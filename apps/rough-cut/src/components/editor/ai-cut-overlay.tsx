"use client";

import { useEffect, useState } from "react";
import ProgressRing from "@/components/progress-ring";

/**
 * Centered progress overlay while the AI pass runs. Gemini gives no progress
 * signal — it's a single call — so the percent is a transcript-size-calibrated
 * estimate that climbs to 95% and completes when the response lands (this
 * overlay unmounts the moment aiBusy clears).
 */
export function AiCutOverlay({ wordCount }: { wordCount: number }) {
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
