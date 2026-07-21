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
import type { EDLSegment, TimeRange, TranscriptWord } from "@/lib/edl";
import {
  findActiveWordIndex,
  findSegmentAt,
  groupWordsIntoParagraphs,
  type EDL,
} from "@/lib/edl";
import { formatDuration } from "@/lib/utils";
import {
  SYNC_HOVER_BG_CLASS,
  SYNC_HOVER_RING_CLASS,
  SYNC_SELECTION_BG_CLASS,
  SYNC_SELECTION_RING_CLASS,
} from "@/lib/sync-colors";

interface TranscriptPanelProps {
  words: TranscriptWord[];
  edl: EDL;
  currentTime: number;
  isPlaying: boolean;
  onSeek: (seconds: number) => void;
  /** Seek AND start playback — the "Play from here" actions. Falls back to
   *  onSeek (seek only) when not provided. */
  onPlayFrom?: (seconds: number) => void;
  onCutWords: (words: TranscriptWord[]) => void;
  onRestoreSegment: (segment: EDLSegment) => void;
  onOpenRetakeReview: () => void;
  /** Last completed cut pass — each new event re-shows the summary card. */
  cutEvent: { kind: "rough" | "ai"; at: number } | null;
  /** Kick off the one paid manual AI pass (ADR 0003 child 2's "Polish with AI"
   *  button — shown only when no run exists yet). */
  onPolishWithAi: () => void;
  aiBusy: boolean;
  /** Human-readable AI Cut price, e.g. "12:34 of credits". */
  aiCostLabel: string;
  /** No successful AI run has ever been stored for this project — the manual
   *  "Polish with AI" button shows only in this state (AC-6). */
  noAiRunYet: boolean;
  /** The user has drifted from the AI's suggestions — the free "Restore AI
   *  suggestions" action shows only when this is true (AC-7). */
  hasDiverged: boolean;
  /** Re-apply the stored run's suggestions client-side (free, no charge). */
  onRestoreAiSuggestions: () => void;
  /** When the currently active AI cut run was generated. */
  lastAiCutTime?: string | null;
  /** A time to preview-highlight, published by the timeline's own hover
   *  (AC-6). Null when nothing is hovered there. */
  hoveredTime?: number | null;
  /** Publish this panel's own word hover so the timeline can show a preview
   *  marker at that time (AC-5). Fired with null on mouse leave. */
  onWordHover?: (seconds: number | null) => void;
  /** The shared cross-panel selection (AC-3/AC-4), highlighted here only when
   *  this panel has no local drag-selection of its own (its local selection
   *  already shows via `isSelected`). */
  selectedRange?: TimeRange | null;
  /** Publish this panel's own drag-selection as a time range (AC-3) so the
   *  timeline can highlight the matching span. Fired with null when the
   *  selection clears. */
  onSelectionRangeChange?: (range: TimeRange | null) => void;
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
  /** Externally-driven hover preview (from the timeline) or cross-panel
   *  selection (from a timeline clip select/trim) — never true for this
   *  panel's own local hover/selection, which use their own styling. */
  isHoverPreview: boolean;
  isCrossSelected: boolean;
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
  isHoverPreview,
  isCrossSelected,
  innerRef,
  onMouseDown,
  onMouseEnter,
  onContextMenu,
}: WordSpanProps) {
  return (
    // The hit-test attribute lives on the wrapper (word + trailing space) so a
    // drag passing through the space between words still resolves to a word —
    // the inner span alone leaves dead zones that stall the selection.
    <span data-word-index={index}>
      <span
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
              ? // Accent yellow is reserved for the playhead — the one word
                // playback is on — so it can never be confused with selection.
                "bg-accent text-accent-foreground shadow-sm shadow-accent/40 ring-1 ring-accent/60"
              : isSelected
                ? // Selection uses the universal text-selection blue: solid and
                  // unmistakable, and a different language from the playhead.
                  "bg-blue-500/80 text-white"
                : "text-foreground/90 hover:bg-foreground/10"
        } ${isCut && isSelected ? "bg-blue-500/35" : ""} ${
          isMatch && !isSelected && !isActive ? "bg-amber-400/25" : ""
        } ${
          isCrossSelected && !isSelected && !isActive
            ? `${SYNC_SELECTION_BG_CLASS} ${SYNC_SELECTION_RING_CLASS}`
            : ""
        } ${
          isHoverPreview && !isSelected && !isActive && !isCrossSelected
            ? `${SYNC_HOVER_BG_CLASS} ${SYNC_HOVER_RING_CLASS}`
            : ""
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
/**
 * Resolve the transcript word under (or nearest to) a viewport point. Tries a
 * direct element hit first, then falls back to the caret position — which the
 * browser resolves to the nearest text position — so dragging through the
 * whitespace between words, past a line's end, or slightly off the text row
 * still lands on a word instead of stalling the selection.
 */
function wordIndexAtPoint(x: number, y: number): number | null {
  let el: Element | null =
    document.elementFromPoint(x, y)?.closest("[data-word-index]") ?? null;
  if (!el) {
    let node: Node | null = null;
    if (typeof document.caretRangeFromPoint === "function") {
      node = document.caretRangeFromPoint(x, y)?.startContainer ?? null;
    } else if ("caretPositionFromPoint" in document) {
      node =
        (
          document as Document & {
            caretPositionFromPoint(x: number, y: number): { offsetNode: Node } | null;
          }
        ).caretPositionFromPoint(x, y)?.offsetNode ?? null;
    }
    const base = node instanceof Element ? node : (node?.parentElement ?? null);
    el = base?.closest("[data-word-index]") ?? null;
  }
  if (!(el instanceof HTMLElement)) return null;
  const index = Number(el.dataset.wordIndex);
  return Number.isNaN(index) ? null : index;
}

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

// First-visit gesture hint, dismissible once per browser. Same external-store
// shape as the hide-cut preference above. The server snapshot says "dismissed"
// so returning users never see it flash during hydration; first-time users see
// it appear right after mount.
const HINT_STORAGE_KEY = "rc:transcriptHintDismissed";
const hintListeners = new Set<() => void>();

function subscribeHint(listener: () => void): () => void {
  hintListeners.add(listener);
  return () => hintListeners.delete(listener);
}

function readHintDismissed(): boolean {
  return localStorage.getItem(HINT_STORAGE_KEY) === "1";
}

function dismissHint() {
  localStorage.setItem(HINT_STORAGE_KEY, "1");
  hintListeners.forEach((listener) => listener());
}

/**
 * Transcript panel — click a word to seek (and set the range anchor), then
 * Shift or Ctrl/Cmd-click another word to select everything between them;
 * click-drag also selects. Right-click for cut/restore/play, click a cut (red)
 * word to restore. Keeps the active word scrolled into view during playback
 * and supports search.
 */
export default function TranscriptPanel({
  words,
  edl,
  currentTime,
  isPlaying,
  onSeek,
  onPlayFrom,
  onCutWords,
  onRestoreSegment,
  onOpenRetakeReview,
  cutEvent,
  onPolishWithAi,
  aiBusy,
  aiCostLabel,
  noAiRunYet,
  hasDiverged,
  onRestoreAiSuggestions,
  lastAiCutTime,
  hoveredTime,
  onWordHover,
  selectedRange,
  onSelectionRangeChange,
}: TranscriptPanelProps) {
  const [now, setNow] = useState<number | null>(() => (lastAiCutTime ? Date.now() : null));
  const isInitialAiCutTime = useRef(true);
  useEffect(() => {
    if (!lastAiCutTime) return;
    // Skip the refresh-on-mount tick (state already seeded by the lazy
    // initializer above); only re-sync `now` when lastAiCutTime changes later.
    if (isInitialAiCutTime.current) {
      isInitialAiCutTime.current = false;
    } else {
      const refresh = setTimeout(() => setNow(Date.now()), 0);
      return () => clearTimeout(refresh);
    }
  }, [lastAiCutTime]);
  useEffect(() => {
    if (!lastAiCutTime) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [lastAiCutTime]);

  // Whether the pointer is currently hovering a word in this panel — see the
  // self-echo note on hoverPreviewIndex above.
  const [isSelfHovering, setIsSelfHovering] = useState(false);
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
  const hintDismissed = useSyncExternalStore(subscribeHint, readHintDismissed, () => true);
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
  // Explicit X-button dismissal. Separate from `dismissedAt` (the auto-collapse
  // timer) so the two don't fight: closing the card should always win over the
  // "reopen while diverged" behavior below, until something new happens (a
  // fresh cut event, or a new divergence after being restored). Tracked with
  // state mirrors (not refs) and reset during render — React's documented
  // pattern for "adjust state when a prop changes" — since this repo's lint
  // config also forbids reading/writing refs during render.
  const [manuallyDismissed, setManuallyDismissed] = useState(false);
  const [prevCutEventAt, setPrevCutEventAt] = useState(cutEvent?.at);
  const [prevHasDiverged, setPrevHasDiverged] = useState(hasDiverged);
  if (cutEvent?.at !== prevCutEventAt || hasDiverged !== prevHasDiverged) {
    const cutEventChanged = cutEvent?.at !== prevCutEventAt;
    const newlyDiverged = hasDiverged && !prevHasDiverged;
    setPrevCutEventAt(cutEvent?.at);
    setPrevHasDiverged(hasDiverged);
    if (manuallyDismissed && (cutEventChanged || newlyDiverged)) setManuallyDismissed(false);
  }
  const showCard =
    cutEvent !== null &&
    !manuallyDismissed &&
    (cutEvent.at !== dismissedAt || hasDiverged);

  const containerRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLSpanElement>(null);
  const firstMatchRef = useRef<HTMLSpanElement>(null);
  // Drag-selection bookkeeping (refs so window mouseup reads live values).
  const selectingRef = useRef(false);
  const didDragRef = useRef(false);
  const downIndexRef = useRef<number | null>(null);
  // True while the click that opened the menu is still in flight, so the
  // close-on-outside-click listener doesn't treat it as an outside click.
  const menuOpenedByClickRef = useRef(false);
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
    () => findActiveWordIndex(words, currentTime),
    [words, currentTime]
  );

  // Externally-driven hover preview (AC-6): the timeline's own hover,
  // resolved to the word it lands on. -1 (no word) when hovering a silence
  // gap — spec 0002's Value sourcing table specifies findActiveWordIndex here.
  // Suppressed while this panel is itself being hovered (isSelfHovering) —
  // otherwise a word hover this panel just published echoes back down as the
  // same `hoveredTime` prop and redundantly re-highlights the word the mouse
  // is already sitting on.
  const hoverPreviewIndex = useMemo(
    () => (hoveredTime == null || isSelfHovering ? -1 : findActiveWordIndex(words, hoveredTime)),
    [words, hoveredTime, isSelfHovering]
  );

  // Cross-panel selection (AC-4): only rendered while this panel has no local
  // drag-selection of its own — a local selection already renders via
  // isSelected, and must win over a stale externally-driven range.
  const crossSelectedRange = selection.size === 0 ? (selectedRange ?? null) : null;

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
  const repetitionCount = edl.segments.filter(
    (s) => s.status === "cut" && s.reason === "repetition"
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
    onSelectionRangeChange?.(null);
  }, [onSelectionRangeChange]);

  const selectRange = useCallback(
    (a: number, b: number) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const next = new Set<number>();
      for (let i = lo; i <= hi; i++) next.add(i);
      setSelection(next);
      onSelectionRangeChange?.({ start: words[lo].start, end: words[hi].end });
    },
    [words, onSelectionRangeChange]
  );

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
      // Shift or Ctrl/Cmd+click extends the selection from the anchor — the
      // last plain-clicked word — to this one (Descript-style range select).
      // With no anchor yet, it starts one here.
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        const anchor = anchorIndexRef.current;
        if (anchor !== null) {
          selectRange(anchor, index);
        } else {
          setAnchorIndex(index);
          setSelection(new Set([index]));
          onSelectionRangeChange?.({ start: words[index].start, end: words[index].end });
        }
        return;
      }
      // The drag seed stays invisible: no selection is set on mousedown, so a
      // plain click never flashes the selection bar open and closed. The
      // selection first appears when a real drag is detected (pointer crosses
      // to another word) in mouseenter or the rAF hit-test loop below.
      downIndexRef.current = index;
      selectingRef.current = true;
      didDragRef.current = false;
      setDragging(true);
      setAnchorIndex(index);
    },
    [selectRange, words, onSelectionRangeChange]
  );

  const handleWordMouseEnter = useCallback(
    (index: number) => {
      // Hover preview (AC-5): fires regardless of an in-progress drag-select —
      // it's a read-only overlay (Key invariant) and never gates on it.
      onWordHover?.(words[index].start);
      setIsSelfHovering((prev) => (prev ? prev : true));
      const down = downIndexRef.current;
      if (!selectingRef.current || down === null) return;
      if (index !== down) didDragRef.current = true;
      if (didDragRef.current) selectRange(down, index);
    },
    [selectRange, words, onWordHover]
  );

  // End-of-drag: a click with no drag seeks (or, on a cut word, opens the
  // small anchored menu with Restore — a lightweight validation step so an
  // accidental click can't silently un-delete) and leaves no lingering
  // selection; a real drag keeps the multi-word selection.
  useEffect(() => {
    function onUp(e: MouseEvent) {
      if (!selectingRef.current) return;
      selectingRef.current = false;
      setDragging(false);
      const i = downIndexRef.current;
      if (didDragRef.current || i === null) return;
      const segment = segmentForWord[i];
      if (segment?.status === "cut") {
        // The trailing `click` of this same gesture must not instantly close
        // the menu — flag it so the close listener lets it pass.
        menuOpenedByClickRef.current = true;
        setMenu({
          x: Math.min(e.clientX, window.innerWidth - 180),
          y: Math.min(e.clientY, window.innerHeight - 100),
          index: i,
        });
      } else {
        onSeek(words[i].start);
      }
      // The clicked word stays the range anchor (so a following Shift or
      // Ctrl-click extends from here); only the visible selection clears.
      setAnchorIndex(i);
      setSelection(new Set());
      onSelectionRangeChange?.(null);
    }
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [segmentForWord, words, onSeek, onSelectionRangeChange]);

  // While drag-selecting: every frame, extend the selection to the word under
  // (or nearest) the pointer via geometric hit-testing, and auto-scroll past
  // the top/bottom edge. The per-word mouseenter path still gives instant
  // feedback over the words themselves; this loop covers everywhere it can't —
  // the spaces between words, line ends, and off-row drift — which is what
  // made dragging feel like it only caught individual words.
  useEffect(() => {
    if (!dragging) return;
    const container = containerRef.current;
    if (!container) return;
    const point = { x: 0, y: 0 };
    let hasPoint = false;
    let frame = 0;
    // Skip the setSelection when the resolved range didn't change, so the
    // 60 Hz loop doesn't re-render the panel on every frame of a still drag.
    let lastLo = -1;
    let lastHi = -1;

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
      if (speed !== 0) container.scrollTop += speed;
      const down = downIndexRef.current;
      if (down === null) return;
      // Clamp the probe point into the panel so a drag that wanders outside
      // it keeps selecting the nearest row instead of freezing.
      const x = Math.min(Math.max(point.x, rect.left + 1), rect.right - 1);
      const y = Math.min(Math.max(point.y, rect.top + 1), rect.bottom - 1);
      const idx = wordIndexAtPoint(x, y);
      if (idx === null) return;
      if (idx !== down) didDragRef.current = true;
      // Until a real drag is detected, keep the selection invisible — a
      // click-hold on one word must not flash the selection bar.
      if (!didDragRef.current) return;
      const lo = Math.min(down, idx);
      const hi = Math.max(down, idx);
      if (lo === lastLo && hi === lastHi) return;
      lastLo = lo;
      lastHi = hi;
      selectRange(down, idx);
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
        onSelectionRangeChange?.({ start: words[index].start, end: words[index].end });
      }
      const x = Math.min(e.clientX, window.innerWidth - 180);
      const y = Math.min(e.clientY, window.innerHeight - 100);
      setMenu({ x, y, index });
    },
    [words, onSelectionRangeChange]
  );

  // Close the menu on any outside interaction. When the menu was opened by a
  // left-click on a cut word (the mouseup handler), the same gesture's trailing
  // `click` event would otherwise close it in the same breath — the ref flag
  // swallows exactly that one click.
  useEffect(() => {
    if (!menu) return;
    const closeOnClick = () => {
      if (menuOpenedByClickRef.current) {
        menuOpenedByClickRef.current = false;
        return;
      }
      setMenu(null);
    };
    const close = () => setMenu(null);
    window.addEventListener("click", closeOnClick);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", closeOnClick);
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
              ? "bg-accent/15 text-accent"
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
            className="w-full rounded-lg border border-foreground/10 bg-foreground/[0.03] py-2 pl-9 pr-16 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent/50 focus:outline-none"
          />
          {normalizedQuery && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-foreground/40">
              {matches.size} found
            </span>
          )}
        </div>
      </div>

      {/* Cut-reason legend — decodes the strikethrough colors at a glance. */}
      {(silenceCount > 0 || retakeCount > 0 || aiCount > 0 || repetitionCount > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
          {silenceCount > 0 && (
            <span
              title="Red strikethrough — silence removed. Click a struck word to restore it."
              className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-300"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
              {silenceCount} silence{silenceCount === 1 ? "" : "s"}
            </span>
          )}
          {retakeCount > 0 && (
            <span
              title="Amber strikethrough — retake removed, the last delivery was kept. Click a struck word to restore it."
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {retakeCount} retake{retakeCount === 1 ? "" : "s"}
            </span>
          )}
          {aiCount > 0 && (
            <span
              title="Blue strikethrough — the AI pass removed a speech mistake. Click a struck word to restore it."
              className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-300"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              {aiCount} AI cut{aiCount === 1 ? "" : "s"}
            </span>
          )}
          {repetitionCount > 0 && (
            <span
              title="Teal strikethrough — repeated words removed, the last delivery was kept. Click a struck word to restore it."
              className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/10 px-2 py-0.5 text-[10px] font-medium text-teal-300"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
              {repetitionCount} repeat{repetitionCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      {/* One-time gesture hints — dismiss persists per browser. */}
      {!hintDismissed && (
        <div className="mx-5 mb-3 flex items-start justify-between gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 py-2">
          <p className="text-xs leading-relaxed text-foreground/60">
            <span className="font-medium text-foreground/80">Click</span> a word to jump
            {" · "}
            <span className="font-medium text-foreground/80">drag</span> to select
            {" · "}
            <span className="font-medium text-foreground/80">Shift/Ctrl-click</span> a second
            word to select the range{" · "}
            <span className="font-medium text-foreground/80">Delete</span> key cuts the
            selection{" · "}click struck-through text to restore it
          </p>
          <button
            type="button"
            onClick={dismissHint}
            aria-label="Dismiss hints"
            className="rounded p-0.5 text-foreground/40 hover:bg-foreground/10 hover:text-foreground/70"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Transcript body. translate="no" + notranslate: Chrome's auto-translate
          (and similar extensions) rewrites text nodes in place — wrapping each
          word in <font> tags — which desyncs React's DOM and crashes the next
          word update with insertBefore NotFoundError. Translated words would
          also no longer match their timestamps, so translation is wrong here
          even when it doesn't crash. */}
      <div
        ref={containerRef}
        tabIndex={0}
        translate="no"
        onKeyDown={handleKeyDown}
        onMouseLeave={() => {
          setIsSelfHovering(false);
          onWordHover?.(null);
        }}
        className="notranslate transcript-scroll relative flex-1 select-none overflow-y-auto px-5 outline-none"
      >
        {/* Selection action bar */}
        {selection.size > 0 && (
          <div className="sticky top-0 z-10 -mx-5 mb-2 flex items-center justify-between border-b border-foreground/10 bg-background/95 px-5 py-2 backdrop-blur">
            <span className="text-xs text-blue-300">
              {selection.size} word{selection.size === 1 ? "" : "s"} selected
              <span className="ml-2 hidden text-[10px] text-foreground/35 min-[380px]:inline">
                Delete key cuts · Esc deselects
              </span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const starts = Array.from(selection).map((i) => words[i].start);
                  (onPlayFrom ?? onSeek)(Math.min(...starts));
                }}
                title="Play from the start of the selection"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-foreground/60 hover:bg-foreground/10 hover:text-foreground/90"
              >
                <Play className="h-3 w-3" />
                Play selection
              </button>
              <button
                type="button"
                onClick={clearSelection}
                title="Keep everything — just remove the highlight"
                className="rounded-md px-2 py-1 text-xs text-foreground/50 hover:bg-foreground/10 hover:text-foreground/80"
              >
                Deselect
              </button>
              <button
                type="button"
                onClick={() => cutWords(Array.from(selection))}
                className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-3 py-1 text-xs font-medium text-red-300 hover:bg-red-500/25"
              >
                <Scissors className="h-3 w-3" />
                Cut {selection.size} word{selection.size === 1 ? "" : "s"}
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
                  // Preview the hidden text in the tooltip so restoring isn't
                  // a blind gamble.
                  const previewWords = words
                    .slice(index, runEnd + 1)
                    .map((w) => w.word)
                    .join(" ");
                  const preview =
                    previewWords.length > 90
                      ? `${previewWords.slice(0, 90)}…`
                      : previewWords;
                  // Keyed wrapper holds the pill AND its trailing space —
                  // every child of the <p> stays a keyed element, no bare
                  // text-node siblings for reconciliation to trip over.
                  nodes.push(
                    <span key={`hidden-${index}`}>
                      <button
                        type="button"
                        onClick={(e) => {
                          // Select the hidden run and open the anchored menu —
                          // its multi-word Restore branch then restores the
                          // full span, with the menu as the validation step.
                          setAnchorIndex(index);
                          const range = new Set<number>();
                          for (let w = index; w <= runEnd; w++) range.add(w);
                          setSelection(range);
                          setMenu({
                            x: Math.min(e.clientX, window.innerWidth - 180),
                            y: Math.min(e.clientY, window.innerHeight - 100),
                            index,
                          });
                        }}
                        title={`${count} removed word${count === 1 ? "" : "s"}: “${preview}” — click to restore`}
                        className="mx-0.5 inline-flex translate-y-px items-center rounded-md bg-foreground/[0.07] px-1.5 text-xs leading-5 text-foreground/40 transition-colors hover:bg-emerald-500/20 hover:text-emerald-300 motion-safe:animate-[rc-pill-in_150ms_ease-out]"
                      >
                        ···
                      </button>{" "}
                    </span>
                  );
                  continue;
                }

                const isRetake = isCut && segment?.reason === "retake";
                const isAi = isCut && segment?.reason === "ai";
                const isRepetition = isCut && segment?.reason === "repetition";
                const isSelected = selection.has(index);
                const isActive = index === activeIndex;
                const isMatch = matches.has(index);
                const isHoverPreview = index === hoverPreviewIndex;
                const isCrossSelected =
                  crossSelectedRange !== null &&
                  words[index].start < crossSelectedRange.end &&
                  words[index].end > crossSelectedRange.start;
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
                    isHoverPreview={isHoverPreview}
                    isCrossSelected={isCrossSelected}
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
                    className="mb-0.5 block select-none font-mono text-[10px] text-foreground/30 transition-colors hover:text-accent"
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
        <div className="m-4 rounded-xl border border-accent/20 bg-accent/[0.07] p-3">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-accent">
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
              onClick={() => {
                setDismissedAt(cutEvent.at);
                setManuallyDismissed(true);
              }}
              aria-label="Dismiss"
              className="rounded-md p-1 text-foreground/40 hover:bg-foreground/10 hover:text-foreground/80"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {/* One paid AI attempt per project (ADR 0003 child 2): the manual
                "Polish with AI" button shows only until a run exists. */}
            {noAiRunYet && (
              <button
                type="button"
                onClick={onPolishWithAi}
                disabled={aiBusy}
                title={`AI pass — remove false starts, stumbles & flubbed takes (uses ${aiCostLabel})`}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {aiBusy ? (
                  <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                {aiBusy ? "AI is working…" : "Polish with AI"}
              </button>
            )}
            {/* Free client-side restore (AC-7): only when a run exists and the
                user has drifted from its suggestions. */}
            {hasDiverged && (
              <button
                type="button"
                onClick={onRestoreAiSuggestions}
                title="Re-apply the AI's suggestions — free, no charge"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore AI suggestions
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
          {noAiRunYet ? (
            <p className="mt-1.5 text-center text-[10px] text-foreground/35">
              Uses {aiCostLabel} · you&apos;ll keep full undo
            </p>
          ) : !hasDiverged ? (
            <p className="mt-1.5 text-center text-[10px] text-foreground/35">
              Your AI cuts are applied
              {lastAiCutTime && now && (
                <span title={new Date(lastAiCutTime).toLocaleString()}>
                  {" "}
                  (last run{" "}
                  {new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
                    -Math.round((now - new Date(lastAiCutTime).getTime()) / 60000) < -60
                      ? -Math.round((now - new Date(lastAiCutTime).getTime()) / 3600000)
                      : -Math.round((now - new Date(lastAiCutTime).getTime()) / 60000),
                    -Math.round((now - new Date(lastAiCutTime).getTime()) / 60000) < -60 ? "hour" : "minute"
                  )}
                  )
                </span>
              )}
            </p>
          ) : null}
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
                  // Restore only this word's own span, not the underlying EDL
                  // segment — adjacent independently-cut words can share one
                  // merged segment (mergeAdjacent), and menuSegment is that
                  // merged range, not something scoped to the clicked word.
                  const word = words[menu.index];
                  onRestoreSegment({ start: word.start, end: word.end, status: "cut", reason: null });
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
                : "1 word"}
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
                : "1 word"}
              <Scissors className="h-3.5 w-3.5 text-foreground/30" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              (onPlayFrom ?? onSeek)(words[menu.index].start);
              setMenu(null);
            }}
            role="menuitem"
            className={menuItem}
          >
            Play from here <Play className="h-3.5 w-3.5 text-foreground/30" />
          </button>
          {selection.size > 0 && (
            <button
              type="button"
              onClick={() => {
                clearSelection();
                setMenu(null);
              }}
              role="menuitem"
              className={menuItem}
            >
              Deselect <X className="h-3.5 w-3.5 text-foreground/30" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
