import { type AnnotationRegion, type ArrowDirection } from "@/components/video-editor/types";
import { getTextAnimationState } from "@/lib/annotationTextAnimation";
import {
	applyMosaicToImageData,
	getBlurOverlayColor,
	getNormalizedBlurIntensity,
	getNormalizedMosaicBlockSize,
	normalizeBlurType,
} from "@/lib/blurEffects";

let blurScratchCanvas: HTMLCanvasElement | null = null;
let blurScratchCtx: CanvasRenderingContext2D | null = null;

// Matches a single code point whose script is Han (including non-BMP
// Extension A-F), Hiragana, Katakana (including halfwidth forms), or
// Hangul. Used to split CJK text at character boundaries during wrap,
// since CJK scripts have no word-separating whitespace. Unicode script
// property escapes require ES2018+; tsconfig target is ES2020.
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

type GraphemeSegmenter = {
	segment(value: string): Iterable<{ segment: string }>;
};

type IntlWithSegmenter = typeof Intl & {
	Segmenter?: new (
		locales?: string | string[],
		options?: { granularity?: "grapheme" },
	) => GraphemeSegmenter;
};

const Segmenter = (Intl as IntlWithSegmenter).Segmenter;
const graphemeSegmenter =
	typeof Segmenter === "function" ? new Segmenter(undefined, { granularity: "grapheme" }) : null;

function splitGraphemes(value: string): string[] {
	if (!graphemeSegmenter) return Array.from(value);
	return Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
}

function tokenizeForWrap(line: string): string[] {
	// Split Latin text on whitespace (preserving the whitespace as its own token,
	// matching the original behavior), and split CJK runs into individual
	// characters so each one becomes a breakable unit. This mirrors the editor's
	// CSS `word-break: break-word` handling for CJK content.
	const tokens: string[] = [];
	let buffer = "";
	const chars = Array.from(line);
	const flushBuffer = () => {
		if (buffer) {
			tokens.push(...buffer.split(/(\s+)/).filter((s) => s.length > 0));
			buffer = "";
		}
	};
	for (const ch of chars) {
		if (CJK_CHAR.test(ch)) {
			flushBuffer();
			tokens.push(ch);
		} else {
			buffer += ch;
		}
	}
	flushBuffer();
	return tokens;
}

// SVG path data for each arrow direction
const ARROW_PATHS: Record<ArrowDirection, string[]> = {
	up: ["M 50 20 L 50 80", "M 50 20 L 35 35", "M 50 20 L 65 35"],
	down: ["M 50 20 L 50 80", "M 50 80 L 35 65", "M 50 80 L 65 65"],
	left: ["M 80 50 L 20 50", "M 20 50 L 35 35", "M 20 50 L 35 65"],
	right: ["M 20 50 L 80 50", "M 80 50 L 65 35", "M 80 50 L 65 65"],
	"up-right": ["M 25 75 L 75 25", "M 75 25 L 60 30", "M 75 25 L 70 40"],
	"up-left": ["M 75 75 L 25 25", "M 25 25 L 40 30", "M 25 25 L 30 40"],
	"down-right": ["M 25 25 L 75 75", "M 75 75 L 70 60", "M 75 75 L 60 70"],
	"down-left": ["M 75 25 L 25 75", "M 25 75 L 30 60", "M 25 75 L 40 70"],
};

function parseSvgPath(
	pathString: string,
	scaleX: number,
	scaleY: number,
): Array<{ cmd: string; args: number[] }> {
	const commands: Array<{ cmd: string; args: number[] }> = [];
	const parts = pathString.trim().split(/\s+/);

	let i = 0;
	while (i < parts.length) {
		const cmd = parts[i];
		if (cmd === "M" || cmd === "L") {
			const x = parseFloat(parts[i + 1]) * scaleX;
			const y = parseFloat(parts[i + 2]) * scaleY;
			commands.push({ cmd, args: [x, y] });
			i += 3;
		} else {
			i++;
		}
	}

	return commands;
}

function renderArrow(
	ctx: CanvasRenderingContext2D,
	direction: ArrowDirection,
	color: string,
	strokeWidth: number,
	x: number,
	y: number,
	width: number,
	height: number,
	_scaleFactor: number,
) {
	const paths = ARROW_PATHS[direction];
	if (!paths) return;

	ctx.save();
	ctx.translate(x, y);

	const padding = 8 * _scaleFactor;
	const availableWidth = Math.max(0, width - padding * 2);
	const availableHeight = Math.max(0, height - padding * 2);

	const scale = Math.min(availableWidth / 100, availableHeight / 100);

	const offsetX = padding + (availableWidth - 100 * scale) / 2;
	const offsetY = padding + (availableHeight - 100 * scale) / 2;

	// Apply centering offset
	ctx.translate(offsetX, offsetY);

	// Apply shadow filter
	ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
	ctx.shadowBlur = 8 * scale;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = 4 * scale;

	ctx.strokeStyle = color;
	ctx.lineWidth = strokeWidth * scale;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	// Draw all paths as a single shape to avoid overlapping shadows/strokes
	ctx.beginPath();

	for (const pathString of paths) {
		const commands = parseSvgPath(pathString, scale, scale);

		for (const { cmd, args } of commands) {
			if (cmd === "M") {
				ctx.moveTo(args[0], args[1]);
			} else if (cmd === "L") {
				ctx.lineTo(args[0], args[1]);
			}
		}
	}

	ctx.stroke();

	ctx.restore();
}

function drawBlurPath(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
) {
	const shape = annotation.blurData?.shape || "rectangle";
	if (shape === "rectangle") {
		ctx.beginPath();
		ctx.rect(x, y, width, height);
		return;
	}

	if (shape === "oval") {
		ctx.beginPath();
		ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
		return;
	}

	const points = annotation.blurData?.freehandPoints;
	if (shape === "freehand" && points && points.length >= 3) {
		ctx.beginPath();
		ctx.moveTo(x + (points[0].x / 100) * width, y + (points[0].y / 100) * height);
		for (let i = 1; i < points.length; i++) {
			ctx.lineTo(x + (points[i].x / 100) * width, y + (points[i].y / 100) * height);
		}
		ctx.closePath();
		return;
	}

	ctx.beginPath();
	ctx.rect(x, y, width, height);
}

function renderBlur(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
	scaleFactor: number,
) {
	const canvas = ctx.canvas;
	const blurType = normalizeBlurType(annotation.blurData?.type);

	const blurRadius = Math.max(
		1,
		Math.round(getNormalizedBlurIntensity(annotation.blurData) * scaleFactor),
	);
	const samplePadding =
		blurType === "mosaic"
			? Math.max(0, Math.ceil(getNormalizedMosaicBlockSize(annotation.blurData, scaleFactor)))
			: Math.max(2, Math.ceil(blurRadius * 2));
	const sx = Math.max(0, Math.floor(x) - samplePadding);
	const sy = Math.max(0, Math.floor(y) - samplePadding);
	const ex = Math.min(canvas.width, Math.ceil(x + width) + samplePadding);
	const ey = Math.min(canvas.height, Math.ceil(y + height) + samplePadding);
	const sw = Math.max(0, ex - sx);
	const sh = Math.max(0, ey - sy);
	if (sw <= 0 || sh <= 0) return;

	if (!blurScratchCanvas || !blurScratchCtx) {
		blurScratchCanvas = document.createElement("canvas");
		blurScratchCtx = blurScratchCanvas.getContext("2d");
	}
	if (!blurScratchCanvas || !blurScratchCtx) return;

	blurScratchCanvas.width = sw;
	blurScratchCanvas.height = sh;
	blurScratchCtx.clearRect(0, 0, sw, sh);
	blurScratchCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

	if (blurType === "mosaic") {
		const imageData = blurScratchCtx.getImageData(0, 0, sw, sh);
		applyMosaicToImageData(
			imageData,
			getNormalizedMosaicBlockSize(annotation.blurData, scaleFactor),
		);
		blurScratchCtx.putImageData(imageData, 0, 0);
	}

	ctx.save();
	drawBlurPath(ctx, annotation, x, y, width, height);
	ctx.clip();
	ctx.filter = blurType === "mosaic" ? "none" : `blur(${blurRadius}px)`;
	ctx.drawImage(blurScratchCanvas, sx, sy);
	ctx.filter = "none";
	ctx.fillStyle = getBlurOverlayColor(annotation.blurData);
	ctx.fillRect(sx, sy, sw, sh);
	ctx.restore();
}

function renderText(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
	scaleFactor: number,
	currentTimeMs: number,
) {
	const style = annotation.style;
	const animationState = getTextAnimationState(annotation, currentTimeMs);

	ctx.save();

	const transformOriginX = x + width / 2;
	const transformOriginY = y + height / 2;
	ctx.translate(transformOriginX, transformOriginY);
	ctx.translate(animationState.translateX * scaleFactor, animationState.translateY * scaleFactor);
	ctx.scale(animationState.scale, animationState.scale);
	ctx.translate(-transformOriginX, -transformOriginY);
	ctx.globalAlpha *= animationState.opacity;

	// Clip text to annotation box bounds (matches editor's overflow: hidden)
	ctx.beginPath();
	ctx.rect(x, y, width, height);
	ctx.clip();

	const fontWeight = style.fontWeight ?? "normal";
	const fontStretch = style.fontStretch ?? "normal";
	const fontStyle = style.fontStyle === "italic" ? "italic" : "normal";
	const scaledFontSize = style.fontSize * scaleFactor;
	ctx.font = `${fontStyle} ${fontWeight} ${fontStretch} ${scaledFontSize}px ${style.fontFamily}`;
	ctx.textBaseline = "middle";

	const containerPadding = 8 * scaleFactor;

	let textX = x;
	let textY = y + height / 2;

	if (style.textAlign === "center") {
		textX = x + width / 2;
		ctx.textAlign = "center";
	} else if (style.textAlign === "right") {
		textX = x + width - containerPadding;
		ctx.textAlign = "right";
	} else {
		textX = x + containerPadding;
		ctx.textAlign = "left";
	}

	const availableWidth = width - containerPadding * 2;
	const rawLines = annotation.content.split("\n");
	const lines: string[] = [];
	for (const rawLine of rawLines) {
		if (!rawLine) {
			lines.push("");
			continue;
		}
		const tokens = tokenizeForWrap(rawLine);
		let current = "";
		for (const token of tokens) {
			const test = current + token;
			if (current && ctx.measureText(test).width > availableWidth) {
				lines.push(current);
				current = token.trimStart();
			} else {
				current = test;
			}
		}
		if (current) lines.push(current);
	}
	const lineHeight = scaledFontSize * 1.4;

	const startY = textY - ((lines.length - 1) * lineHeight) / 2;

	lines.forEach((line, index) => {
		const currentY = startY + index * lineHeight;
		const revealProgress = animationState.revealProgress;
		const graphemes = splitGraphemes(line);
		const visibleCount = Math.ceil(graphemes.length * revealProgress);
		const visibleLine = revealProgress >= 1 ? line : graphemes.slice(0, visibleCount).join("");
		if (!visibleLine && revealProgress < 1) return;

		const previousAlign = ctx.textAlign;
		const fullMetrics = ctx.measureText(line);
		let startX = textX;

		if (ctx.textAlign === "center") {
			startX = textX - fullMetrics.width / 2;
			ctx.textAlign = "left";
		} else if (ctx.textAlign === "right" || ctx.textAlign === "end") {
			startX = textX - fullMetrics.width;
			ctx.textAlign = "left";
		}

		if (style.backgroundColor && style.backgroundColor !== "transparent") {
			const metrics = ctx.measureText(visibleLine);
			const verticalPadding = scaledFontSize * 0.1;
			const horizontalPadding = scaledFontSize * 0.2;
			const borderRadius = 4 * scaleFactor;

			let bgX = startX - horizontalPadding;
			const bgWidth = metrics.width + horizontalPadding * 2;

			const contentHeight = scaledFontSize * 1.4;
			const bgHeight = contentHeight + verticalPadding * 2;
			const bgY = currentY - bgHeight / 2;

			if (previousAlign === "left" || previousAlign === "start") {
				bgX = textX - horizontalPadding;
			}

			ctx.fillStyle = style.backgroundColor;
			ctx.beginPath();
			ctx.roundRect(bgX, bgY, bgWidth, bgHeight, borderRadius);
			ctx.fill();
		}

		ctx.fillStyle = style.color;
		ctx.fillText(visibleLine, startX, currentY);

		if (style.textDecoration === "underline") {
			const metrics = ctx.measureText(visibleLine);
			let underlineX = startX;
			const underlineY = currentY + scaledFontSize * 0.15;

			if (previousAlign === "left" || previousAlign === "start") {
				underlineX = textX;
			}

			ctx.strokeStyle = style.color;
			ctx.lineWidth = Math.max(1, scaledFontSize / 16);
			ctx.beginPath();
			ctx.moveTo(underlineX, underlineY);
			ctx.lineTo(underlineX + metrics.width, underlineY);
			ctx.stroke();
		}

		ctx.textAlign = previousAlign;
	});

	ctx.restore();
}

async function renderImage(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
	scaleFactor: number,
	currentTimeMs: number,
): Promise<void> {
	if (!annotation.content || !annotation.content.startsWith("data:image")) {
		return;
	}

	const borderRadius = (annotation.style.borderRadius ?? 0) * scaleFactor;
	const imgData = annotation.imageData;
	const timeIntoAnnotation = currentTimeMs - annotation.startMs;
	const totalDuration = annotation.endMs - annotation.startMs;
	const animDuration = imgData?.animationDuration ?? 500;

	const rawProgress = Math.min(1, Math.max(0, timeIntoAnnotation / animDuration));
	const p = 1 - Math.pow(1 - rawProgress, 3);
	const animType = imgData?.animationType ?? "none";

	const fadeOutStart = Math.max(0, totalDuration - animDuration);
	const exitRaw = imgData?.fadeOut
		? Math.min(1, Math.max(0, (timeIntoAnnotation - fadeOutStart) / animDuration))
		: 0;
	const exitOpacity = imgData?.fadeOut ? 1 - exitRaw : 1;

	const animOpacity = (animType !== "none" && rawProgress < 1 ? p : 1) * exitOpacity;
	let offsetX = 0;
	let offsetY = 0;
	let zoomScale = 1;
	if (animType !== "none" && rawProgress < 1) {
		if (animType === "slide-up") offsetY = (1 - p) * height * 0.5;
		else if (animType === "slide-down") offsetY = -(1 - p) * height * 0.5;
		else if (animType === "slide-left") offsetX = (1 - p) * width * 0.5;
		else if (animType === "slide-right") offsetX = -(1 - p) * width * 0.5;
		else if (animType === "zoom") zoomScale = 0.75 + 0.25 * p;
	}

	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => {
			ctx.save();
			ctx.globalAlpha *= animOpacity;

			// Clip to annotation bounds (static — slide/zoom stays inside the box)
			ctx.beginPath();
			if (borderRadius > 0) {
				ctx.roundRect(x, y, width, height, borderRadius);
			} else {
				ctx.rect(x, y, width, height);
			}
			ctx.clip();

			// object-cover: fill the box, center-crop
			const imgAspect = img.width / img.height;
			const boxAspect = width / height;
			let drawWidth = width;
			let drawHeight = height;
			let drawX = x;
			let drawY = y;

			if (imgAspect > boxAspect) {
				drawWidth = height * imgAspect;
				drawX = x - (drawWidth - width) / 2;
			} else {
				drawHeight = width / imgAspect;
				drawY = y - (drawHeight - height) / 2;
			}

			// Apply animation offset / zoom
			if (zoomScale !== 1) {
				const cx = x + width / 2;
				const cy = y + height / 2;
				drawX = cx - (drawWidth * zoomScale) / 2;
				drawY = cy - (drawHeight * zoomScale) / 2;
				drawWidth *= zoomScale;
				drawHeight *= zoomScale;
			} else {
				drawX += offsetX;
				drawY += offsetY;
			}

			ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
			ctx.restore();
			resolve();
		};
		img.onerror = () => {
			console.error("[AnnotationRenderer] Failed to load image annotation");
			resolve();
		};
		img.src = annotation.content;
	});
}

function renderMarker(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
	currentTimeMs: number,
) {
	const data = annotation.markerData;
	if (!data) return;

	const timeIntoAnnotation = currentTimeMs - annotation.startMs;
	const totalDuration = annotation.endMs - annotation.startMs;
	const fadeOutStart = Math.max(0, totalDuration - 500);
	const globalOpacity =
		timeIntoAnnotation >= fadeOutStart
			? Math.max(0, 1 - (timeIntoAnnotation - fadeOutStart) / 500)
			: 1;

	const sweepProgress = Math.min(1, Math.max(0, timeIntoAnnotation / data.animationDuration));

	let drawX = x;
	let drawW = width * sweepProgress;
	if (data.direction === "right") {
		drawX = x + width * (1 - sweepProgress);
	}

	ctx.save();
	ctx.globalAlpha = data.opacity * globalOpacity;
	ctx.fillStyle = data.color;
	ctx.fillRect(drawX, y, drawW, height);
	ctx.restore();
}

async function renderCaption(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
	scaleFactor: number,
	currentTimeMs: number,
): Promise<void> {
	const data = annotation.captionData;
	if (!data) return;

	const timeIntoAnnotation = currentTimeMs - annotation.startMs;
	const totalDuration = annotation.endMs - annotation.startMs;
	const fadeOutStart = Math.max(0, totalDuration - 500);
	const globalOpacity =
		timeIntoAnnotation >= fadeOutStart
			? Math.max(0, 1 - (timeIntoAnnotation - fadeOutStart) / 500)
			: 1;
	const fadeInOpacity = Math.min(1, Math.max(0, timeIntoAnnotation / 400));
	const backgroundOpacity = fadeInOpacity * globalOpacity;

	ctx.save();

	// Gradient background
	if (data.gradientDirection !== "none" && backgroundOpacity > 0) {
		let x0 = x,
			y0 = y,
			x1 = x,
			y1 = y;
		switch (data.gradientDirection) {
			case "bottom":
				y0 = y + height;
				y1 = y;
				x1 = x;
				break;
			case "top":
				y0 = y;
				y1 = y + height;
				break;
			case "left":
				x0 = x;
				x1 = x + width;
				break;
			case "right":
				x0 = x + width;
				x1 = x;
				break;
		}
		const grad = ctx.createLinearGradient(x0, y0, x1, y1);
		grad.addColorStop(0, `rgba(0,0,0,${0.88 * backgroundOpacity})`);
		grad.addColorStop(0.6, `rgba(0,0,0,${0.4 * backgroundOpacity})`);
		grad.addColorStop(1, "rgba(0,0,0,0)");
		ctx.fillStyle = grad;
		ctx.fillRect(x, y, width, height + 4); // +4 covers bottom edge
	}

	const padding = 20 * scaleFactor;
	const lineGap = 4 * scaleFactor;
	const imageGap = 6 * scaleFactor;
	const primaryFontSize = data.primaryFontSize * scaleFactor;
	const secondaryFontSize = data.secondaryFontSize * scaleFactor;

	// For left/right gradients pin to that side; otherwise follow textAlign
	const effectiveAlign =
		data.gradientDirection === "left"
			? "left"
			: data.gradientDirection === "right"
				? "right"
				: (data.textAlign ?? "center");
	const isLeft = effectiveAlign === "left";
	const isRight = effectiveAlign === "right";
	const isTop = data.gradientDirection === "top";

	const availableWidth = width - 2 * padding;

	// Load image first so we know its dimensions for layout
	let imgElement: HTMLImageElement | null = null;
	let imgDrawW = 0;
	let imgDrawH = 0;
	if (data.imageUrl) {
		imgElement = await new Promise<HTMLImageElement | null>((resolve) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => resolve(null);
			img.src = data.imageUrl!;
		});
		if (imgElement) {
			const maxH = height * 0.35;
			const maxW = width * 0.6;
			const aspect = imgElement.width / imgElement.height;
			imgDrawW = Math.min(maxW, maxH * aspect);
			imgDrawH = imgDrawW / aspect;
			if (imgDrawH > maxH) {
				imgDrawH = maxH;
				imgDrawW = imgDrawH * aspect;
			}
		}
	}
	const imageBlockHeight = imgElement ? imgDrawH + imageGap : 0;

	// Wrap text into lines that fit within availableWidth
	const wrapText = (text: string, fontSize: number): string[][] => {
		const uppercased = text.toUpperCase();
		const words = uppercased.split(" ").filter((w) => w.length > 0);
		ctx.font = `${data.fontWeight ?? "700"} ${data.fontStretch ?? "normal"} ${fontSize}px ${data.fontFamily}`;
		const spaceWidth = ctx.measureText(" ").width;
		const lines: string[][] = [];
		let currentLine: string[] = [];
		let currentLineWidth = 0;

		for (const word of words) {
			const wordWidth = ctx.measureText(word).width;
			const addWidth = currentLine.length > 0 ? spaceWidth + wordWidth : wordWidth;
			if (currentLine.length > 0 && currentLineWidth + addWidth > availableWidth) {
				lines.push(currentLine);
				currentLine = [word];
				currentLineWidth = wordWidth;
			} else {
				currentLine.push(word);
				currentLineWidth += addWidth;
			}
		}
		if (currentLine.length > 0) lines.push(currentLine);
		return lines;
	};

	// Pre-compute wrapped lines
	const primaryLines = data.primaryText ? wrapText(data.primaryText, primaryFontSize) : [];
	const secondaryLines = data.secondaryText ? wrapText(data.secondaryText, secondaryFontSize) : [];

	// Text block height
	const primaryLineHeight = primaryFontSize * 1.2;
	const secondaryLineHeight = secondaryFontSize * 1.2;
	let textHeight = 0;
	if (primaryLines.length > 0) textHeight += primaryLines.length * primaryLineHeight;
	if (primaryLines.length > 0 && secondaryLines.length > 0) textHeight += lineGap;
	if (secondaryLines.length > 0) textHeight += secondaryLines.length * secondaryLineHeight;

	const totalBlockHeight = imageBlockHeight + textHeight;

	// Compute image and text start positions matching preview flexbox layout
	let imageStartY: number;
	let textStartY: number;
	if (isTop) {
		// flex-start: image at top, text below
		imageStartY = y + padding;
		textStartY = y + padding + imageBlockHeight;
	} else if (data.gradientDirection === "left" || data.gradientDirection === "right") {
		// justify-content: center — center the whole block
		imageStartY = y + (height - totalBlockHeight) / 2;
		textStartY = imageStartY + imageBlockHeight;
	} else {
		// bottom / none — flex-end: anchor block to bottom
		imageStartY = y + height - padding - totalBlockHeight;
		textStartY = imageStartY + imageBlockHeight;
	}

	// Render wrapped lines with per-word animation
	const renderWrappedLines = (
		lines: string[][],
		startWordIndex: number,
		color: string,
		fontSize: number,
		blockStartY: number,
	) => {
		ctx.font = `${data.fontWeight ?? "700"} ${data.fontStretch ?? "normal"} ${fontSize}px ${data.fontFamily}`;
		ctx.textBaseline = "top";
		const spaceWidth = ctx.measureText(" ").width;
		const lineHeight = fontSize * 1.2;
		let wordIdx = startWordIndex;

		lines.forEach((lineWords, lineIndex) => {
			const lineY = blockStartY + lineIndex * lineHeight;
			const wordWidths = lineWords.map((w) => ctx.measureText(w).width);
			const totalLineWidth =
				wordWidths.reduce((a, b) => a + b, 0) + spaceWidth * (lineWords.length - 1);

			let curX: number;
			if (isRight) curX = x + width - padding - totalLineWidth;
			else if (isLeft) curX = x + padding;
			else curX = x + (width - totalLineWidth) / 2;

			lineWords.forEach((word, wi) => {
				const progress = Math.min(
					1,
					Math.max(0, (timeIntoAnnotation - wordIdx * data.wordDelay) / data.animationDuration),
				);
				const wordOpacity = progress * globalOpacity;
				const offsetY = (1 - progress) * 14 * scaleFactor;

				if (wordOpacity > 0) {
					ctx.save();
					ctx.globalAlpha = wordOpacity;
					const isWhite = color.toLowerCase() === "#ffffff";
					if (isWhite) {
						ctx.shadowColor = "rgba(0,0,0,0.9)";
						ctx.shadowBlur = 4 * scaleFactor;
						ctx.shadowOffsetX = 2 * scaleFactor;
						ctx.shadowOffsetY = 2 * scaleFactor;
					} else {
						// Glow pass
						ctx.shadowColor = color;
						ctx.shadowBlur = 20 * scaleFactor;
						ctx.shadowOffsetX = 0;
						ctx.shadowOffsetY = 0;
					}
					ctx.fillStyle = color;
					ctx.fillText(word, curX, lineY + offsetY);
					// Dark drop shadow pass for non-white (matches preview's dual textShadow)
					if (!isWhite) {
						ctx.shadowColor = "rgba(0,0,0,0.9)";
						ctx.shadowBlur = 4 * scaleFactor;
						ctx.shadowOffsetX = 2 * scaleFactor;
						ctx.shadowOffsetY = 2 * scaleFactor;
						ctx.fillText(word, curX, lineY + offsetY);
					}
					ctx.restore();
				}
				curX += wordWidths[wi] + spaceWidth;
				wordIdx++;
			});
		});
	};

	// Image above the text block (already loaded for layout; draw synchronously)
	if (imgElement && imgDrawW > 0) {
		let ix: number;
		if (isRight) ix = x + width - padding - imgDrawW;
		else if (isLeft) ix = x + padding;
		else ix = x + (width - imgDrawW) / 2;

		ctx.save();
		ctx.globalAlpha = globalOpacity;
		ctx.drawImage(imgElement, ix, imageStartY, imgDrawW, imgDrawH);
		ctx.restore();
	}

	// Primary text block
	let currentY = textStartY;
	const primaryWordCount = primaryLines.reduce((sum, line) => sum + line.length, 0);
	if (primaryLines.length > 0) {
		renderWrappedLines(primaryLines, 0, data.primaryColor, primaryFontSize, currentY);
		currentY += primaryLines.length * primaryLineHeight + lineGap;
	}

	// Secondary text block
	if (secondaryLines.length > 0) {
		renderWrappedLines(
			secondaryLines,
			primaryWordCount,
			data.secondaryColor,
			secondaryFontSize,
			currentY,
		);
	}

	ctx.restore();
}

export async function renderAnnotations(
	ctx: CanvasRenderingContext2D,
	annotations: AnnotationRegion[],
	canvasWidth: number,
	canvasHeight: number,
	currentTimeMs: number,
	scaleFactor: number = 1.0,
): Promise<void> {
	// Filter active annotations at current time
	const activeAnnotations = annotations.filter(
		(ann) => currentTimeMs >= ann.startMs && currentTimeMs < ann.endMs,
	);

	// Sort by z-index (lower first, so higher z-index draws on top)
	const sortedAnnotations = [...activeAnnotations].sort((a, b) => a.zIndex - b.zIndex);

	for (const annotation of sortedAnnotations) {
		const x = (annotation.position.x / 100) * canvasWidth;
		const y = (annotation.position.y / 100) * canvasHeight;
		const width = (annotation.size.width / 100) * canvasWidth;
		const height = (annotation.size.height / 100) * canvasHeight;

		switch (annotation.type) {
			case "text":
				renderText(ctx, annotation, x, y, width, height, scaleFactor, currentTimeMs);
				break;

			case "image":
				await renderImage(ctx, annotation, x, y, width, height, scaleFactor, currentTimeMs);
				break;

			case "figure":
				if (annotation.figureData) {
					renderArrow(
						ctx,
						annotation.figureData.arrowDirection,
						annotation.figureData.color,
						annotation.figureData.strokeWidth,
						x,
						y,
						width,
						height,
						scaleFactor,
					);
				}
				break;

			case "blur":
				renderBlur(ctx, annotation, x, y, width, height, scaleFactor);
				break;

			case "caption":
				if (annotation.captionData) {
					await renderCaption(ctx, annotation, x, y, width, height, scaleFactor, currentTimeMs);
				}
				break;

			case "marker":
				if (annotation.markerData) {
					renderMarker(ctx, annotation, x, y, width, height, currentTimeMs);
				}
				break;
		}
	}
}
