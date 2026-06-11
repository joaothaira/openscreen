import type React from "react";
import type { SubtitleItem, SubtitleStyle } from "./types";

export function SubtitleOverlay({
	currentTime,
	subtitleRegions,
	showSubtitles,
	subtitleStyle,
}: {
	currentTime: number;
	subtitleRegions: SubtitleItem[];
	showSubtitles?: boolean;
	subtitleStyle?: SubtitleStyle;
}) {
	if (!showSubtitles || subtitleRegions.length === 0) return null;
	const timeMs = Math.round(currentTime * 1000);
	const active = subtitleRegions.find((s) => timeMs >= s.startMs && timeMs <= s.endMs);
	if (!active) return null;
	const st = subtitleStyle;
	const template = st?.template ?? "classic";
	const isBottom = !st || st.position !== "top";
	const offset = st ? `${st.bottomOffset}%` : "8%";
	const fontColor = st?.fontColor ?? "#ffffff";
	const fontSize = st ? `${st.fontSize}px` : "32px";
	const fontFamily = st?.fontFamily ?? "Inter, Arial, sans-serif";
	const bgColor = st?.backgroundColor ?? "rgba(0,0,0,0.7)";

	let inner: React.ReactNode;
	if (template === "minimal") {
		inner = (
			<span
				style={{
					color: fontColor,
					fontSize,
					fontFamily,
					fontWeight: 600,
					textShadow: "0 2px 8px rgba(0,0,0,0.8),0 4px 16px rgba(0,0,0,0.6)",
					lineHeight: 1.3,
				}}
			>
				{active.text}
			</span>
		);
	} else if (template === "bold") {
		inner = (
			<span
				style={{
					color: fontColor,
					fontSize,
					fontFamily,
					fontWeight: 900,
					textShadow: "0 4px 20px rgba(0,0,0,0.9)",
					textTransform: "uppercase",
					letterSpacing: "-0.03em",
					lineHeight: 1.3,
				}}
			>
				{active.text}
			</span>
		);
	} else if (template === "boxed") {
		inner = (
			<span
				style={{
					display: "block",
					background: "rgba(0,0,0,0.9)",
					color: fontColor,
					fontSize,
					fontFamily,
					fontWeight: 700,
					padding: "6px 20px",
					letterSpacing: "0.02em",
					lineHeight: 1.3,
				}}
			>
				{active.text}
			</span>
		);
	} else if (template === "cinematic") {
		inner = (
			<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px" }}>
				<div style={{ width: "50px", height: "1px", background: fontColor, opacity: 0.6 }} />
				<span
					style={{
						color: fontColor,
						fontSize,
						fontFamily,
						fontWeight: 500,
						letterSpacing: "0.15em",
						textTransform: "uppercase",
						lineHeight: 1.3,
					}}
				>
					{active.text}
				</span>
				<div style={{ width: "50px", height: "1px", background: fontColor, opacity: 0.6 }} />
			</div>
		);
	} else if (template === "outline") {
		inner = (
			<span
				style={{
					color: "transparent",
					WebkitTextStroke: `2px ${fontColor}`,
					fontSize,
					fontFamily,
					fontWeight: 900,
					textShadow: "0 4px 20px rgba(0,0,0,0.6)",
					textTransform: "uppercase",
					letterSpacing: "-0.02em",
					lineHeight: 1.3,
				}}
			>
				{active.text}
			</span>
		);
	} else if (template === "glow") {
		const g = "rgba(255,255,255,0.8)";
		inner = (
			<span
				style={{
					color: fontColor,
					fontSize,
					fontFamily,
					fontWeight: 800,
					textShadow: `0 0 20px ${g},0 0 40px ${g},0 0 60px ${g}`,
					letterSpacing: "-0.02em",
					lineHeight: 1.3,
				}}
			>
				{active.text}
			</span>
		);
	} else if (template === "stacked") {
		inner = (
			<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
				{active.text.split(" ").map((word, i) => (
					<span
						key={i}
						style={{
							color: fontColor,
							fontSize,
							fontFamily,
							fontWeight: 800,
							textShadow: "0 2px 12px rgba(0,0,0,0.8)",
							textTransform: "uppercase",
							letterSpacing: "-0.03em",
							lineHeight: 0.95,
						}}
					>
						{word}
					</span>
				))}
			</div>
		);
	} else if (template === "highlight") {
		inner = (
			<span
				style={{
					display: "block",
					background: bgColor,
					padding: "4px 16px",
					borderRadius: "6px",
					color: "#FFD700",
					fontSize,
					fontFamily,
					fontWeight: 700,
					lineHeight: 1.3,
				}}
			>
				{active.text}
			</span>
		);
	} else {
		// classic
		inner = (
			<span
				style={{
					display: "block",
					background: bgColor,
					color: fontColor,
					fontSize,
					fontFamily,
					padding: "4px 16px",
					borderRadius: "6px",
					lineHeight: 1.3,
					fontWeight: 600,
				}}
			>
				{active.text}
			</span>
		);
	}

	return (
		<div
			className="absolute left-0 right-0 flex justify-center px-4 pointer-events-none"
			style={{ [isBottom ? "bottom" : "top"]: offset, zIndex: 40 }}
		>
			<div style={{ maxWidth: "90%", textAlign: "center" }}>{inner}</div>
		</div>
	);
}
