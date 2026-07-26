"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Scissors,
  Trash2,
  Magnet,
  Minus,
  Plus,
  ArrowLeftToLine,
  ArrowRightToLine,
  RotateCcw,
  Hand,
  MousePointer2,
} from "lucide-react";
import { Tooltip, TooltipProvider } from "@repo/ui";
import {
  totalDuration,
  roundMs,
  MIN_SEGMENT_SECONDS,
  type EDL,
  type EDLSegment,
  type TimeRange,
} from "@/lib/edl";
import { extractWaveform, type Waveform } from "@/lib/waveform";
import { extractFilmstrip, type Filmstrip } from "@/lib/thumbnails";
import { formatDuration, nearestSorted } from "@/lib/utils";
import { frameDurationSeconds, type VideoFps } from "@/lib/frame-math";
import {
  SYNC_HOVER_LINE_CLASS,
  SYNC_PLAYHEAD_CLASS,
  SYNC_SELECTION_BG_CLASS,
  SYNC_SELECTION_RING_CLASS,
} from "@/lib/sync-colors";

export interface TimelineHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;
}

/** The two timeline tools, mutually exclusive: Select (A) or Hand/pan (H). */
export type TimelineTool = "select" | "hand";

interface TimelineBarProps {
  edl: EDL;
  currentTime: number;
  isPlaying: boolean;
  sourceFile: File | null;
  /** The reselected source's detected frame rate, or null until known. Used to
   *  size the one-frame tolerance when reconciling the filmstrip's/waveform's
   *  own decoded duration against the shared timeline duration (spec 0004). */
  sourceFps: VideoFps | null;
  fileName: string;
  /** Sorted word-edge times to snap trim drags to (hold Alt to drag freely). */
  snapTimes: number[];
  onSeek: (seconds: number) => void;
  onRestoreSegment: (segment: EDLSegment) => void;
  /** Called once when a boundary drag actually moves, before onTrimBoundary. */
  onTrimStart: () => void;
  onTrimBoundary: (leftIndex: number, newTime: number) => void;
  /** Called when a boundary drag ends (only if it moved) so the trim can be
   *  pinned — marked as manual intent that survives a rough-cut re-run.
   *  `originalBoundary` is where the boundary sat before the drag. */
  onTrimEnd: (leftIndex: number, originalBoundary: number) => void;
  /** Trim the clip under the playhead up to / from it (mirrors the Q / W keys). */
  onCutToPlayhead: (side: "left" | "right") => void;
  /** Razor the clip under the playhead into two clips (mirrors the S key). */
  onSplit: () => void;
  /** Start time of the currently selected clip, or null when none is selected. */
  selectedStart: number | null;
  /** Select a clip (or pass null to clear the selection). */
  onSelectSegment: (segment: EDLSegment | null) => void;
  /** Delete the selected clip (mirrors the Delete key). */
  onDeleteSelected: () => void;
  /** A time to show a lightweight preview marker at, published by the
   *  transcript's own word hover (AC-5). Null when nothing is hovered there. */
  hoveredTime?: number | null;
  /** Publish this timeline's own pointer hover (word-granularity, throttled) so
   *  the transcript can preview the matching word (AC-6). */
  onHoverTimeChange?: (seconds: number | null) => void;
  /** The shared cross-panel selection (AC-3/AC-4), rendered as a highlight band
   *  regardless of which panel it originated in. */
  selectedRange?: TimeRange | null;
  /** Publish this timeline's own clip selection / trim drag as a time range
   *  (AC-4) so the transcript can highlight the matching words. */
  onRangeSelect?: (range: TimeRange | null) => void;
}

const MIN_PX_PER_SEC = 5;
const MAX_PX_PER_SEC = 400;
const DEFAULT_PX_PER_SEC = 40;
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
const HANDLE_HIT_WIDTH = 12;
const SNAP_PX = 8;

const RULER_H = 24;
const VIDEO_H = 72;
const AUDIO_H = 104;
const TOTAL_H = RULER_H + VIDEO_H + AUDIO_H;
const HEADER_W = 88;
// Hardcoded wave color matches the new brand identity
const WAVE_COLOR = "rgba(255, 252, 0, 0.6)"; // Accent yellow
// Amplitude boost so quieter passages still read clearly; clamped to the track.
const WAVE_GAIN = 2.2;

function niceRulerStep(targetSeconds: number): number {
  return RULER_STEPS.find((step) => step >= targetSeconds) ?? RULER_STEPS[RULER_STEPS.length - 1];
}

/**
 * The media duration to position a decoded filmstrip or waveform against (spec
 * 0004). Both are sampled uniformly across their own decoded duration, but the
 * clips and the playhead are positioned by the shared timeline duration
 * (`totalDuration(edl)`). To make peaks and thumbs line up with the clips and
 * the playhead, a timeline time is mapped into the decode's buckets using the
 * shared duration, not the decode's own length — which can differ slightly (an
 * audio track a hair longer than the video, a container header duration that is
 * a touch off). Within one frame the two are interchangeable; beyond that the
 * shared duration still wins here, so a decode-length disagreement can never
 * reintroduce drift (AC-9). Falls back to the decode's own length only when the
 * timeline duration isn't known yet.
 */
function positioningDuration(sharedDuration: number, decodedDuration: number): number {
  return sharedDuration > 0 ? sharedDuration : decodedDuration;
}

/**
 * Two-track NLE timeline (Video clips + Audio waveform): tick ruler, scrubbable
 * playhead, draggable clip boundaries (snap to word edges), click a cut to
 * restore. Creating new cuts is the transcript panel's job.
 */
const TimelineBar = forwardRef<TimelineHandle, TimelineBarProps>(function TimelineBar(
  {
    edl,
    currentTime,
    isPlaying,
    sourceFile,
    sourceFps,
    fileName,
    snapTimes,
    onSeek,
    onRestoreSegment,
    onTrimStart,
    onTrimBoundary,
    onTrimEnd,
    onCutToPlayhead,
    onSplit,
    selectedStart,
    onSelectSegment,
    onDeleteSelected,
    hoveredTime,
    onHoverTimeChange,
    selectedRange,
    onRangeSelect,
  },
  ref
) {
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);
  const [waveform, setWaveform] = useState<Waveform | null>(null);
  const [isDecodingWaveform, setIsDecodingWaveform] = useState(false);
  const [filmstrip, setFilmstrip] = useState<Filmstrip | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [view, setView] = useState({ scrollLeft: 0, width: 0 });
  // Which tool the timeline is in (Descript's model): Select scrubs, selects and
  // trims; Hand drags the timeline horizontally instead. A tool stays on until
  // the other is chosen — by its button, or by pressing A / H. Mirrored into a
  // ref so the pointer handlers (registered once) always read the latest value.
  const [tool, setTool] = useState<TimelineTool>("select");
  const [isPanning, setIsPanning] = useState(false);
  const toolRef = useRef<TimelineTool>("select");
  toolRef.current = tool;
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ clientX: 0, scrollLeft: 0 });
  // Drives both the pointer-handler guard and the grab cursor.
  const panArmed = tool === "hand";
  // A cut clip the user has selected but not yet confirmed restoring — a click
  // no longer restores instantly, it surfaces a Restore button first.
  const [selectedCutStart, setSelectedCutStart] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const filmstripCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragLeftIndexRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  // Boundary position at drag start, so the pinned trim knows how far it moved.
  const dragOrigBoundaryRef = useRef(0);
  const scrubbingRef = useRef(false);
  // Latest zoom level for the (stable) native wheel listener to read.
  const pxPerSecRef = useRef(pxPerSec);
  pxPerSecRef.current = pxPerSec;
  // After a wheel-zoom, restore the time that was under the cursor (applied in
  // a layout effect once the content has re-sized to the new zoom).
  const pendingZoomRef = useRef<{ time: number; offsetX: number } | null>(null);

  const total = totalDuration(edl);
  const widthPx = Math.max(1, total * pxPerSec);

  // Zoom level at which the whole timeline exactly fills the viewport. Also
  // the effective zoom-out floor — long videos need to go well below the
  // static MIN_PX_PER_SEC to be seen whole. Kept in a ref for the stable
  // wheel listener and the zoom callbacks.
  const fitPxPerSec =
    total > 0 && view.width > 0
      ? Math.min(MAX_PX_PER_SEC, view.width / total)
      : DEFAULT_PX_PER_SEC;
  const minPxPerSec = Math.min(MIN_PX_PER_SEC, fitPxPerSec);
  const fitPxPerSecRef = useRef(fitPxPerSec);
  fitPxPerSecRef.current = fitPxPerSec;
  const minPxPerSecRef = useRef(minPxPerSec);
  minPxPerSecRef.current = minPxPerSec;

  const zoomIn = useCallback(
    () => setPxPerSec((px) => Math.min(MAX_PX_PER_SEC, px * 1.5)),
    []
  );
  const zoomOut = useCallback(
    () => setPxPerSec((px) => Math.max(minPxPerSecRef.current, px / 1.5)),
    []
  );
  const zoomFit = useCallback(() => setPxPerSec(fitPxPerSecRef.current), []);

  useImperativeHandle(ref, () => ({ zoomIn, zoomOut, zoomFit }), [
    zoomIn,
    zoomOut,
    zoomFit,
  ]);

  // Decode the waveform once per source file.
  useEffect(() => {
    let cancelled = false;
    async function decode() {
      setIsDecodingWaveform(true);
      const result = sourceFile ? await extractWaveform(sourceFile) : null;
      if (!cancelled) {
        setWaveform(result);
        setIsDecodingWaveform(false);
      }
    }
    decode();
    return () => {
      cancelled = true;
    };
  }, [sourceFile]);

  // Extract the filmstrip once per source file (independent of the waveform —
  // whichever finishes first shows first).
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function decode() {
      const result = sourceFile
        ? await extractFilmstrip(sourceFile, { signal: controller.signal })
        : null;
      if (!cancelled) setFilmstrip(result);
    }
    setFilmstrip(null);
    decode();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sourceFile]);

  // Track the visible scroll window (scrollLeft + viewport width).
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setView({ scrollLeft: scroller.scrollLeft, width: scroller.clientWidth });
      });
    };
    sync();
    scroller.addEventListener("scroll", sync, { passive: true });
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", sync);
      resizeObserver.disconnect();
    };
  }, []);

  // Mouse-wheel zoom toward the cursor; shift / horizontal wheel pans instead.
  // Attached natively (not via React's passive onWheel) so we can preventDefault.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    function onWheel(e: WheelEvent) {
      // Normalize wheel deltas to pixels — mice report line/page units
      // (deltaMode 1/2) with tiny deltaY, which otherwise barely zooms.
      const unit =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller!.clientHeight : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      const horizontal = e.shiftKey || Math.abs(dx) > Math.abs(dy);
      if (horizontal) {
        if (e.shiftKey && dx === 0) {
          scroller!.scrollLeft += dy;
          e.preventDefault();
        }
        return; // let native horizontal trackpad scroll through
      }
      e.preventDefault();
      const rect = scroller!.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const px = pxPerSecRef.current;
      const time = (scroller!.scrollLeft + offsetX) / px;
      const next = Math.min(
        MAX_PX_PER_SEC,
        Math.max(minPxPerSecRef.current, px * Math.exp(-dy * 0.0015))
      );
      if (next === px) return;
      pendingZoomRef.current = { time, offsetX };
      setPxPerSec(next);
    }

    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);

  // Tool switching, Descript's rules: H picks the Hand (pan), A picks Select.
  // A tool is sticky — it stays until the other is chosen — so unlike the old
  // hold-Space-to-pan there's no hidden mode and no keyup to miss. Space is now
  // play/pause only, owned by the studio page's shortcut map.
  //
  // Ignored while typing in a form field, so "hand" still types those letters.
  // Escape dismisses the cut-restore confirmation. A window blur (alt-tab,
  // devtools focus, etc.) ends an in-flight drag, since a pointerup that lands
  // on another window never reaches us; the chosen tool deliberately survives.
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Escape") {
        setSelectedCutStart(null);
        return;
      }
      // Let OS/browser chords through untouched — Cmd/Ctrl+A is select-all.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.repeat || isTypingTarget(e.target)) return;
      if (e.code === "KeyH") setTool("hand");
      else if (e.code === "KeyA") setTool("select");
    }
    function endDrag() {
      isPanningRef.current = false;
      setIsPanning(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", endDrag);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", endDrag);
    };
  }, []);

  // Pan drag — attached with capture so it wins over scrub/click/trim handlers
  // further down the tree while the hand tool is armed.
  const handlePanPointerDown = useCallback((e: React.PointerEvent) => {
    if (toolRef.current !== "hand") return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    isPanningRef.current = true;
    setIsPanning(true);
    panStartRef.current = {
      clientX: e.clientX,
      scrollLeft: scrollRef.current?.scrollLeft ?? 0,
    };
  }, []);
  const handlePanPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    e.stopPropagation();
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollLeft = panStartRef.current.scrollLeft - (e.clientX - panStartRef.current.clientX);
  }, []);
  const handlePanPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    e.stopPropagation();
    isPanningRef.current = false;
    setIsPanning(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);
  // A cancelled pointer (e.g. a touch/pen interrupted mid-drag) never fires
  // pointerup — without this, isPanningRef stays stuck true.
  const handlePanPointerCancel = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    e.stopPropagation();
    isPanningRef.current = false;
    setIsPanning(false);
  }, []);

  // Keep the cursor's time anchored after a wheel-zoom resizes the content.
  useLayoutEffect(() => {
    const pending = pendingZoomRef.current;
    if (!pending) return;
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = pending.time * pxPerSec - pending.offsetX;
    pendingZoomRef.current = null;
  }, [pxPerSec]);

  // Draw only the visible slice of the waveform, mapped against the shared
  // timeline duration (not the audio's own decoded length) so peaks line up
  // with the clips and the playhead (spec 0004, AC-8).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!waveform || waveform.duration <= 0) return;

    const { peaksMin, peaksMax } = waveform;
    const duration = positioningDuration(total, waveform.duration);
    if (duration <= 0) return;
    const buckets = peaksMin.length;
    const mid = canvas.height / 2;
    ctx.fillStyle = WAVE_COLOR;

    for (let x = 0; x < canvas.width; x++) {
      const t = (view.scrollLeft + x) / pxPerSec;
      if (t > duration) break;
      const bucketIndex = Math.min(buckets - 1, Math.floor((t / duration) * buckets));
      const min = Math.max(-1, (peaksMin[bucketIndex] ?? 0) * WAVE_GAIN);
      const max = Math.min(1, (peaksMax[bucketIndex] ?? 0) * WAVE_GAIN);
      const yTop = mid - max * mid;
      const yBottom = mid - min * mid;
      ctx.fillRect(x, yTop, 1, Math.max(1, yBottom - yTop));
    }
  }, [waveform, pxPerSec, view, total]);

  // Tile the visible slice of the filmstrip across the video track. Tiles are
  // anchored to absolute timeline positions (not the viewport) so they don't
  // shimmer sideways while scrolling.
  useEffect(() => {
    const canvas = filmstripCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!filmstrip || filmstrip.duration <= 0) return;

    const { strip, count, thumbWidth, thumbHeight } = filmstrip;
    const duration = positioningDuration(total, filmstrip.duration);
    if (duration <= 0) return;
    const drawH = canvas.height;
    const drawW = Math.max(1, Math.round((thumbWidth / thumbHeight) * drawH));
    const firstTile = Math.floor(view.scrollLeft / drawW);

    for (let k = firstTile; k * drawW < view.scrollLeft + canvas.width; k++) {
      const globalX = k * drawW;
      const t = (globalX + drawW / 2) / pxPerSec;
      if (t > duration) break;
      const index = Math.min(count - 1, Math.floor((t / duration) * count));
      ctx.drawImage(
        strip,
        index * thumbWidth,
        0,
        thumbWidth,
        thumbHeight,
        globalX - view.scrollLeft,
        0,
        drawW,
        drawH
      );
    }
  }, [filmstrip, pxPerSec, view, total]);

  // Reconciliation check (spec 0004, AC-9): positioning above always uses the
  // shared timeline duration, so a decode whose own length drifts from the
  // timeline by more than one frame can never move the peaks or thumbs off the
  // clips. This surfaces such a mismatch in dev so it isn't silent; it changes
  // nothing that's drawn. The one-frame tolerance is sized at the detected fps.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !sourceFps || !(total > 0)) return;
    const oneFrame = frameDurationSeconds(sourceFps);
    const warnIfDrifted = (label: string, decoded: number | undefined) => {
      if (decoded && decoded > 0 && Math.abs(decoded - total) > oneFrame) {
        console.warn(
          `[timeline] ${label} decoded duration ${decoded.toFixed(3)}s disagrees with ` +
            `the timeline duration ${total.toFixed(3)}s by more than one frame; using the ` +
            `shared timeline duration for positioning (spec 0004).`
        );
      }
    };
    warnIfDrifted("waveform", waveform?.duration);
    warnIfDrifted("filmstrip", filmstrip?.duration);
  }, [waveform, filmstrip, total, sourceFps]);

  // Keep the playhead in view during playback. The Hand tool suspends
  // auto-follow so the user's manual pan isn't fought by the recenter.
  useEffect(() => {
    if (!isPlaying || panArmed) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const x = currentTime * pxPerSec;
    const left = scroller.scrollLeft;
    const right = left + scroller.clientWidth;
    if (x < left + 40 || x > right - 40) {
      scroller.scrollLeft = x - scroller.clientWidth / 2;
    }
  }, [currentTime, isPlaying, pxPerSec, panArmed]);

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const content = contentRef.current;
      if (!content) return 0;
      const rect = content.getBoundingClientRect();
      return Math.max(0, Math.min(total, (clientX - rect.left) / pxPerSec));
    },
    [pxPerSec, total]
  );

  // --- Hover scrub preview (ghost playhead + timestamp) ---
  // Updated imperatively on the DOM node: a state update per mousemove would
  // re-render every clip block just to move a 1px line.
  const hoverRef = useRef<HTMLDivElement>(null);
  const hoverTimeRef = useRef<HTMLSpanElement>(null);
  // Throttles the outward hover publish to word-ish granularity (50ms
  // buckets) — the ghost playhead above stays imperative/per-pixel for smooth
  // visuals, but re-rendering the transcript panel on every pixel of mouse
  // movement would reintroduce the perf problem WordSpan's memoization exists
  // to avoid, for a preview that only ever needs to resolve to a word anyway.
  const lastHoverBucketRef = useRef<number | null>(null);
  // Whether the pointer is currently over this timeline's own hover surface.
  // While true, the local ghost line above already shows the hover — the
  // cross-panel `hoveredTime` prop must not also render its own marker, or a
  // self-published hover echoes back down as a second, redundant line at the
  // same position. Only flips on a genuine true/false change, so it doesn't
  // re-render on every pixel of mouse movement.
  const [isSelfHovering, setIsSelfHovering] = useState(false);
  const handleHoverMove = useCallback(
    (e: React.PointerEvent) => {
      const ghost = hoverRef.current;
      if (!ghost || e.pointerType !== "mouse") return;
      const t = timeFromClientX(e.clientX);
      ghost.style.transform = `translateX(${t * pxPerSec}px)`;
      ghost.style.opacity = "1";
      if (hoverTimeRef.current) {
        hoverTimeRef.current.textContent = formatDuration(t * 1000);
      }
      setIsSelfHovering((prev) => (prev ? prev : true));
      if (onHoverTimeChange) {
        const bucket = Math.round(t * 20);
        if (bucket !== lastHoverBucketRef.current) {
          lastHoverBucketRef.current = bucket;
          onHoverTimeChange(t);
        }
      }
    },
    [timeFromClientX, pxPerSec, onHoverTimeChange]
  );
  const handleHoverLeave = useCallback(() => {
    if (hoverRef.current) hoverRef.current.style.opacity = "0";
    setIsSelfHovering(false);
    lastHoverBucketRef.current = null;
    onHoverTimeChange?.(null);
  }, [onHoverTimeChange]);
  // A zoom under a resting cursor would leave the ghost at a stale time —
  // hide it until the next mouse move recomputes the position.
  useEffect(() => {
    if (hoverRef.current) hoverRef.current.style.opacity = "0";
  }, [pxPerSec]);

  // --- Scrubbing ---
  const handleScrubPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      scrubbingRef.current = true;
      // Scrubbing empty timeline / ruler clears any clip selection.
      onSelectSegment(null);
      setSelectedCutStart(null);
      onRangeSelect?.(null);
      onSeek(timeFromClientX(e.clientX));
    },
    [onSelectSegment, onSeek, timeFromClientX, onRangeSelect]
  );
  const handleScrubPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!scrubbingRef.current) return;
      onSeek(timeFromClientX(e.clientX));
    },
    [onSeek, timeFromClientX]
  );
  const handleScrubPointerUp = useCallback((e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    scrubbingRef.current = false;
  }, []);

  // --- Clip click (select + seek keep / select cut for confirm-restore) ---
  const handleSegmentClick = useCallback(
    (e: React.MouseEvent, segment: EDLSegment) => {
      e.stopPropagation();
      if (segment.status === "cut") {
        // Selecting a cut only surfaces the Restore button — it doesn't
        // restore it, so a stray click can't undo a cut by accident.
        onSelectSegment(null);
        setSelectedCutStart(segment.start);
      } else {
        setSelectedCutStart(null);
        onSelectSegment(segment);
        onSeek(timeFromClientX(e.clientX));
      }
      onRangeSelect?.({ start: segment.start, end: segment.end });
    },
    [onSelectSegment, onSeek, timeFromClientX, onRangeSelect]
  );

  const handleConfirmRestore = useCallback(
    (e: React.MouseEvent, segment: EDLSegment) => {
      e.stopPropagation();
      onRestoreSegment(segment);
      setSelectedCutStart(null);
    },
    [onRestoreSegment]
  );

  // --- Boundary trim drag ---
  const handleBoundaryPointerDown = useCallback(
    (e: React.PointerEvent, leftIndex: number) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragLeftIndexRef.current = leftIndex;
      dragMovedRef.current = false;
      // Snapshot the boundary's starting position for pinning on drag end.
      dragOrigBoundaryRef.current = edl.segments[leftIndex]?.end ?? 0;
    },
    [edl]
  );
  const handleBoundaryPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragLeftIndexRef.current === null) return;
      if (!dragMovedRef.current) {
        dragMovedRef.current = true;
        onTrimStart();
      }
      let t = timeFromClientX(e.clientX);
      if (snapEnabled && !e.altKey) {
        const snapped = nearestSorted(snapTimes, t);
        if (snapped !== null && Math.abs(snapped - t) * pxPerSec <= SNAP_PX) t = snapped;
      }
      const leftIndex = dragLeftIndexRef.current;
      onTrimBoundary(leftIndex, t);
      // Live-preview the trim's effect on whichever adjacent segment is kept
      // (a cut segment has no words worth highlighting in the transcript).
      // Mirrors trimBoundary's own clamp (edl.ts) exactly: publishing the raw
      // drag position here let the preview claim a wider range than what
      // actually gets cut whenever a drag overshoots past the neighbouring
      // segment's edge, leaving a stale, too-wide highlight in the transcript
      // that made an uncut word look like it had been selected for deletion.
      const left = edl.segments[leftIndex];
      const right = edl.segments[leftIndex + 1];
      if (left && right) {
        const min = left.start + MIN_SEGMENT_SECONDS;
        const max = right.end - MIN_SEGMENT_SECONDS;
        const clampedBoundary = roundMs(Math.min(Math.max(t, min), max));
        if (left.status === "keep") {
          onRangeSelect?.({ start: left.start, end: clampedBoundary });
        } else if (right.status === "keep") {
          onRangeSelect?.({ start: clampedBoundary, end: right.end });
        }
      }
    },
    [onTrimBoundary, onTrimStart, timeFromClientX, snapEnabled, snapTimes, pxPerSec, edl, onRangeSelect]
  );
  const handleBoundaryPointerUp = useCallback((e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    // Pin the boundary only if the drag actually moved it (a bare click is not
    // a trim). Fires within the same undo unit opened by onTrimStart.
    if (dragMovedRef.current && dragLeftIndexRef.current !== null) {
      onTrimEnd(dragLeftIndexRef.current, dragOrigBoundaryRef.current);
    }
    dragLeftIndexRef.current = null;
    dragMovedRef.current = false;
  }, [onTrimEnd]);

  const rulerStep = niceRulerStep(80 / pxPerSec);
  const rulerMarks = useMemo(() => {
    const marks: number[] = [];
    for (let t = 0; t <= total; t += rulerStep) marks.push(t);
    return marks;
  }, [total, rulerStep]);

  const playheadLeft = currentTime * pxPerSec;
  const firstKeepIndex = edl.segments.findIndex((s) => s.status === "keep");
  // A live selection that still points at an existing kept clip — the toolbar
  // Delete button only enables when there's actually something to delete.
  const canDelete =
    selectedStart !== null &&
    edl.segments.some((s) => s.status === "keep" && s.start === selectedStart);

  const toolBtn =
    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground/40 cursor-not-allowed";
  const actionBtn =
    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground/90";
  const zoomBtn =
    "flex h-7 w-7 items-center justify-center rounded-md border border-foreground/10 text-foreground/60 hover:bg-foreground/10 hover:text-foreground/90";
  // Shared by every on/off control in the toolbar (Select, Hand, Snap).
  const toggleBtn = (active: boolean) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
      active
        ? "bg-accent/20 text-accent"
        : "text-foreground/50 hover:bg-foreground/10 hover:text-foreground/80"
    }`;

  return (
    <div className="flex flex-col border-t border-foreground/10 bg-background">
      {/* Toolbar */}
      <TooltipProvider>
        <div className="flex items-center justify-between border-b border-foreground/5 px-4 py-2">
          <div className="flex items-center gap-1">
            {/* Tool group: exactly one of Select / Hand is active at a time. */}
            <Tooltip label="Select" keys="A">
              <button
                type="button"
                onClick={() => setTool("select")}
                aria-pressed={tool === "select"}
                className={toggleBtn(tool === "select")}
              >
                <MousePointer2 className="h-3.5 w-3.5" /> Select
              </button>
            </Tooltip>
            <Tooltip label="Pan" keys="H">
              <button
                type="button"
                onClick={() => setTool("hand")}
                aria-pressed={tool === "hand"}
                className={toggleBtn(tool === "hand")}
              >
                <Hand className="h-3.5 w-3.5" /> Hand
              </button>
            </Tooltip>

            <span className="mx-1 h-5 w-px bg-foreground/10" />

            <Tooltip label="Cut left of playhead" keys="Q">
              <button
                type="button"
                onClick={() => onCutToPlayhead("left")}
                className={actionBtn}
              >
                <ArrowLeftToLine className="h-3.5 w-3.5" /> Cut left
              </button>
            </Tooltip>
            <Tooltip label="Cut right of playhead" keys="W">
              <button
                type="button"
                onClick={() => onCutToPlayhead("right")}
                className={actionBtn}
              >
                <ArrowRightToLine className="h-3.5 w-3.5" /> Cut right
              </button>
            </Tooltip>
            <Tooltip label="Split clip at playhead" keys="S">
              <button type="button" onClick={onSplit} className={actionBtn}>
                <Scissors className="h-3.5 w-3.5" /> Split
              </button>
            </Tooltip>
            <Tooltip
              label={canDelete ? "Delete selected clip" : "Select a clip to delete"}
              keys={canDelete ? "Del" : undefined}
            >
              {/* Wrapped: a disabled button swallows pointer events, so Radix
                  would never see the hover that explains why it's disabled. */}
              <span className="inline-flex">
                <button
                  type="button"
                  onClick={onDeleteSelected}
                  disabled={!canDelete}
                  className={canDelete ? actionBtn : toolBtn}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </span>
            </Tooltip>
            <Tooltip label="Toggle snapping to word edges">
              <button
                type="button"
                onClick={() => setSnapEnabled((s) => !s)}
                aria-pressed={snapEnabled}
                className={toggleBtn(snapEnabled)}
              >
                <Magnet className="h-3.5 w-3.5" /> Snap
              </button>
            </Tooltip>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-foreground/40">
              {isDecodingWaveform ? (
                "Decoding audio…"
              ) : waveform ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Audio decoded
                </>
              ) : sourceFile ? (
                "Waveform unavailable"
              ) : null}
            </span>
            <div className="flex items-center gap-1.5">
              <Tooltip label="Zoom out" keys="−">
                <button type="button" aria-label="Zoom out" onClick={zoomOut} className={zoomBtn}>
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip label="Fit timeline to view" keys="0">
                <button
                  type="button"
                  onClick={zoomFit}
                  className="rounded-md border border-foreground/10 px-2 py-1 text-xs text-foreground/60 hover:bg-foreground/10 hover:text-foreground/90"
                >
                  Fit
                </button>
              </Tooltip>
              <Tooltip label="Zoom in" keys="=">
                <button type="button" aria-label="Zoom in" onClick={zoomIn} className={zoomBtn}>
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </TooltipProvider>

      {/* Tracks */}
      <div className="flex">
        {/* Row headers */}
        <div className="shrink-0 border-r border-foreground/5" style={{ width: HEADER_W }}>
          <div style={{ height: RULER_H }} />
          <div
            style={{ height: VIDEO_H }}
            className="flex flex-col justify-center gap-1 border-b border-foreground/5 px-3"
          >
            <span className="text-xs font-semibold text-foreground/70">Video</span>
          </div>
          <div
            style={{ height: AUDIO_H }}
            className="flex flex-col justify-center gap-1 px-3"
          >
            <span className="text-xs font-semibold text-foreground/70">Audio</span>
          </div>
        </div>

        {/* Scrollable tracks */}
        <div
          ref={scrollRef}
          onPointerDownCapture={handlePanPointerDown}
          onPointerMoveCapture={handlePanPointerMove}
          onPointerUpCapture={handlePanPointerUp}
          onPointerCancelCapture={handlePanPointerCancel}
          className={`timeline-scroll flex-1 overflow-x-auto overflow-y-hidden ${
            isPanning ? "cursor-grabbing" : panArmed ? "cursor-grab" : ""
          }`}
        >
          <div
            ref={contentRef}
            onPointerMove={handleHoverMove}
            onPointerLeave={handleHoverLeave}
            style={{ width: widthPx, height: TOTAL_H }}
            className={`relative select-none ${
              isPanning ? "[&_*]:cursor-grabbing!" : panArmed ? "[&_*]:cursor-grab!" : ""
            }`}
          >
            {/* Ruler (scrub strip) */}
            <div
              onPointerDown={handleScrubPointerDown}
              onPointerMove={handleScrubPointerMove}
              onPointerUp={handleScrubPointerUp}
              style={{ height: RULER_H }}
              className="relative cursor-text border-b border-foreground/5 bg-foreground/[0.02]"
            >
              {rulerMarks.map((t) => (
                <div key={t} style={{ left: t * pxPerSec }} className="absolute top-0 h-full">
                  <span className="absolute top-1 left-1 font-mono text-[10px] text-foreground/35">
                    {formatDuration(t * 1000)}
                  </span>
                  <div className="absolute bottom-0 h-1.5 w-px bg-foreground/15" />
                </div>
              ))}
            </div>

            {/* Video track — clip blocks */}
            <div
              onPointerDown={handleScrubPointerDown}
              onPointerMove={handleScrubPointerMove}
              onPointerUp={handleScrubPointerUp}
              style={{ height: VIDEO_H }}
              className="relative border-b border-foreground/5 bg-foreground/[0.02]"
            >
              {/* Filmstrip behind the clip blocks — aligned to the clips' inset. */}
              <canvas
                ref={filmstripCanvasRef}
                width={Math.max(1, view.width)}
                height={VIDEO_H - 16}
                style={{ left: view.scrollLeft, top: 8 }}
                className="pointer-events-none absolute rounded-md"
              />
              {edl.segments.map((segment, index) => {
                const isCut = segment.status === "cut";
                const isRetake = isCut && segment.reason === "retake";
                const isAi = isCut && segment.reason === "ai";
                const isRepetition = isCut && segment.reason === "repetition";
                const isSelected =
                  !isCut &&
                  selectedStart !== null &&
                  segment.start === selectedStart;
                const isSelectedCut = isCut && segment.start === selectedCutStart;
                const cutTooltip =
                  segment.reason === "retake"
                    ? "Retake — kept the later take. Click to select, then Restore."
                    : segment.reason === "ai"
                      ? "AI cut — speech mistake removed. Click to select, then Restore."
                      : segment.reason === "repetition"
                        ? "Repeated words — kept the last delivery. Click to select, then Restore."
                        : segment.reason === "silence"
                          ? "Silence — auto-trimmed. Click to select, then Restore."
                          : "Cut — click to select, then Restore.";
                return (
                  <div
                    key={index}
                    onClick={(e) => handleSegmentClick(e, segment)}
                    onPointerDown={(e) => e.stopPropagation()}
                    // Cut clips are keyboard-selectable so the Restore button
                    // can be reached without a mouse. Enter/Space activate the
                    // same selection path as a click.
                    {...(isCut
                      ? {
                          tabIndex: 0,
                          role: "button",
                          "aria-label": cutTooltip,
                          onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              onSelectSegment(null);
                              setSelectedCutStart(segment.start);
                            }
                          },
                        }
                      : {})}
                    title={isCut ? cutTooltip : "Keep — click to select, Delete to remove"}
                    style={{
                      left: segment.start * pxPerSec,
                      width: Math.max(1, (segment.end - segment.start) * pxPerSec),
                      backgroundImage: isCut
                        ? "repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 6px, transparent 6px 12px)"
                        : undefined,
                    }}
                    className={`absolute top-2 bottom-2 flex items-center overflow-hidden rounded-md border ${
                      isRetake
                        ? filmstrip
                          ? "border-amber-400/40 bg-amber-950/70"
                          : "border-amber-400/30 bg-amber-950/40"
                        : isAi
                          ? filmstrip
                            ? "border-sky-400/40 bg-sky-950/70"
                            : "border-sky-400/30 bg-sky-950/40"
                          : isRepetition
                            ? filmstrip
                              ? "border-teal-400/40 bg-teal-950/70"
                              : "border-teal-400/30 bg-teal-950/40"
                            : isCut
                              ? filmstrip
                                ? "border-foreground/10 bg-black/70"
                                : "border-foreground/10 bg-black/40"
                              : filmstrip
                            ? // Frames show through kept clips; the yellow wash keeps
                              // them visible while marking the region active.
                              "border-accent/50 bg-accent/15 hover:bg-accent/20"
                            : "border-accent/40 bg-accent/85 hover:bg-accent/95"
                    } ${isSelected || isSelectedCut ? SYNC_SELECTION_RING_CLASS : ""}`}
                  >
                    {!isCut && index === firstKeepIndex && (
                      <span
                        className={`truncate text-[11px] font-medium text-white/90 ${
                          filmstrip ? "mx-1 rounded bg-black/50 px-1.5 py-px" : "px-2"
                        }`}
                      >
                        {fileName}
                      </span>
                    )}
                    {isSelected && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSelected();
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        title="Delete clip (Delete)"
                        aria-label="Delete clip"
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-black/50 text-white/90 hover:bg-red-600"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                    {isSelectedCut && (
                      <button
                        type="button"
                        onClick={(e) => handleConfirmRestore(e, segment)}
                        onPointerDown={(e) => e.stopPropagation()}
                        title="Restore this cut"
                        aria-label="Restore cut"
                        className="absolute right-1 top-1 flex h-5 items-center gap-1 rounded bg-emerald-600/90 px-1.5 text-[10px] font-medium text-white/95 hover:bg-emerald-500"
                      >
                        <RotateCcw className="h-3 w-3" /> Restore
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Boundary trim handles — a razor split boundary reads brighter
                  (accent) so the user can see where they cut the clip. */}
              {edl.segments.slice(0, -1).map((segment, index) => {
                const isSplit = edl.segments[index + 1]?.split;
                return (
                  <div
                    key={`handle-${index}`}
                    onPointerDown={(e) => handleBoundaryPointerDown(e, index)}
                    onPointerMove={handleBoundaryPointerMove}
                    onPointerUp={handleBoundaryPointerUp}
                    style={{
                      left: segment.end * pxPerSec - HANDLE_HIT_WIDTH / 2,
                      width: HANDLE_HIT_WIDTH,
                    }}
                    className="group absolute top-0 z-10 flex h-full cursor-col-resize items-center justify-center"
                  >
                    <div
                      className={`h-8 w-0.5 rounded-full group-hover:bg-accent ${
                        isSplit ? "bg-accent/80" : "bg-foreground/25"
                      }`}
                    />
                  </div>
                );
              })}
            </div>

            {/* Audio track — waveform */}
            <div style={{ height: AUDIO_H }} className="relative bg-foreground/[0.01]">
              <canvas
                ref={canvasRef}
                width={Math.max(1, view.width)}
                height={AUDIO_H}
                style={{ left: view.scrollLeft, height: AUDIO_H }}
                className="absolute top-0"
              />
            </div>

            {/* Hover ghost playhead — position driven imperatively in
                handleHoverMove; opacity 0 until the mouse enters. */}
            <div
              ref={hoverRef}
              style={{ height: TOTAL_H, opacity: 0 }}
              className="pointer-events-none absolute left-0 top-0 z-10 motion-safe:transition-opacity motion-safe:duration-100"
            >
              <div className={`w-px ${SYNC_HOVER_LINE_CLASS}`} style={{ height: TOTAL_H }} />
              <span
                ref={hoverTimeRef}
                className="absolute left-1.5 top-0.5 whitespace-nowrap rounded bg-background/95 px-1 py-px font-mono text-[10px] text-foreground/70 shadow-sm"
              />
            </div>

            {/* Cross-panel hover preview (AC-5) — published by the transcript's
                own word hover; a lightweight marker, never touches playback.
                Suppressed while this timeline is itself being hovered — the
                ghost line above already shows it, and hoveredTime would
                otherwise be this same hover echoed back down as a prop. */}
            {hoveredTime != null && !isSelfHovering && (
              <div
                style={{ left: hoveredTime * pxPerSec, height: TOTAL_H }}
                className={`pointer-events-none absolute top-0 z-10 w-px ${SYNC_HOVER_LINE_CLASS}`}
              />
            )}

            {/* Cross-panel selection highlight (AC-3/AC-4) — a shared time
                range from either panel's own selection gesture. */}
            {selectedRange && (
              <div
                style={{
                  left: selectedRange.start * pxPerSec,
                  width: Math.max(1, (selectedRange.end - selectedRange.start) * pxPerSec),
                  height: TOTAL_H,
                }}
                className={`pointer-events-none absolute top-0 z-[5] ${SYNC_SELECTION_BG_CLASS}`}
              />
            )}

            {/* Playhead */}
            <div
              onPointerDown={handleScrubPointerDown}
              onPointerMove={handleScrubPointerMove}
              onPointerUp={handleScrubPointerUp}
              style={{ left: playheadLeft }}
              className="absolute top-0 z-20 -ml-1.5 w-3 cursor-ew-resize"
            >
              <div className={`mx-auto w-px ${SYNC_PLAYHEAD_CLASS}`} style={{ height: TOTAL_H }} />
              <div className={`absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px] ${SYNC_PLAYHEAD_CLASS}`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default TimelineBar;
