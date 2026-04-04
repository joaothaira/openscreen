import type { WebcamSegment } from "@/components/video-editor/types";
import { AsyncVideoFrameQueue } from "./asyncVideoFrameQueue";
import { StreamingVideoDecoder } from "./streamingDecoder";

const MAX_QUEUE_LENGTH = 12;

/**
 * Manages multiple webcam segment decoders running in parallel.
 * Each segment decoder runs forward-only from the beginning of its webcam video.
 * The `getFrame` method returns the correct webcam frame for a given main-video
 * source timestamp, or null when in a gap between segments.
 */
export class SegmentedWebcamSource {
	private segments: WebcamSegment[];
	private decoders: Map<string, StreamingVideoDecoder> = new Map();
	private queues: Map<string, AsyncVideoFrameQueue> = new Map();
	private decodePromises: Map<string, Promise<void>> = new Map();
	private stopped = false;

	constructor(segments: WebcamSegment[]) {
		// Sort by startMs so iteration is predictable
		this.segments = [...segments].sort((a, b) => a.startMs - b.startMs);
	}

	/**
	 * Start all segment decoders concurrently.
	 * Must be called before `getFrame`.
	 * @param frameRate - Export frame rate (fps)
	 */
	start(frameRate: number): void {
		for (const segment of this.segments) {
			const decoder = new StreamingVideoDecoder();
			const queue = new AsyncVideoFrameQueue();
			this.decoders.set(segment.id, decoder);
			this.queues.set(segment.id, queue);

			const promise = (async () => {
				try {
					await decoder.loadMetadata(segment.videoPath);
					await decoder.decodeAll(
						frameRate,
						undefined, // no trim — segments are positioned by startMs in the main timeline
						undefined, // no speed — webcam plays at source speed within its segment
						async (frame) => {
							// Backpressure: stall if the queue is full and we're not stopped
							while (queue.length >= MAX_QUEUE_LENGTH && !this.stopped) {
								await new Promise<void>((resolve) => setTimeout(resolve, 2));
							}
							if (this.stopped) {
								frame.close();
								return;
							}
							queue.enqueue(frame);
						},
					);
				} catch (e) {
					const error = e instanceof Error ? e : new Error(String(e));
					queue.fail(error);
					return;
				}
				queue.close();
			})();

			this.decodePromises.set(segment.id, promise);
		}
	}

	/**
	 * Return the webcam frame for the given main-video source timestamp (ms).
	 * Returns null when no segment is active at that timestamp.
	 * The returned VideoFrame must be closed by the caller.
	 */
	async getFrame(sourceTimestampMs: number): Promise<VideoFrame | null> {
		const segment = this.segments.find(
			(s) => sourceTimestampMs >= s.startMs && sourceTimestampMs < s.startMs + s.durationMs,
		);
		if (!segment) return null;

		const queue = this.queues.get(segment.id);
		if (!queue) return null;

		return await queue.dequeue();
	}

	stop(): void {
		this.stopped = true;
		for (const decoder of this.decoders.values()) {
			decoder.cancel();
		}
		for (const queue of this.queues.values()) {
			queue.destroy();
		}
	}

	destroy(): void {
		this.stop();
		for (const decoder of this.decoders.values()) {
			try {
				decoder.destroy();
			} catch {
				// ignore
			}
		}
		this.decoders.clear();
		this.queues.clear();
		this.decodePromises.clear();
	}
}
