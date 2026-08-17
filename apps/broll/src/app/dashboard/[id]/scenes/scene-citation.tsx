"use client";

import { citationParts } from "@/lib/citation";
import type { SceneChart } from "@/lib/scene-schema";

export function SceneCitation({
  sourceText,
  chart,
}: {
  sourceText: string;
  chart: SceneChart;
}) {
  const parts = citationParts(sourceText, chart);
  if (parts.length === 0) return null;

  return (
    <p className="text-xs leading-relaxed text-zinc-400">
      <span className="mr-1.5 font-semibold text-zinc-300">Read from:</span>
      {parts.map((part, i) => {
        if (part.kind === "figure") {
          return (
            <strong
              key={i}
              className="font-bold underline decoration-[var(--broll-accent)]"
              style={{ color: "var(--broll-accent)" }}
            >
              {part.text}
            </strong>
          );
        }
        if (part.kind === "cited") {
          return (
            <span key={i} className="text-zinc-200">
              {part.text}
            </span>
          );
        }
        return (
          <span key={i} className="opacity-60 text-zinc-400">
            {part.text}
          </span>
        );
      })}
    </p>
  );
}
