"use client";

import { useState } from "react";

/**
 * The bar: what this plan is, and every way to leave it
 * (spec `broll/0006` AC-106, AC-114, AC-116).
 *
 * Three regions, one job each: the bar is state and departure, the list is
 * judgement, the detail pane is the single scene. Because the page body never
 * scrolls, this is reachable from any scroll position without being sticky
 * about it, which is half of the feature's own definition of done: finishing
 * should never be a hunt.
 *
 * Two refusals live here rather than in the shell, because both are things a
 * creator presses and must be told about:
 *
 * - **Export with nothing included** is disabled and says what is needed
 *   (spec `0005` AC-90). An empty archive is not an export.
 * - **A plan run while a render is in flight** is refused with a reason
 *   (AC-116). Encoding clips for scenes a re-run is about to replace wastes the
 *   creator's laptop on work that is already void.
 */

export function StudioBar({
  sceneCount,
  includedCount,
  droppedCharts,
  touchedCount,
  manualCount,
  plannerCount,
  exportableCount,
  readyCount,
  isRerun,
  rerunPrice,
  planPhaseLabel,
  planning,
  rendering,
  atManualCap,
  stale,
  adding,
  onPlan,
  onAddScene,
  onRenderAll,
  onCancelRender,
  onDownload,
}: {
  sceneCount: number;
  includedCount: number;
  droppedCharts: number;
  /** Planner scenes carrying a creator's edits, from `user_edited_at` (AC-89). */
  touchedCount: number;
  manualCount: number;
  plannerCount: number;
  /** Included scenes whose template can actually be drawn. */
  exportableCount: number;
  readyCount: number;
  isRerun: boolean;
  /** Formatted server side: the price env override is not public. */
  rerunPrice: string;
  planPhaseLabel: string | null;
  planning: boolean;
  rendering: boolean;
  atManualCap: boolean;
  /** The Ruff Cut edit has moved since this transcript was taken (AC-114). */
  stale: boolean;
  adding: boolean;
  onPlan: () => void;
  onAddScene: () => void;
  onRenderAll: () => void;
  onCancelRender: () => void;
  onDownload: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const startPlan = () => {
    if (planning) return;
    if (rendering) {
      // Named rather than silently disabled: a button that does nothing when
      // pressed teaches nothing about why.
      setRefusal(
        "Clips are still encoding. Wait for the render to finish, or stop it, before re-running the plan — a re-run would replace the scenes those clips are being made from."
      );
      return;
    }
    setRefusal(null);
    if (isRerun && sceneCount > 0) {
      setConfirming(true);
      return;
    }
    onPlan();
  };

  return (
    <div>
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6"
        style={{ minHeight: 56 }}
      >
        <p className="broll-tabular text-sm" role="status" aria-live="polite">
          {planning ? (
            <span style={{ color: "var(--broll-accent)" }}>
              {planPhaseLabel ?? "Working"}…
            </span>
          ) : sceneCount === 0 ? (
            <span style={{ color: "var(--broll-muted)" }}>No scenes yet</span>
          ) : (
            <>
              {sceneCount} scene{sceneCount === 1 ? "" : "s"}
              <span style={{ color: "var(--broll-muted)" }}>
                {" · "}
                {includedCount} included
                {droppedCharts > 0 &&
                  ` · ${droppedCharts} chart${droppedCharts === 1 ? "" : "s"} dropped`}
                {readyCount > 0 && ` · ${readyCount} rendered`}
              </span>
            </>
          )}
        </p>

        {stale && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={{ border: "1px solid var(--broll-accent)", color: "var(--broll-accent)" }}
            title="The Ruff Cut edit has changed since this transcript was taken, so these timecodes may no longer match it."
          >
            Timecodes may be stale
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={startPlan}
            disabled={planning}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60"
            style={{
              background: "var(--broll-accent)",
              color: "var(--broll-accent-foreground)",
            }}
          >
            {planning ? "Planning…" : sceneCount > 0 ? `Re-run plan ${rerunPrice}` : "Plan scenes"}
          </button>

          <button
            type="button"
            onClick={onAddScene}
            disabled={planning || atManualCap || adding}
            title={
              atManualCap ? "You've added the maximum number of scenes by hand." : undefined
            }
            className="broll-glass rounded-md px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {atManualCap ? "Manual scene limit reached" : "Add a scene"}
          </button>

          {rendering ? (
            <button
              type="button"
              onClick={onCancelRender}
              className="broll-glass rounded-md px-3 py-1.5 text-xs"
            >
              Stop after this one
            </button>
          ) : (
            <button
              type="button"
              onClick={onRenderAll}
              disabled={planning || exportableCount === 0}
              title={exportGateReason(sceneCount, includedCount, exportableCount)}
              className="broll-glass rounded-md px-3 py-1.5 text-xs disabled:opacity-60"
            >
              Render all {exportableCount > 0 ? exportableCount : ""} clips
            </button>
          )}

          <button
            type="button"
            onClick={onDownload}
            disabled={readyCount === 0 || rendering}
            className="broll-glass rounded-md px-3 py-1.5 text-xs disabled:opacity-60"
          >
            Download zip
          </button>
        </div>
      </div>

      {/* An empty archive is not an export, so the gate says what is missing
          rather than handing over a zip with nothing in it (AC-90). */}
      {!planning && sceneCount > 0 && exportableCount === 0 && (
        <p
          className="px-6 pb-2 text-xs"
          role="status"
          style={{ color: "var(--broll-muted)" }}
        >
          {exportGateReason(sceneCount, includedCount, exportableCount)}
        </p>
      )}

      {refusal && (
        <p className="px-6 pb-2 text-xs" role="alert" style={{ color: "#ff6b6b" }}>
          {refusal}
        </p>
      )}

      {confirming && (
        <div className="broll-glow mx-6 mb-3 rounded-lg px-4 py-3">
          <p className="text-sm">
            Re-running costs <strong>{rerunPrice}</strong> and replaces the {plannerCount}{" "}
            planned scene{plannerCount === 1 ? "" : "s"}.
            {/* Named, not implied: a creator deciding whether to spend needs to
                know what the money buys and what it costs them (AC-89). */}
            {touchedCount > 0 ? (
              <>
                {" "}
                <strong>
                  {touchedCount} of them {touchedCount === 1 ? "has" : "have"} edits you made
                </strong>
                , and those edits will be lost.
              </>
            ) : (
              " You haven't edited any of them yet."
            )}{" "}
            {manualCount > 0
              ? `The ${manualCount} scene${manualCount === 1 ? "" : "s"} you added by hand ${manualCount === 1 ? "is" : "are"} kept.`
              : "Scenes you add by hand are always kept."}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onPlan();
              }}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold"
              style={{
                background: "var(--broll-accent)",
                color: "var(--broll-accent-foreground)",
              }}
            >
              Re-run for {rerunPrice}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg px-3 py-1.5 text-sm"
              style={{ color: "var(--broll-muted)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Why nothing can be exported, in the creator's terms rather than the code's. */
function exportGateReason(
  sceneCount: number,
  includedCount: number,
  exportableCount: number
): string | undefined {
  if (exportableCount > 0 || sceneCount === 0) return undefined;
  return includedCount === 0
    ? "Nothing is switched on to export yet. Tick a scene's include box on at least one row."
    : "None of the included scenes can be drawn yet. Pick a template this project can render, or generate a character set first.";
}
