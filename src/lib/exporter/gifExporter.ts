import GIF from "gif.js";
import type {
	AnnotationRegion,
	CropRegion,
	SpeedRegion,
	SubtitleItem,
	SubtitleStyle,
	TrimRegion,
	WebcamFocusRegion,
	WebcamLayoutPreset,
	WebcamMaskShape,
	WebcamSegment,
	ZoomRegion,
} from "@/components/video-editor/types";
import { BackgroundLoadError } from "@/lib/wallpaper";
import type { CursorRecordingData } from "@/native/contracts";
import { FrameRenderer } from "./frameRenderer";
import { SegmentedWebcamSource } from "./segmentedWebcamSource";
import { StreamingVideoDecoder } from "./streamingDecoder";
import type {
	ExportProgress,
	ExportResult,
	GIF_SIZE_PRESETS,
	GifFrameRate,
	GifSizePreset,
} from "./types";

const GIF_WORKER_URL = new URL("gif.js/dist/gif.worker.js", import.meta.url).toString();

interface GifExporterConfig {
	videoUrl: string;
	webcamSegments?: WebcamSegment[];
	width: number;
	height: number;
	frameRate: GifFrameRate;
	loop: boolean;
	sizePreset: GifSizePreset;
	wallpaper: string;
	zoomRegions: ZoomRegion[];
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	showShadow: boolean;
	shadowIntensity: number;
	showBlur: boolean;
	motionBlurAmount?: number;
	borderRadius?: number;
	padding?: number;
	videoPadding?: number;
	cropRegion: CropRegion;
	webcamLayoutPreset?: WebcamLayoutPreset;
	webcamMaskShape?: WebcamMaskShape;
	webcamMirrored?: boolean;
	webcamReactiveZoom?: boolean;
	webcamSizePreset?: import("@/components/video-editor/types").WebcamSizePreset;
	webcamPosition?: { cx: number; cy: number } | null;
	webcamCornerPreset?: import("@/components/video-editor/types").WebcamCornerPreset | null;
	webcamStackPosition?: import("@/components/video-editor/types").WebcamStackPosition | null;
	webcamFocusZoom?: number;
	cursorRecordingData?: CursorRecordingData | null;
	cursorScale?: number;
	cursorSmoothing?: number;
	cursorMotionBlur?: number;
	cursorClickBounce?: number;
	cursorClipToBounds?: boolean;
	cursorTheme?: string;
	annotationRegions?: AnnotationRegion[];
	webcamFocusRegions?: WebcamFocusRegion[];
	previewWidth?: number;
	previewHeight?: number;
	cursorTelemetry?: import("@/components/video-editor/types").CursorTelemetryPoint[];
	subtitleRegions?: SubtitleItem[];
	showSubtitles?: boolean;
	subtitleStyle?: SubtitleStyle;
	onProgress?: (progress: ExportProgress) => void;
}

/**
 * Calculate output dimensions based on size preset and source dimensions while preserving aspect ratio.
 * @param sourceWidth - Original video width
 * @param sourceHeight - Original video height
 * @param sizePreset - The size preset to use
 * @param sizePresets - The size presets configuration
 * @returns The calculated output dimensions
 */
export function calculateOutputDimensions(
	sourceWidth: number,
	sourceHeight: number,
	sizePreset: GifSizePreset,
	sizePresets: typeof GIF_SIZE_PRESETS,
	targetAspectRatio = sourceWidth / sourceHeight,
): { width: number; height: number } {
	const preset = sizePresets[sizePreset];
	const maxHeight = preset.maxHeight;
	const aspectRatio =
		Number.isFinite(targetAspectRatio) && targetAspectRatio > 0
			? targetAspectRatio
			: sourceWidth / sourceHeight;

	const toEven = (value: number) => {
		const evenValue = Math.max(2, Math.floor(value / 2) * 2);
		return evenValue;
	};

	if (sizePreset === "original") {
		const sourceAspect = sourceWidth / sourceHeight;
		if (aspectRatio >= sourceAspect) {
			const width = toEven(sourceWidth);
			const height = toEven(width / aspectRatio);
			return { width, height };
		}

		const height = toEven(sourceHeight);
		const width = toEven(height * aspectRatio);
		return { width, height };
	}

	const targetHeight = maxHeight;
	const targetWidth = Math.round(targetHeight * aspectRatio);

	return {
		width: toEven(targetWidth),
		height: toEven(targetHeight),
	};
}

export class GifExporter {
	private config: GifExporterConfig;
	private streamingDecoder: StreamingVideoDecoder | null = null;
	private webcamSource: SegmentedWebcamSource | null = null;
	private renderer: FrameRenderer | null = null;
	private gif: GIF | null = null;
	private cancelled = false;

	constructor(config: GifExporterConfig) {
		this.config = config;
	}

	async export(): Promise<ExportResult> {
		try {
			this.cleanup();
			this.cancelled = false;

			this.streamingDecoder = new StreamingVideoDecoder();
			const videoInfo = await this.streamingDecoder.loadMetadata(this.config.videoUrl);

			// Probe the first webcam segment for renderer dimensions
			const segments = this.config.webcamSegments ?? [];
			let webcamSize: { width: number; height: number } | null = null;
			if (segments.length > 0) {
				const probeDecoder = new StreamingVideoDecoder();
				try {
					const info = await probeDecoder.loadMetadata(segments[0].videoPath);
					webcamSize = { width: info.width, height: info.height };
				} finally {
					probeDecoder.destroy();
				}
			}

			this.renderer = new FrameRenderer({
				width: this.config.width,
				height: this.config.height,
				wallpaper: this.config.wallpaper,
				zoomRegions: this.config.zoomRegions,
				showShadow: this.config.showShadow,
				shadowIntensity: this.config.shadowIntensity,
				showBlur: this.config.showBlur,
				motionBlurAmount: this.config.motionBlurAmount,
				borderRadius: this.config.borderRadius,
				padding: this.config.padding,
				cropRegion: this.config.cropRegion,
				cursorRecordingData: this.config.cursorRecordingData,
				cursorScale: this.config.cursorScale,
				cursorSmoothing: this.config.cursorSmoothing,
				cursorMotionBlur: this.config.cursorMotionBlur,
				cursorClickBounce: this.config.cursorClickBounce,
				cursorClipToBounds: this.config.cursorClipToBounds,
				cursorTheme: this.config.cursorTheme,
				videoWidth: videoInfo.width,
				videoHeight: videoInfo.height,
				webcamSize,
				webcamLayoutPreset: this.config.webcamLayoutPreset,
				webcamMaskShape: this.config.webcamMaskShape,
				webcamMirrored: this.config.webcamMirrored,
				webcamReactiveZoom: this.config.webcamReactiveZoom,
				webcamSizePreset: this.config.webcamSizePreset,
				webcamPosition: this.config.webcamPosition,
				webcamCornerPreset: this.config.webcamCornerPreset,
				webcamStackPosition: this.config.webcamStackPosition,
				webcamFocusZoom: this.config.webcamFocusZoom,
				annotationRegions: this.config.annotationRegions,
				subtitleRegions: this.config.subtitleRegions,
				showSubtitles: this.config.showSubtitles,
				subtitleStyle: this.config.subtitleStyle,
				speedRegions: this.config.speedRegions,
				webcamFocusRegions: this.config.webcamFocusRegions,
				previewWidth: this.config.previewWidth,
				previewHeight: this.config.previewHeight,
				cursorTelemetry: this.config.cursorTelemetry,
			});
			await this.renderer.initialize();

			// gif.js repeat: 0 = infinite loop, 1 = play once
			const repeat = this.config.loop ? 0 : 1;
			const cores = navigator.hardwareConcurrency || 4;
			const WORKER_COUNT = Math.max(1, Math.min(8, cores - 1));
			this.gif = new GIF({
				workers: WORKER_COUNT,
				quality: 10,
				width: this.config.width,
				height: this.config.height,
				workerScript: GIF_WORKER_URL,
				repeat,
				background: "#000000",
				transparent: null,
				dither: "FloydSteinberg",
			});

			// Effective duration and frame count, excluding trim regions
			const { effectiveDuration, totalFrames } = this.streamingDecoder.getExportMetrics(
				this.config.frameRate,
				this.config.trimRegions,
				this.config.speedRegions,
			);

			// gif.js wants frame delay in ms
			const frameDelay = Math.round(1000 / this.config.frameRate);

			console.log("[GifExporter] Original duration:", videoInfo.duration, "s");
			console.log("[GifExporter] Effective duration:", effectiveDuration, "s");
			console.log("[GifExporter] Total frames to export:", totalFrames);
			console.log("[GifExporter] Frame rate:", this.config.frameRate, "FPS");
			console.log("[GifExporter] Frame delay:", frameDelay, "ms");
			console.log("[GifExporter] Loop:", this.config.loop ? "infinite" : "once");
			console.log("[GifExporter] Using streaming decode (web-demuxer + VideoDecoder)");

			// Start segmented webcam source if there are segments
			let frameIndex = 0;
			if (segments.length > 0) {
				this.webcamSource = new SegmentedWebcamSource(segments);
				this.webcamSource.start(this.config.frameRate);
			}

			// Stream decode and process frames, no seeking
			await this.streamingDecoder.decodeAll(
				this.config.frameRate,
				this.config.trimRegions,
				this.config.speedRegions,
				async (videoFrame, _exportTimestampUs, sourceTimestampMs) => {
					let webcamFrame: VideoFrame | null = null;
					try {
						if (this.cancelled) {
							return;
						}

						webcamFrame = this.webcamSource
							? await this.webcamSource.getFrame(sourceTimestampMs)
							: null;
						const renderer = this.renderer;
						if (this.cancelled || !renderer) {
							return;
						}

						const sourceTimestampUs = sourceTimestampMs * 1000; // us
						await renderer.renderFrame(videoFrame, sourceTimestampUs, webcamFrame);

						const canvas = renderer.getCanvas();

						this.gif!.addFrame(canvas, { delay: frameDelay, copy: true });

						frameIndex++;

						if (this.config.onProgress) {
							this.config.onProgress({
								currentFrame: frameIndex,
								totalFrames,
								percentage: (frameIndex / totalFrames) * 100,
								estimatedTimeRemaining: 0,
							});
						}
					} finally {
						videoFrame.close();
						webcamFrame?.close();
					}
				},
			);

			if (this.cancelled) {
				return { success: false, error: "Export cancelled" };
			}

			this.webcamSource?.stop();

			// Now in the finalizing phase
			if (this.config.onProgress) {
				this.config.onProgress({
					currentFrame: totalFrames,
					totalFrames,
					percentage: 100,
					estimatedTimeRemaining: 0,
					phase: "finalizing",
				});
			}

			const blob = await new Promise<Blob>((resolve, _reject) => {
				this.gif!.on("finished", (blob: Blob) => {
					resolve(blob);
				});

				this.gif!.on("progress", (progress: number) => {
					if (this.config.onProgress) {
						this.config.onProgress({
							currentFrame: totalFrames,
							totalFrames,
							percentage: 100,
							estimatedTimeRemaining: 0,
							phase: "finalizing",
							renderProgress: Math.round(progress * 100),
						});
					}
				});

				// gif.js has no typed 'error' event; the outer try/catch handles failures
				this.gif!.render();
			});

			return { success: true, blob };
		} catch (error) {
			if (error instanceof BackgroundLoadError) {
				throw error;
			}
			console.error("GIF Export error:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			this.cleanup();
		}
	}

	cancel(): void {
		this.cancelled = true;
		if (this.streamingDecoder) {
			this.streamingDecoder.cancel();
		}
		if (this.webcamSource) {
			this.webcamSource.stop();
		}
		if (this.gif) {
			this.gif.abort();
		}
		this.cleanup();
	}

	private cleanup(): void {
		if (this.streamingDecoder) {
			try {
				this.streamingDecoder.destroy();
			} catch (e) {
				console.warn("Error destroying streaming decoder:", e);
			}
			this.streamingDecoder = null;
		}

		if (this.webcamSource) {
			try {
				this.webcamSource.destroy();
			} catch (e) {
				console.warn("Error destroying webcam source:", e);
			}
			this.webcamSource = null;
		}

		if (this.renderer) {
			try {
				this.renderer.destroy();
			} catch (e) {
				console.warn("Error destroying renderer:", e);
			}
			this.renderer = null;
		}

		this.gif = null;
	}
}
