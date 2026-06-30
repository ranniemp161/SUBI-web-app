"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EDLSegment, TranscriptWord } from "@/lib/edl";
import { findSegmentAt, type EDL } from "@/lib/edl";
import { formatDuration } from "@/lib/utils";

interface TranscriptPanelProps {
  words: TranscriptWord[];
  edl: EDL;
  currentTime: number;
  isPlaying: boolean;
  onSeek: (seconds: number) => void;
  onCutWords: (words: TranscriptWord[]) => void;
  onRestoreSegment: (segment: EDLSegment) => void;
}

/**
 * Transcript panel — click a word to seek, shift-click to select a range
 * (then Cut, via the toolbar or the Delete key), click a cut (red strikethrough)
 * word to restore its segment. Includes a search/highlight box and keeps the
 * active word scrolled into view during playback.
 */
export default function TranscriptPanel({
  words,
  edl,
  currentTime,
  isPlaying,
  onSeek,
  onCutWords,
  onRestoreSegment,
}: TranscriptPanelProps) {
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLSpanElement>(null);
  const firstMatchRef = useRef<HTMLSpanElement>(null);

  const segmentForWord = useMemo(
    () => words.map((word) => findSegmentAt(edl, word.start)),
    [words, edl]
  );

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

  const cutSelection = useCallback(() => {
    if (selection.size === 0) return;
    onCutWords(Array.from(selection).map((i) => words[i]));
    clearSelection();
  }, [selection, words, onCutWords, clearSelection]);

  const handleWordClick = useCallback(
    (index: number, shiftKey: boolean) => {
      const word = words[index];
      const segment = segmentForWord[index];

      if (segment?.status === "cut" && !shiftKey) {
        onRestoreSegment(segment);
        clearSelection();
        return;
      }

      onSeek(word.start);

      if (shiftKey && anchorIndex !== null) {
        const lo = Math.min(anchorIndex, index);
        const hi = Math.max(anchorIndex, index);
        const next = new Set<number>();
        for (let i = lo; i <= hi; i++) next.add(i);
        setSelection(next);
      } else {
        setAnchorIndex(index);
        setSelection(new Set([index]));
      }
    },
    [words, segmentForWord, anchorIndex, onSeek, onRestoreSegment, clearSelection]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selection.size > 0) {
        e.preventDefault();
        e.stopPropagation();
        cutSelection();
      }
      if (e.key === "Escape") clearSelection();
    },
    [selection, cutSelection, clearSelection]
  );

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
          disabled
          title="More options (coming soon)"
          className="cursor-not-allowed rounded-md p-1.5 text-foreground/30"
        >
          ⋮
        </button>
      </div>

      {/* Search */}
      <div className="px-5 pb-3">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/30">
            ⌕
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcript…"
            className="w-full rounded-lg border border-foreground/10 bg-foreground/[0.03] py-2 pl-9 pr-16 text-sm text-foreground placeholder:text-foreground/30 focus:border-violet-500/50 focus:outline-none"
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
        className="relative flex-1 overflow-y-auto px-5 outline-none"
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
                onClick={cutSelection}
                className="rounded-md bg-red-500/15 px-3 py-1 text-xs font-medium text-red-300 hover:bg-red-500/25"
              >
                Cut
              </button>
            </div>
          </div>
        )}

        {/* Speaker label */}
        {words.length > 0 && (
          <div className="mb-3 flex items-center gap-2 pt-1">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xs font-bold text-white">
              S1
            </span>
            <span className="text-sm font-semibold text-foreground/80">Speaker 1</span>
            <span className="font-mono text-xs text-foreground/30">
              {formatDuration((words[0]?.start ?? 0) * 1000)}
            </span>
          </div>
        )}

        <div className="pb-6 text-base leading-loose">
          {words.length === 0 ? (
            <p className="text-foreground/30">No transcript available.</p>
          ) : (
            words.map((word, index) => {
              const segment = segmentForWord[index];
              const isCut = segment?.status === "cut";
              const isSelected = selection.has(index);
              const isActive = index === activeIndex;
              const isMatch = matches.has(index);

              return (
                <span key={`${word.start}-${index}`}>
                  <span
                    ref={
                      isActive
                        ? activeWordRef
                        : index === firstMatchIndex
                          ? firstMatchRef
                          : undefined
                    }
                    onClick={(e) => handleWordClick(index, e.shiftKey)}
                    className={`cursor-pointer rounded px-0.5 transition-colors ${
                      isCut
                        ? "text-red-400/70 line-through decoration-red-400/50 hover:text-emerald-300/80 hover:decoration-transparent"
                        : "text-foreground/90 hover:bg-foreground/10"
                    } ${isSelected ? "bg-violet-500/30" : ""} ${
                      isMatch && !isSelected ? "bg-amber-400/25" : ""
                    } ${isActive && !isCut ? "bg-violet-500/20" : ""}`}
                    title={isCut ? "Click to restore this cut" : undefined}
                  >
                    {word.word}
                  </span>{" "}
                </span>
              );
            })
          )}
        </div>
      </div>

      {/* Suggestion card */}
      <div className="m-4 rounded-xl border border-violet-500/20 bg-violet-500/[0.07] p-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
            ✦
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {silenceCount} silence{silenceCount === 1 ? "" : "s"} auto-removed
            </p>
            <p className="truncate text-xs text-foreground/50">
              Filler-word cleanup (“um”, “uh”) coming soon
            </p>
          </div>
          <button
            type="button"
            disabled
            title="AI cleanup coming soon"
            className="cursor-not-allowed rounded-lg bg-foreground/10 px-3 py-1.5 text-xs font-medium text-foreground/40"
          >
            Review
          </button>
        </div>
      </div>
    </div>
  );
}
