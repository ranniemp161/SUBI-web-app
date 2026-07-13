"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import type { EDL, EDLSegment } from "@/lib/edl";

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
export function RetakeReviewQueue({ edl, onSeek, onRestoreSegment, onClose }: RetakeReviewQueueProps) {
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
