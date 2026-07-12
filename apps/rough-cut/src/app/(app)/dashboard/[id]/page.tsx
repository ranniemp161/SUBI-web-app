"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Clapperboard,
  Undo2,
  Redo2,
  Download,
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
  RotateCcw,
  ChevronDown,
  Film,
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
import { buildFcpxml } from "@/lib/export/fcpxml";
import { buildCmx3600Edl } from "@/lib/export/cmx3600";
import { sanitizeFilename } from "@/lib/export/filename";
import { downloadTextFile } from "@/lib/download-text-file";
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
  buildInitialEDL,
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
import { ConfirmDialog } from "@repo/ui";

// A project holds at most this many stored AI Cut runs at once (ADR 0002-ai-cut-paid-rerun).
const AI_CUT_RUN_LIMIT = 3;

interface Project {
  id: string;
  fileName: string;
  fileSize: number | null;
  fileType: string | null;
  durationMs: number | null;
  transcript: Transcript | null;
  transcriptStatus: "idle" | "processing" | "ready" | "failed";
  edl: EDL | null;
  /** Whether AI polish was requested (and paid-consented) at upload (ADR 0003). */
  aiPolishRequested: boolean;
  activeAiCutRunId: string | null;
  aiCutRuns: AiCutRun[];
}

const AUTOSAVE_DELAY_MS = 800;
const MIN_TRANSCRIPT_W = 300;
const MAX_TRANSCRIPT_W = 640;

/**
 * Structural equality on an EDL's cut layout — same segment boundaries and
 * statuses. Used for divergence detection (ADR 0003 child 2): the user has
 * drifted from the AI's suggestions when re-applying the stored run would
 * change the current cut layout. Compares only start/end/status because those
 * are what a cut/restore changes; `reason` isn't load-bearing here.
 */
function edlSegmentsEqual(a: EDL, b: EDL): boolean {
  if (a === b) return true;
  if (a.segments.length !== b.segments.length) return false;
  for (let i = 0; i < a.segments.length; i++) {
    const x = a.segments[i];
    const y = b.segments[i];
    if (x.start !== y.start || x.end !== y.end || x.status !== y.status) {
      return false;
    }
  }
  return true;
}

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
const exportSupportSubscribe = () => () => { };

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [sourceFile, setSourceFile] = useState<File | null>(null);

  const [edl, setEdl] = useState<EDL | null>(null);
  // Auto-cut chain (ADR 0003 child 1): a fresh, ready project runs the
  // mechanical cut — and, if AI polish was requested at upload, the AI pass —
  // automatically on open, with no click. `autoCutBusy` spans the whole chain
  // (it drives the unified loader alongside `aiBusy`); `autoChainedRef` makes
  // the effect body run at most once per mounted studio; `freshOnLoadRef`
  // records whether the just-loaded project had no usable saved EDL.
  const [autoCutBusy, setAutoCutBusy] = useState(false);
  const autoChainedRef = useRef(false);
  const freshOnLoadRef = useRef(false);
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

        // A saved EDL that keeps nothing is unusable (you can't export an empty
        // cut) and is almost certainly a corrupted auto-build from before the
        // keep-all safety floor existed — rebuild it instead of loading it.
        const savedEdl =
          data.edl && keptDuration(data.edl) > 0 ? data.edl : null;

        // A reload can be triggered more than once while transcription is
        // still finishing (the "processing -> ready" poll below fires
        // checkStatus from a 4s interval AND from visibilitychange/focus, so a
        // user switching tabs while waiting can cause two overlapping polls to
        // both detect "ready" and both bump reloadNonce). Once this project's
        // EDL has been edited locally — including by the auto-cut chain, which
        // edits it the instant it fires — a later reload must not re-seed it
        // from the server: the debounced autosave (AUTOSAVE_DELAY_MS) may not
        // have persisted that edit yet, so the server's `data.edl` here can
        // still be stale/null and would silently wipe out the local cut.
        if (!hasEditedRef.current) {
          if (savedEdl?.sensitivity) setSensitivity(savedEdl.sensitivity);

          // A ready project with no usable saved EDL is "fresh" — the auto-cut
          // chain (below) will build the mechanical cut (and, if requested, the
          // AI pass) automatically. A saved EDL, a manually-edited project, or one
          // with an existing run is not fresh and never auto-fires (AC-4, AC-10).
          freshOnLoadRef.current =
            data.transcriptStatus === "ready" && !savedEdl;

          // The mechanical cut is no longer gated behind a click: a fresh ready
          // project starts with no EDL, and the auto-cut effect populates the cut
          // timeline the moment it runs. A saved EDL loads as-is.
          setEdl(savedEdl);
        }
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
    // The 4s interval and the visibilitychange/focus handlers below can both
    // call checkStatus around the same moment (e.g. the tab regains focus
    // right as the interval also ticks) — without this guard, two overlapping
    // calls can both observe the terminal status and each bump reloadNonce,
    // triggering a second, redundant reload of the project a moment after the
    // first. That second reload reads server state that may still predate
    // anything the client has since done locally (like the auto-cut chain's
    // mechanical cut, saved only after a debounced autosave), so a "ready"
    // detection must only ever act once per transition.
    let settled = false;

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
        if (
          !settled &&
          (updated.transcriptStatus === "ready" || updated.transcriptStatus === "failed")
        ) {
          settled = true;
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

  // `sourceEdl` lets a caller run the AI pass against a just-built EDL that
  // isn't yet in `edl` state (the auto-chain's mechanical result). Because
  // setEdl is async, reading `edl` from the render closure right after applying
  // the mechanical cut would see the stale, pre-cut EDL — so the auto-chain
  // passes the fresh EDL through explicitly (ADR 0003 child 1, stale-closure
  // invariant). Manual clicks omit it and use the current `edl`.
  const runAiCut = useCallback(async (sourceEdl?: EDL) => {
    const base = sourceEdl ?? edl;
    if (!base || aiBusy) return;
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
      if (!applyEdl(applyAiCuts(base, run, words))) {
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

  // The auto-cut chain (ADR 0003 child 1): build the mechanical rough cut, then
  // — if AI polish was requested at upload and no run exists yet — run the AI
  // pass, all behind one loader (`autoCutBusy` + `aiBusy`). Builds the mechanical
  // EDL from scratch (buildInitialEDL, pure, no network) at balanced sensitivity
  // and passes it straight into runAiCut so the AI phase never reads a stale EDL.
  const runAutoChain = useCallback(async () => {
    if (durationSeconds <= 0 || words.length === 0) return;
    setAutoCutBusy(true);
    try {
      const mechanical = buildInitialEDL(
        words,
        durationSeconds,
        SENSITIVITY_PRESETS.balanced,
        project?.transcript?.utteranceEnds
      );
      // Never claim the cut applied when it didn't (applyEdl refuses an edit
      // that would keep nothing) — matches every other applyEdl call site.
      if (!applyEdl(mechanical)) return;
      setCutEvent({ kind: "rough", at: Date.now() });
      // AC-3/AC-4: chain into the AI pass only when it was requested at upload
      // and no run has ever been stored. The server claim (which flips
      // ai_polish_requested false atomically) is the real exactly-once guard;
      // this client check just avoids a pointless request.
      if (project?.aiPolishRequested && project.aiCutRuns.length === 0) {
        await runAiCut(mechanical);
      }
    } finally {
      setAutoCutBusy(false);
    }
  }, [durationSeconds, words, project, applyEdl, runAiCut]);

  // Fire the auto-chain exactly once, when a fresh ready project has finished
  // loading (no usable saved EDL — freshOnLoadRef). autoChainedRef guards
  // re-entry within one mounted studio; the effect re-runs as edl/project
  // settle but only the first pass does the work. Legacy rows, saved-EDL
  // projects, and projects with an existing run set freshOnLoadRef false and
  // are provably inert here (AC-4, AC-10).
  useEffect(() => {
    if (autoChainedRef.current) return;
    if (!freshOnLoadRef.current) return;
    if (!project || project.transcriptStatus !== "ready") return;
    if (edl !== null) return;
    if (words.length === 0 || durationSeconds <= 0) return;
    autoChainedRef.current = true;
    // Deferred to a microtask so the chain's first setState (setAutoCutBusy)
    // isn't a synchronous call within the effect body itself
    // (react-hooks/set-state-in-effect). No cancellation on cleanup: the
    // autoChainedRef guard above already makes this fire at most once ever
    // for this mounted studio, so there's nothing to race — a stray fire
    // after unmount is a harmless no-op (React 18+ ignores a setState call
    // on an unmounted component).
    queueMicrotask(() => void runAutoChain());
  }, [project, edl, words, durationSeconds, runAutoChain]);

  // Divergence check (ADR 0003 child 2): true when the user has drifted from
  // the active AI run's suggestions, i.e. re-applying the run would change the
  // current cut layout. Both the "Restore AI suggestions" affordance and its
  // action derive from this same pure re-application.
  const hasDivergedFromAi = useMemo(() => {
    if (!edl || !activeAiCutRun) return false;
    return !edlSegmentsEqual(applyAiCuts(edl, activeAiCutRun, words), edl);
  }, [edl, activeAiCutRun, words]);

  // Free "Restore AI suggestions" (AC-7): re-apply the stored run's ranges
  // client-side — no Gemini call, no charge. Same pure applyAiCuts the paid run
  // was originally applied with.
  const restoreAiSuggestions = useCallback(() => {
    if (!edl || !activeAiCutRun) return;
    if (!applyEdl(applyAiCuts(edl, activeAiCutRun, words))) return;
    setCutEvent({ kind: "ai", at: Date.now() });
    toast.success("AI suggestions restored", {
      action: { label: "Undo", onClick: () => undo() },
    });
  }, [edl, activeAiCutRun, words, applyEdl, undo]);

  // Native browser leave-warning (ADR 0003 child 3): attached only while the AI
  // pass is actively running (aiBusy — set for both the automatic chain and a
  // manual "Polish with AI" click), the one moment leaving risks abandoning a
  // paid, in-flight operation. Ordinary editing never triggers it.
  useEffect(() => {
    if (!aiBusy) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [aiBusy]);

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

  // Builds an FCPXML or CMX 3600 EDL file describing the current EDL's kept
  // segments and downloads it directly — no WebCodecs, no save picker, no
  // reselected source video required, since both formats only reference the
  // source by filename.
  const handleExportFcpxml = useCallback(() => {
    if (!edl || !project || keptDuration(edl) <= 0) {
      toast.error("Nothing to export", {
        description: "This project has no kept segments yet.",
      });
      return;
    }
    const xml = buildFcpxml(edl, project.fileName, project.fileName);
    downloadTextFile(xml, `${sanitizeFilename(project.fileName)}.fcpxml`, "application/xml");
    toast.success("FCPXML exported", {
      description: "Open it in DaVinci Resolve or Premiere Pro and relink your source file.",
    });
  }, [edl, project]);

  const handleExportCmx3600 = useCallback(() => {
    if (!edl || !project || keptDuration(edl) <= 0) {
      toast.error("Nothing to export", {
        description: "This project has no kept segments yet.",
      });
      return;
    }
    const doc = buildCmx3600Edl(edl, project.fileName, project.fileName);
    downloadTextFile(doc, `${sanitizeFilename(project.fileName)}.edl`, "text/plain");
    toast.success("CMX 3600 EDL exported", {
      description: "Open it in DaVinci Resolve or Premiere Pro and relink your source file.",
    });
  }, [edl, project]);

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
          <h1 className="text-2xl font-bold text-foreground"> STEP 2 reselect your video file: {project.fileName}</h1>
          <p className="mt-2 text-foreground/50">
            Your video isn&apos;t stored on our server. Re-select{" "}
            <span className="text-foreground/80">{project.fileName}</span> from your
            computer to continue editing.
          </p>
          <div className="mt-6">
            <FilePicker
              onFileSelected={(file) => setSourceFile(file)}
              expectedDurationMs={project.durationMs ?? undefined}
              expectedFileSize={project.fileSize ?? undefined}
              expectedFileName={project.fileName ?? undefined}
              expectedFileType={project.fileType ?? undefined}
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
  // No successful AI run has ever been stored — the manual "Polish with AI"
  // button shows only in this state (ADR 0003 child 2, AC-6); a run that found
  // nothing to cut still counts, so this keys off run count, not ranges.
  const noAiRunYet = (project?.aiCutRuns.length ?? 0) === 0;
  const railTools: {
    Icon: LucideIcon;
    label: string;
    badge?: number;
    active?: boolean;
    title?: string;
    action: "filler" | "review";
  }[] = [
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
        onExportFcpxml={handleExportFcpxml}
        onExportCmx3600={handleExportCmx3600}
        exportFormatBlockedReason={
          !edl || keptDuration(edl) <= 0 ? "Nothing to export yet" : undefined
        }
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
                tool.action === "filler"
                  ? removeFillerWords
                  : () => setShowRetakeReview(true)
              }
              title={tool.title ?? tool.label}
              className={`relative flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-[10px] ${tool.active
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
              {!isPlaying && (
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
            {(aiBusy || autoCutBusy) && <AiCutOverlay wordCount={words.length} />}
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
            onPolishWithAi={() => runAiCut()}
            aiBusy={aiBusy}
            aiCostLabel={aiCostLabel}
            noAiRunYet={noAiRunYet}
            hasDiverged={hasDivergedFromAi}
            onRestoreAiSuggestions={restoreAiSuggestions}
            lastAiCutTime={activeAiCutRun?.createdAt}
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
                  className={`px-2 py-0.5 capitalize transition-colors ${sensitivity === level
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
 * Blocking "leave the editor?" exit link (ADR 0003 child 3). Replaces the old
 * fire-and-forget toast: clicking it opens a real confirm dialog instead of
 * navigating immediately, so the exit is an impossible-to-miss decision. Kept
 * as a self-contained component (own dialog state + router) so both the
 * StatusScreen and TopBar exit points get the same copy and behavior even
 * though StatusScreen renders as an early return, before the editor body.
 */
function ExitToDashboardLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Leave the editor?"
        description="Your edits are saved automatically. To reopen this project, reselect the same source video from your computer."
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        onConfirm={() => router.push("/dashboard")}
      />
    </>
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
        className={`flex h-14 w-14 items-center justify-center rounded-2xl ${tone === "error" ? "bg-red-500/10 text-red-400" : "bg-blue-500/15 text-blue-300"
          }`}
      >
        {icon}
      </div>
      <div className="space-y-1.5">
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <p className="max-w-md text-sm text-foreground/50">{message}</p>
      </div>
      <ExitToDashboardLink className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-sm text-foreground/70 hover:bg-foreground/10">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </ExitToDashboardLink>
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

/** Shared styling for the two select-style controls in the export cluster (AC-8). */
const dropdownTriggerClass =
  "flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-transparent px-2 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-50";
const dropdownOptionClass =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-foreground/10";

/**
 * A hand-rolled, design-token-styled listbox replacing the browser's native
 * `<select>` chrome (AC-8) — a plain button that toggles an absolutely
 * positioned option list, closed on outside click or Escape.
 */
function StyledSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  title,
}: {
  id: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div ref={rootRef} className="relative">
      <span id={`${id}-label`} className="sr-only">
        {label}
      </span>
      <button
        type="button"
        id={id}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}`}
        onClick={() => setOpen((o) => !o)}
        className={dropdownTriggerClass}
      >
        {current?.label}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-labelledby={`${id}-label`}
          className="absolute right-0 top-full z-20 mt-1 min-w-full overflow-hidden rounded-lg border border-foreground/10 bg-background py-1 shadow-lg"
        >
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                role="option"
                aria-selected={opt.value === value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`${dropdownOptionClass} ${opt.value === value ? "text-blue-300" : "text-foreground/70"
                  }`}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The export cluster's format menu (AC-16): one styled trigger, matching the
 * resolution dropdown, opening two action entries (FCPXML, CMX 3600 EDL).
 * Each entry immediately generates and downloads its format, then closes —
 * there's no persisted selection, just two actions behind one control.
 */
function ExportFormatMenu({
  onExportFcpxml,
  onExportCmx3600,
  disabled,
  title,
}: {
  onExportFcpxml?: () => void;
  onExportCmx3600?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        title={title ?? "Export cut list for DaVinci Resolve or Premiere Pro"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={dropdownTriggerClass}
      >
        <Film className="h-4 w-4" />
        For DaVinci / Premiere
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <ul
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-full overflow-hidden rounded-lg border border-foreground/10 bg-background py-1 shadow-lg"
        >
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onExportFcpxml?.();
                setOpen(false);
              }}
              className={dropdownOptionClass}
            >
              FCPXML (.fcpxml)
            </button>
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onExportCmx3600?.();
                setOpen(false);
              }}
              className={dropdownOptionClass}
            >
              CMX 3600 EDL (.edl)
            </button>
          </li>
        </ul>
      )}
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
  onExportFcpxml,
  onExportCmx3600,
  exportFormatBlockedReason,
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
  // Exports the current EDL as an FCPXML file for DaVinci Resolve / Premiere Pro.
  onExportFcpxml?: () => void;
  // Exports the current EDL as a CMX 3600 EDL file, the alternate interchange format.
  onExportCmx3600?: () => void;
  // Non-empty when both format export options should be disabled (no kept EDL yet); doubles as the tooltip.
  exportFormatBlockedReason?: string;
}) {
  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-md text-foreground/60 hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
  const busy = exportState !== "idle";
  const exportDisabled = busy || Boolean(exportBlockedReason);
  const exportFormatDisabled = Boolean(exportFormatBlockedReason);
  // Cancel is offered only once a cancellable handle exists — not during
  // "starting" (save dialog open, nothing to cancel yet).
  const showCancel = exportState === "exporting" || exportState === "cancelling";
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-3 py-2">
      <div className="flex items-center gap-3">
        <ExitToDashboardLink className="flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-sm text-foreground/70 hover:bg-foreground/10">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </ExitToDashboardLink>
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
                className={`h-1.5 w-1.5 rounded-full ${savedAt === "saving" ? "bg-amber-400" : "bg-emerald-400"
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
        <StyledSelect
          id="export-quality"
          label="Export resolution"
          value={exportMaxHeight === null ? "source" : String(exportMaxHeight)}
          onChange={(v) => onExportMaxHeightChange?.(v === "source" ? null : Number(v))}
          disabled={busy}
          title="Export resolution — downscales larger sources, never upscales"
          options={[
            { value: "source", label: "Source" },
            { value: "1080", label: "1080p" },
            { value: "720", label: "720p" },
          ]}
        />
        <ExportFormatMenu
          onExportFcpxml={onExportFcpxml}
          onExportCmx3600={onExportCmx3600}
          disabled={exportFormatDisabled}
          title={exportFormatBlockedReason}
        />
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
