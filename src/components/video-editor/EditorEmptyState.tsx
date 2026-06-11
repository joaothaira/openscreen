import { AlertCircle, Film, FolderOpen, Upload, Video, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useScopedT } from "@/contexts/I18nContext";
import type { RecordingSession } from "@/lib/recordingSession";
import { getProjectFolder, parentDirectoryOf, saveUserPreferences } from "@/lib/userPreferences";
import { nativeBridgeClient } from "@/native";

interface EditorEmptyStateProps {
	onVideoImported: (videoPath: string) => void;
	/** Called with the loaded project data; handles both button click and drag-drop */
	onProjectOpened: (project: unknown, path: string | null) => void;
	/** Called after a past recording's session is reopened from its manifest. */
	onRecordingSessionOpened: (session: RecordingSession) => void | Promise<void>;
}

type RecentRecording = RecordingSession & { sizeBytes: number };

function formatRecordingSize(sizeBytes: number) {
	const mb = sizeBytes / (1024 * 1024);
	return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`;
}

type DropError = "unsupported-format" | "load-failed" | null;

export function EditorEmptyState({
	onVideoImported,
	onProjectOpened,
	onRecordingSessionOpened,
}: EditorEmptyStateProps) {
	const te = useScopedT("editor");
	const tc = useScopedT("common");
	const [isDraggingOver, setIsDraggingOver] = useState(false);
	const [recentRecordings, setRecentRecordings] = useState<RecentRecording[]>([]);

	useEffect(() => {
		let cancelled = false;
		window.electronAPI
			.listRecordingSessions()
			.then((result) => {
				if (!cancelled && result.success) {
					setRecentRecordings(result.sessions);
				}
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	const handleOpenRecording = useCallback(
		async (recording: RecentRecording) => {
			const result = await window.electronAPI.openRecordingSession(recording.screenVideoPath);
			if (!result.success || !result.session) {
				toast.error(result.error ?? te("emptyState.recentRecordings.openFailed"));
				// The manifest or video may have gone away since listing; refresh.
				const refreshed = await window.electronAPI.listRecordingSessions().catch(() => null);
				if (refreshed?.success) {
					setRecentRecordings(refreshed.sessions);
				}
				return;
			}
			await onRecordingSessionOpened(result.session);
		},
		[onRecordingSessionOpened, te],
	);
	const [dropError, setDropError] = useState<DropError>(null);
	// Freeze the last non-null error type so dialog content doesn't snap to the else-branch
	// during the closing animation (same pattern as UnsavedChangesDialog).
	const lastDropErrorRef = useRef<Exclude<DropError, null>>("unsupported-format");
	if (dropError !== null) {
		lastDropErrorRef.current = dropError;
	}

	const handleImportVideo = useCallback(async () => {
		const result = await window.electronAPI.openVideoFilePicker();
		if (result.canceled || !result.success || !result.path) return;

		const setResult = await nativeBridgeClient.project.setCurrentVideoPath(result.path);
		if (!setResult.success) return;

		onVideoImported(result.path);
	}, [onVideoImported]);

	const handleLoadProject = useCallback(async () => {
		const result = await nativeBridgeClient.project.loadProjectFile(getProjectFolder());
		if (result.canceled || !result.success || !result.project) return;
		if (result.path) {
			const folder = parentDirectoryOf(result.path);
			if (folder) {
				saveUserPreferences({ projectFolder: folder });
			}
		}
		onProjectOpened(result.project, result.path ?? null);
	}, [onProjectOpened]);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		if (e.dataTransfer.items.length > 0) {
			setIsDraggingOver(true);
		}
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			setIsDraggingOver(false);
		}
	}, []);

	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			e.preventDefault();
			setIsDraggingOver(false);

			const files = Array.from(e.dataTransfer.files);
			if (files.length === 0) return;

			const projectFile = files.find((f) => f.name.endsWith(".openscreen"));
			if (!projectFile) {
				setDropError("unsupported-format");
				return;
			}

			// Use Electron's webUtils.getPathForFile; File.path was removed in Electron 32+
			let filePath: string;
			try {
				filePath = window.electronAPI.getPathForFile(projectFile);
			} catch {
				setDropError("load-failed");
				return;
			}
			if (!filePath) {
				setDropError("load-failed");
				return;
			}

			let result: Awaited<ReturnType<typeof window.electronAPI.loadProjectFileFromPath>>;
			try {
				result = await window.electronAPI.loadProjectFileFromPath(filePath);
			} catch {
				setDropError("load-failed");
				return;
			}
			if (!result.success || !result.project) {
				setDropError("load-failed");
				return;
			}

			onProjectOpened(result.project, result.path ?? null);
		},
		[onProjectOpened],
	);

	return (
		<div
			className="flex h-full w-full flex-col items-center justify-center bg-[#09090b]"
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{/* Drop overlay */}
			{isDraggingOver && (
				<div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#34B27B] bg-[#34B27B]/10">
					<Upload className="mb-3 h-10 w-10 text-[#34B27B]" />
					<p className="text-base font-semibold text-[#34B27B]">{te("emptyState.dropOverlay")}</p>
				</div>
			)}

			{/* Drop error dialog */}
			<Dialog open={dropError !== null} onOpenChange={(open) => !open && setDropError(null)}>
				<DialogContent className="bg-[#09090b] border-white/10 rounded-2xl max-w-sm p-6 gap-0">
					<DialogHeader className="mb-4">
						<div className="flex items-center gap-3">
							<img
								src="./openscreen.png"
								alt=""
								aria-hidden="true"
								className="w-9 h-9 rounded-xl flex-shrink-0"
							/>
							<DialogTitle className="text-base font-semibold text-slate-200 leading-tight">
								{lastDropErrorRef.current === "unsupported-format"
									? te("emptyState.dropErrors.unsupportedFormatTitle")
									: te("emptyState.dropErrors.couldNotOpenTitle")}
							</DialogTitle>
						</div>
					</DialogHeader>

					<div className="flex flex-col items-center gap-3 mb-6 text-center">
						<div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/5 ring-1 ring-white/10">
							<AlertCircle className="w-5 h-5 text-slate-400 flex-shrink-0" />
						</div>
						<p className="text-sm text-slate-400 leading-relaxed">
							{lastDropErrorRef.current === "unsupported-format"
								? te("emptyState.dropErrors.unsupportedFormatMessage")
								: te("emptyState.dropErrors.couldNotOpenMessage")}
						</p>
					</div>

					<button
						type="button"
						onClick={() => setDropError(null)}
						className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-medium text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
					>
						<X className="w-4 h-4" />
						{tc("actions.close")}
					</button>
				</DialogContent>
			</Dialog>

			<div className="relative flex flex-col items-center gap-8 px-6 text-center">
				{/* Logo */}
				<img
					src="./openscreen.png"
					alt=""
					aria-hidden="true"
					className="h-16 w-16 rounded-2xl opacity-90"
				/>

				<div className="flex flex-col gap-2">
					<h2 className="text-xl font-semibold text-slate-200">{te("emptyState.title")}</h2>
					<p className="max-w-sm text-sm leading-relaxed text-slate-500">
						{te("emptyState.description")}
					</p>
				</div>

				{/* Actions */}
				<div className="flex flex-col gap-3 w-full max-w-xs">
					<button
						type="button"
						onClick={handleImportVideo}
						className="flex items-center justify-center gap-2.5 w-full px-4 py-3 rounded-xl bg-[#34B27B] hover:bg-[#2d9e6c] active:bg-[#27885c] text-white font-medium text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#34B27B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
					>
						<Film className="h-4 w-4" />
						{te("emptyState.importVideoButton")}
					</button>
					<button
						type="button"
						onClick={handleLoadProject}
						className="flex items-center justify-center gap-2.5 w-full px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-medium text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
					>
						<FolderOpen className="h-4 w-4" />
						{te("emptyState.loadProjectButton")}
					</button>
				</div>

				{recentRecordings.length > 0 && (
					<div className="flex w-full max-w-xs flex-col gap-2">
						<p className="text-left text-xs font-medium uppercase tracking-wide text-slate-600">
							{te("emptyState.recentRecordings.title")}
						</p>
						<div className="flex max-h-44 flex-col gap-1.5 overflow-y-auto custom-scrollbar pr-1">
							{recentRecordings.map((recording) => (
								<button
									key={recording.screenVideoPath}
									type="button"
									onClick={() => handleOpenRecording(recording)}
									className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/30"
								>
									<Film className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
									<span className="min-w-0 flex-1 truncate text-xs text-slate-300">
										{new Date(recording.createdAt).toLocaleString()}
									</span>
									{recording.webcamVideoPath && (
										<span
											className="flex items-center gap-1 rounded bg-[#6366f1]/15 px-1.5 py-0.5 text-[10px] text-[#a5b4fc]"
											title={te("emptyState.recentRecordings.webcamBadge")}
										>
											<Video className="h-3 w-3" />
										</span>
									)}
									<span className="flex-shrink-0 text-[10px] text-slate-600">
										{formatRecordingSize(recording.sizeBytes)}
									</span>
								</button>
							))}
						</div>
					</div>
				)}

				<div className="flex flex-col items-center gap-2">
					<p className="text-xs text-slate-600">{te("emptyState.supportedFormats")}</p>
					<div className="flex items-center gap-1.5 text-xs text-slate-700 mt-4">
						<Upload className="h-3 w-3" />
						<span>{te("emptyState.dragDropHint")}</span>
					</div>
				</div>
			</div>
		</div>
	);
}
