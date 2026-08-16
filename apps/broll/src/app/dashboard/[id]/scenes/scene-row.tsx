"use client";

import type { SceneSummary } from "@/lib/scenes";
import { formatClock } from "@/lib/utterances";
import {
  STRENGTH_METER_STEPS,
  strengthBand,
  strengthSteps,
} from "@/lib/scene-strength";
import { sceneDrawsChart } from "@/lib/scene-templates";
import type { Renderable } from "@/lib/render/renderable";
import { SceneStill, StillPlaceholder } from "./scene-still";
import type { ScenePhase } from "./use-render-queue";

/**
 * One scene at rest, built to be judged in about two seconds
 * (spec `broll/0006` AC-97 to AC-100, AC-104, AC-108).
 *
 * The row answers four questions without being opened: when in the edit this
 * sits, what was said there, how strongly the planner rated it, and whether
 * anything unusual is true of it. Everything else belongs in the detail pane.
 *
 * **The source line is what makes a scene identifiable**, so it wraps over up to
 * three lines rather than truncating to a fragment (AC-97). A row reading "was
 * the deadline" identifies nothing, which is the failure the UI brief called out
 * by name. The full text is always in the detail pane, so the clamp loses
 * nothing that cannot be recovered by opening it.
 *
 * **No state is carried by colour or opacity alone** (AC-99). Every marker is a
 * word, and an excluded row stays exactly as legible as an included one. The
 * 55 percent dim the old list used made the scenes a creator had already judged
 * the hardest ones to read, which is backwards.
 */

/** The still's width, at the project's output aspect ratio. */
const STILL_WIDTH = 96;

export function SceneRow({
  scene,
  position,
  selected,
  renderable,
  renderState,
  aspectWidth,
  aspectHeight,
  locked,
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
  onSelect: () => void;
  onToggleInclude: (included: boolean) => void;
}) {
  const band = strengthBand(scene.strength);
  const drawsChart = sceneDrawsChart(scene);

  return (
    <li
      className="rounded-lg"
      style={{
        // The selected row is the one the detail pane is showing, so it is
        // marked with the brand rather than with a shade of grey.
        border: selected
          ? "1px solid var(--broll-accent)"
          : "1px solid rgba(255,255,255,0.08)",
        background: selected ? "rgba(255,252,0,0.05)" : "rgba(255,255,255,0.02)",
      }}
    >
      <div className="flex gap-3 px-3 py-3">
        {/* The include toggle is deliberately outside the select button: a
            creator scanning the list excludes weak scenes without ever opening
            one, and nesting a checkbox inside a button is not clickable. Both
            this and the detail pane's toggle write through the same PATCH, so
            the two can never disagree (AC-104). */}
        <label className="flex shrink-0 items-start pt-0.5">
          <input
            type="checkbox"
            checked={scene.included}
            disabled={locked}
            tabIndex={selected ? 0 : -1}
            onChange={(event) => onToggleInclude(event.target.checked)}
            aria-label={`Include scene ${position} at ${formatClock(scene.startMs)} in the export`}
          />
        </label>

        <button
          type="button"
          onClick={onSelect}
          tabIndex={selected ? 0 : -1}
          aria-current={selected ? "true" : undefined}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-baseline gap-2">
            <span
              className="broll-tabular text-sm font-semibold"
              style={{ color: "var(--broll-accent)" }}
            >
              {formatClock(scene.startMs)}
            </span>
            <span className="broll-tabular text-xs" style={{ color: "var(--broll-muted)" }}>
              {(scene.durationMs / 1000).toFixed(1)}s
            </span>
            <StrengthMeter band={band} steps={strengthSteps(scene.strength)} />
          </div>

          {/* Clamped to three lines, never to a single fragment (AC-97). */}
          <p
            className="mt-1 text-sm leading-relaxed"
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 3,
              overflow: "hidden",
            }}
          >
            {scene.sourceText ?? (
              <span style={{ color: "var(--broll-muted)" }}>
                A scene you added by hand
              </span>
            )}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {!scene.included && <Marker>Excluded</Marker>}
            {scene.chartRejectionReason !== null && <Marker>Downgraded to text</Marker>}
            {scene.origin === "manual" && <Marker>Added by hand</Marker>}
            {drawsChart && <Marker accent>Chart traced</Marker>}
          </div>
        </button>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {renderable ? (
            <SceneStill
              renderable={renderable}
              width={STILL_WIDTH}
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
          <RenderState state={renderState} />
        </div>
      </div>
    </li>
  );
}

/**
 * The planner's score, as a short meter and the word for it (AC-98).
 *
 * A scene with no score shows neither, never a zero: the manual scenes were
 * never ranked, and an empty meter beside a full one would read as the planner
 * having judged this one worthless.
 */
function StrengthMeter({
  band,
  steps,
}: {
  band: ReturnType<typeof strengthBand>;
  steps: number;
}) {
  if (!band) return null;

  return (
    <span className="flex items-center gap-1.5" title={`Planner strength: ${band}`}>
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: STRENGTH_METER_STEPS }, (_, i) => (
          <span
            key={i}
            className="rounded-[1px]"
            style={{
              width: 4,
              height: 10,
              background:
                i < steps ? "var(--broll-accent)" : "rgba(255,255,255,0.15)",
            }}
          />
        ))}
      </span>
      {/* The word carries the state, not the bars. A meter alone is colour and
          shape only, which AC-99 rules out. */}
      <span className="text-xs" style={{ color: "var(--broll-muted)" }}>
        {band}
      </span>
    </span>
  );
}

/** A labelled state pill. Always a word, never a colour on its own (AC-99). */
function Marker({
  children,
  accent = false,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{
        border: `1px solid ${accent ? "var(--broll-brand-muted)" : "rgba(255,255,255,0.15)"}`,
        color: accent ? "var(--broll-accent)" : "var(--broll-muted)",
      }}
    >
      {children}
    </span>
  );
}

/**
 * What this scene's encode is doing, read from the one queue that knows
 * (AC-108).
 *
 * Absent means not yet rendered this session, which is also what a reload
 * gives: the state is the browser's and is never stored, so the row cannot
 * claim a status the page has no way to know.
 */
function RenderState({ state }: { state: ScenePhase | undefined }) {
  if (!state) return null;

  const text =
    state.phase === "queued"
      ? "Queued"
      : state.phase === "rendering"
        ? `${Math.round(state.ratio * 100)}%`
        : state.phase === "done"
          ? "Rendered"
          : "Failed";

  return (
    <span
      className="broll-tabular text-[10px]"
      style={{
        color: state.phase === "failed" ? "#ff6b6b" : "var(--broll-muted)",
      }}
      role={state.phase === "failed" ? "alert" : undefined}
    >
      {text}
    </span>
  );
}
