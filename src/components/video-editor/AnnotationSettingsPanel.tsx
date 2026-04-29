import Block from "@uiw/react-color-block";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	ChevronDown,
	Image as ImageIcon,
	Info,
	Italic,
	Subtitles,
	Trash2,
	Type,
	Underline,
	Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useScopedT } from "@/contexts/I18nContext";
import { type CustomFont, getCustomFonts } from "@/lib/customFonts";
import { cn } from "@/lib/utils";
import { AddCustomFontDialog } from "./AddCustomFontDialog";
import { getArrowComponent } from "./ArrowSvgs";
import type {
	AnnotationRegion,
	AnnotationType,
	ArrowDirection,
	CaptionData,
	CaptionGradientDirection,
	FigureData,
	ImageAnimationType,
	ImageData,
	MarkerData,
	MarkerDirection,
} from "./types";

interface AnnotationSettingsPanelProps {
	annotation: AnnotationRegion;
	onContentChange: (content: string) => void;
	onTypeChange: (type: AnnotationType) => void;
	onStyleChange: (style: Partial<AnnotationRegion["style"]>) => void;
	onPositionChange?: (position: { x: number; y: number }) => void;
	onSizeChange?: (size: { width: number; height: number }) => void;
	onImageDataChange?: (imageData: ImageData) => void;
	onFigureDataChange?: (figureData: FigureData) => void;
	onCaptionDataChange?: (captionData: CaptionData) => void;
	onMarkerDataChange?: (markerData: MarkerData) => void;
	onDelete: () => void;
}

const IMAGE_PRESETS = [
	{
		label: "Full width",
		icon: "▬",
		position: { x: 5, y: 57 },
		size: { width: 90, height: 38 },
		borderRadius: 10,
	},
	{
		label: "Card",
		icon: "▪",
		position: { x: 12, y: 50 },
		size: { width: 76, height: 43 },
		borderRadius: 24,
	},
	{
		label: "Phone",
		icon: "▯",
		position: { x: 25, y: 37 },
		size: { width: 50, height: 55 },
		borderRadius: 28,
	},
];

const FONT_FAMILIES = [
	{ value: "system-ui, -apple-system, sans-serif", labelKey: "classic" },
	{ value: "Georgia, serif", labelKey: "editor" },
	{ value: "Impact, Arial Black, sans-serif", labelKey: "strong" },
	{ value: "Courier New, monospace", labelKey: "typewriter" },
	{ value: "Brush Script MT, cursive", labelKey: "deco" },
	{ value: "Arial, sans-serif", labelKey: "simple" },
	{ value: "Verdana, sans-serif", labelKey: "modern" },
	{ value: "Trebuchet MS, sans-serif", labelKey: "clean" },
	{ value: "'Saira Stencil', sans-serif", labelKey: "stencil" },
];

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128];

const FONT_WEIGHTS = [
	{ value: "100", label: "Thin" },
	{ value: "200", label: "Extra Light" },
	{ value: "300", label: "Light" },
	{ value: "400", label: "Regular" },
	{ value: "500", label: "Medium" },
	{ value: "600", label: "Semi Bold" },
	{ value: "700", label: "Bold" },
	{ value: "800", label: "Extra Bold" },
	{ value: "900", label: "Black" },
];

const FONT_STRETCHES = [
	{ value: "ultra-condensed", label: "Ultra Condensed" },
	{ value: "extra-condensed", label: "Extra Condensed" },
	{ value: "condensed", label: "Condensed" },
	{ value: "semi-condensed", label: "Semi Condensed" },
	{ value: "normal", label: "Normal" },
	{ value: "semi-expanded", label: "Semi Expanded" },
	{ value: "expanded", label: "Expanded" },
	{ value: "extra-expanded", label: "Extra Expanded" },
	{ value: "ultra-expanded", label: "Ultra Expanded" },
];

export function AnnotationSettingsPanel({
	annotation,
	onContentChange,
	onTypeChange,
	onStyleChange,
	onPositionChange,
	onSizeChange,
	onImageDataChange,
	onFigureDataChange,
	onCaptionDataChange,
	onMarkerDataChange,
	onDelete,
}: AnnotationSettingsPanelProps) {
	const t = useScopedT("settings");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);

	const fontStyleLabels: Record<string, string> = {
		classic: t("fontStyles.classic"),
		editor: t("fontStyles.editor"),
		strong: t("fontStyles.strong"),
		typewriter: t("fontStyles.typewriter"),
		deco: t("fontStyles.deco"),
		simple: t("fontStyles.simple"),
		modern: t("fontStyles.modern"),
		clean: t("fontStyles.clean"),
		stencil: t("fontStyles.stencil"),
	};

	// Load custom fonts on mount
	useEffect(() => {
		setCustomFonts(getCustomFonts());
	}, []);

	const colorPalette = [
		"#FF0000", // Red
		"#FFD700", // Yellow/Gold
		"#00FF00", // Green
		"#FFFFFF", // White
		"#0000FF", // Blue
		"#FF6B00", // Orange
		"#9B59B6", // Purple
		"#E91E63", // Pink
		"#00BCD4", // Cyan
		"#FF5722", // Deep Orange
		"#8BC34A", // Light Green
		"#FFC107", // Amber
		"#34B27B", // Brand Green
		"#000000", // Black
		"#607D8B", // Blue Grey
		"#795548", // Brown
	];

	const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = event.target.files;
		if (!files || files.length === 0) return;

		const file = files[0];

		// Validate file type
		const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
		if (!validTypes.includes(file.type)) {
			toast.error(t("annotation.invalidImageType"), {
				description: t("annotation.imageFormatsOnly"),
			});
			event.target.value = "";
			return;
		}

		const reader = new FileReader();

		reader.onload = (e) => {
			const dataUrl = e.target?.result as string;
			if (dataUrl) {
				onContentChange(dataUrl);
				toast.success(t("annotation.imageUploadSuccess"));
			}
		};

		reader.onerror = () => {
			toast.error(t("annotation.failedImageUpload"), {
				description: "There was an error reading the file.",
			});
		};

		reader.readAsDataURL(file);
		event.target.value = "";
	};

	return (
		<div className="flex-[2] min-w-0 bg-[#09090b] border border-white/5 rounded-2xl p-4 flex flex-col shadow-xl h-full overflow-y-auto custom-scrollbar">
			<div className="mb-6">
				<div className="flex items-center justify-between mb-4">
					<span className="text-sm font-medium text-slate-200">{t("annotation.title")}</span>
					<span className="text-[10px] uppercase tracking-wider font-medium text-[#34B27B] bg-[#34B27B]/10 px-2 py-1 rounded-full">
						{t("annotation.active")}
					</span>
				</div>

				{/* Type Selector */}
				<Tabs
					value={annotation.type}
					onValueChange={(value) => onTypeChange(value as AnnotationType)}
					className="mb-6"
				>
					<TabsList className="mb-4 bg-white/5 border border-white/5 p-1 w-full grid grid-cols-5 h-auto rounded-xl">
						<TabsTrigger
							value="text"
							className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all gap-1 text-xs"
						>
							<Type className="w-3.5 h-3.5" />
							{t("annotation.typeText")}
						</TabsTrigger>
						<TabsTrigger
							value="image"
							className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all gap-1 text-xs"
						>
							<ImageIcon className="w-3.5 h-3.5" />
							{t("annotation.typeImage")}
						</TabsTrigger>
						<TabsTrigger
							value="figure"
							className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all gap-1 text-xs"
						>
							<svg
								className="w-3.5 h-3.5"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<path d="M4 12h16m0 0l-6-6m6 6l-6 6" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
							{t("annotation.typeArrow")}
						</TabsTrigger>
						<TabsTrigger
							value="caption"
							className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all gap-1 text-xs"
						>
							<Subtitles className="w-3.5 h-3.5" />
							Caption
						</TabsTrigger>
						<TabsTrigger
							value="marker"
							className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all gap-1 text-xs"
						>
							<svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
								<rect x="2" y="8" width="20" height="8" rx="1" opacity="0.9" />
							</svg>
							Marker
						</TabsTrigger>
					</TabsList>

					{/* Text Content */}
					<TabsContent value="text" className="mt-0 space-y-4">
						<div>
							<label className="text-xs font-medium text-slate-200 mb-2 block">
								{t("annotation.textContent")}
							</label>
							<textarea
								value={annotation.textContent || annotation.content}
								onChange={(e) => onContentChange(e.target.value)}
								placeholder={t("annotation.textPlaceholder")}
								rows={5}
								className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-200 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#34B27B] focus:border-transparent resize-none"
							/>
						</div>

						{/* Styling Controls */}
						<div className="space-y-4">
							{/* Font Family & Size */}
							<div className="grid grid-cols-2 gap-2">
								<div>
									<label className="text-xs font-medium text-slate-200 mb-2 block">
										{t("annotation.fontStyle")}
									</label>
									<Select
										value={annotation.style.fontFamily}
										onValueChange={(value) => onStyleChange({ fontFamily: value })}
									>
										<SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
											<SelectValue placeholder={t("annotation.selectStyle")} />
										</SelectTrigger>
										<SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200 max-h-[300px]">
											{FONT_FAMILIES.map((font) => (
												<SelectItem
													key={font.value}
													value={font.value}
													style={{ fontFamily: font.value }}
												>
													{fontStyleLabels[font.labelKey]}
												</SelectItem>
											))}
											{customFonts.length > 0 && (
												<>
													<div className="px-2 py-1.5 text-[10px] font-medium text-slate-400 uppercase tracking-wider">
														{t("annotation.customFonts")}
													</div>
													{customFonts.map((font) => (
														<SelectItem
															key={font.id}
															value={font.fontFamily}
															style={{ fontFamily: font.fontFamily }}
														>
															{font.name}
														</SelectItem>
													))}
												</>
											)}
										</SelectContent>
									</Select>
								</div>
								<div>
									<label className="text-xs font-medium text-slate-200 mb-2 block">
										{t("annotation.size")}
									</label>
									<Select
										value={annotation.style.fontSize.toString()}
										onValueChange={(value) => onStyleChange({ fontSize: parseInt(value) })}
									>
										<SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
											<SelectValue placeholder={t("annotation.size")} />
										</SelectTrigger>
										<SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200 max-h-[200px]">
											{FONT_SIZES.map((size) => (
												<SelectItem key={size} value={size.toString()}>
													{size}px
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>

							{/* Add Custom Font Button */}
							<div>
								<AddCustomFontDialog
									onFontAdded={(font) => {
										setCustomFonts(getCustomFonts());
										onStyleChange({ fontFamily: font.fontFamily });
									}}
								/>
							</div>

							{/* Weight & Stretch */}
							<div className="grid grid-cols-2 gap-2">
								<div>
									<label className="text-xs font-medium text-slate-200 mb-2 block">
										Weight
									</label>
									<Select
										value={annotation.style.fontWeight}
										onValueChange={(v) => onStyleChange({ fontWeight: v })}
									>
										<SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
											<SelectValue />
										</SelectTrigger>
										<SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
											{FONT_WEIGHTS.map((w) => (
												<SelectItem key={w.value} value={w.value}>
													{w.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div>
									<label className="text-xs font-medium text-slate-200 mb-2 block">
										Width
									</label>
									<Select
										value={annotation.style.fontStretch}
										onValueChange={(v) => onStyleChange({ fontStretch: v })}
									>
										<SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
											<SelectValue />
										</SelectTrigger>
										<SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
											{FONT_STRETCHES.map((s) => (
												<SelectItem key={s.value} value={s.value}>
													{s.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>

							{/* Formatting Toggles */}
							<div className="flex items-center justify-between gap-2">
								<ToggleGroup
									type="multiple"
									className="justify-start bg-white/5 p-1 rounded-lg border border-white/5"
								>
									<ToggleGroupItem
										value="italic"
										aria-label="Toggle italic"
										data-state={annotation.style.fontStyle === "italic" ? "on" : "off"}
										onClick={() =>
											onStyleChange({
												fontStyle: annotation.style.fontStyle === "italic" ? "normal" : "italic",
											})
										}
										className="h-8 w-8 data-[state=on]:bg-[#34B27B] data-[state=on]:text-white text-slate-400 hover:bg-white/5 hover:text-slate-200"
									>
										<Italic className="h-4 w-4" />
									</ToggleGroupItem>
									<ToggleGroupItem
										value="underline"
										aria-label="Toggle underline"
										data-state={annotation.style.textDecoration === "underline" ? "on" : "off"}
										onClick={() =>
											onStyleChange({
												textDecoration:
													annotation.style.textDecoration === "underline" ? "none" : "underline",
											})
										}
										className="h-8 w-8 data-[state=on]:bg-[#34B27B] data-[state=on]:text-white text-slate-400 hover:bg-white/5 hover:text-slate-200"
									>
										<Underline className="h-4 w-4" />
									</ToggleGroupItem>
								</ToggleGroup>

								<ToggleGroup
									type="single"
									value={annotation.style.textAlign}
									className="justify-start bg-white/5 p-1 rounded-lg border border-white/5"
								>
									<ToggleGroupItem
										value="left"
										aria-label="Align left"
										onClick={() => onStyleChange({ textAlign: "left" })}
										className="h-8 w-8 data-[state=on]:bg-[#34B27B] data-[state=on]:text-white text-slate-400 hover:bg-white/5 hover:text-slate-200"
									>
										<AlignLeft className="h-4 w-4" />
									</ToggleGroupItem>
									<ToggleGroupItem
										value="center"
										aria-label="Align center"
										onClick={() => onStyleChange({ textAlign: "center" })}
										className="h-8 w-8 data-[state=on]:bg-[#34B27B] data-[state=on]:text-white text-slate-400 hover:bg-white/5 hover:text-slate-200"
									>
										<AlignCenter className="h-4 w-4" />
									</ToggleGroupItem>
									<ToggleGroupItem
										value="right"
										aria-label="Align right"
										onClick={() => onStyleChange({ textAlign: "right" })}
										className="h-8 w-8 data-[state=on]:bg-[#34B27B] data-[state=on]:text-white text-slate-400 hover:bg-white/5 hover:text-slate-200"
									>
										<AlignRight className="h-4 w-4" />
									</ToggleGroupItem>
								</ToggleGroup>
							</div>

							{/* Colors */}
							<div className="grid grid-cols-2 gap-4">
								<div>
									<label className="text-xs font-medium text-slate-200 mb-2 block">
										{t("annotation.textColor")}
									</label>
									<Popover>
										<PopoverTrigger asChild>
											<Button
												variant="outline"
												className="w-full h-9 justify-start gap-2 bg-white/5 border-white/10 hover:bg-white/10 px-2"
											>
												<div
													className="w-4 h-4 rounded-full border border-white/20"
													style={{ backgroundColor: annotation.style.color }}
												/>
												<span className="text-xs text-slate-300 truncate flex-1 text-left">
													{annotation.style.color}
												</span>
												<ChevronDown className="h-3 w-3 opacity-50" />
											</Button>
										</PopoverTrigger>
										<PopoverContent className="w-[260px] p-3 bg-[#1a1a1c] border border-white/10 rounded-xl shadow-xl">
											<Block
												color={annotation.style.color}
												colors={colorPalette}
												onChange={(color) => {
													onStyleChange({ color: color.hex });
												}}
												style={{
													borderRadius: "8px",
												}}
											/>
										</PopoverContent>
									</Popover>
								</div>
								<div>
									<label className="text-xs font-medium text-slate-200 mb-2 block">
										{t("annotation.background")}
									</label>
									<Popover>
										<PopoverTrigger asChild>
											<Button
												variant="outline"
												className="w-full h-9 justify-start gap-2 bg-white/5 border-white/10 hover:bg-white/10 px-2"
											>
												<div className="w-4 h-4 rounded-full border border-white/20 relative overflow-hidden">
													<div className="absolute inset-0 checkerboard-bg opacity-50" />
													<div
														className="absolute inset-0"
														style={{ backgroundColor: annotation.style.backgroundColor }}
													/>
												</div>
												<span className="text-xs text-slate-300 truncate flex-1 text-left">
													{annotation.style.backgroundColor === "transparent"
														? t("annotation.none")
														: t("annotation.color")}
												</span>
												<ChevronDown className="h-3 w-3 opacity-50" />
											</Button>
										</PopoverTrigger>
										<PopoverContent className="w-[260px] p-3 bg-[#1a1a1c] border border-white/10 rounded-xl shadow-xl">
											<Block
												color={
													annotation.style.backgroundColor === "transparent"
														? "#000000"
														: annotation.style.backgroundColor
												}
												colors={colorPalette}
												onChange={(color) => {
													onStyleChange({ backgroundColor: color.hex });
												}}
												style={{
													borderRadius: "8px",
												}}
											/>
											<Button
												variant="ghost"
												size="sm"
												className="w-full mt-2 text-xs h-7 hover:bg-white/5 text-slate-400"
												onClick={() => {
													onStyleChange({ backgroundColor: "transparent" });
												}}
											>
												{t("annotation.clearBackground")}
											</Button>
										</PopoverContent>
									</Popover>
								</div>
							</div>
						</div>
					</TabsContent>

					{/* Image Upload */}
					<TabsContent value="image" className="mt-0 space-y-4">
						<input
							type="file"
							ref={fileInputRef}
							onChange={handleImageUpload}
							accept=".jpg,.jpeg,.png,.gif,.webp,image/*"
							className="hidden"
						/>
						<Button
							onClick={() => fileInputRef.current?.click()}
							variant="outline"
							className="w-full gap-2 bg-white/5 text-slate-200 border-white/10 hover:bg-[#34B27B] hover:text-white hover:border-[#34B27B] transition-all py-8"
						>
							<Upload className="w-5 h-5" />
							{t("annotation.uploadImage")}
						</Button>

						{annotation.content && annotation.content.startsWith("data:image") && (
							<div className="rounded-lg border border-white/10 overflow-hidden bg-white/5 p-2">
								<img
									src={annotation.content}
									alt="Uploaded annotation"
									className="w-full h-auto rounded-md"
								/>
							</div>
						)}

						{/* Layout presets */}
						<div>
							<label className="text-xs font-medium text-slate-200 mb-2 block">
								Layout preset
							</label>
							<div className="grid grid-cols-3 gap-2">
								{IMAGE_PRESETS.map((preset) => (
									<button
										key={preset.label}
										type="button"
										onClick={() => {
											onPositionChange?.(preset.position);
											onSizeChange?.(preset.size);
											onStyleChange({ borderRadius: preset.borderRadius });
										}}
										className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-slate-400 hover:text-slate-200 transition-all"
									>
										{preset.label === "Full width" && (
											<svg width="32" height="20" viewBox="0 0 32 20" fill="none">
												<rect x="1" y="5" width="30" height="10" rx="2" fill="currentColor" opacity="0.6" />
											</svg>
										)}
										{preset.label === "Card" && (
											<svg width="24" height="20" viewBox="0 0 24 20" fill="none">
												<rect x="1" y="1" width="22" height="18" rx="4" fill="currentColor" opacity="0.6" />
											</svg>
										)}
										{preset.label === "Phone" && (
											<svg width="16" height="20" viewBox="0 0 16 20" fill="none">
												<rect x="1" y="1" width="14" height="18" rx="4" fill="currentColor" opacity="0.6" />
											</svg>
										)}
										<span className="text-[10px] font-medium">{preset.label}</span>
									</button>
								))}
							</div>
						</div>

						{/* Border radius */}
						<div>
							<label className="text-xs font-medium text-slate-200 mb-2 block">
								Corner radius: {annotation.style.borderRadius ?? 0}px
							</label>
							<Slider
								min={0}
								max={80}
								step={2}
								value={[annotation.style.borderRadius ?? 0]}
								onValueChange={([v]) => onStyleChange({ borderRadius: v })}
								className="w-full"
							/>
						</div>

						{/* Entrance animation */}
						{(() => {
							const imgData = annotation.imageData ?? { animationType: "none" as ImageAnimationType, animationDuration: 500 };
							const update = (patch: Partial<ImageData>) =>
								onImageDataChange?.({ ...imgData, ...patch });
							const ANIM_PRESETS: { type: ImageAnimationType; label: string; icon: React.ReactNode }[] = [
								{
									type: "none",
									label: "None",
									icon: (
										<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
											<rect x="2" y="2" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
										</svg>
									),
								},
								{
									type: "fade",
									label: "Fade",
									icon: (
										<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
											<rect x="2" y="2" width="14" height="14" rx="2" fill="url(#fadeGrad)" opacity="0.8" />
											<defs>
												<linearGradient id="fadeGrad" x1="2" y1="2" x2="16" y2="2" gradientUnits="userSpaceOnUse">
													<stop offset="0%" stopColor="currentColor" stopOpacity="0.1" />
													<stop offset="100%" stopColor="currentColor" stopOpacity="0.9" />
												</linearGradient>
											</defs>
										</svg>
									),
								},
								{
									type: "slide-up",
									label: "Up",
									icon: (
										<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
											<path d="M9 14 L9 4 M9 4 L5 8 M9 4 L13 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									),
								},
								{
									type: "slide-down",
									label: "Down",
									icon: (
										<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
											<path d="M9 4 L9 14 M9 14 L5 10 M9 14 L13 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									),
								},
								{
									type: "slide-left",
									label: "Left",
									icon: (
										<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
											<path d="M14 9 L4 9 M4 9 L8 5 M4 9 L8 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									),
								},
								{
									type: "slide-right",
									label: "Right",
									icon: (
										<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
											<path d="M4 9 L14 9 M14 9 L10 5 M14 9 L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									),
								},
								{
									type: "zoom",
									label: "Zoom",
									icon: (
										<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
											<rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
											<rect x="2" y="2" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
										</svg>
									),
								},
							];
							return (
								<div>
									<label className="text-xs font-medium text-slate-200 mb-2 block">
										Entrance animation
									</label>
									<div className="grid grid-cols-4 gap-1.5 mb-3">
										{ANIM_PRESETS.map((anim) => (
											<button
												key={anim.type}
												type="button"
												onClick={() => update({ animationType: anim.type })}
												className={cn(
													"flex flex-col items-center justify-center gap-1 py-2 rounded-lg border text-[10px] font-medium transition-all",
													imgData.animationType === anim.type
														? "bg-[#34B27B] border-[#34B27B] text-white"
														: "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:border-white/20 hover:text-slate-200",
												)}
											>
												{anim.icon}
												{anim.label}
											</button>
										))}
									</div>
									{imgData.animationType !== "none" && (
										<div>
											<label className="text-xs font-medium text-slate-200 mb-2 block">
												Duration: {imgData.animationDuration}ms
											</label>
											<Slider
												min={100}
												max={1500}
												step={50}
												value={[imgData.animationDuration]}
												onValueChange={([v]) => update({ animationDuration: v })}
												className="w-full"
											/>
										</div>
									)}
									<div className="flex items-center justify-between mt-1">
										<span className="text-xs font-medium text-slate-200">Fade out</span>
										<Switch
											checked={imgData.fadeOut ?? false}
											onCheckedChange={(v) => update({ fadeOut: v })}
										/>
									</div>
								</div>
							);
						})()}

						<p className="text-xs text-slate-500 text-center leading-relaxed">
							{t("annotation.supportedFormats")}
						</p>
					</TabsContent>

					<TabsContent value="figure" className="mt-0 space-y-4">
						<div>
							<label className="text-xs font-medium text-slate-200 mb-3 block">
								{t("annotation.arrowDirection")}
							</label>
							<div className="grid grid-cols-4 gap-2">
								{(
									[
										"up",
										"down",
										"left",
										"right",
										"up-right",
										"up-left",
										"down-right",
										"down-left",
									] as ArrowDirection[]
								).map((direction) => {
									const ArrowComponent = getArrowComponent(direction);
									return (
										<button
											key={direction}
											onClick={() => {
												const newFigureData: FigureData = {
													...annotation.figureData!,
													arrowDirection: direction,
												};
												onFigureDataChange?.(newFigureData);
											}}
											className={cn(
												"h-16 rounded-lg border flex items-center justify-center transition-all p-2",
												annotation.figureData?.arrowDirection === direction
													? "bg-[#34B27B] border-[#34B27B]"
													: "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20",
											)}
										>
											<ArrowComponent
												color={
													annotation.figureData?.arrowDirection === direction
														? "#ffffff"
														: "#94a3b8"
												}
												strokeWidth={3}
											/>
										</button>
									);
								})}
							</div>
						</div>

						<div>
							<label className="text-xs font-medium text-slate-200 mb-2 block">
								{t("annotation.strokeWidth", {
									width: String(annotation.figureData?.strokeWidth || 4),
								})}
							</label>
							<Slider
								value={[annotation.figureData?.strokeWidth || 4]}
								onValueChange={([value]) => {
									const newFigureData: FigureData = {
										...annotation.figureData!,
										strokeWidth: value,
									};
									onFigureDataChange?.(newFigureData);
								}}
								min={1}
								max={6}
								step={1}
								className="w-full"
							/>
						</div>

						<div>
							<label className="text-xs font-medium text-slate-200 mb-2 block">
								{t("annotation.arrowColor")}
							</label>
							<Popover>
								<PopoverTrigger asChild>
									<Button
										variant="outline"
										className="w-full h-10 justify-start gap-2 bg-white/5 border-white/10 hover:bg-white/10"
									>
										<div
											className="w-5 h-5 rounded-full border border-white/20"
											style={{ backgroundColor: annotation.figureData?.color || "#34B27B" }}
										/>
										<span className="text-xs text-slate-300 truncate flex-1 text-left">
											{annotation.figureData?.color || "#34B27B"}
										</span>
										<ChevronDown className="h-3 w-3 opacity-50" />
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-[260px] p-3 bg-[#1a1a1c] border border-white/10 rounded-xl shadow-xl">
									<Block
										color={annotation.figureData?.color || "#34B27B"}
										colors={colorPalette}
										onChange={(color) => {
											const newFigureData: FigureData = {
												...annotation.figureData!,
												color: color.hex,
											};
											onFigureDataChange?.(newFigureData);
										}}
										style={{
											borderRadius: "8px",
										}}
									/>
								</PopoverContent>
							</Popover>
						</div>
					</TabsContent>

					{/* Caption / Lower-Third */}
					<TabsContent value="caption" className="mt-0 space-y-4">
						{(() => {
							const data = annotation.captionData;
							if (!data || !onCaptionDataChange) return null;
							const update = (patch: Partial<CaptionData>) =>
								onCaptionDataChange({ ...data, ...patch });
							return (
								<>
									<div>
										<label className="text-xs font-medium text-slate-200 mb-2 block">
											Primary text (top line)
										</label>
										<input
											value={data.primaryText}
											onChange={(e) => update({ primaryText: e.target.value })}
											className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-200 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#34B27B]"
										/>
									</div>
									<div>
										<label className="text-xs font-medium text-slate-200 mb-2 block">
											Secondary text (bottom line)
										</label>
										<input
											value={data.secondaryText}
											onChange={(e) => update({ secondaryText: e.target.value })}
											className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-200 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#34B27B]"
										/>
									</div>
									<div>
										<label className="text-xs font-medium text-slate-200 mb-2 block">
											{t("annotation.fontStyle")}
										</label>
										<Select
											value={data.fontFamily}
											onValueChange={(v) => update({ fontFamily: v })}
										>
											<SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
												<SelectValue placeholder={t("annotation.selectStyle")} />
											</SelectTrigger>
											<SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200 max-h-[300px]">
												{FONT_FAMILIES.map((font) => (
													<SelectItem
														key={font.value}
														value={font.value}
														style={{ fontFamily: font.value }}
													>
														{fontStyleLabels[font.labelKey]}
													</SelectItem>
												))}
												{customFonts.length > 0 && (
													<>
														<div className="px-2 py-1.5 text-[10px] font-medium text-slate-400 uppercase tracking-wider">
															{t("annotation.customFonts")}
														</div>
														{customFonts.map((font) => (
															<SelectItem
																key={font.id}
																value={font.fontFamily}
																style={{ fontFamily: font.fontFamily }}
															>
																{font.name}
															</SelectItem>
														))}
													</>
												)}
											</SelectContent>
										</Select>
									</div>
									<div className="grid grid-cols-2 gap-2">
										<div>
											<label className="text-xs font-medium text-slate-200 mb-2 block">
												Weight
											</label>
											<Select
												value={data.fontWeight ?? "700"}
												onValueChange={(v) => update({ fontWeight: v })}
											>
												<SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
													<SelectValue />
												</SelectTrigger>
												<SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
													{FONT_WEIGHTS.map((w) => (
														<SelectItem key={w.value} value={w.value}>
															{w.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
										<div>
											<label className="text-xs font-medium text-slate-200 mb-2 block">
												Width
											</label>
											<Select
												value={data.fontStretch ?? "normal"}
												onValueChange={(v) => update({ fontStretch: v })}
											>
												<SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
													<SelectValue />
												</SelectTrigger>
												<SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
													{FONT_STRETCHES.map((s) => (
														<SelectItem key={s.value} value={s.value}>
															{s.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</div>
									<div className="grid grid-cols-2 gap-3">
										<div>
											<label className="text-xs font-medium text-slate-200 mb-2 block">
												Primary color
											</label>
											<Popover>
												<PopoverTrigger asChild>
													<Button
														variant="outline"
														className="w-full h-9 justify-start gap-2 bg-white/5 border-white/10 hover:bg-white/10 px-2"
													>
														<div
															className="w-4 h-4 rounded-full border border-white/20"
															style={{ backgroundColor: data.primaryColor }}
														/>
														<span className="text-xs text-slate-300 truncate flex-1 text-left">
															{data.primaryColor}
														</span>
														<ChevronDown className="h-3 w-3 opacity-50" />
													</Button>
												</PopoverTrigger>
												<PopoverContent className="w-[260px] p-3 bg-[#1a1a1c] border border-white/10 rounded-xl shadow-xl">
													<Block
														color={data.primaryColor}
														colors={colorPalette}
														onChange={(c) => update({ primaryColor: c.hex })}
														style={{ borderRadius: "8px" }}
													/>
												</PopoverContent>
											</Popover>
										</div>
										<div>
											<label className="text-xs font-medium text-slate-200 mb-2 block">
												Secondary color
											</label>
											<Popover>
												<PopoverTrigger asChild>
													<Button
														variant="outline"
														className="w-full h-9 justify-start gap-2 bg-white/5 border-white/10 hover:bg-white/10 px-2"
													>
														<div
															className="w-4 h-4 rounded-full border border-white/20"
															style={{ backgroundColor: data.secondaryColor }}
														/>
														<span className="text-xs text-slate-300 truncate flex-1 text-left">
															{data.secondaryColor}
														</span>
														<ChevronDown className="h-3 w-3 opacity-50" />
													</Button>
												</PopoverTrigger>
												<PopoverContent className="w-[260px] p-3 bg-[#1a1a1c] border border-white/10 rounded-xl shadow-xl">
													<Block
														color={data.secondaryColor}
														colors={colorPalette}
														onChange={(c) => update({ secondaryColor: c.hex })}
														style={{ borderRadius: "8px" }}
													/>
												</PopoverContent>
											</Popover>
										</div>
									</div>
									<div className="grid grid-cols-2 gap-3">
										<div>
											<label className="text-xs font-medium text-slate-200 mb-2 block">
												Primary size
											</label>
											<Select
												value={data.primaryFontSize.toString()}
												onValueChange={(v) => update({ primaryFontSize: parseInt(v) })}
											>
												<SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
													<SelectValue />
												</SelectTrigger>
												<SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200 max-h-[200px]">
													{[24, 32, 40, 48, 56, 64, 72, 80, 96].map((s) => (
														<SelectItem key={s} value={s.toString()}>
															{s}px
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
										<div>
											<label className="text-xs font-medium text-slate-200 mb-2 block">
												Secondary size
											</label>
											<Select
												value={data.secondaryFontSize.toString()}
												onValueChange={(v) => update({ secondaryFontSize: parseInt(v) })}
											>
												<SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
													<SelectValue />
												</SelectTrigger>
												<SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200 max-h-[200px]">
													{[20, 24, 32, 40, 48, 56, 64, 72, 80].map((s) => (
														<SelectItem key={s} value={s.toString()}>
															{s}px
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</div>
									<div>
										<label className="text-xs font-medium text-slate-200 mb-2 block">
											Gradient direction
										</label>
										<div className="grid grid-cols-5 gap-1.5">
											{(
												["bottom", "top", "left", "right", "none"] as CaptionGradientDirection[]
											).map((dir) => (
												<button
													key={dir}
													onClick={() => update({ gradientDirection: dir })}
													className={cn(
														"py-1.5 rounded-lg border text-[10px] font-medium capitalize transition-all",
														data.gradientDirection === dir
															? "bg-[#34B27B] border-[#34B27B] text-white"
															: "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10",
													)}
												>
													{dir}
												</button>
											))}
										</div>
									</div>
									<div>
										<label className="text-xs font-medium text-slate-200 mb-2 block">
											Text alignment
										</label>
										<ToggleGroup
											type="single"
											value={data.textAlign ?? "center"}
											className="justify-start bg-white/5 p-1 rounded-lg border border-white/5"
										>
											<ToggleGroupItem
												value="left"
												aria-label="Align left"
												onClick={() => update({ textAlign: "left" })}
												className="h-8 w-8 data-[state=on]:bg-[#34B27B] data-[state=on]:text-white text-slate-400 hover:bg-white/5 hover:text-slate-200"
											>
												<AlignLeft className="h-4 w-4" />
											</ToggleGroupItem>
											<ToggleGroupItem
												value="center"
												aria-label="Align center"
												onClick={() => update({ textAlign: "center" })}
												className="h-8 w-8 data-[state=on]:bg-[#34B27B] data-[state=on]:text-white text-slate-400 hover:bg-white/5 hover:text-slate-200"
											>
												<AlignCenter className="h-4 w-4" />
											</ToggleGroupItem>
											<ToggleGroupItem
												value="right"
												aria-label="Align right"
												onClick={() => update({ textAlign: "right" })}
												className="h-8 w-8 data-[state=on]:bg-[#34B27B] data-[state=on]:text-white text-slate-400 hover:bg-white/5 hover:text-slate-200"
											>
												<AlignRight className="h-4 w-4" />
											</ToggleGroupItem>
										</ToggleGroup>
									</div>
									<div className="grid grid-cols-2 gap-3">
										<div>
											<label className="text-xs font-medium text-slate-200 mb-2 block">
												Word delay: {data.wordDelay}ms
											</label>
											<Slider
												value={[data.wordDelay]}
												onValueChange={([v]) => update({ wordDelay: v })}
												min={50}
												max={500}
												step={25}
												className="w-full"
											/>
										</div>
										<div>
											<label className="text-xs font-medium text-slate-200 mb-2 block">
												Fade-in: {data.animationDuration}ms
											</label>
											<Slider
												value={[data.animationDuration]}
												onValueChange={([v]) => update({ animationDuration: v })}
												min={50}
												max={600}
												step={25}
												className="w-full"
											/>
										</div>
									</div>
									<div>
										<label className="text-xs font-medium text-slate-200 mb-2 block">
											Image (optional)
										</label>
										{data.imageUrl ? (
											<div className="flex flex-col gap-2">
												<img
													src={data.imageUrl}
													alt="Caption image"
													className="w-full max-h-24 object-contain rounded-lg border border-white/10 bg-white/5 p-2"
												/>
												<Button
													variant="ghost"
													size="sm"
													className="w-full text-xs h-7 hover:bg-white/5 text-slate-400"
													onClick={() => update({ imageUrl: undefined })}
												>
													Remove image
												</Button>
											</div>
										) : (
											<label className="w-full flex items-center justify-center gap-2 py-5 border border-dashed border-white/15 rounded-lg text-slate-400 text-xs cursor-pointer hover:bg-white/5 transition-all">
												<Upload className="w-4 h-4" />
												Upload image
												<input
													type="file"
													accept="image/*"
													className="hidden"
													onChange={(e) => {
														const file = e.target.files?.[0];
														if (!file) return;
														const reader = new FileReader();
														reader.onload = (ev) => {
															const url = ev.target?.result as string;
															if (url) update({ imageUrl: url });
														};
														reader.readAsDataURL(file);
														e.target.value = "";
													}}
												/>
											</label>
										)}
									</div>
								</>
							);
						})()}
					</TabsContent>

					{/* Marker highlight */}
					<TabsContent value="marker" className="mt-0 space-y-4">
						{(() => {
							const data = annotation.markerData;
							if (!data || !onMarkerDataChange) return null;
							const update = (patch: Partial<MarkerData>) =>
								onMarkerDataChange({ ...data, ...patch });
							return (
								<>
									<div>
										<label className="text-xs font-medium text-slate-200 mb-2 block">Color</label>
										<Popover>
											<PopoverTrigger asChild>
												<Button
													variant="outline"
													className="w-full h-9 justify-start gap-2 bg-white/5 border-white/10 hover:bg-white/10 px-2"
												>
													<div
														className="w-4 h-4 rounded-full border border-white/20"
														style={{ backgroundColor: data.color }}
													/>
													<span className="text-xs text-slate-300 truncate flex-1 text-left">
														{data.color}
													</span>
													<ChevronDown className="h-3 w-3 opacity-50" />
												</Button>
											</PopoverTrigger>
											<PopoverContent className="w-[260px] p-3 bg-[#1a1a1c] border border-white/10 rounded-xl shadow-xl">
												<Block
													color={data.color}
													colors={colorPalette}
													onChange={(c) => update({ color: c.hex })}
													style={{ borderRadius: "8px" }}
												/>
											</PopoverContent>
										</Popover>
									</div>
									<div>
										<label className="text-xs font-medium text-slate-200 mb-2 block">
											Opacity: {Math.round(data.opacity * 100)}%
										</label>
										<Slider
											value={[data.opacity * 100]}
											onValueChange={([v]) => update({ opacity: v / 100 })}
											min={10}
											max={90}
											step={5}
											className="w-full"
										/>
									</div>
									<div>
										<label className="text-xs font-medium text-slate-200 mb-2 block">
											Sweep direction
										</label>
										<div className="grid grid-cols-2 gap-2">
											{(["left", "right"] as MarkerDirection[]).map((dir) => (
												<button
													key={dir}
													onClick={() => update({ direction: dir })}
													className={cn(
														"py-2 rounded-lg border text-xs font-medium capitalize transition-all flex items-center justify-center gap-1.5",
														data.direction === dir
															? "bg-[#34B27B] border-[#34B27B] text-white"
															: "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10",
													)}
												>
													{dir === "left" ? "← Left to right" : "Right to left →"}
												</button>
											))}
										</div>
									</div>
									<div>
										<label className="text-xs font-medium text-slate-200 mb-2 block">
											Sweep duration: {data.animationDuration}ms
										</label>
										<Slider
											value={[data.animationDuration]}
											onValueChange={([v]) => update({ animationDuration: v })}
											min={100}
											max={1000}
											step={50}
											className="w-full"
										/>
									</div>
								</>
							);
						})()}
					</TabsContent>
				</Tabs>

				<Button
					onClick={onDelete}
					variant="destructive"
					size="sm"
					className="w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all mt-4"
				>
					<Trash2 className="w-4 h-4" />
					{t("annotation.deleteAnnotation")}
				</Button>

				<div className="mt-6 p-3 bg-white/5 rounded-lg border border-white/5">
					<div className="flex items-center gap-2 mb-2 text-slate-300">
						<Info className="w-3.5 h-3.5" />
						<span className="text-xs font-medium">{t("annotation.shortcutsAndTips")}</span>
					</div>
					<ul className="text-[10px] text-slate-400 space-y-1.5 list-disc pl-3 leading-relaxed">
						<li>{t("annotation.tipMovePlayhead")}</li>
						<li>{t("annotation.tipTabCycle")}</li>
						<li>{t("annotation.tipShiftTabCycle")}</li>
					</ul>
				</div>
			</div>
		</div>
	);
}
