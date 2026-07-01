"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Clapperboard,
  Undo2,
  Redo2,
  Share2,
  Download,
  MousePointer2,
  Scissors,
  Sparkles,
  AudioLines,
  Captions,
  SlidersHorizontal,
  Type,
  Settings,
  Play,
  Pause,
  Rewind,
  FastForward,
  Volume2,
  VolumeX,
  Maximize,
  X,
  AlertTriangle,
  Loader2,
  Clock,
  Check,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Toaster, toast } from "sonner";
import FilePicker from "@/components/file-picker";
import VideoPlayer, {
  type VideoPlayerHandle,
  type VideoMeta,
} from "@/components/video-player";
import TranscriptPanel from "@/components/transcript-panel";
import TimelineBar, { type TimelineHandle } from "@/components/timeline-bar";
import { formatDuration } from "@/lib/utils";
import { isExportSupported, startExport, type ExportHandle } from "@/lib/export/export-trigger";
import {
  cutWords as cutWordsInEdl,
  restoreSegment as restoreSegmentInEdl,
  trimBoundary as trimBoundaryInEdl,
  setRangeStatus as setRangeStatusInEdl,
  splitAt as splitAtInEdl,
  reRoughCut as reRoughCutInEdl,
  pinTrimmedBoundary as pinTrimmedBoundaryInEdl,
  findSegmentAt,
  buildInitialEDL,
  keptDuration,
  SENSITIVITY_PRESETS,
  DEFAULT_SENSITIVITY,
  type SensitivityLevel,
  type EDL,
  type EDLSegment,
  type Transcript,
  type TranscriptWord,
} from "@/lib/edl";

interface Project {
  id: string;
  fileName: string;
  durationMs: number | null;
  transcript: Transcript | null;
  transcriptStatus: "idle" | "processing" | "ready" | "failed";
  edl: EDL | null;
}

const AUTOSAVE_DELAY_MS = 800;
const MIN_TRANSCRIPT_W = 300;
const MAX_TRANSCRIPT_W = 640;

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();

  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [sourceFile, setSourceFile] = useState<File | null>(null);

  const [edl, setEdl] = useState<EDL | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showRetakeReview, setShowRetakeReview] = useState(false);
  // The timeline clip the user has selected, identified by its start time
  // (segment starts are unique). null = nothing selected.
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [muted, setMuted] = useState(false);
  // Auto-cut aggressiveness. Drives silence + retake thresholds on the next
  // re-run; restored from the saved EDL on load.
  const [sensitivity, setSensitivity] = useState<SensitivityLevel>(DEFAULT_SENSITIVITY);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [savedAt, setSavedAt] = useState<"saved" | "saving">("saved");
  const [exportState, setExportState] = useState<"idle" | "exporting">("idle");
  const exportHandleRef = useRef<ExportHandle | null>(null);
  const resizingRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const undoStack = useRef<EDL[]>([]);
  const redoStack = useRef<EDL[]>([]);
  // A freshly auto-generated initial EDL must NOT be persisted until the user
  // actually edits — otherwise a bad auto-build saves itself and, because the
  // load path is `data.edl ?? buildInitialEDL(...)`, can never be rebuilt.
  const hasEditedRef = useRef(false);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const timelineRef = useRef<TimelineHandle>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch the project on mount.
  useEffect(() => {
    async function fetchProject() {
      try {
        const response = await fetch(`/api/projects/${id}`);
        if (!response.ok) {
          setLoadError("Project not found.");
          return;
        }

        // A redirect (e.g. to the sign-in page during a session refresh)
        // resolves with response.ok === true but an HTML body, not JSON.
        if (!response.headers.get("content-type")?.includes("application/json")) {
          setLoadError("Failed to load project.");
          return;
        }

        const data: Project = await response.json();
        setProject(data);

        const words = data.transcript?.words ?? [];
        const durationSeconds =
          data.transcript?.duration ?? (data.durationMs ? data.durationMs / 1000 : 0);

        // A saved EDL that keeps nothing is unusable (you can't export an empty
        // cut) and is almost certainly a corrupted auto-build from before the
        // keep-all safety floor existed — rebuild it instead of loading it.
        const savedEdl =
          data.edl && keptDuration(data.edl) > 0 ? data.edl : null;

        if (savedEdl?.sensitivity) setSensitivity(savedEdl.sensitivity);

        // Only auto-build from the transcript once it's actually ready. Whisper
        // transcribes in the background, so an editor opened mid-processing has
        // no words yet — building then would derive the EDL from an empty
        // transcript (the original whole-video-deleted bug). When ready we build;
        // otherwise we keep any valid saved EDL and wait for a reload.
        setEdl(
          data.transcriptStatus === "ready"
            ? savedEdl ?? buildInitialEDL(words, durationSeconds)
            : savedEdl
        );
      } catch {
        setLoadError("Failed to load project.");
      } finally {
        setIsLoading(false);
      }
    }

    fetchProject();
  }, [id]);

  // Object URL for the locally re-selected source file, revoked on change/unmount.
  const sourceUrl = useMemo(
    () => (sourceFile ? URL.createObjectURL(sourceFile) : null),
    [sourceFile]
  );
  useEffect(() => {
    if (!sourceUrl) return;
    return () => URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

  // Debounced auto-save of EDL changes to Postgres. Only runs after a real
  // user edit — the initial auto-built EDL stays unsaved until then.
  useEffect(() => {
    if (!edl || !project || !hasEditedRef.current) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setSavedAt("saving");
      fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Stamp the current sensitivity onto the saved EDL so a reload restores
        // it. Kept out of the EDL transforms (which drop top-level fields) —
        // merged in only at the save boundary.
        body: JSON.stringify({ edl: { ...edl, sensitivity } }),
      })
        .then(() => setSavedAt("saved"))
        .catch((error) => {
          // Leave the status on "Saving…" (it genuinely hasn't saved); the next
          // edit re-triggers this effect and retries. The toast is the signal.
          console.error("Failed to auto-save EDL:", error);
          toast.error("Couldn't save your changes", {
            description: "Your edits are safe here — we'll retry on your next edit.",
          });
        });
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [edl, project, id, sensitivity]);

  // Apply an edit, returning whether it was accepted. An edit that keeps
  // nothing is refused: the timeline must always retain at least one clip,
  // otherwise the load path (which discards a zero-kept EDL as corrupt) would
  // silently rebuild from the transcript and wipe every edit on the next reload.
  const applyEdl = useCallback(
    (next: EDL): boolean => {
      if (keptDuration(next) <= 0) {
        toast("Can't remove everything", {
          description: "At least one clip must stay in the timeline.",
        });
        return false;
      }
      hasEditedRef.current = true;
      setEdl((prev) => {
        if (prev) undoStack.current.push(prev);
        redoStack.current = [];
        return next;
      });
      return true;
    },
    []
  );

  const undo = useCallback(() => {
    setEdl((prev) => {
      if (!prev || undoStack.current.length === 0) return prev;
      hasEditedRef.current = true;
      redoStack.current.push(prev);
      return undoStack.current.pop()!;
    });
  }, []);

  const redo = useCallback(() => {
    setEdl((prev) => {
      if (!prev || redoStack.current.length === 0) return prev;
      hasEditedRef.current = true;
      undoStack.current.push(prev);
      return redoStack.current.pop()!;
    });
  }, []);

  const handleCutWords = useCallback(
    (words: TranscriptWord[]) => {
      if (!edl) return;
      if (!applyEdl(cutWordsInEdl(edl, words))) return;
      toast(`Cut ${words.length} word${words.length === 1 ? "" : "s"}`, {
        action: { label: "Undo", onClick: () => undo() },
      });
    },
    [edl, applyEdl, undo]
  );

  const handleRestoreSegment = useCallback(
    (segment: EDLSegment) => {
      if (!edl) return;
      applyEdl(restoreSegmentInEdl(edl, segment));
      toast("Segment restored", {
        action: { label: "Undo", onClick: () => undo() },
      });
    },
    [edl, applyEdl, undo]
  );

  // Q / W — trim the kept clip under the playhead up to / from it (Premiere-style
  // "trim previous/next edit to playhead"). Only acts inside a kept clip.
  const cutToPlayhead = useCallback(
    (side: "left" | "right") => {
      if (!edl) return;
      const seg = findSegmentAt(edl, currentTime);
      if (!seg || seg.status === "cut") {
        toast("Nothing to trim here", {
          description: "Park the playhead inside a clip first.",
        });
        return;
      }
      const [start, end] =
        side === "left" ? [seg.start, currentTime] : [currentTime, seg.end];
      // Playhead sitting on the clip edge — nothing to remove.
      if (end - start < 1e-3) return;
      if (!applyEdl(setRangeStatusInEdl(edl, start, end, "cut", "manual"))) return;
      toast(side === "left" ? "Trimmed clip start" : "Trimmed clip end", {
        action: { label: "Undo", onClick: () => undo() },
      });
    },
    [edl, currentTime, applyEdl, undo]
  );

  // S — razor: split the clip under the playhead into two independent clips
  // (a persistent boundary, so each half is separately cuttable / trimmable).
  const splitAtPlayhead = useCallback(() => {
    if (!edl) return;
    const seg = findSegmentAt(edl, currentTime);
    const EPS = 1e-3;
    if (
      !seg ||
      seg.status !== "keep" ||
      currentTime <= seg.start + EPS ||
      currentTime >= seg.end - EPS
    ) {
      toast("Nothing to split here", {
        description: "Park the playhead inside a clip, away from its edges.",
      });
      return;
    }
    applyEdl(splitAtInEdl(edl, currentTime));
    toast("Split clip", { action: { label: "Undo", onClick: () => undo() } });
  }, [edl, currentTime, applyEdl, undo]);

  // Select a timeline clip (or pass null to clear). Seeking is handled
  // separately by the click, so this only tracks what's selected.
  const handleSelectSegment = useCallback((segment: EDLSegment | null) => {
    setSelectedStart(segment ? segment.start : null);
  }, []);

  // Delete the selected clip — mark its whole span as a manual cut (skipped on
  // playback). Only kept clips are deletable; no-op otherwise.
  const deleteSelected = useCallback(() => {
    if (!edl || selectedStart === null) return;
    const seg = edl.segments.find((s) => s.start === selectedStart);
    setSelectedStart(null);
    if (!seg || seg.status !== "keep") return;
    if (!applyEdl(setRangeStatusInEdl(edl, seg.start, seg.end, "cut", "manual"))) return;
    toast("Clip deleted", { action: { label: "Undo", onClick: () => undo() } });
  }, [edl, selectedStart, applyEdl, undo]);

  // Boundary drags call onTrimStart once (snapshots undo state, like applyEdl)
  // then onTrimBoundary repeatedly as the pointer moves — those live updates
  // must not each push a new undo entry, or undo would only step back a pixel.
  const handleTrimStart = useCallback(() => {
    hasEditedRef.current = true;
    setEdl((prev) => {
      if (prev) undoStack.current.push(prev);
      redoStack.current = [];
      return prev;
    });
  }, []);

  const handleTrimBoundary = useCallback((leftIndex: number, newTime: number) => {
    setEdl((prev) => (prev ? trimBoundaryInEdl(prev, leftIndex, newTime) : prev));
  }, []);

  // Pin the trimmed boundary as manual intent so a rough-cut re-run preserves
  // it. No undo push — this rides inside the drag's existing undo entry.
  const handleTrimEnd = useCallback((leftIndex: number, originalBoundary: number) => {
    setEdl((prev) => (prev ? pinTrimmedBoundaryInEdl(prev, leftIndex, originalBoundary) : prev));
  }, []);

  const handleSeek = useCallback((seconds: number) => {
    playerRef.current?.seek(seconds);
  }, []);

  const seekRelative = useCallback(
    (delta: number) => playerRef.current?.seek(Math.max(0, currentTime + delta)),
    [currentTime]
  );

  // Jump to the previous/next edit point (any keep/cut segment boundary).
  const seekToEditPoint = useCallback(
    (dir: 1 | -1) => {
      if (!edl) return;
      const EPS = 0.05;
      const bounds = Array.from(
        new Set(edl.segments.flatMap((s) => [s.start, s.end]))
      ).sort((a, b) => a - b);
      const target =
        dir === 1
          ? bounds.find((b) => b > currentTime + EPS)
          : [...bounds].reverse().find((b) => b < currentTime - EPS);
      if (target !== undefined) playerRef.current?.seek(target);
    },
    [edl, currentTime]
  );

  // Global keyboard shortcuts — NLE-style transport, navigation, zoom, undo.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        ((e.shiftKey && e.key.toLowerCase() === "z") || e.key === "y")
      ) {
        e.preventDefault();
        redo();
        return;
      }
      // Don't swallow other browser/OS chords (e.g. Cmd+R, Cmd+L).
      if (e.metaKey || e.ctrlKey) return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          playerRef.current?.togglePlay();
          break;
        case "j":
          seekRelative(-5);
          break;
        case "l":
          seekRelative(5);
          break;
        case "q":
          e.preventDefault();
          cutToPlayhead("left");
          break;
        case "w":
          e.preventDefault();
          cutToPlayhead("right");
          break;
        case "s":
          e.preventDefault();
          splitAtPlayhead();
          break;
        case "Delete":
        case "Backspace":
          // Only claim Delete when a clip is selected; the transcript panel
          // handles it for word selections.
          if (selectedStart !== null) {
            e.preventDefault();
            deleteSelected();
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekRelative(e.shiftKey ? -5 : -1);
          break;
        case "ArrowRight":
          e.preventDefault();
          seekRelative(e.shiftKey ? 5 : 1);
          break;
        case ",":
          seekRelative(-0.1);
          break;
        case ".":
          seekRelative(0.1);
          break;
        case "ArrowUp":
          e.preventDefault();
          seekToEditPoint(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          seekToEditPoint(1);
          break;
        case "Home":
          e.preventDefault();
          playerRef.current?.seek(0);
          break;
        case "End":
          e.preventDefault();
          if (edl) playerRef.current?.seek(Math.max(...edl.segments.map((s) => s.end), 0));
          break;
        case "=":
        case "+":
          timelineRef.current?.zoomIn();
          break;
        case "-":
        case "_":
          timelineRef.current?.zoomOut();
          break;
        case "0":
          timelineRef.current?.zoomFit();
          break;
        case "?":
          setShowShortcuts((s) => !s);
          break;
        case "Escape":
          setShowShortcuts(false);
          setShowRetakeReview(false);
          setSelectedStart(null);
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [edl, undo, redo, seekRelative, seekToEditPoint, cutToPlayhead, splitAtPlayhead, selectedStart, deleteSelected]);

  const words = useMemo(() => project?.transcript?.words ?? [], [project]);
  const totalSeconds = useMemo(
    () => (edl ? Math.max(...edl.segments.map((s) => s.end), 0) : 0),
    [edl]
  );
  // Source duration for regenerating the auto cut — the transcript's own
  // duration, falling back to the stored source length.
  const durationSeconds = useMemo(
    () =>
      project?.transcript?.duration ??
      (project?.durationMs ? project.durationMs / 1000 : 0),
    [project]
  );

  // Re-run the automatic rough cut at the current sensitivity, keeping manual
  // edits. This is what applies improved detection to an already-edited project.
  const reRunRoughCut = useCallback(() => {
    if (!edl || durationSeconds <= 0) return;
    const next = reRoughCutInEdl(edl, words, durationSeconds, SENSITIVITY_PRESETS[sensitivity]);
    // reRoughCut returns the same EDL untouched when there's nothing to
    // regenerate from (transcript not ready yet) — don't claim a re-run happened.
    if (next === edl) {
      toast("Nothing to re-run", {
        description: "The transcript isn't ready yet.",
      });
      return;
    }
    if (!applyEdl(next)) return;
    toast("Rough cut re-run", {
      description: "Silence & retakes regenerated — your manual edits were kept.",
      action: { label: "Undo", onClick: () => undo() },
    });
  }, [edl, words, durationSeconds, sensitivity, applyEdl, undo]);
  // Kick off a WebCodecs export of the current EDL, streaming the result
  // straight to a file the user picks via the native save dialog.
  const handleExport = useCallback(async () => {
    if (!sourceFile || !edl || !project) return;

    const support = isExportSupported();
    if (!support.supported) {
      toast.error("Export isn't available", { description: support.reason });
      return;
    }

    setExportState("exporting");
    try {
      exportHandleRef.current = await startExport(sourceFile, edl, project.fileName, {
        onProgress: (processedSeconds, totalSeconds) => {
          const pct = totalSeconds > 0 ? Math.round((processedSeconds / totalSeconds) * 100) : 0;
          toast.loading(`Exporting… ${pct}%`, { id: "export" });
        },
        onDone: () => {
          setExportState("idle");
          toast.success("Export complete", { id: "export" });
        },
        onError: (message) => {
          setExportState("idle");
          toast.error("Export failed", { id: "export", description: message });
        },
      });
    } catch (error) {
      setExportState("idle");
      // The user closing the native save dialog isn't a real error.
      if ((error as DOMException)?.name !== "AbortError") {
        toast.error("Couldn't start export");
      }
    }
  }, [sourceFile, edl, project]);

  // Warn on tab close/reload while a render is in flight — closing loses it.
  useEffect(() => {
    if (exportState !== "exporting") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [exportState]);

  // Sorted, de-duped word edges that timeline trim drags snap to.
  const snapTimes = useMemo(() => {
    const edges = new Set<number>();
    for (const w of words) {
      edges.add(w.start);
      edges.add(w.end);
    }
    return Array.from(edges).sort((a, b) => a - b);
  }, [words]);

  // Live status counts derived from the EDL.
  const stats = useMemo(() => {
    const segments = edl?.segments ?? [];
    const cutSegments = segments.filter((s) => s.status === "cut");
    const keepSegments = segments.filter((s) => s.status === "keep");
    const cutSeconds = cutSegments.reduce((sum, s) => sum + (s.end - s.start), 0);
    const keptSeconds = keepSegments.reduce((sum, s) => sum + (s.end - s.start), 0);
    return {
      removedCount: cutSegments.length,
      clipCount: keepSegments.length,
      cutSeconds,
      keptSeconds,
    };
  }, [edl]);

  const resolutionLabel = useMemo(() => {
    if (!videoMeta || !videoMeta.height) return null;
    const h = videoMeta.height;
    const tier = h >= 2160 ? "4K" : h >= 1440 ? "1440p" : h >= 1080 ? "1080p" : h >= 720 ? "720p" : `${h}p`;
    const ratio = videoMeta.width / videoMeta.height;
    const aspect =
      Math.abs(ratio - 16 / 9) < 0.05
        ? "16:9"
        : Math.abs(ratio - 9 / 16) < 0.05
          ? "9:16"
          : Math.abs(ratio - 4 / 3) < 0.05
            ? "4:3"
            : Math.abs(ratio - 1) < 0.05
              ? "1:1"
              : null;
    return { tier, aspect };
  }, [videoMeta]);

  const cycleSpeed = useCallback(() => {
    const rates = [1, 1.5, 2];
    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    setPlaybackRate(next);
    playerRef.current?.setPlaybackRate(next);
  }, [playbackRate]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      playerRef.current?.setMuted(next);
      return next;
    });
  }, []);

  // Width is managed imperatively on the DOM node (not React state): avoids a
  // re-render per drag step and an SSR hydration mismatch on the persisted value.
  // Restore the saved width after mount.
  useEffect(() => {
    const saved = Number(localStorage.getItem("rc:transcriptWidth"));
    if (saved >= MIN_TRANSCRIPT_W && saved <= MAX_TRANSCRIPT_W && transcriptRef.current) {
      transcriptRef.current.style.width = `${saved}px`;
    }
  }, []);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizingRef.current || !transcriptRef.current) return;
    // Transcript is pinned to the right edge, so its width grows as the pointer
    // moves left: width = viewport right edge − pointer x.
    const next = Math.min(MAX_TRANSCRIPT_W, Math.max(MIN_TRANSCRIPT_W, window.innerWidth - e.clientX));
    transcriptRef.current.style.width = `${next}px`;
  }, []);
  const endResize = useCallback((e: React.PointerEvent) => {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (transcriptRef.current) {
      localStorage.setItem("rc:transcriptWidth", String(transcriptRef.current.offsetWidth));
    }
  }, []);

  if (isLoading) {
    return <EditorSkeleton />;
  }

  if (loadError || !project) {
    return (
      <StatusScreen
        tone="error"
        icon={<AlertTriangle className="h-7 w-7" />}
        title="Project not found"
        message={loadError || "We couldn't find this project. It may have been deleted."}
      />
    );
  }

  if (project.transcriptStatus !== "ready") {
    if (project.transcriptStatus === "processing") {
      return (
        <StatusScreen
          icon={<Loader2 className="h-7 w-7 motion-safe:animate-spin" />}
          title="Transcribing your video"
          message="This usually takes a minute or two. Come back once it's ready — we'll have the transcript waiting."
        />
      );
    }
    if (project.transcriptStatus === "failed") {
      return (
        <StatusScreen
          tone="error"
          icon={<AlertTriangle className="h-7 w-7" />}
          title="Transcription failed"
          message="Something went wrong while transcribing this video. Try re-uploading it from the dashboard."
        />
      );
    }
    return (
      <StatusScreen
        icon={<Clock className="h-7 w-7" />}
        title="Transcription hasn't started"
        message="This project doesn't have a transcript yet. Start one from the dashboard to begin editing."
      />
    );
  }

  if (!sourceUrl) {
    return (
      <div className="flex h-screen flex-col">
        <TopBar fileName={project.fileName} savedAt={savedAt} disabled />
        <div className="mx-auto mt-16 max-w-2xl px-6">
          <h1 className="text-2xl font-bold text-foreground">{project.fileName}</h1>
          <p className="mt-2 text-foreground/50">
            Your video isn&apos;t stored on our server. Re-select{" "}
            <span className="text-foreground/80">{project.fileName}</span> from your
            computer to continue editing.
          </p>
          <div className="mt-6">
            <FilePicker onFileSelected={(file) => setSourceFile(file)} />
          </div>
        </div>
      </div>
    );
  }

  const railTools: { Icon: LucideIcon; label: string; badge?: number; active?: boolean }[] = [
    { Icon: MousePointer2, label: "Select", active: true },
    { Icon: Scissors, label: "Trim" },
    { Icon: Sparkles, label: "Filler" },
    { Icon: AudioLines, label: "Silence", badge: stats.removedCount },
    { Icon: Captions, label: "Captions" },
    { Icon: SlidersHorizontal, label: "Audio" },
    { Icon: Type, label: "Titles" },
    { Icon: Settings, label: "Settings" },
  ];

  const transportBtn =
    "flex h-9 w-9 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground";

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TopBar
        fileName={project.fileName}
        savedAt={savedAt}
        onUndo={undo}
        onRedo={redo}
        onExport={handleExport}
        exportDisabled={!sourceFile || exportState === "exporting"}
        exportState={exportState}
      />

      {/* Middle band: rail + preview + transcript */}
      <div className="flex min-h-0 flex-1">
        {/* Tool rail */}
        <div className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-foreground/5 py-3">
          {railTools.map((tool) => (
            <button
              key={tool.label}
              type="button"
              disabled={!tool.active}
              aria-pressed={tool.active}
              title={tool.active ? tool.label : `${tool.label} (coming soon)`}
              className={`relative flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-[10px] ${
                tool.active
                  ? "bg-violet-500/15 text-violet-300"
                  : "cursor-not-allowed text-foreground/30"
              }`}
            >
              <tool.Icon className="h-5 w-5" strokeWidth={1.75} />
              {tool.label}
              {tool.badge ? (
                <span className="absolute right-2 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-500 px-1 text-[9px] font-bold text-white">
                  {tool.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Center: video + transport */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/40 p-4">
            <div className="relative flex h-full max-h-full items-center justify-center">
              <VideoPlayer
                ref={playerRef}
                src={sourceUrl}
                edl={edl ?? { segments: [] }}
                onTimeUpdate={setCurrentTime}
                onPlayingChange={setIsPlaying}
                onLoadedMetadata={setVideoMeta}
                className="max-h-full max-w-full cursor-pointer rounded-lg bg-black object-contain"
              />
              {resolutionLabel && (
                <div className="pointer-events-none absolute left-3 top-3 flex gap-2 font-mono text-xs text-white/70">
                  <span>{resolutionLabel.tier}</span>
                  {resolutionLabel.aspect && <span>{resolutionLabel.aspect}</span>}
                </div>
              )}
              {!isPlaying && (
                <button
                  type="button"
                  aria-label="Play"
                  onClick={() => playerRef.current?.play()}
                  className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-violet-600/90 text-white shadow-lg motion-safe:transition-transform motion-safe:hover:scale-105"
                >
                  <Play className="h-7 w-7 translate-x-0.5 fill-current" />
                </button>
              )}
            </div>
          </div>

          {/* Transport bar */}
          <div className="flex items-center gap-3 border-t border-foreground/5 px-4 py-2.5">
            <span className="font-mono text-xs text-foreground/50">
              <span className="text-foreground/80">{formatDuration(currentTime * 1000)}</span>
              {" / "}
              {formatDuration(totalSeconds * 1000)}
            </span>
            <div className="flex flex-1 items-center justify-center gap-2">
              <button
                type="button"
                aria-label="Back 5 seconds"
                onClick={() => playerRef.current?.seek(Math.max(0, currentTime - 5))}
                className={transportBtn}
              >
                <Rewind className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={isPlaying ? "Pause" : "Play"}
                onClick={() => playerRef.current?.togglePlay()}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-white transition-colors hover:bg-violet-500"
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5 fill-current" />
                ) : (
                  <Play className="h-5 w-5 translate-x-0.5 fill-current" />
                )}
              </button>
              <button
                type="button"
                aria-label="Forward 5 seconds"
                onClick={() => playerRef.current?.seek(currentTime + 5)}
                className={transportBtn}
              >
                <FastForward className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={cycleSpeed}
                title="Playback speed"
                className="rounded-md border border-foreground/10 px-2 py-1 font-mono text-xs text-foreground/60 hover:bg-foreground/10 hover:text-foreground/90"
              >
                {playbackRate}×
              </button>
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? "Unmute" : "Mute"}
                aria-pressed={muted}
                className={transportBtn}
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => playerRef.current?.requestFullscreen()}
                aria-label="Fullscreen"
                className={transportBtn}
              >
                <Maximize className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Resize handle */}
        <div
          onPointerDown={startResize}
          onPointerMove={onResizeMove}
          onPointerUp={endResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize transcript panel"
          className="group relative z-10 w-1 shrink-0 cursor-col-resize"
        >
          <div className="absolute inset-y-0 -left-1 -right-1 transition-colors group-hover:bg-violet-500/30" />
        </div>

        {/* Transcript */}
        <div ref={transcriptRef} className="shrink-0" style={{ width: 380 }}>
          <TranscriptPanel
            words={words}
            edl={edl ?? { segments: [] }}
            currentTime={currentTime}
            isPlaying={isPlaying}
            onSeek={handleSeek}
            onCutWords={handleCutWords}
            onRestoreSegment={handleRestoreSegment}
            onOpenRetakeReview={() => setShowRetakeReview(true)}
          />
        </div>
      </div>

      {/* Timeline dock */}
      <TimelineBar
        ref={timelineRef}
        edl={edl ?? { segments: [] }}
        currentTime={currentTime}
        isPlaying={isPlaying}
        sourceFile={sourceFile}
        fileName={project.fileName}
        snapTimes={snapTimes}
        onSeek={handleSeek}
        onRestoreSegment={handleRestoreSegment}
        onTrimStart={handleTrimStart}
        onTrimBoundary={handleTrimBoundary}
        onTrimEnd={handleTrimEnd}
        onCutToPlayhead={cutToPlayhead}
        onSplit={splitAtPlayhead}
        selectedStart={selectedStart}
        onSelectSegment={handleSelectSegment}
        onDeleteSelected={deleteSelected}
      />

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-foreground/5 px-4 py-1.5 text-[11px] text-foreground/55">
        <div className="flex items-center gap-3">
          <span>
            Original <span className="font-mono text-foreground/60">{formatDuration(totalSeconds * 1000)}</span>
            {" → "}Cut to{" "}
            <span className="font-mono text-emerald-400">{formatDuration(stats.keptSeconds * 1000)}</span>
          </span>
          <span>·</span>
          <span>
            Removed {stats.removedCount} cut{stats.removedCount === 1 ? "" : "s"} (
            {formatDuration(stats.cutSeconds * 1000)})
          </span>
          <span>·</span>
          <span>{stats.clipCount} clip{stats.clipCount === 1 ? "" : "s"}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-foreground/40">Sensitivity</span>
            <div className="flex overflow-hidden rounded-md border border-foreground/10">
              {(["light", "balanced", "aggressive"] as SensitivityLevel[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setSensitivity(level)}
                  aria-pressed={sensitivity === level}
                  title={`${level} auto-cut`}
                  className={`px-2 py-0.5 capitalize transition-colors ${
                    sensitivity === level
                      ? "bg-violet-600 text-white"
                      : "text-foreground/55 hover:bg-foreground/10 hover:text-foreground/80"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={reRunRoughCut}
            title="Regenerate silence & retake cuts, keeping your manual edits"
            className="inline-flex items-center gap-1 rounded-md border border-foreground/10 px-2 py-0.5 text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Re-run rough cut
          </button>
          <button
            type="button"
            onClick={() => setShowShortcuts(true)}
            className="text-violet-400/70 hover:text-violet-400 hover:underline"
          >
            Shortcuts (?)
          </button>
        </div>
      </div>

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}

      {showRetakeReview && edl && (
        <RetakeReviewQueue
          edl={edl}
          onSeek={handleSeek}
          onRestoreSegment={handleRestoreSegment}
          onClose={() => setShowRetakeReview(false)}
        />
      )}

      <Toaster
        position="bottom-center"
        gap={8}
        toastOptions={{
          classNames: {
            toast:
              "!rounded-lg !border !border-foreground/10 !bg-background !text-foreground !shadow-2xl",
            description: "!text-foreground/60",
            actionButton:
              "!rounded-md !bg-violet-600 !px-2.5 !py-1 !text-xs !font-medium !text-white hover:!bg-violet-500",
            error: "!text-red-300",
            icon: "!text-violet-300",
          },
        }}
      />
    </div>
  );
}

function StatusScreen({
  icon,
  title,
  message,
  tone,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  tone?: "error";
}) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
          tone === "error" ? "bg-red-500/10 text-red-400" : "bg-violet-500/15 text-violet-300"
        }`}
      >
        {icon}
      </div>
      <div className="space-y-1.5">
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <p className="max-w-md text-sm text-foreground/50">{message}</p>
      </div>
      <Link
        href="/dashboard"
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-sm text-foreground/70 hover:bg-foreground/10"
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>
    </div>
  );
}

function EditorSkeleton() {
  const block = "rounded-md bg-foreground/[0.06] motion-safe:animate-pulse";
  return (
    <div className="flex h-screen flex-col bg-background" aria-busy="true" aria-label="Loading editor">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-3 py-2">
        <div className="flex items-center gap-3">
          <div className={`h-8 w-28 ${block}`} />
          <div className={`h-8 w-40 ${block}`} />
        </div>
        <div className="flex items-center gap-2">
          <div className={`h-8 w-16 ${block}`} />
          <div className={`h-8 w-20 ${block}`} />
          <div className={`h-8 w-24 ${block}`} />
        </div>
      </div>

      {/* Middle band */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-foreground/5 py-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`h-10 w-12 ${block}`} />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center bg-black/40 p-4">
            <div className={`h-full w-full max-w-3xl ${block}`} />
          </div>
          <div className="flex items-center gap-3 border-t border-foreground/5 px-4 py-2.5">
            <div className={`h-5 w-28 ${block}`} />
            <div className="flex flex-1 items-center justify-center gap-2">
              <div className={`h-9 w-9 rounded-full ${block}`} />
              <div className={`h-10 w-10 rounded-full ${block}`} />
              <div className={`h-9 w-9 rounded-full ${block}`} />
            </div>
            <div className={`h-7 w-20 ${block}`} />
          </div>
        </div>
        <div className="w-[380px] shrink-0 space-y-3 border-l border-foreground/5 p-5">
          <div className={`h-7 w-32 ${block}`} />
          <div className={`h-9 w-full ${block}`} />
          <div className="space-y-2.5 pt-3">
            {[72, 88, 64, 80, 56, 84, 68, 76].map((w, i) => (
              <div key={i} className={`h-4 ${block}`} style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>

      {/* Timeline dock */}
      <div className="space-y-3 border-t border-foreground/10 p-4">
        <div className={`h-6 w-full ${block}`} />
        <div className={`h-12 w-full ${block}`} />
        <div className={`h-10 w-full ${block}`} />
      </div>
    </div>
  );
}

function TopBar({
  fileName,
  savedAt,
  onUndo,
  onRedo,
  disabled,
  onExport,
  exportDisabled,
  exportState,
}: {
  fileName: string;
  savedAt: "saved" | "saving";
  onUndo?: () => void;
  onRedo?: () => void;
  disabled?: boolean;
  onExport?: () => void;
  exportDisabled?: boolean;
  exportState?: "idle" | "exporting";
}) {
  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-md text-foreground/60 hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-3 py-2">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-sm text-foreground/70 hover:bg-foreground/10"
        >
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/15 text-violet-300">
            <Clapperboard className="h-4 w-4" />
          </span>
          <div>
            <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
              {fileName}
            </div>
            <div
              aria-live="polite"
              className="flex items-center gap-1 text-[11px] text-foreground/55"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  savedAt === "saving" ? "bg-amber-400" : "bg-emerald-400"
                }`}
              />
              {savedAt === "saving" ? "Saving…" : "All changes saved"}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-foreground/10">
          <button type="button" onClick={onUndo} disabled={disabled} aria-label="Undo" className={iconBtn}>
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={onRedo} disabled={disabled} aria-label="Redo" className={iconBtn}>
            <Redo2 className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          disabled
          title="Share (coming soon)"
          className="flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-sm text-foreground/40"
        >
          <Share2 className="h-4 w-4" /> Share
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={exportDisabled}
          title={exportDisabled ? "Select your source video first" : "Export to MP4"}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-violet-600/60 disabled:text-white/70 disabled:hover:bg-violet-600/60"
        >
          {exportState === "exporting" ? (
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {exportState === "exporting" ? "Exporting…" : "Export"}
        </button>
      </div>
    </div>
  );
}

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "Space / K", label: "Play / pause" },
  { keys: "J / L", label: "Jump back / forward 5s" },
  { keys: "← / →", label: "Step 1s (Shift = 5s)" },
  { keys: ", / .", label: "Nudge 0.1s" },
  { keys: "↑ / ↓", label: "Previous / next edit point" },
  { keys: "Home / End", label: "Jump to start / end" },
  { keys: "Click word", label: "Seek to that word" },
  { keys: "Shift-click + Delete", label: "Cut selected words" },
  { keys: "Q / W", label: "Trim clip to playhead — left / right" },
  { keys: "S", label: "Split clip at playhead" },
  { keys: "Click clip + Delete", label: "Select a clip, then delete it" },
  { keys: "Click a cut", label: "Restore it" },
  { keys: "Drag handle", label: "Trim a cut edge (Alt = free, no snap)" },
  { keys: "= / − / 0", label: "Zoom in / out / fit timeline" },
  { keys: "⌘Z / ⇧⌘Z", label: "Undo / redo" },
  { keys: "?", label: "Toggle this help" },
];

interface RetakeReviewQueueProps {
  edl: EDL;
  onSeek: (seconds: number) => void;
  onRestoreSegment: (segment: EDLSegment) => void;
  onClose: () => void;
}

/**
 * Jump-through review of auto-cut retakes: one at a time, "Accept cut" moves
 * on, "Keep both" restores it. Restoring shrinks the queue and shifts the
 * next retake into the same index, so the index only advances on accept.
 */
function RetakeReviewQueue({ edl, onSeek, onRestoreSegment, onClose }: RetakeReviewQueueProps) {
  const retakes = useMemo(
    () =>
      edl.segments
        .filter((s) => s.status === "cut" && s.reason === "retake")
        .sort((a, b) => a.start - b.start),
    [edl]
  );
  const [index, setIndex] = useState(0);
  const clampedIndex = Math.min(index, Math.max(0, retakes.length - 1));
  const current = retakes[clampedIndex];

  // Preview the current retake in the player as the queue advances.
  useEffect(() => {
    if (current) onSeek(current.start);
  }, [current, onSeek]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-foreground/10 bg-background p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Review retakes</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-foreground/40 hover:bg-foreground/10 hover:text-foreground/80"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {current ? (
          <>
            <p className="mb-4 text-xs text-foreground/50">
              {clampedIndex + 1} of {retakes.length} — kept the later take
            </p>
            <div className="mb-5 rounded-lg border border-amber-400/20 bg-amber-500/[0.08] px-3 py-2 font-mono text-xs text-amber-300">
              {formatDuration(current.start * 1000)} – {formatDuration(current.end * 1000)}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onRestoreSegment(current)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-foreground/10 px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-foreground/15"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Keep both
              </button>
              <button
                type="button"
                onClick={() =>
                  setIndex((i) => Math.min(i + 1, Math.max(0, retakes.length - 1)))
                }
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/25"
              >
                <Check className="h-3.5 w-3.5" /> Accept cut
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-5 text-sm text-foreground/60">All retakes reviewed.</p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-lg bg-violet-500/20 px-3 py-2 text-sm font-medium text-violet-300 hover:bg-violet-500/30"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-foreground/10 bg-background p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-foreground/40 hover:bg-foreground/10 hover:text-foreground/80"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-foreground/60">{s.label}</span>
              <kbd className="rounded-md border border-foreground/10 bg-foreground/5 px-2 py-0.5 font-mono text-xs text-foreground/80">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
