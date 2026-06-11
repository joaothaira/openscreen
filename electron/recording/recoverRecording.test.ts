import { describe, expect, it } from "vitest";
import { estimateWebmDurationMs } from "./recoverRecording";

/** Builds an EBML element: 1-byte id, 1-byte size, payload. */
function el(id: number, payload: number[]): number[] {
	return [id, 0x80 | payload.length, ...payload];
}

/** Builds a Cluster with the given absolute timecode and SimpleBlock relative offsets. */
function cluster(timecodeMs: number, blockRelMs: number[], unknownSize = false): number[] {
	const children = [
		...el(0xe7, [(timecodeMs >> 8) & 0xff, timecodeMs & 0xff]),
		...blockRelMs.flatMap((rel) =>
			// SimpleBlock payload: track vint (0x81), int16BE relative time, flags, fake frame data
			el(0xa3, [0x81, (rel >> 8) & 0xff, rel & 0xff, 0x80, 0xde, 0xad]),
		),
	];
	const sizeBytes = unknownSize
		? [0xff] // 1-byte unknown-size sentinel
		: [0x80 | children.length];
	return [0x1f, 0x43, 0xb6, 0x75, ...sizeBytes, ...children];
}

describe("estimateWebmDurationMs", () => {
	it("returns last cluster timecode plus the largest block offset", () => {
		const buf = Buffer.from([
			...cluster(0, [100, 500, 900]),
			...cluster(1000, [200, 800]),
			...cluster(2000, [350]),
		]);
		expect(estimateWebmDurationMs(buf)).toBe(2350);
	});

	it("handles unknown-size clusters from streamed MediaRecorder output", () => {
		const buf = Buffer.from([...cluster(0, [500], true), ...cluster(3000, [250, 750], true)]);
		expect(estimateWebmDurationMs(buf)).toBe(3750);
	});

	it("falls back to an earlier cluster when trailing bytes mimic a cluster id", () => {
		const buf = Buffer.from([
			...cluster(5000, [400]),
			// Truncated garbage that contains the cluster ID pattern but no parsable children.
			0x1f,
			0x43,
			0xb6,
			0x75,
		]);
		expect(estimateWebmDurationMs(buf)).toBe(5400);
	});

	it("returns null when no cluster exists", () => {
		expect(estimateWebmDurationMs(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]))).toBeNull();
	});
});
