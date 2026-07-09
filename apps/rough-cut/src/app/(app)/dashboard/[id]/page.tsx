"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Clapperboard,
  Undo2,
  Redo2,
  Download,
  Scissors,
  Sparkles,
  ListChecks,
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
  Eraser,
  RotateCcw,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Toaster, toast } from "sonner";
import FilePicker from "@/components/file-picker";
import ProgressRing from "@/components/progress-ring";
import VideoPlayer, {
  type VideoPlayerHandle,
  type VideoMeta,
} from "@/components/video-player";
import TranscriptPanel from "@/components/transcript-panel";
import TimelineBar, { type TimelineHandle } from "@/components/timeline-bar";
import { WALLET_DASHBOARD_URL } from "@/lib/env";
import { formatDuration } from "@/lib/utils";
import {
  isExportSupported,
  startExport,
  type ExportHandle,
  type ExportSupport,
} from "@/lib/export/export-trigger";
import {
  absorbCutResidue,
  changedSpan,
  cutWords as cutWordsInEdl,
  cutEachWord,
  restoreSegment as restoreSegmentInEdl,
  trimBoundary as trimBoundaryInEdl,
  setRangeStatus as setRangeStatusInEdl,
  splitAt as splitAtInEdl,
  reRoughCut as reRoughCutInEdl,
  pinTrimmedBoundary as pinTrimmedBoundaryInEdl,
  findSegmentAt,
  findFillerWords,
  keptDuration,
  SENSITIVITY_PRESETS,
  DEFAULT_SENSITIVITY,
  type SensitivityLevel,
  type EDL,
  type EDLSegment,
  type Transcript,
  type TranscriptWord,
} from "@/lib/edl";
import { applyAiCuts, type AiCutRun } from "@/lib/ai-cuts";

// A project holds at most this many stored AI Cut runs at once (ADR 0002-ai-cut-paid-rerun).
const AI_CUT_RUN_LIMIT = 3;

interface Project {
  id: string;
  fileName: string;
  durationMs: number | null;
  transcript: Transcript | null;
  transcriptStatus: "idle" | "processing" | "ready" | "failed";
  edl: EDL | null;
  activeAiCutRunId: string | null;
  aiCutRuns: AiCutRun[];
}

// Fired on every editor→dashboard navigation: pure reassurance, never a
// blocker — autosave is real, so nothing is unsaved. The one non-obvious fact
// a user needs is that reopening requires reselecting the same source file
// (the video never touches the server). The dashboard mounts its own Toaster,
// so the toast survives the navigation.
function showExitReassuranceToast() {
  toast("Project saved", {
    description:
      "Your edits are stored automatically. To reopen this project, just reselect the same source video.",
  });
}

const AUTOSAVE_DELAY_MS = 800;
const MIN_TRANSCRIPT_W = 300;
const MAX_TRANSCRIPT_W = 640;

// Export support is a fixed property of the browser, so probe it once and cache
// the (stable-reference) result — useSyncExternalStore compares snapshots by
// identity, so it must not recompute per render.
let cachedExportSupport: ExportSupport | null = null;
const exportSupportSnapshot = (): ExportSupport =>
  (cachedExportSupport ??= isExportSupported());
// Probing touches window/VideoEncoder, so the server can't answer — report null
// on the server and during hydration (button ungated), then swap to the real
// answer on the client. No effect, no hydration mismatch.
const exportSupportServerSnapshot = (): ExportSupport | null => null;
const exportSupportSubscribe = () => () => {};

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [sourceFile, setSourceFile] = useState<File | null>(null);

  const [edl, setEdl] = useState<EDL | null>(null);
  // The hero prompt shows until the user edits (any accepted edit dismisses
  // it), dismisses it, or opens a project that already has a saved EDL.
  const [heroDismissed, setHeroDismissed] = useState(false);
  // The last completed cut pass — drives the transcript panel's summary card
  // (which auto-collapses a few seconds after each event).
  const [cutEvent, setCutEvent] = useState<{ kind: "rough" | "ai"; at: number } | null>(
    null
  );
  const [currentTime, setCurrentTime] = useState(0);
  // Mirror of currentTime for event handlers. The rAF clock updates state at
  // ~60 Hz; handlers that read the playhead through this ref stay referentially
  // stable instead of re-creating (and re-attaching the global key listener,
  // and re-rendering every timeline clip) once per frame.
  const currentTimeRef = useRef(0);
  const handleTimeUpdate = useCallback((seconds: number) => {
    currentTimeRef.current = seconds;
    setCurrentTime(seconds);
  }, []);
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
  // "starting" = save dialog open, no cancellable handle yet; "exporting" =
  // worker is encoding and can be cancelled; "cancelling" = cancel requested.
  const [exportState, setExportState] = useState<
    "idle" | "starting" | "exporting" | "cancelling"
  >("idle");
  // null until the client has probed WebCodecs + File System Access; ungated
  // until then to avoid a flash of "unsupported" during hydration.
  const exportSupport = useSyncExternalStore(
    exportSupportSubscribe,
    exportSupportSnapshot,
    exportSupportServerSnapshot
  );
  // Export output resolution cap (px height); null = keep the source resolution.
  const [exportMaxHeight, setExportMaxHeight] = useState<number | null>(null);
  const exportHandleRef = useRef<ExportHandle | null>(null);
  // Mirrors the "cancelling" state for the onProgress closure (which captures a
  // stale exportState) so late progress events don't clobber the "Cancelling…"
  // toast.
  const cancellingRef = useRef(false);
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

  // Bumped by the transcription poll below when a processing project reaches
  // a terminal status — re-runs the fetch effect so the editor swaps in.
  const [reloadNonce, setReloadNonce] = useState(0);

  // Fetch the project on mount (and again whenever a reload is requested).
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

        const durationSeconds =
          data.transcript?.duration ?? (data.durationMs ? data.durationMs / 1000 : 0);

        // A saved EDL that keeps nothing is unusable (you can't export an empty
        // cut) and is almost certainly a corrupted auto-build from before the
        // keep-all safety floor existed — rebuild it instead of loading it.
        const savedEdl =
          data.edl && keptDuration(data.edl) > 0 ? data.edl : null;

        if (savedEdl?.sensitivity) setSensitivity(savedEdl.sensitivity);

        // A saved EDL means this project has been edited before — even one
        // where every cut was later restored. Don't float the first-run hero
        // over work in progress.
        if (savedEdl) setHeroDismissed(true);

        // No automatic rough cut: a fresh project opens with the full, uncut
        // timeline and a hero prompt to create the rough cut. The user sees
        // their raw footage first and watches the cuts happen on their click —
        // nothing is ever removed without an action they took.
        setEdl(
          data.transcriptStatus === "ready"
            ? savedEdl ?? {
                segments: [
                  {
                    start: 0,
                    end: Math.max(durationSeconds, 0),
                    status: "keep" as const,
                    reason: null,
                  },
                ],
              }
            : savedEdl
        );
      } catch {
        setLoadError("Failed to load project.");
      } finally {
        setIsLoading(false);
      }
    }

    fetchProject();
  }, [id, reloadNonce]);

  // While transcription runs, poll for completion and swap in the editor the
  // moment it's ready — without this, the "Transcribing your video" screen is
  // a dead end the user has to leave and re-enter by hand.
  const transcriptStatus = project?.transcriptStatus;
  useEffect(() => {
    if (transcriptStatus !== "processing") return;
    const abortController = new AbortController();

    const checkStatus = async () => {
      try {
        const response = await fetch(`/api/projects/${id}/status`, {
          signal: abortController.signal,
        });
        if (!response.ok) return;
        if (!response.headers.get("content-type")?.includes("application/json")) {
          return;
        }
        const updated = await response.json();
        // Terminal either way (ready or failed): re-run the fetch effect so
        // the screen reflects the real outcome. The refreshed status also
        // shuts this poll down.
        if (updated.transcriptStatus === "ready" || updated.transcriptStatus === "failed") {
          setReloadNonce((n) => n + 1);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to poll transcript status:", error);
      }
    };

    // Background tabs throttle timers heavily, so also re-check the moment
    // the user comes back to the tab.
    const interval = setInterval(checkStatus, 4000);
    const handleReturnToTab = () => {
      if (document.visibilityState === "visible") checkStatus();
    };
    document.addEventListener("visibilitychange", handleReturnToTab);
    window.addEventListener("focus", handleReturnToTab);

    return () => {
      clearInterval(interval);
      abortController.abort();
      document.removeEventListener("visibilitychange", handleReturnToTab);
      window.removeEventListener("focus", handleReturnToTab);
    };
  }, [transcriptStatus, id]);

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

  const words = useMemo(() => project?.transcript?.words ?? [], [project]);

  // Apply an edit, returning whether it was accepted. An edit that keeps
  // nothing is refused: the timeline must always retain at least one clip,
  // otherwise the load path (which discards a zero-kept EDL as corrupt) would
  // silently rebuild from the transcript and wipe every edit on the next reload.
  // Every accepted edit is swept for cut residue — pad-width keep slivers
  // trapped between two cuts that the user would otherwise hunt down by hand.
  // The sweep is scoped to where this edit actually landed (changedSpan), so
  // a deliberate tiny keep elsewhere is never absorbed by an unrelated edit.
  const applyEdl = useCallback(
    (next: EDL): boolean => {
      if (keptDuration(next) <= 0) {
        toast("Can't remove everything", {
          description: "At least one clip must stay in the timeline.",
        });
        return false;
      }
      hasEditedRef.current = true;
      setHeroDismissed(true);
      setEdl((prev) => {
        if (prev) undoStack.current.push(prev);
        redoStack.current = [];
        return prev ? absorbCutResidue(next, words, changedSpan(prev, next)) : next;
      });
      return true;
    },
    [words]
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
      const now = currentTimeRef.current;
      const seg = findSegmentAt(edl, now);
      if (!seg || seg.status === "cut") {
        toast("Nothing to trim here", {
          description: "Park the playhead inside a clip first.",
        });
        return;
      }
      const [start, end] = side === "left" ? [seg.start, now] : [now, seg.end];
      // Playhead sitting on the clip edge — nothing to remove.
      if (end - start < 1e-3) return;
      if (!applyEdl(setRangeStatusInEdl(edl, start, end, "cut", "manual"))) return;
      toast(side === "left" ? "Trimmed clip start" : "Trimmed clip end", {
        action: { label: "Undo", onClick: () => undo() },
      });
    },
    [edl, applyEdl, undo]
  );

  // S — razor: split the clip under the playhead into two independent clips
  // (a persistent boundary, so each half is separately cuttable / trimmable).
  const splitAtPlayhead = useCallback(() => {
    if (!edl) return;
    const now = currentTimeRef.current;
    const seg = findSegmentAt(edl, now);
    const EPS = 1e-3;
    if (
      !seg ||
      seg.status !== "keep" ||
      now <= seg.start + EPS ||
      now >= seg.end - EPS
    ) {
      toast("Nothing to split here", {
        description: "Park the playhead inside a clip, away from its edges.",
      });
      return;
    }
    applyEdl(splitAtInEdl(edl, now));
    toast("Split clip", { action: { label: "Undo", onClick: () => undo() } });
  }, [edl, applyEdl, undo]);

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
    // A trim drag is an edit like any other — the first-run hero goes away.
    setHeroDismissed(true);
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
    (delta: number) =>
      playerRef.current?.seek(Math.max(0, currentTimeRef.current + delta)),
    []
  );

  // Jump to the previous/next edit point (any keep/cut segment boundary).
  const seekToEditPoint = useCallback(
    (dir: 1 | -1) => {
      if (!edl) return;
      const now = currentTimeRef.current;
      const EPS = 0.05;
      const bounds = Array.from(
        new Set(edl.segments.flatMap((s) => [s.start, s.end]))
      ).sort((a, b) => a - b);
      const target =
        dir === 1
          ? bounds.find((b) => b > now + EPS)
          : [...bounds].reverse().find((b) => b < now - EPS);
      if (target !== undefined) playerRef.current?.seek(target);
    },
    [edl]
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

  const showRoughCutHero =
    !!edl &&
    words.length > 0 &&
    !heroDismissed &&
    edl.segments.every((s) => s.status === "keep");

  // The one stored AI Cut run currently applied to the timeline (ADR
  // 0002-ai-cut-paid-rerun) — null when the project has never run AI Cut, or
  // its last active run was deleted.
  const activeAiCutRun =
    project?.aiCutRuns.find((run) => run.id === project.activeAiCutRunId) ?? null;

  // Create the rough cut (first run), or re-run it at the current sensitivity
  // keeping manual edits — same operation, framed differently in the UI.
  const reRunRoughCut = useCallback(() => {
    if (!edl || durationSeconds <= 0) return;
    const firstRun = edl.segments.every((s) => s.status === "keep");
    let next = reRoughCutInEdl(
      edl,
      words,
      durationSeconds,
      SENSITIVITY_PRESETS[sensitivity],
      project?.transcript?.utteranceEnds
    );
    // reRoughCut returns the same EDL untouched when there's nothing to
    // regenerate from (transcript not ready yet) — don't claim a re-run happened.
    if (next === edl) {
      toast("Nothing to re-run", {
        description: "The transcript isn't ready yet.",
      });
      return;
    }
    // Stored AI cuts are part of the auto layer — re-apply them on top of the
    // regenerated heuristics (applyAiCuts re-asserts protectedKeeps after, so
    // the user's restores still win).
    next = applyAiCuts(next, activeAiCutRun, words);
    if (!applyEdl(next)) return;
    setCutEvent({ kind: "rough", at: Date.now() });
    const removed = Math.max(0, keptDuration(edl) - keptDuration(next));
    toast(firstRun ? "Rough cut created" : "Rough cut re-run", {
      description: firstRun
        ? `Removed ${formatDuration(removed * 1000)} of silence, retakes & repeats — all undoable.`
        : "Silence & retakes regenerated — your manual edits were kept.",
      action: { label: "Undo", onClick: () => undo() },
    });
  }, [edl, words, durationSeconds, sensitivity, project, activeAiCutRun, applyEdl, undo]);

  // The studio's on-demand AI pass: ask the server to (re)run Gemini over the
  // transcript, then layer the returned cuts onto the current edit — undoable
  // like any other cut. Also the retry path when the automatic pass at
  // transcription time failed, and the only path for older projects.
  const [aiBusy, setAiBusy] = useState(false);
  const aiCutIdempotencyKey = useRef<string | null>(null);

  // Switch which stored run is active (AC-3). Discards the current manual
  // edits by re-applying the target run's ranges onto a fresh EDL layer, same
  // as a freshly returned POST result.
  const switchActiveAiCutRun = useCallback(
    async (runId: string) => {
      try {
        const response = await fetch(`/api/projects/${id}/ai-cut/active`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !edl) {
          toast.error("Couldn't switch runs", {
            description: (data as { error?: string } | null)?.error ?? "Try again in a moment.",
          });
          return;
        }
        const run = data as AiCutRun;
        setProject((prev) => (prev ? { ...prev, activeAiCutRunId: run.id } : prev));
        if (!applyEdl(applyAiCuts(edl, run, words))) return;
        setCutEvent({ kind: "ai", at: Date.now() });
        toast.success(`Switched to run ${run.runNumber}`, {
          description: `${run.ranges.length} mistake${run.ranges.length === 1 ? "" : "s"} applied — your prior manual edits were discarded.`,
        });
      } catch {
        toast.error("Couldn't switch runs", {
          description: "Check your connection and try again.",
        });
      }
    },
    [id, edl, words, applyEdl]
  );

  // Confirm via a sonner action-toast (the app has no Dialog primitive; this
  // is the same deliberate-action pattern the undo toasts use). Only the
  // explicit Switch press fires the PATCH — Cancel or dismiss does nothing.
  const requestSwitchActiveAiCutRun = useCallback(
    (run: AiCutRun) => {
      toast(`Switch to run ${run.runNumber}?`, {
        description:
          "This discards your current manual edits and applies this run's suggestions instead.",
        action: { label: "Switch", onClick: () => void switchActiveAiCutRun(run.id) },
        cancel: { label: "Cancel", onClick: () => {} },
      });
    },
    [switchActiveAiCutRun]
  );

  // Delete a non-active stored run (AC-4) — no charge, no refund. The active
  // run can't be deleted directly (the button for it isn't even shown), but
  // the server enforces this regardless.
  const deleteAiCutRun = useCallback(
    async (runId: string) => {
      try {
        const response = await fetch(`/api/projects/${id}/ai-cut/runs/${runId}`, {
          method: "DELETE",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          toast.error("Couldn't delete that run", {
            description: (data as { error?: string } | null)?.error ?? "Try again in a moment.",
          });
          return;
        }
        setProject((prev) =>
          prev ? { ...prev, aiCutRuns: prev.aiCutRuns.filter((r) => r.id !== runId) } : prev
        );
        toast.success("AI Cut run deleted");
      } catch {
        toast.error("Couldn't delete that run", {
          description: "Check your connection and try again.",
        });
      }
    },
    [id]
  );

  const requestDeleteAiCutRun = useCallback(
    (run: AiCutRun) => {
      toast(`Delete run ${run.runNumber}?`, {
        description: "This removes this stored run for good — no refund.",
        action: { label: "Delete", onClick: () => void deleteAiCutRun(run.id) },
        cancel: { label: "Cancel", onClick: () => {} },
      });
    },
    [deleteAiCutRun]
  );

  const runAiCut = useCallback(async () => {
    if (!edl || aiBusy) return;
    setAiBusy(true);
    
    if (!aiCutIdempotencyKey.current) {
      aiCutIdempotencyKey.current = crypto.randomUUID();
    }
    const currentKey = aiCutIdempotencyKey.current;

    toast.loading("AI is reviewing your transcript…", { id: "ai-cut" });
    try {
      const response = await fetch(`/api/projects/${id}/ai-cut`, {
        method: "POST",
        headers: { "Idempotency-Key": currentKey },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 402) {
          toast.error("Not enough funds", {
            id: "ai-cut",
            description: "This AI pass needs more credit than you have left.",
            action: { label: "Add funds", onClick: () => window.open(WALLET_DASHBOARD_URL, "_blank") },
          });
          return;
        }
        if (response.status === 409) {
          const code = (data as { code?: string } | null)?.code;
          if (code === "AI_CUT_RUN_LIMIT_REACHED") {
            toast.error(`Already have ${AI_CUT_RUN_LIMIT} saved runs`, {
              id: "ai-cut",
              description:
                (data as { error?: string } | null)?.error ??
                "Delete one of the stored runs to make room for another.",
            });
            return;
          }
          if (code === "AI_CUT_IN_PROGRESS") {
            // Another tab/request is already mid-run for this project — not
            // a failure, just lost the race to claim the run.
            toast("AI Cut is already running", {
              id: "ai-cut",
              description: "Another request is already running AI Cut on this project — try again shortly.",
            });
            return;
          }
        }
        toast.error("AI cut failed", {
          id: "ai-cut",
          description:
            (data as { error?: string } | null)?.error ?? "Try again in a moment.",
        });
        return;
      }
      const run = data as AiCutRun;
      setProject((prev) =>
        prev
          ? { ...prev, activeAiCutRunId: run.id, aiCutRuns: [...prev.aiCutRuns, run] }
          : prev
      );
      if (run.ranges.length === 0) {
        toast.success("Nothing to cut", {
          id: "ai-cut",
          description: "The AI found no false starts, stumbles, or flubbed takes.",
        });
        return;
      }
      if (!applyEdl(applyAiCuts(edl, run, words))) {
        toast.dismiss("ai-cut");
        return;
      }
      setCutEvent({ kind: "ai", at: Date.now() });
      toast.success(
        `AI cut applied — ${run.ranges.length} mistake${run.ranges.length === 1 ? "" : "s"} removed`,
        { id: "ai-cut", action: { label: "Undo", onClick: () => undo() } }
      );
    } catch {
      toast.error("AI cut failed", {
        id: "ai-cut",
        description: "Check your connection and try again.",
      });
    } finally {
      aiCutIdempotencyKey.current = null;
      setAiBusy(false);
    }
  }, [edl, aiBusy, id, words, applyEdl, undo]);
  // Signal the in-flight export to stop. Only reachable once a handle exists
  // (the Cancel control is shown only in "exporting"/"cancelling"); the guard
  // is belt-and-suspenders. The worker throws ExportError("cancelled"), which
  // lands in onError below and settles the state back to idle.
  const handleCancelExport = useCallback(() => {
    if (!exportHandleRef.current) return;
    cancellingRef.current = true;
    setExportState("cancelling");
    toast.loading("Cancelling…", { id: "export" });
    exportHandleRef.current.cancel();
  }, []);

  // Kick off a WebCodecs export of the current EDL, streaming the result
  // straight to a file the user picks via the native save dialog.
  const handleExport = useCallback(async () => {
    if (!sourceFile || !edl || !project) return;

    const support = isExportSupported();
    if (!support.supported) {
      toast.error("Export isn't available", { description: support.reason });
      return;
    }

    // Drop any handle from a previous export so a cancel during this run's save
    // dialog can't act on a terminated worker. "starting" keeps the Cancel
    // control hidden until startExport resolves with a real, cancellable handle.
    exportHandleRef.current = null;
    cancellingRef.current = false;
    setExportState("starting");
    try {
      const handle = await startExport(sourceFile, edl, project.fileName, {
        onProgress: (processedSeconds, totalSeconds) => {
          // A cancel already landed — don't clobber the "Cancelling…" toast with
          // a late progress tick.
          if (cancellingRef.current) return;
          const pct = totalSeconds > 0 ? Math.round((processedSeconds / totalSeconds) * 100) : 0;
          toast.loading(`Exporting… ${pct}%`, {
            id: "export",
            action: { label: "Cancel", onClick: () => handleCancelExport() },
          });
        },
        onDone: () => {
          setExportState("idle");
          toast.success("Export complete", { id: "export" });
        },
        onError: (message, code) => {
          setExportState("idle");
          // A user-initiated cancel isn't a failure — just clear the toast.
          if (code === "cancelled") {
            toast.dismiss("export");
            return;
          }
          if (code === "unsupported-resolution") {
            toast.error("Resolution too high", { id: "export", description: message });
            return;
          }
          toast.error("Export failed", { id: "export", description: message });
        },
      }, { maxHeight: exportMaxHeight ?? undefined });
      // startExport has resolved: the worker is running and the handle can now
      // be cancelled. (This runs before any queued worker message, so no
      // progress/done/error callback can fire while state is still "starting".)
      exportHandleRef.current = handle;
      setExportState("exporting");
    } catch (error) {
      setExportState("idle");
      // The user closing the native save dialog isn't a real error.
      if ((error as DOMException)?.name !== "AbortError") {
        toast.error("Couldn't start export");
      }
    }
  }, [sourceFile, edl, project, handleCancelExport, exportMaxHeight]);

  // Warn on tab close/reload only while an export is actively encoding — that's
  // the one state with work worth losing. "starting" has nothing yet, and
  // "cancelling" is discarding its output on purpose, so neither warns.
  useEffect(() => {
    if (exportState !== "exporting") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [exportState]);

  // Filler words ("um", "uh", …) still inside kept segments — one click on the
  // Filler rail tool cuts them all (Descript-style).
  const fillerWords = useMemo(
    () => (edl ? findFillerWords(edl, words) : []),
    [edl, words]
  );

  const removeFillerWords = useCallback(() => {
    if (!edl || fillerWords.length === 0) return;
    // cutEachWord, NOT cutWords: fillers are scattered, and cutWords' span
    // semantics would take every word between the first and last filler too.
    if (!applyEdl(cutEachWord(edl, fillerWords))) return;
    toast(`Removed ${fillerWords.length} filler word${fillerWords.length === 1 ? "" : "s"}`, {
      description: "Every “um” and “uh” is gone — undo if one carried meaning.",
      action: { label: "Undo", onClick: () => undo() },
    });
  }, [edl, fillerWords, applyEdl, undo]);

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
          message="This usually takes a minute or two. The editor opens automatically the moment your transcript is ready."
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
            <FilePicker
              onFileSelected={(file) => setSourceFile(file)}
              expectedDurationMs={project.durationMs ?? undefined}
            />
          </div>
        </div>
      </div>
    );
  }

  // Pure data only — the click handlers are attached at JSX time via
  // `action`. Storing the callbacks here trips react-hooks/refs: they
  // transitively capture the undo-stack refs, which taints the whole array
  // as "ref-carrying" and flags its render-time read as a ref access.
  // Only real, working tools live in the rail — anything not yet built simply
  // isn't shown (no "coming soon" buttons in production).
  const retakeCount =
    edl?.segments.filter((s) => s.status === "cut" && s.reason === "retake").length ?? 0;
  // What an AI Cut run charges, phrased for tooltips/CTAs. When the duration is
  // unknown the server charges the 60s fallback — say that, not "0:00".
  const aiCostLabel =
    durationSeconds > 0
      ? `${formatDuration(durationSeconds * 1000)} of credits`
      : "1:00 of credits";
  const hasAiCuts = (activeAiCutRun?.ranges.length ?? 0) > 0;
  const railTools: {
    Icon: LucideIcon;
    label: string;
    badge?: number;
    active?: boolean;
    title?: string;
    action: "ai-cut" | "filler" | "review";
  }[] = [
    {
      Icon: Wand2,
      label: "AI Cut",
      active: !aiBusy,
      badge: edl?.segments.filter((s) => s.status === "cut" && s.reason === "ai").length,
      title: aiBusy
        ? "AI is reviewing your transcript…"
        : `AI pass — remove false starts, stumbles & flubbed takes (uses ${aiCostLabel})`,
      action: "ai-cut",
    },
    {
      Icon: Sparkles,
      label: "Filler",
      active: fillerWords.length > 0,
      badge: fillerWords.length,
      title:
        fillerWords.length > 0
          ? `Remove ${fillerWords.length} filler word${fillerWords.length === 1 ? "" : "s"} (um, uh, …)`
          : "No filler words detected",
      action: "filler",
    },
    {
      Icon: ListChecks,
      label: "Review",
      active: retakeCount > 0,
      badge: retakeCount,
      title:
        retakeCount > 0
          ? `Review ${retakeCount} auto-cut retake${retakeCount === 1 ? "" : "s"} one by one`
          : "No auto-cut retakes to review",
      action: "review",
    },
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
        onCancelExport={handleCancelExport}
        exportBlockedReason={
          exportSupport && !exportSupport.supported
            ? exportSupport.reason
            : !sourceFile
              ? "Select your source video first"
              : undefined
        }
        exportState={exportState}
        exportMaxHeight={exportMaxHeight}
        onExportMaxHeightChange={setExportMaxHeight}
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
              onClick={
                tool.action === "ai-cut"
                  ? runAiCut
                  : tool.action === "filler"
                    ? removeFillerWords
                    : () => setShowRetakeReview(true)
              }
              title={tool.title ?? tool.label}
              className={`relative flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-[10px] ${
                tool.active
                  ? "bg-blue-500/15 text-blue-300 transition-colors hover:bg-blue-500/25"
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
                onTimeUpdate={handleTimeUpdate}
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
              {!isPlaying && !showRoughCutHero && (
                <button
                  type="button"
                  aria-label="Play"
                  onClick={() => playerRef.current?.play()}
                  className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-600/90 text-white shadow-lg motion-safe:transition-transform motion-safe:hover:scale-105"
                >
                  <Play className="h-7 w-7 translate-x-0.5 fill-current" />
                </button>
              )}
            </div>
            {showRoughCutHero && (
              <RoughCutHero
                sensitivity={sensitivity}
                onSensitivityChange={setSensitivity}
                onRun={reRunRoughCut}
                onDismiss={() => setHeroDismissed(true)}
              />
            )}
            {aiBusy && <AiCutOverlay wordCount={words.length} />}
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
                onClick={() => seekRelative(-5)}
                className={transportBtn}
              >
                <Rewind className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={isPlaying ? "Pause" : "Play"}
                onClick={() => playerRef.current?.togglePlay()}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-500"
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
                onClick={() => seekRelative(5)}
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
          <div className="absolute inset-y-0 -left-1 -right-1 transition-colors group-hover:bg-blue-500/30" />
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
            cutEvent={cutEvent}
            onEnhanceAi={runAiCut}
            aiBusy={aiBusy}
            aiCostLabel={aiCostLabel}
            hasAiCuts={hasAiCuts}
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
                      ? "bg-blue-600 text-white"
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
          {project && project.aiCutRuns.length > 0 && (
            <div className="flex items-center gap-1" title="Stored AI Cut runs — click a number to switch, the eraser to delete">
              <span className="text-foreground/40">
                AI runs ({project.aiCutRuns.length}/{AI_CUT_RUN_LIMIT})
              </span>
              {project.aiCutRuns.map((run) => {
                const isActive = run.id === project.activeAiCutRunId;
                return (
                  <div key={run.id} className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => !isActive && requestSwitchActiveAiCutRun(run)}
                      aria-pressed={isActive}
                      title={
                        isActive
                          ? `Run ${run.runNumber} — currently active`
                          : `Switch to run ${run.runNumber} (${run.ranges.length} cuts)`
                      }
                      className={`rounded-md border px-1.5 py-0.5 transition-colors ${
                        isActive
                          ? "border-blue-500/40 bg-blue-600/20 text-blue-300"
                          : "border-foreground/10 text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
                      }`}
                    >
                      {run.runNumber}
                    </button>
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => requestDeleteAiCutRun(run)}
                        title={`Delete run ${run.runNumber}`}
                        className="rounded-md border border-foreground/10 p-0.5 text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground"
                      >
                        <Eraser className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowShortcuts(true)}
            className="text-blue-400/70 hover:text-blue-400 hover:underline"
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
              "!rounded-md !bg-blue-600 !px-2.5 !py-1 !text-xs !font-medium !text-white hover:!bg-blue-500",
            error: "!text-red-300",
            icon: "!text-blue-300",
          },
        }}
      />
    </div>
  );
}

/**
 * Centered progress overlay while the AI pass runs. Gemini gives no progress
 * signal — it's a single call — so the percent is a transcript-size-calibrated
 * estimate that climbs to 95% and completes when the response lands (this
 * overlay unmounts the moment aiBusy clears).
 */
function AiCutOverlay({ wordCount }: { wordCount: number }) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);
  // Gemini's runtime scales with transcript length (thinking enabled, capped
  // at 240s server-side) — roughly 40 words/s of review, floored and capped.
  const expectedSeconds = Math.min(180, Math.max(12, 8 + wordCount / 40));
  const percent = Math.min(95, ((now - startedAt) / 1000 / expectedSeconds) * 100);
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm">
      <ProgressRing percent={percent} size={96} />
      <div className="text-center">
        <p className="text-sm font-semibold text-white">
          AI is reviewing your transcript…
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          Finding false starts, stumbles & flubbed takes
        </p>
      </div>
    </div>
  );
}

/**
 * First-run hero: floats over the video preview until the user creates their
 * rough cut (or dismisses it). Deliberately not a modal — the raw footage
 * stays scrubbable and watchable behind it.
 */
function RoughCutHero({
  sensitivity,
  onSensitivityChange,
  onRun,
  onDismiss,
}: {
  sensitivity: SensitivityLevel;
  onSensitivityChange: (level: SensitivityLevel) => void;
  onRun: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="absolute bottom-6 left-1/2 z-10 w-full max-w-xl -translate-x-1/2 px-4">
      <div className="rounded-2xl border border-white/10 bg-surface/90 p-5 shadow-2xl shadow-black/50 backdrop-blur-md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300">
              <Scissors className="h-4.5 w-4.5" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-white">Create your rough cut</h3>
              <p className="mt-0.5 text-xs text-zinc-400">
                Removes silences, retakes & repeated words — instant, free, and
                fully undoable.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex overflow-hidden rounded-lg border border-white/10">
            {(["light", "balanced", "aggressive"] as SensitivityLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => onSensitivityChange(level)}
                aria-pressed={sensitivity === level}
                title={`${level} auto-cut`}
                className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                  sensitivity === level
                    ? "bg-blue-600 text-white"
                    : "text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                }`}
              >
                {level}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onRun}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-colors hover:bg-blue-500"
          >
            <Scissors className="h-4 w-4" />
            Create rough cut
          </button>
        </div>
      </div>
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
          tone === "error" ? "bg-red-500/10 text-red-400" : "bg-blue-500/15 text-blue-300"
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
        onClick={showExitReassuranceToast}
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
  onCancelExport,
  exportBlockedReason,
  exportState = "idle",
  exportMaxHeight = null,
  onExportMaxHeightChange,
}: {
  fileName: string;
  savedAt: "saved" | "saving";
  onUndo?: () => void;
  onRedo?: () => void;
  disabled?: boolean;
  onExport?: () => void;
  onCancelExport?: () => void;
  // Non-empty when the Export button should be disabled in the idle state (no
  // source re-selected, or the browser can't export); doubles as the tooltip.
  exportBlockedReason?: string;
  exportState?: "idle" | "starting" | "exporting" | "cancelling";
  // Output resolution cap for export; null = source resolution.
  exportMaxHeight?: number | null;
  onExportMaxHeightChange?: (height: number | null) => void;
}) {
  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-md text-foreground/60 hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
  const busy = exportState !== "idle";
  const exportDisabled = busy || Boolean(exportBlockedReason);
  // Cancel is offered only once a cancellable handle exists — not during
  // "starting" (save dialog open, nothing to cancel yet).
  const showCancel = exportState === "exporting" || exportState === "cancelling";
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-3 py-2">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          onClick={showExitReassuranceToast}
          className="flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-sm text-foreground/70 hover:bg-foreground/10"
        >
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/15 text-blue-300">
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
        <label htmlFor="export-quality" className="sr-only">
          Export resolution
        </label>
        <select
          id="export-quality"
          value={exportMaxHeight ?? "source"}
          onChange={(e) =>
            onExportMaxHeightChange?.(
              e.target.value === "source" ? null : Number(e.target.value)
            )
          }
          disabled={busy}
          title="Export resolution — downscales larger sources, never upscales"
          className="rounded-lg border border-foreground/10 bg-transparent px-2 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="source">Source</option>
          <option value="1080">1080p</option>
          <option value="720">720p</option>
        </select>
        {showCancel && (
          <button
            type="button"
            onClick={onCancelExport}
            disabled={exportState === "cancelling"}
            title="Cancel export"
            className="flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            {exportState === "cancelling" ? "Cancelling…" : "Cancel"}
          </button>
        )}
        <button
          type="button"
          onClick={onExport}
          disabled={exportDisabled}
          title={exportBlockedReason ?? "Export to MP4"}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-600/60 disabled:text-white/70 disabled:hover:bg-blue-600/60"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {busy ? "Exporting…" : "Export"}
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
              className="w-full rounded-lg bg-blue-500/20 px-3 py-2 text-sm font-medium text-blue-300 hover:bg-blue-500/30"
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
