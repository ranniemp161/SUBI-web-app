"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import {
  EyeOff,
  Eye,
  Search,
  Sparkles,
  RotateCcw,
  Scissors,
  Play,
  Wand2,
  Loader2,
  X,
} from "lucide-react";
import type { EDLSegment, TranscriptWord } from "@/lib/edl";
import { findSegmentAt, groupWordsIntoParagraphs, type EDL } from "@/lib/edl";
import { formatDuration } from "@/lib/utils";

interface TranscriptPanelProps {
  words: TranscriptWord[];
  edl: EDL;
  currentTime: number;
  isPlaying: boolean;
  onSeek: (seconds: number) => void;
  onCutWords: (words: TranscriptWord[]) => void;
  onRestoreSegment: (segment: EDLSegment) => void;
  onOpenRetakeReview: () => void;
  /** Last completed cut pass — each new event re-shows the summary card. */
  cutEvent: { kind: "rough" | "ai"; at: number } | null;
  /** Kick off the paid AI pass (the card's "Enhance with AI Cut" upsell). */
  onEnhanceAi: () => void;
  aiBusy: boolean;
  /** Human-readable AI Cut price, e.g. "12:34 of credits". */
  aiCostLabel: string;
  /** Whether stored AI cuts are already applied to this project — the card
   *  must not upsell a pass whose results the user already has. */
  hasAiCuts: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  index: number;
}

interface WordSpanProps {
  index: number;
  word: string;
  isCut: boolean;
  isRetake: boolean;
  isAi: boolean;
  isRepetition: boolean;
  isSelected: boolean;
  isActive: boolean;
  isMatch: boolean;
  innerRef?: React.Ref<HTMLSpanElement>;
  onMouseDown: (index: number, e: React.MouseEvent) => void;
  onMouseEnter: (index: number) => void;
  onContextMenu: (index: number, e: React.MouseEvent) => void;
}

/**
 * A single transcript word. Memoized so that during a drag-selection only the
 * words whose selected/active/match state actually changed re-render, instead of
 * all ~thousands of spans. Relies on its callbacks being referentially stable.
 */
const WordSpan = memo(function WordSpan({
  index,
  word,
  isCut,
  isRetake,
  isAi,
  isRepetition,
  isSelected,
  isActive,
  isMatch,
  innerRef,
  onMouseDown,
  onMouseEnter,
  onContextMenu,
}: WordSpanProps) {
  return (
    <span>
      <span
        data-word-index={index}
        ref={innerRef}
        onMouseDown={(e) => onMouseDown(index, e)}
        onMouseEnter={() => onMouseEnter(index)}
        onContextMenu={(e) => onContextMenu(index, e)}
        className={`cursor-pointer rounded px-0.5 motion-safe:transition-[color,text-decoration-color,background-color] motion-safe:duration-200 ${
          isCut
            ? isRetake
              ? "text-amber-400/70 line-through decoration-amber-400/50 hover:text-emerald-300/80 hover:decoration-transparent"
              : isAi
                ? "text-sky-400/70 line-through decoration-sky-400/50 hover:text-emerald-300/80 hover:decoration-transparent"
                : isRepetition
                  ? "text-teal-400/70 line-through decoration-teal-400/50 hover:text-emerald-300/80 hover:decoration-transparent"
                  : "text-red-400/70 line-through decoration-red-400/50 hover:text-emerald-300/80 hover:decoration-transparent"
            : isActive
              ? "bg-blue-600 text-white shadow-sm shadow-blue-500/40 ring-1 ring-blue-300/60"
              : "text-foreground/90 hover:bg-foreground/10"
        } ${isSelected && !isActive ? "bg-blue-500/30" : ""} ${
          isMatch && !isSelected && !isActive ? "bg-amber-400/25" : ""
        }`}
        title={
          isCut
            ? isRetake
              ? "Retake — click to restore"
              : isAi
                ? "AI cut — speech mistake removed. Click to restore"
                : isRepetition
                  ? "Repeated words — kept the last delivery. Click to restore"
                  : "Click to restore this cut"
            : undefined
        }
      >
        {word}
      </span>{" "}
    </span>
  );
});

// The persisted "hide removed text" preference as a tiny external store, so
// components read it with useSyncExternalStore instead of a mount effect
// (localStorage is an external system; effect-body setState is a lint error
// and an extra render). The listener set makes same-tab toggles reactive —
// the native "storage" event only fires in *other* tabs.
const HIDE_CUT_STORAGE_KEY = "rc:hideCutWords";
const hideCutListeners = new Set<() => void>();

function subscribeHideCut(listener: () => void): () => void {
  hideCutListeners.add(listener);
  return () => hideCutListeners.delete(listener);
}

function readHideCutPreference(): boolean {
  return localStorage.getItem(HIDE_CUT_STORAGE_KEY) === "1";
}

function writeHideCutPreference(hide: boolean) {
  localStorage.setItem(HIDE_CUT_STORAGE_KEY, hide ? "1" : "0");
  hideCutListeners.forEach((listener) => listener());
}

/**
 * Transcript panel — click a word to seek, click-drag or shift-click to select
 * a range, right-click for cut/restore/play, click a cut (red) word to restore.
 * Keeps the active word scrolled into view during playback and supports search.
 */
export default function TranscriptPanel({
  words,
  edl,
  currentTime,
  isPlaying,
  onSeek,
  onCutWords,
  onRestoreSegment,
  onOpenRetakeReview,
  cutEvent,
  onEnhanceAi,
  aiBusy,
  aiCostLabel,
  hasAiCuts,
}: TranscriptPanelProps) {
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [dragging, setDragging] = useState(false);
  // Descript-style "hide removed text": cut words collapse to a restorable "···"
  // pill. Backed by the module-level localStorage store below — the server
  // snapshot is false, so SSR and first client render agree (no hydration
  // mismatch), then React swaps in the saved preference.
  const hideCut = useSyncExternalStore(
    subscribeHideCut,
    readHideCutPreference,
    () => false
  );
  const toggleHideCut = useCallback(() => {
    writeHideCutPreference(!readHideCutPreference());
  }, []);

  // Post-cut summary card: re-shows on each completed cut pass, then gets out
  // of the way — auto-collapses after a few seconds so the transcript keeps
  // its space. Retake review stays reachable from the tool rail afterwards.
  // "Dismissed" is keyed to the event's timestamp, so a new event (new `at`)
  // is visible again without any state reset in the effect.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  useEffect(() => {
    // While the AI pass is running the card is the thing showing its spinner —
    // hold it open and restart the countdown when the run settles.
    if (!cutEvent || aiBusy) return;
    const timer = setTimeout(() => setDismissedAt(cutEvent.at), 10_000);
    return () => clearTimeout(timer);
  }, [cutEvent, aiBusy]);
  const showCard = cutEvent !== null && cutEvent.at !== dismissedAt;

  const containerRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLSpanElement>(null);
  const firstMatchRef = useRef<HTMLSpanElement>(null);
  // Drag-selection bookkeeping (refs so window mouseup reads live values).
  const selectingRef = useRef(false);
  const didDragRef = useRef(false);
  const downIndexRef = useRef<number | null>(null);
  // Mirrors of state read by the per-word callbacks, so those callbacks can stay
  // referentially stable and the memoized word spans don't all re-render mid-drag.
  const anchorIndexRef = useRef<number | null>(null);
  const selectionRef = useRef<Set<number>>(selection);
  useEffect(() => {
    anchorIndexRef.current = anchorIndex;
    selectionRef.current = selection;
  }, [anchorIndex, selection]);

  const segmentForWord = useMemo(
    () => words.map((word) => findSegmentAt(edl, word.start)),
    [words, edl]
  );

  const paragraphs = useMemo(() => groupWordsIntoParagraphs(words), [words]);

  const activeIndex = useMemo(
    () => words.findIndex((w) => currentTime >= w.start && currentTime < w.end),
    [words, currentTime]
  );

  const normalizedQuery = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!normalizedQuery) return new Set<number>();
    const found = new Set<number>();
    words.forEach((w, i) => {
      if (w.word.toLowerCase().includes(normalizedQuery)) found.add(i);
    });
    return found;
  }, [words, normalizedQuery]);
  const firstMatchIndex = useMemo(
    () => (matches.size > 0 ? Math.min(...matches) : -1),
    [matches]
  );

  const silenceCount = edl.segments.filter(
    (s) => s.status === "cut" && s.reason === "silence"
  ).length;
  const retakeCount = edl.segments.filter(
    (s) => s.status === "cut" && s.reason === "retake"
  ).length;
  const aiCount = edl.segments.filter(
    (s) => s.status === "cut" && s.reason === "ai"
  ).length;

  // Keep the active word in view while playing.
  useEffect(() => {
    if (!isPlaying) return;
    const el = activeWordRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    if (eRect.top < cRect.top + 8 || eRect.bottom > cRect.bottom - 8) {
      container.scrollTop +=
        eRect.top - cRect.top - container.clientHeight / 2 + el.offsetHeight / 2;
    }
  }, [activeIndex, isPlaying]);

  // Scroll to the first search match when the query changes.
  useEffect(() => {
    if (firstMatchIndex < 0) return;
    firstMatchRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [firstMatchIndex]);

  const clearSelection = useCallback(() => {
    setAnchorIndex(null);
    setSelection(new Set());
  }, []);

  const selectRange = useCallback((a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const next = new Set<number>();
    for (let i = lo; i <= hi; i++) next.add(i);
    setSelection(next);
  }, []);

  const cutWords = useCallback(
    (indices: number[]) => {
      if (indices.length === 0) return;
      onCutWords(indices.map((i) => words[i]));
      clearSelection();
    },
    [words, onCutWords, clearSelection]
  );

  // --- Mouse selection (drag to select, shift-click to extend) ---
  const handleWordMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      if (e.button !== 0) return; // left button only; right opens the menu
      if (e.shiftKey && anchorIndexRef.current !== null) {
        selectRange(anchorIndexRef.current, index);
        return;
      }
      downIndexRef.current = index;
      selectingRef.current = true;
      didDragRef.current = false;
      setDragging(true);
      setAnchorIndex(index);
      setSelection(new Set([index]));
    },
    [selectRange]
  );

  const handleWordMouseEnter = useCallback(
    (index: number) => {
      if (!selectingRef.current || downIndexRef.current === null) return;
      didDragRef.current = true;
      selectRange(downIndexRef.current, index);
    },
    [selectRange]
  );

  // End-of-drag: a click with no drag seeks (or restores a cut) and leaves no
  // lingering selection; a real drag keeps the multi-word selection.
  useEffect(() => {
    function onUp() {
      if (!selectingRef.current) return;
      selectingRef.current = false;
      setDragging(false);
      const i = downIndexRef.current;
      if (didDragRef.current || i === null) return;
      const segment = segmentForWord[i];
      if (segment?.status === "cut") onRestoreSegment(segment);
      else onSeek(words[i].start);
      clearSelection();
    }
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [segmentForWord, words, onSeek, onRestoreSegment, clearSelection]);

  // Auto-scroll the transcript while drag-selecting past the top/bottom edge,
  // extending the selection to whatever word scrolls under the cursor.
  useEffect(() => {
    if (!dragging) return;
    const container = containerRef.current;
    if (!container) return;
    const point = { x: 0, y: 0 };
    let hasPoint = false;
    let frame = 0;

    const onMove = (e: MouseEvent) => {
      point.x = e.clientX;
      point.y = e.clientY;
      hasPoint = true;
    };

    const EDGE = 48; // px from an edge where auto-scroll kicks in
    const MAX_SPEED = 18; // px per frame at the very edge
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!hasPoint) return;
      const rect = container.getBoundingClientRect();
      let speed = 0;
      if (point.y < rect.top + EDGE) {
        speed = -Math.ceil(((rect.top + EDGE - point.y) / EDGE) * MAX_SPEED);
      } else if (point.y > rect.bottom - EDGE) {
        speed = Math.ceil(((point.y - (rect.bottom - EDGE)) / EDGE) * MAX_SPEED);
      }
      if (speed === 0) return;
      const before = container.scrollTop;
      container.scrollTop = before + speed;
      if (container.scrollTop === before) return; // already at a scroll limit
      const target = document.elementFromPoint(point.x, point.y);
      const wordEl = target?.closest<HTMLElement>("[data-word-index]");
      if (wordEl && downIndexRef.current !== null) {
        const idx = Number(wordEl.dataset.wordIndex);
        if (!Number.isNaN(idx)) {
          didDragRef.current = true;
          selectRange(downIndexRef.current, idx);
        }
      }
    };

    window.addEventListener("mousemove", onMove);
    frame = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [dragging, selectRange]);

  // --- Right-click context menu ---
  const handleContextMenu = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      if (!selectionRef.current.has(index)) {
        setAnchorIndex(index);
        setSelection(new Set([index]));
      }
      const x = Math.min(e.clientX, window.innerWidth - 180);
      const y = Math.min(e.clientY, window.innerHeight - 100);
      setMenu({ x, y, index });
    },
    []
  );

  // Close the menu on any outside interaction.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selection.size > 0) {
        e.preventDefault();
        e.stopPropagation();
        cutWords(Array.from(selection));
      }
      if (e.key === "Escape") {
        clearSelection();
        setMenu(null);
      }
    },
    [selection, cutWords, clearSelection]
  );

  const menuSegment = menu ? segmentForWord[menu.index] : undefined;
  const menuItem =
    "flex w-full items-center justify-between gap-6 rounded-md px-3 py-1.5 text-left text-sm text-foreground/80 hover:bg-foreground/10";

  return (
    <div className="flex h-full flex-col border-l border-foreground/5 bg-foreground/[0.01]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="flex items-baseline gap-2 text-xl font-bold text-foreground">
          Transcript
          <span className="text-sm font-normal text-foreground/40">
            {words.length.toLocaleString()} words
          </span>
        </h2>
        <button
          type="button"
          onClick={toggleHideCut}
          aria-pressed={hideCut}
          title={hideCut ? "Show removed text" : "Hide removed text"}
          className={`rounded-md p-1.5 transition-colors ${
            hideCut
              ? "bg-blue-500/15 text-blue-300"
              : "text-foreground/40 hover:bg-foreground/10 hover:text-foreground/70"
          }`}
        >
          {hideCut ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {/* Search */}
      <div className="px-5 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcript…"
            className="w-full rounded-lg border border-foreground/10 bg-foreground/[0.03] py-2 pl-9 pr-16 text-sm text-foreground placeholder:text-foreground/30 focus:border-blue-500/50 focus:outline-none"
          />
          {normalizedQuery && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-foreground/40">
              {matches.size} found
            </span>
          )}
        </div>
      </div>

      {/* Transcript body */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="transcript-scroll relative flex-1 select-none overflow-y-auto px-5 outline-none"
      >
        {/* Selection action bar */}
        {selection.size > 0 && (
          <div className="sticky top-0 z-10 -mx-5 mb-2 flex items-center justify-between border-b border-foreground/10 bg-background/95 px-5 py-2 backdrop-blur">
            <span className="text-xs text-foreground/60">
              {selection.size} word{selection.size === 1 ? "" : "s"} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-md px-2 py-1 text-xs text-foreground/50 hover:bg-foreground/10 hover:text-foreground/80"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => cutWords(Array.from(selection))}
                className="rounded-md bg-red-500/15 px-3 py-1 text-xs font-medium text-red-300 hover:bg-red-500/25"
              >
                Cut
              </button>
            </div>
          </div>
        )}

        <div className="pb-6 pt-1 text-base leading-loose">
          {words.length === 0 ? (
            <p className="text-foreground/30">No transcript available.</p>
          ) : (
            paragraphs.map((paragraph) => {
              const nodes: ReactNode[] = [];
              for (let index = paragraph.startIndex; index <= paragraph.endIndex; index++) {
                const segment = segmentForWord[index];
                const isCut = segment?.status === "cut";

                // With "hide removed text" on, collapse each run of cut words
                // into one restorable pill instead of rendering strikethrough.
                if (hideCut && isCut) {
                  if (index > paragraph.startIndex && segmentForWord[index - 1]?.status === "cut") {
                    continue; // interior of a run already covered by its pill
                  }
                  let runEnd = index;
                  while (
                    runEnd < paragraph.endIndex &&
                    segmentForWord[runEnd + 1]?.status === "cut"
                  ) {
                    runEnd++;
                  }
                  const count = runEnd - index + 1;
                  const start = words[index].start;
                  const end = words[runEnd].end;
                  nodes.push(
                    <button
                      key={`hidden-${index}`}
                      type="button"
                      onClick={() =>
                        onRestoreSegment({ start, end, status: "cut", reason: null })
                      }
                      title={`${count} removed word${count === 1 ? "" : "s"} — click to restore`}
                      className="mx-0.5 inline-flex translate-y-px items-center rounded-md bg-foreground/[0.07] px-1.5 text-xs leading-5 text-foreground/40 transition-colors hover:bg-emerald-500/20 hover:text-emerald-300"
                    >
                      ···
                    </button>
                  );
                  nodes.push(" ");
                  continue;
                }

                const isRetake = isCut && segment?.reason === "retake";
                const isAi = isCut && segment?.reason === "ai";
                const isRepetition = isCut && segment?.reason === "repetition";
                const isSelected = selection.has(index);
                const isActive = index === activeIndex;
                const isMatch = matches.has(index);
                nodes.push(
                  <WordSpan
                    key={`${words[index].start}-${index}`}
                    index={index}
                    word={words[index].word}
                    isCut={isCut}
                    isRetake={isRetake}
                    isAi={isAi}
                    isRepetition={isRepetition}
                    isSelected={isSelected}
                    isActive={isActive}
                    isMatch={isMatch}
                    innerRef={
                      isActive
                        ? activeWordRef
                        : index === firstMatchIndex
                          ? firstMatchRef
                          : undefined
                    }
                    onMouseDown={handleWordMouseDown}
                    onMouseEnter={handleWordMouseEnter}
                    onContextMenu={handleContextMenu}
                  />
                );
              }

              return (
                <div key={paragraph.startIndex} className="mb-4">
                  <button
                    type="button"
                    onClick={() => onSeek(words[paragraph.startIndex].start)}
                    title="Jump to this paragraph"
                    className="mb-0.5 block select-none font-mono text-[10px] text-foreground/30 transition-colors hover:text-blue-400"
                  >
                    {formatDuration(words[paragraph.startIndex].start * 1000)}
                  </button>
                  <p>{nodes}</p>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Post-cut summary card — event-driven, auto-collapses (see showCard) */}
      {showCard && (
        <div className="m-4 rounded-xl border border-blue-500/20 bg-blue-500/[0.07] p-3">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-blue-300">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              {cutEvent.kind === "rough" ? (
                <>
                  <p className="text-sm font-semibold text-foreground">
                    Rough cut done — {silenceCount} silence{silenceCount === 1 ? "" : "s"} removed
                  </p>
                  <p className="truncate text-xs text-foreground/50">
                    {retakeCount > 0
                      ? `${retakeCount} retake${retakeCount === 1 ? "" : "s"} auto-cut — kept the later take`
                      : "No repeated takes detected"}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-foreground">
                    AI cut applied — {aiCount} mistake{aiCount === 1 ? "" : "s"} removed
                  </p>
                  <p className="truncate text-xs text-foreground/50">
                    Click any struck-through word to restore it.
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setDismissedAt(cutEvent.at)}
              aria-label="Dismiss"
              className="rounded-md p-1 text-foreground/40 hover:bg-foreground/10 hover:text-foreground/80"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {cutEvent.kind === "rough" && !hasAiCuts && (
              <button
                type="button"
                onClick={onEnhanceAi}
                disabled={aiBusy}
                title={`AI pass — remove false starts, stumbles & flubbed takes (uses ${aiCostLabel})`}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {aiBusy ? (
                  <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                {aiBusy ? "AI is working…" : "Enhance with AI Cut"}
              </button>
            )}
            {retakeCount > 0 && (
              <button
                type="button"
                onClick={onOpenRetakeReview}
                title="Review detected retakes one by one"
                className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/30"
              >
                Review retakes
              </button>
            )}
          </div>
          {cutEvent.kind === "rough" &&
            (hasAiCuts ? (
              <p className="mt-1.5 text-center text-[10px] text-foreground/35">
                Your AI cuts are already included — re-run anytime from the AI
                Cut tool (uses {aiCostLabel})
              </p>
            ) : (
              <p className="mt-1.5 text-center text-[10px] text-foreground/35">
                Uses {aiCostLabel} · you&apos;ll keep full undo
              </p>
            ))}
        </div>
      )}

      {/* Context menu */}
      {menu && (
        <div
          role="menu"
          aria-label="Word actions"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-44 rounded-lg border border-foreground/10 bg-background p-1 shadow-2xl"
        >
          {menuSegment?.status === "cut" ? (
            <button
              type="button"
              onClick={() => {
                if (selection.has(menu.index) && selection.size > 1) {
                  // Restore the whole selected span (restoreSegment only reads
                  // start/end), matching how Cut respects a multi-word selection.
                  const sel = Array.from(selection).map((i) => words[i]);
                  const start = Math.min(...sel.map((w) => w.start));
                  const end = Math.max(...sel.map((w) => w.end));
                  onRestoreSegment({ start, end, status: "cut", reason: null });
                } else {
                  onRestoreSegment(menuSegment);
                }
                clearSelection();
                setMenu(null);
              }}
              role="menuitem"
              className={menuItem}
            >
              Restore{" "}
              {selection.has(menu.index) && selection.size > 1
                ? `${selection.size} words`
                : ""}
              <RotateCcw className="h-3.5 w-3.5 text-foreground/30" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                const indices = selection.has(menu.index)
                  ? Array.from(selection)
                  : [menu.index];
                cutWords(indices);
                setMenu(null);
              }}
              role="menuitem"
              className={menuItem}
            >
              Cut{" "}
              {selection.has(menu.index) && selection.size > 1
                ? `${selection.size} words`
                : ""}
              <Scissors className="h-3.5 w-3.5 text-foreground/30" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onSeek(words[menu.index].start);
              setMenu(null);
            }}
            role="menuitem"
            className={menuItem}
          >
            Play from here <Play className="h-3.5 w-3.5 text-foreground/30" />
          </button>
        </div>
      )}
    </div>
  );
}
