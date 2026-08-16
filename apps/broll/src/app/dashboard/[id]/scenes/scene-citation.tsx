"use client";

import { citationParts } from "@/lib/citation";
import type { SceneChart } from "@/lib/scene-schema";

/**
 * Where a chart's numbers came from, shown on the scene itself
 * (spec `broll/0005` AC-86).
 *
 * This is the product made visible. Every figure on screen was proved against
 * the creator's own words before it was stored, and this is where a creator can
 * see that for themselves rather than take it on trust — which is the
 * difference between publishing under your own name and hoping.
 *
 * **Shown only while the scene's current template actually draws a chart.** A
 * scene styled away from `chart-full` keeps its `chart` value, so the citation
 * is keyed off the template rather than off the column being present: a
 * citation beside a text card would point at numbers nobody is going to see.
 */
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
    <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--broll-muted)" }}>
      <span className="mr-1">Read from:</span>
      {parts.map((part, i) => {
        if (part.kind === "figure") {
          return (
            <strong key={i} style={{ color: "var(--broll-accent)" }}>
              {part.text}
            </strong>
          );
        }
        if (part.kind === "cited") {
          return (
            <span key={i} style={{ color: "var(--broll-fg, inherit)" }}>
              {part.text}
            </span>
          );
        }
        return (
          <span key={i} style={{ opacity: 0.6 }}>
            {part.text}
          </span>
        );
      })}
    </p>
  );
}
