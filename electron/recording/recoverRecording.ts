import fs from "node:fs/promises";
import { patchWebmDurationOnDisk } from "./webm-duration";

/**
 * Recovery for recordings whose writer never finalized (renderer crash, power
 * loss): the streamed bytes are on disk, but the WebM has no Duration header,
 * so the editor's seek bar and timeline get `Infinity`/`N/A`.
 *
 * The duration is estimated by scanning the raw EBML tail: the last Cluster's
 * absolute Timecode plus the largest SimpleBlock relative timestamp inside it.
 * MediaRecorder writes 1 ms timecode scale and ~1 s clusters, so the estimate
 * is within one block of the true duration. @fix-webm-duration/parser can't do
 * this walk — it deliberately skips Cluster internals (`sections.js` comments
 * the Cluster ID out for performance).
 */

const CLUSTER_ID = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
const TIMECODE_ID = 0xe7;
const SIMPLE_BLOCK_ID = 0xa3;
const BLOCK_GROUP_ID = 0xa0;

/** Reads an EBML vint at `pos`; returns its value and width, or null at EOF/invalid. */
function readVint(
	buf: Buffer,
	pos: number,
	keepMarker: boolean,
): { value: number; width: number } | null {
	if (pos >= buf.length) return null;
	const first = buf[pos];
	if (first === 0) return null;
	let width = 1;
	for (let mask = 0x80; !(first & mask); mask >>= 1) {
		width++;
		if (width > 8) return null;
	}
	if (pos + width > buf.length) return null;
	let value = keepMarker ? first : first & (0xff >> width);
	for (let i = 1; i < width; i++) {
		value = value * 256 + buf[pos + i];
	}
	return { value, width };
}

/** True when an element size vint is the EBML "unknown size" sentinel (all value bits set). */
function isUnknownSize(size: { value: number; width: number }): boolean {
	// 1-byte 0xFF → value 127, 2-byte 0x01FF… etc. All value bits set.
	return size.value === 2 ** (7 * size.width) - 1;
}

/**
 * Walks the children of the cluster starting at `clusterPayloadStart`, returning the
 * cluster's absolute Timecode plus the largest SimpleBlock relative timestamp, or
 * null when the bytes don't parse as a cluster (e.g. a false-positive ID match
 * inside media payload).
 */
function parseClusterDurationMs(buf: Buffer, clusterPayloadStart: number, end: number) {
	let pos = clusterPayloadStart;
	let timecode: number | null = null;
	let maxRelative = 0;

	while (pos < end) {
		const id = readVint(buf, pos, true);
		if (!id) break;
		pos += id.width;
		const size = readVint(buf, pos, false);
		if (!size) break;
		pos += size.width;
		const payloadEnd = isUnknownSize(size) ? end : pos + size.value;
		if (payloadEnd > buf.length) break;

		if (id.value === TIMECODE_ID) {
			let v = 0;
			for (let i = pos; i < payloadEnd; i++) v = v * 256 + buf[i];
			timecode = v;
		} else if (id.value === SIMPLE_BLOCK_ID || id.value === BLOCK_GROUP_ID) {
			// SimpleBlock payload: track vint, then int16BE relative timestamp.
			// BlockGroup nests a Block with the same prefix — close enough to scan the
			// first bytes the same way for a tail estimate.
			const track = readVint(buf, pos, false);
			if (track && pos + track.width + 2 <= payloadEnd) {
				const rel = buf.readInt16BE(pos + track.width);
				if (rel > maxRelative) maxRelative = rel;
			}
		} else if (timecode !== null) {
			// Unknown element after the timecode — likely we ran into the next
			// top-level element of an unknown-size cluster. Stop here.
			break;
		}

		pos = payloadEnd;
	}

	return timecode === null ? null : timecode + maxRelative;
}

/**
 * Estimates the playable duration of a (possibly truncated) WebM by parsing its
 * tail clusters. Returns null when no cluster parses — a file too damaged to
 * estimate, which the caller should surface as-is rather than mis-patch.
 */
export function estimateWebmDurationMs(buf: Buffer): number | null {
	// Walk cluster ID matches from the end; payload bytes can contain the ID
	// pattern by chance, so fall back to earlier matches until one parses.
	let searchEnd = buf.length;
	for (let attempt = 0; attempt < 8; attempt++) {
		const idx = buf.lastIndexOf(CLUSTER_ID, searchEnd - 1);
		if (idx < 0) return null;
		const size = readVint(buf, idx + CLUSTER_ID.length, false);
		if (size) {
			const payloadStart = idx + CLUSTER_ID.length + size.width;
			const end = isUnknownSize(size)
				? buf.length
				: Math.min(buf.length, payloadStart + size.value);
			const duration = parseClusterDurationMs(buf, payloadStart, end);
			if (duration !== null && duration > 0) return duration;
		}
		searchEnd = idx;
	}
	return null;
}

/**
 * One-shot duration repair for a crash-orphaned WebM: estimate from the cluster
 * tail, then patch the header on disk. Best-effort — failures leave the file
 * untouched (it still plays; only seeking misbehaves).
 */
export async function repairWebmDurationOnDisk(
	filePath: string,
): Promise<{ repaired: boolean; durationMs?: number }> {
	try {
		const bytes = await fs.readFile(filePath);
		const durationMs = estimateWebmDurationMs(bytes);
		if (!durationMs) {
			console.warn(`[recover-recording] could not estimate duration for ${filePath}`);
			return { repaired: false };
		}
		const result = await patchWebmDurationOnDisk(filePath, durationMs);
		// "already-valid" means a previous repair (or clean finalize) got there first.
		return { repaired: result.patched, durationMs };
	} catch (error) {
		console.error(`[recover-recording] failed to repair ${filePath}:`, error);
		return { repaired: false };
	}
}
