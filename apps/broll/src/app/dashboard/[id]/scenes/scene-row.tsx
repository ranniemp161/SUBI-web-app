"use client";

import type { SceneSummary } from "@/lib/scenes";
import { formatClock } from "@/lib/utterances";
import {
  STRENGTH_METER_STEPS,
  strengthBand,
  strengthSteps,
} from "@/lib/scene-strength";
import { blockerBadge, sceneDrawsChart, type SceneBlocker } from "@/lib/scene-templates";
import type { Renderable } from "@/lib/render/renderable";
import { Badge } from "@/components/ui";
import { SceneStill, StillPlaceholder } from "./scene-still";
import type { ScenePhase } from "./use-render-queue";

/** The still's width, at the project's output aspect ratio. */
const STILL_WIDTH = 84;

export function SceneRow({
  scene,
  position,
  selected,
  renderable,
  renderState,
  aspectWidth,
  aspectHeight,
  locked,
  blocker,
  onSelect,
  onToggleInclude,
}: {
  scene: SceneSummary;
  /** 1 based position in plan order, which is what the clip filename carries. */
  position: number;
  selected: boolean;
  /** Null when this scene's template has no drawer yet. */
  renderable: Renderable | null;
  renderState: ScenePhase | undefined;
  aspectWidth: number;
  aspectHeight: number;
  /** True while a plan run is in flight: the whole list is inert (AC-116). */
  locked: boolean;
  /**
   * Why this scene cannot render, or null (AC-138). Computed by the shell from
   * the server's committed emotions, so it is settled before the first paint
   * rather than arriving with the decoded bitmaps.
   */
  blocker: SceneBlocker | null;
  onSelect: () => void;
  onToggleInclude: (included: boolean) => void;
}) {
  const band = strengthBand(scene.strength);
  const drawsChart = sceneDrawsChart(scene);

  return (
    <li
      className={`rounded-xl transition-all duration-150 relative ${
        selected
          ? "bg-[#14151a] border border-[var(--broll-accent)] shadow-[0_0_20px_rgba(255,252,0,0.12)]"
          : "bg-[#111215] border border-white/[0.07] hover:border-white/20"
      }`}
    >
      <div className="flex gap-2.5 p-3 items-start">
        {/* Custom checkbox */}
        <label className="flex shrink-0 items-start pt-0.5 cursor-pointer">
          <input
            type="checkbox"
            checked={scene.included}
            disabled={locked}
            tabIndex={selected ? 0 : -1}
            onChange={(event) => onToggleInclude(event.target.checked)}
            aria-label={`Include scene ${position} at ${formatClock(scene.startMs)} in the export`}
            className="broll-checkbox"
          />
        </label>

        <button
          type="button"
          onClick={onSelect}
          tabIndex={selected ? 0 : -1}
          aria-current={selected ? "true" : undefined}
          className="min-w-0 flex-1 text-left cursor-pointer focus:outline-none"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="broll-tabular text-xs font-bold"
              style={{ color: "var(--broll-accent)" }}
            >
              {formatClock(scene.startMs)}
            </span>
            <span className="broll-tabular text-[11px] text-zinc-400 font-medium">
              {(scene.durationMs / 1000).toFixed(1)}s
            </span>
            <StrengthBadge band={band} steps={strengthSteps(scene.strength)} />
          </div>

          {/* Clamped to two or three lines */}
          <p
            className="mt-1.5 text-xs leading-relaxed text-zinc-300"
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
            }}
          >
            {scene.sourceText ?? (
              <span className="text-zinc-500 italic">
                A scene you added by hand
              </span>
            )}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {!scene.included && <Badge size="sm" variant="neutral">Excluded</Badge>}
            {scene.chartRejectionReason !== null && <Badge size="sm" variant="warning">Downgraded to text</Badge>}
            {scene.origin === "manual" && <Badge size="sm" variant="neutral">Added by hand</Badge>}
            {drawsChart && <Badge size="sm" variant="accent">Chart traced</Badge>}
            {/* Stated on the row, not only when a render is attempted (AC-138):
                the point is that a creator scanning the list can see which
                scenes have nothing to draw before pressing Render all. */}
            {blocker && (
              <Badge
                size="sm"
                variant={blockerBadge(blocker).variant}
                title={blocker.reason}
              >
                {blockerBadge(blocker).label}
              </Badge>
            )}
          </div>
        </button>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="rounded-md overflow-hidden border border-white/10 relative">
            {renderable ? (
              <SceneStill
                renderable={renderable}
                width={STILL_WIDTH}
                durationMs={scene.durationMs}
                aspectWidth={aspectWidth}
                aspectHeight={aspectHeight}
                label={`Scene ${position} at ${formatClock(scene.startMs)}`}
              />
            ) : (
              <StillPlaceholder
                width={STILL_WIDTH}
                aspectWidth={aspectWidth}
                aspectHeight={aspectHeight}
                template={scene.layoutTemplate}
              />
            )}
            <span className="absolute bottom-1 right-1 px-1 py-0.2 rounded text-[8px] font-bold tracking-wider uppercase bg-black/80 text-zinc-300 border border-white/10">
              {blocker?.code === "no_object_image"
                ? "NOT DRAWN"
                : drawsChart
                  ? "CHART"
                  : renderable
                    ? "PREVIEW"
                    : "NO PREVIEW"}
            </span>
          </div>
          <RenderState state={renderState} />
        </div>
      </div>
    </li>
  );
}

/** Strength Badge */
function StrengthBadge({
  band,
  steps,
}: {
  band: ReturnType<typeof strengthBand>;
  steps: number;
}) {
  if (!band) return null;

  const isStrong = band.toLowerCase() === "strong";
  const isMedium = band.toLowerCase() === "medium";

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
        isStrong
          ? "bg-amber-400/10 text-amber-300 border border-amber-400/30"
          : isMedium
            ? "bg-orange-400/10 text-orange-300 border border-orange-400/30"
            : "bg-zinc-800 text-zinc-400 border border-zinc-700"
      }`}
      title={`Planner strength: ${band}`}
    >
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: STRENGTH_METER_STEPS }, (_, i) => (
          <span
            key={i}
            className="rounded-[1px]"
            style={{
              width: 2.5,
              height: 7,
              background:
                i < steps
                  ? isStrong
                    ? "var(--broll-accent)"
                    : isMedium
                      ? "#fb923c"
                      : "#a1a1aa"
                  : "rgba(255,255,255,0.15)",
            }}
          />
        ))}
      </span>
      <span>{band}</span>
    </span>
  );
}

function RenderState({ state }: { state: ScenePhase | undefined }) {
  if (!state) return null;

  const text =
    state.phase === "queued"
      ? "Queued"
      : state.phase === "rendering"
        ? `${Math.round(state.ratio * 100)}%`
        : state.phase === "done"
          ? "Rendered"
          : // "Skipped", not "Failed": nothing went wrong and retrying changes
            // nothing, so the word has to point at the fix (AC-138).
            state.phase === "blocked"
            ? "Skipped"
            : "Failed";

  return (
    <span
      className="broll-tabular text-[10px] font-semibold"
      style={{
        color:
          state.phase === "failed"
            ? "#ff6b6b"
            : state.phase === "done"
              ? "#34d399"
              : state.phase === "blocked"
                ? "#fbbf24"
                : "var(--broll-muted)",
      }}
      title={state.phase === "blocked" ? state.message : undefined}
      role={state.phase === "failed" ? "alert" : undefined}
    >
      {text}
    </span>
  );
}
