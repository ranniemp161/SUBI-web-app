"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  totalDuration,
  type EDL,
  type EDLSegment,
} from "@/lib/edl";
import { extractWaveform, type Waveform } from "@/lib/waveform";
import { formatDuration } from "@/lib/utils";

export interface TimelineHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;
}

interface TimelineBarProps {
  edl: EDL;
  currentTime: number;
  isPlaying: boolean;
  sourceFile: File | null;
  fileName: string;
  /** Sorted word-edge times to snap trim drags to (hold Alt to drag freely). */
  snapTimes: number[];
  onSeek: (seconds: number) => void;
  onRestoreSegment: (segment: EDLSegment) => void;
  /** Called once when a boundary drag actually moves, before onTrimBoundary. */
  onTrimStart: () => void;
  onTrimBoundary: (leftIndex: number, newTime: number) => void;
}

const MIN_PX_PER_SEC = 5;
const MAX_PX_PER_SEC = 400;
const DEFAULT_PX_PER_SEC = 40;
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
const HANDLE_HIT_WIDTH = 12;
const SNAP_PX = 8;

const RULER_H = 24;
const VIDEO_H = 72;
const AUDIO_H = 64;
const TOTAL_H = RULER_H + VIDEO_H + AUDIO_H;
const HEADER_W = 88;
const WAVE_COLOR = "rgba(167, 139, 250, 0.55)";

function niceRulerStep(targetSeconds: number): number {
  return RULER_STEPS.find((step) => step >= targetSeconds) ?? RULER_STEPS[RULER_STEPS.length - 1];
}

/** Nearest value in a sorted array to `target` (binary search). */
function nearestSorted(sorted: number[], target: number): number | null {
  if (sorted.length === 0) return null;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const candidate = sorted[lo];
  const prev = lo > 0 ? sorted[lo - 1] : candidate;
  return Math.abs(prev - target) <= Math.abs(candidate - target) ? prev : candidate;
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
    fileName,
    snapTimes,
    onSeek,
    onRestoreSegment,
    onTrimStart,
    onTrimBoundary,
  },
  ref
) {
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);
  const [waveform, setWaveform] = useState<Waveform | null>(null);
  const [isDecodingWaveform, setIsDecodingWaveform] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [view, setView] = useState({ scrollLeft: 0, width: 0 });

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragLeftIndexRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const scrubbingRef = useRef(false);

  const total = totalDuration(edl);
  const widthPx = Math.max(1, total * pxPerSec);

  const zoomIn = useCallback(
    () => setPxPerSec((px) => Math.min(MAX_PX_PER_SEC, px * 1.5)),
    []
  );
  const zoomOut = useCallback(
    () => setPxPerSec((px) => Math.max(MIN_PX_PER_SEC, px / 1.5)),
    []
  );
  const zoomFit = useCallback(() => setPxPerSec(DEFAULT_PX_PER_SEC), []);

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

  // Draw only the visible slice of the waveform, mapped against the audio's own
  // decoded duration so peaks line up with the clips.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!waveform || waveform.duration <= 0) return;

    const { peaksMin, peaksMax, duration } = waveform;
    const buckets = peaksMin.length;
    const mid = canvas.height / 2;
    ctx.fillStyle = WAVE_COLOR;

    for (let x = 0; x < canvas.width; x++) {
      const t = (view.scrollLeft + x) / pxPerSec;
      if (t > duration) break;
      const bucketIndex = Math.min(buckets - 1, Math.floor((t / duration) * buckets));
      const min = peaksMin[bucketIndex] ?? 0;
      const max = peaksMax[bucketIndex] ?? 0;
      const yTop = mid - max * mid;
      const yBottom = mid - min * mid;
      ctx.fillRect(x, yTop, 1, Math.max(1, yBottom - yTop));
    }
  }, [waveform, pxPerSec, view]);

  // Keep the playhead in view during playback.
  useEffect(() => {
    if (!isPlaying) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const x = currentTime * pxPerSec;
    const left = scroller.scrollLeft;
    const right = left + scroller.clientWidth;
    if (x < left + 40 || x > right - 40) {
      scroller.scrollLeft = x - scroller.clientWidth / 2;
    }
  }, [currentTime, isPlaying, pxPerSec]);

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const content = contentRef.current;
      if (!content) return 0;
      const rect = content.getBoundingClientRect();
      return Math.max(0, Math.min(total, (clientX - rect.left) / pxPerSec));
    },
    [pxPerSec, total]
  );

  // --- Scrubbing ---
  const handleScrubPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      scrubbingRef.current = true;
      onSeek(timeFromClientX(e.clientX));
    },
    [onSeek, timeFromClientX]
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

  // --- Clip click (seek keep / restore cut) ---
  const handleSegmentClick = useCallback(
    (e: React.MouseEvent, segment: EDLSegment) => {
      e.stopPropagation();
      if (segment.status === "cut") onRestoreSegment(segment);
      else onSeek(timeFromClientX(e.clientX));
    },
    [onRestoreSegment, onSeek, timeFromClientX]
  );

  // --- Boundary trim drag ---
  const handleBoundaryPointerDown = useCallback(
    (e: React.PointerEvent, leftIndex: number) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragLeftIndexRef.current = leftIndex;
      dragMovedRef.current = false;
    },
    []
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
      onTrimBoundary(dragLeftIndexRef.current, t);
    },
    [onTrimBoundary, onTrimStart, timeFromClientX, snapEnabled, snapTimes, pxPerSec]
  );
  const handleBoundaryPointerUp = useCallback((e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragLeftIndexRef.current = null;
  }, []);

  const rulerStep = niceRulerStep(80 / pxPerSec);
  const rulerMarks = useMemo(() => {
    const marks: number[] = [];
    for (let t = 0; t <= total; t += rulerStep) marks.push(t);
    return marks;
  }, [total, rulerStep]);

  const playheadLeft = currentTime * pxPerSec;
  const firstKeepIndex = edl.segments.findIndex((s) => s.status === "keep");

  const toolBtn =
    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground/40 cursor-not-allowed";
  const zoomBtn =
    "flex h-7 w-7 items-center justify-center rounded-md border border-foreground/10 text-foreground/60 hover:bg-foreground/10 hover:text-foreground/90";

  return (
    <div className="flex flex-col border-t border-foreground/10 bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-foreground/5 px-4 py-2">
        <div className="flex items-center gap-1">
          <span className="mr-3 font-mono text-xs text-foreground/40">
            <span className="text-foreground/70">{formatDuration(currentTime * 1000)}</span>
            {" / "}
            {formatDuration(total * 1000)}
          </span>
          <button type="button" disabled title="Split (coming soon)" className={toolBtn}>
            ✂ Split
          </button>
          <button type="button" disabled title="Ripple delete (coming soon)" className={toolBtn}>
            🗑 Ripple delete
          </button>
          <button
            type="button"
            onClick={() => setSnapEnabled((s) => !s)}
            title="Toggle snapping to word edges"
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              snapEnabled
                ? "bg-violet-500/20 text-violet-300"
                : "text-foreground/50 hover:bg-foreground/10 hover:text-foreground/80"
            }`}
          >
            ⌒ Snap
          </button>
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
            <button type="button" aria-label="Zoom out" onClick={zoomOut} className={zoomBtn}>
              −
            </button>
            <button
              type="button"
              onClick={zoomFit}
              className="rounded-md border border-foreground/10 px-2 py-1 text-xs text-foreground/60 hover:bg-foreground/10 hover:text-foreground/90"
            >
              Fit
            </button>
            <button type="button" aria-label="Zoom in" onClick={zoomIn} className={zoomBtn}>
              +
            </button>
          </div>
        </div>
      </div>

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
            <span className="text-foreground/25">👁 🔒</span>
          </div>
          <div
            style={{ height: AUDIO_H }}
            className="flex flex-col justify-center gap-1 px-3"
          >
            <span className="text-xs font-semibold text-foreground/70">Audio</span>
            <span className="text-foreground/25">🔇 🔒</span>
          </div>
        </div>

        {/* Scrollable tracks */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden">
          <div
            ref={contentRef}
            style={{ width: widthPx, height: TOTAL_H }}
            className="relative select-none"
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
              {edl.segments.map((segment, index) => {
                const isCut = segment.status === "cut";
                return (
                  <div
                    key={index}
                    onClick={(e) => handleSegmentClick(e, segment)}
                    onPointerDown={(e) => e.stopPropagation()}
                    title={
                      isCut
                        ? `Cut (${segment.reason ?? "manual"}) — click to restore`
                        : "Keep — click to seek"
                    }
                    style={{
                      left: segment.start * pxPerSec,
                      width: Math.max(1, (segment.end - segment.start) * pxPerSec),
                      backgroundImage: isCut
                        ? "repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 6px, transparent 6px 12px)"
                        : undefined,
                    }}
                    className={`absolute top-2 bottom-2 flex items-center overflow-hidden rounded-md border ${
                      isCut
                        ? "border-foreground/10 bg-black/40"
                        : "border-violet-400/40 bg-gradient-to-b from-violet-500/85 to-violet-600/85 hover:from-violet-500 hover:to-violet-600"
                    }`}
                  >
                    {!isCut && index === firstKeepIndex && (
                      <span className="truncate px-2 text-[11px] font-medium text-white/90">
                        {fileName}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Boundary trim handles */}
              {edl.segments.slice(0, -1).map((segment, index) => (
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
                  <div className="h-8 w-0.5 rounded-full bg-foreground/25 group-hover:bg-violet-400" />
                </div>
              ))}
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

            {/* Playhead */}
            <div
              onPointerDown={handleScrubPointerDown}
              onPointerMove={handleScrubPointerMove}
              onPointerUp={handleScrubPointerUp}
              style={{ left: playheadLeft }}
              className="absolute top-0 z-20 -ml-1.5 w-3 cursor-ew-resize"
            >
              <div className="mx-auto w-px bg-red-500" style={{ height: TOTAL_H }} />
              <div className="absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-red-500" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default TimelineBar;
