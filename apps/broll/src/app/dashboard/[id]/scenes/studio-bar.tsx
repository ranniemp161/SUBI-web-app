"use client";

import { useState } from "react";
import { Badge, Button } from "@/components/ui";

/**
 * The bar: what this plan is, and every way to leave it
 * (spec `broll/0006` AC-106, AC-114, AC-116).
 */
export function StudioBar({
  sceneCount,
  includedCount,
  droppedCharts,
  touchedCount,
  manualCount,
  plannerCount,
  exportableCount,
  blockedCount,
  needingImagesCount,
  missingImagesPrice,
  drawingObjects,
  objectBatchError,
  readyCount,
  isRerun,
  rerunPrice,
  planPhaseLabel,
  planning,
  rendering,
  atManualCap,
  stale,
  adding,
  zipError,
  onPlan,
  onAddScene,
  onRenderAll,
  onCancelRender,
  onDownload,
  onDrawMissingObjects,
}: {
  sceneCount: number;
  includedCount: number;
  droppedCharts: number;
  touchedCount: number;
  manualCount: number;
  plannerCount: number;
  exportableCount: number;
  /**
   * Included scenes that cannot render because the project has no character for
   * them (AC-138). Stated **before** Render all rather than discovered after it:
   * the batch skips them and still zips the rest, which is silent unless the bar
   * says so, and eleven clips arriving when twelve were asked for is exactly the
   * kind of thing a creator notices only on the timeline.
   */
  blockedCount: number;
  /**
   * Included scenes blocked only because their illustration has not been drawn
   * yet (spec `broll/0008`).
   *
   * **Separate from `blockedCount` because this one is fixable from here.**
   * Illustrations are drawn on demand so a creator pays only for the ones they
   * keep, but the brief also promises that plan-then-export-all produces usable
   * output — so the gap is offered as one action with its total price before the
   * export, rather than discovered as missing clips afterwards.
   */
  needingImagesCount: number;
  /** The total to draw them all, formatted server side. */
  missingImagesPrice: string;
  drawingObjects: boolean;
  objectBatchError: string | null;
  readyCount: number;
  isRerun: boolean;
  rerunPrice: string;
  planPhaseLabel: string | null;
  planning: boolean;
  rendering: boolean;
  atManualCap: boolean;
  stale: boolean;
  adding: boolean;
  zipError: string | null;
  onPlan: () => void;
  onAddScene: () => void;
  onRenderAll: () => void;
  onCancelRender: () => void;
  onDownload: () => void;
  onDrawMissingObjects: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const startPlan = () => {
    if (planning) return;
    if (rendering) {
      setRefusal(
        "Clips are still encoding. Wait for the render to finish, or stop it, before re-running the plan — a re-run would replace the scenes those clips are being made from."
      );
      return;
    }
    setRefusal(null);
    if (isRerun) {
      setConfirming(true);
      return;
    }
    onPlan();
  };

  const unrenderedCount = Math.max(0, includedCount - readyCount);

  return (
    <div>
      <div
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-2.5"
        style={{ minHeight: 52 }}
      >
        <div className="flex items-center gap-2.5 text-xs flex-wrap">
          <p className="broll-tabular font-medium" role="status" aria-live="polite">
            {planning ? (
              <span className="font-bold" style={{ color: "var(--broll-accent)" }}>
                {planPhaseLabel ?? "Working"}…
              </span>
            ) : sceneCount === 0 ? (
              <span style={{ color: "var(--broll-muted)" }}>No scenes yet</span>
            ) : (
              <span className="text-zinc-300">
                <strong className="text-white">{sceneCount}</strong> scenes ·{" "}
                <strong className="text-white">{includedCount}</strong> included
                {droppedCharts > 0 && (
                  <span className="text-zinc-400">
                    {" · "}
                    <strong className="text-zinc-300">{droppedCharts}</strong> chart{droppedCharts === 1 ? "" : "s"} dropped
                  </span>
                )}
                {blockedCount > needingImagesCount && (
                  <span className="text-amber-300/90">
                    {" · "}
                    <strong>{blockedCount - needingImagesCount}</strong> need
                    {blockedCount - needingImagesCount === 1 ? "s" : ""} a character
                  </span>
                )}
                {needingImagesCount > 0 && (
                  <span className="text-amber-300/90">
                    {" · "}
                    <strong>{needingImagesCount}</strong> need
                    {needingImagesCount === 1 ? "s" : ""} an illustration
                  </span>
                )}
                {readyCount > 0 && (
                  <span className="text-zinc-400">
                    {" · "}
                    <strong className="text-emerald-400">{readyCount}</strong> rendered
                  </span>
                )}
              </span>
            )}
          </p>

          {stale && (
            <Badge
              variant="warning"
              title="The Ruff Cut edit has changed since this transcript was taken, so these timecodes may no longer match it."
            >
              Timecodes may be stale
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {includedCount > 0 && unrenderedCount > 0 && (
            <span className="text-xs text-zinc-400 broll-tabular hidden sm:inline mr-1">
              {unrenderedCount} clip{unrenderedCount === 1 ? "" : "s"} unrendered
            </span>
          )}

          <Button
            type="button"
            variant="glass"
            size="sm"
            onClick={onAddScene}
            disabled={planning || atManualCap || adding}
            title={
              atManualCap ? "You've added the maximum number of scenes by hand." : undefined
            }
          >
            {atManualCap ? "Manual scene limit reached" : "Add scene"}
          </Button>

          <Button
            type="button"
            variant="glass"
            size="sm"
            onClick={startPlan}
            disabled={planning}
          >
            {planning ? "Planning…" : isRerun ? `Re-run plan · ${rerunPrice}` : "Plan scenes"}
          </Button>

          {/* Offered before Render all rather than after it, and priced on the
              button: the batch would otherwise skip these silently, and clips
              arriving short is exactly what a creator notices only on the
              timeline. */}
          {needingImagesCount > 0 && !rendering && (
            <Button
              type="button"
              variant="glass"
              size="sm"
              onClick={onDrawMissingObjects}
              disabled={planning || drawingObjects}
            >
              {drawingObjects
                ? "Drawing…"
                : `Draw ${needingImagesCount} illustration${needingImagesCount === 1 ? "" : "s"} · ${missingImagesPrice}`}
            </Button>
          )}

          {rendering ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={onCancelRender}
            >
              Stop render
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onRenderAll}
              disabled={planning || exportableCount === 0}
              title={exportGateReason(sceneCount, includedCount, exportableCount)}
            >
              Render all {exportableCount > 0 ? exportableCount : ""}
            </Button>
          )}

          {readyCount > 0 && (
            <Button
              type="button"
              variant="glass"
              size="sm"
              onClick={onDownload}
              disabled={readyCount === 0 || rendering}
            >
              Download zip
            </Button>
          )}
        </div>
      </div>

      {!planning && sceneCount > 0 && exportableCount === 0 && (
        <p
          className="px-6 pb-2 text-xs text-zinc-400"
          role="status"
        >
          {exportGateReason(sceneCount, includedCount, exportableCount)}
        </p>
      )}

      {refusal && (
        <p className="px-6 pb-2 text-xs" role="alert" style={{ color: "#ff6b6b" }}>
          {refusal}
        </p>
      )}

      {zipError && (
        <p className="px-6 pb-2 text-xs" role="alert" style={{ color: "#ff6b6b" }}>
          {zipError}
        </p>
      )}

      {objectBatchError && (
        <p className="px-6 pb-2 text-xs" role="alert" style={{ color: "#ff6b6b" }}>
          {objectBatchError}
        </p>
      )}

      {confirming && (
        <div className="broll-glow mx-6 mb-3 rounded-xl p-4">
          <p className="text-xs leading-relaxed text-zinc-200">
            Re-running costs <strong>{rerunPrice}</strong>
            {plannerCount > 0
              ? ` and replaces the ${plannerCount} planned scene${plannerCount === 1 ? "" : "s"}.`
              : ". There are no planned scenes to replace."}
            {plannerCount > 0 &&
              (touchedCount > 0 ? (
                <>
                  {" "}
                  <strong>
                    {touchedCount} of them {touchedCount === 1 ? "has" : "have"} edits you
                    made
                  </strong>
                  , and those edits will be lost.
                </>
              ) : (
                " You haven't edited any of them yet."
              ))}{" "}
            {manualCount > 0
              ? `The ${manualCount} scene${manualCount === 1 ? "" : "s"} you added by hand ${manualCount === 1 ? "is" : "are"} kept.`
              : "Scenes you add by hand are always kept."}
          </p>
          <div className="mt-3 flex gap-2.5">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                setConfirming(false);
                onPlan();
              }}
            >
              Re-run for {rerunPrice}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

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
