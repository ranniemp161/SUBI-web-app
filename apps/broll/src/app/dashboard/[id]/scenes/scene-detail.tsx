"use client";

import type { RefObject } from "react";
import type { SceneSummary } from "@/lib/scenes";
import type { CharacterEmotion } from "@/lib/emotions";
import { formatClock } from "@/lib/utterances";
import { sceneDrawsChart } from "@/lib/scene-templates";
import type { Renderable } from "@/lib/render/renderable";
import { ScenePreview } from "./scene-preview";
import { SceneCitation } from "./scene-citation";
import { SceneOverrides, type ScenePatch } from "./scene-overrides";
import { RenderSceneButton } from "./render-scene-button";
import type { TranscriptChoice } from "./add-scene";
import type { ScenePhase } from "./use-render-queue";

/**
 * The one open scene: what it looks like, what a creator may change, and where
 * its numbers came from (spec `broll/0006` AC-102).
 *
 * **The order is preview, controls, provenance, and it is deliberate.** The
 * preview is what a creator is judging, the controls are what they do about it,
 * and the proof is what they check before putting their name on the clip. Read
 * top to bottom that is the actual sequence of the decision; any other order
 * asks them to scroll back up after changing something.
 *
 * A manual scene has no cited line, no chart and no downgrade note, because
 * spec `0002`'s invariant makes all three NULL on a scene the creator added. So
 * its provenance block says the one true thing there is to say: where it was
 * placed, and the transcript line it sits on.
 */

export function SceneDetail({
  projectId,
  scene,
  position,
  renderable,
  renderState,
  committedEmotions,
  transcriptChoices,
  aspectWidth,
  aspectHeight,
  locked,
  reducedMotion,
  firstControlRef,
  flushRef,
  onChange,
  onDelete,
  onRender,
}: {
  projectId: string;
  scene: SceneSummary;
  /** 1 based position in plan order, which is what the clip filename carries. */
  position: number;
  renderable: Renderable | null;
  renderState: ScenePhase | undefined;
  committedEmotions: CharacterEmotion[];
  /** The stored document's lines, used to place a manual scene (AC-102). */
  transcriptChoices: TranscriptChoice[];
  aspectWidth: number;
  aspectHeight: number;
  locked: boolean;
  reducedMotion: boolean;
  /** Where Enter from the list lands (AC-107). */
  firstControlRef: RefObject<HTMLInputElement | null>;
  flushRef: RefObject<(() => void) | null>;
  onChange: (patch: ScenePatch) => void;
  onDelete: () => void;
  onRender: () => void;
}) {
  const drawsChart = sceneDrawsChart(scene);

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-space-grotesk)" }}>
          <span className="broll-tabular" style={{ color: "var(--broll-accent)" }}>
            {formatClock(scene.startMs)}
          </span>{" "}
          <span style={{ color: "var(--broll-muted)" }}>· scene {position}</span>
        </h2>
        <span className="broll-tabular text-sm" style={{ color: "var(--broll-muted)" }}>
          {(scene.durationMs / 1000).toFixed(1)}s · {scene.layoutTemplate}
        </span>
      </header>

      {renderable ? (
        <div className="grid gap-3">
          <ScenePreview
            renderable={renderable}
            durationMs={scene.durationMs}
            aspectWidth={aspectWidth}
            aspectHeight={aspectHeight}
            reducedMotion={reducedMotion}
          />
          <RenderSceneButton
            width={aspectWidth}
            height={aspectHeight}
            state={renderState}
            disabled={locked}
            onRender={onRender}
          />
        </div>
      ) : (
        <p className="broll-glass rounded-lg px-4 py-3 text-sm" role="status">
          <strong>{scene.layoutTemplate}</strong> has no renderer yet, so this scene
          cannot be previewed or exported. Pick a template this project can draw.
        </p>
      )}

      <SceneOverrides
        projectId={projectId}
        sceneId={scene.id}
        included={scene.included}
        overlayText={scene.overlayText}
        layoutTemplate={scene.layoutTemplate}
        emotion={scene.emotion}
        origin={scene.origin}
        hasChart={scene.chart !== null}
        committedEmotions={committedEmotions}
        disabled={locked}
        firstControlRef={firstControlRef}
        flushRef={flushRef}
        onChange={onChange}
        onDelete={onDelete}
      />

      <Provenance
        scene={scene}
        drawsChart={drawsChart}
        transcriptChoices={transcriptChoices}
      />
    </div>
  );
}

/**
 * Where this scene came from (AC-102).
 *
 * This is the product made visible. Every figure on a chart was proved against
 * the creator's own words before it was stored, and this is where they can see
 * that for themselves rather than take it on trust, which is the difference
 * between publishing under your own name and hoping.
 */
function Provenance({
  scene,
  drawsChart,
  transcriptChoices,
}: {
  scene: SceneSummary;
  drawsChart: boolean;
  transcriptChoices: TranscriptChoice[];
}) {
  if (scene.origin === "manual") {
    const line = lineUnder(transcriptChoices, scene.startMs);
    return (
      <section className="grid gap-2 border-t pt-4" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <h3
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--broll-muted)" }}
        >
          Where this came from
        </h3>
        <p className="text-sm">
          You added this scene by hand, placed at{" "}
          <span className="broll-tabular" style={{ color: "var(--broll-accent)" }}>
            {formatClock(scene.startMs)}
          </span>
          .
        </p>
        {line && (
          <p className="text-sm leading-relaxed" style={{ color: "var(--broll-muted)" }}>
            It sits on this line: “{line.text}”
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="grid gap-2 border-t pt-4" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
      <h3
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: "var(--broll-muted)" }}
      >
        Where this came from
      </h3>

      {/* The full text, never clamped. The row's three line clamp is a scanning
          decision, and this is the place it is always recoverable (AC-97). */}
      {scene.sourceText && (
        <p className="text-sm leading-relaxed">{scene.sourceText}</p>
      )}

      {/* Keyed off the same predicate the row marker and the chart chip use, so
          a row promising a traced chart and a pane showing no citation is not a
          state this screen can reach (AC-105). */}
      {drawsChart && scene.chart && scene.sourceText && (
        <SceneCitation sourceText={scene.sourceText} chart={scene.chart} />
      )}

      {/* A downgrade reads as a decision rather than a bug, and it survives a
          reload because it is a column (AC-87). */}
      {scene.chartRejectionReason && (
        <p className="text-sm" style={{ color: "var(--broll-muted)" }}>
          <strong>Shown as text, not a chart:</strong> {scene.chartRejectionReason}. The
          number stays out rather than being guessed at.
        </p>
      )}
    </section>
  );
}

/** The transcript line a manual scene was placed on: the last one at or before it. */
function lineUnder(choices: TranscriptChoice[], startMs: number): TranscriptChoice | null {
  let found: TranscriptChoice | null = null;
  for (const choice of choices) {
    if (choice.startMs > startMs) break;
    found = choice;
  }
  return found;
}
