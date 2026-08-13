"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideoFps } from "@repo/transcript";
import type { SceneSummary } from "@/lib/scenes";
import type { CharacterEmotion } from "@/lib/emotions";
import { MAX_MANUAL_SCENES_PER_PROJECT } from "@/lib/scene-limits";
import { formatClock } from "@/lib/utterances";
import { loadCharacterBitmaps } from "@/lib/render/character-assets";
import type { Renderable } from "@/lib/render/renderable";
import { BatchExport, type BatchScene } from "./batch-export";
import { AddScene, type TranscriptChoice } from "./add-scene";
import { SceneCitation } from "./scene-citation";
import { SceneOverrides, type ScenePatch } from "./scene-overrides";
import { RenderSceneButton } from "./render-scene-button";
import { ScenePreview } from "./scene-preview";

/**
 * Scene Studio: the Plan button, the phases while a run is in flight, and the
 * review surface over the scenes it produced (spec `broll/0003`, `broll/0005`).
 *
 * A client component because the run is a stream it has to read incrementally:
 * the route sends HTTP 200 before the model answers, so a failure arrives as
 * `{"error"}` inside the last line rather than as a status, and `res.json()`
 * would deadlock on a body that is still open.
 */

type PlanRejection = {
  utteranceIndex: number | null;
  reason: string;
  kind: "scene" | "chart";
};

type TerminalLine = {
  scenes?: SceneSummary[];
  rejected?: PlanRejection[];
  refunded?: boolean;
  error?: string;
};

const PHASE_LABELS: Record<string, string> = {
  merging: "Reading the transcript",
  planning: "Planning scenes",
  validating: "Checking every number",
};

export function PlanPanel({
  projectId,
  initialScenes,
  planRuns,
  rerunPrice,
  outputWidth,
  outputHeight,
  fps,
  committedEmotions,
  transcriptChoices,
}: {
  projectId: string;
  initialScenes: SceneSummary[];
  planRuns: number;
  /** Formatted server side: the price env override is not public. */
  rerunPrice: string;
  /** The project's output frame size, which the renderer encodes at. */
  outputWidth: number;
  outputHeight: number;
  /** The project's output rate as an exact rational, never a decimal. */
  fps: VideoFps;
  /** The emotions this project has actually generated (AC-75, AC-77). */
  committedEmotions: CharacterEmotion[];
  /** The lines a hand added scene may sit on (AC-79). */
  transcriptChoices: TranscriptChoice[];
}) {
  const [scenes, setScenes] = useState<SceneSummary[]>(initialScenes);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejections, setRejections] = useState<PlanRejection[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [bitmaps, setBitmaps] = useState<Map<string, ImageBitmap>>(new Map());

  // The emotions this plan actually uses. A plan touching three of the six
  // variants must not download the other three.
  const emotionsUsed = useMemo(
    () =>
      Array.from(
        new Set(
          scenes
            .filter(
              (scene) =>
                (scene.layoutTemplate === "character-left" ||
                  scene.layoutTemplate === "character-center") &&
                scene.emotion
            )
            .map((scene) => scene.emotion as string)
        )
      ).sort(),
    [scenes]
  );

  // Character cutouts live in a private store, so each needs a short lived
  // signed URL. Loaded once per set of emotions, on the page rather than in the
  // worker, because signing is authorized by the Clerk session.
  useEffect(() => {
    if (emotionsUsed.length === 0) return;
    let active = true;
    loadCharacterBitmaps(projectId, emotionsUsed)
      .then((loaded) => {
        if (active) setBitmaps(loaded);
      })
      .catch(() => {
        // A missing character set is not an error worth interrupting the plan
        // for: those scenes render their text and say nothing about images.
      });
    return () => {
      active = false;
    };
  }, [projectId, emotionsUsed]);

  const running = phase !== null;
  const isRerun = planRuns > 0;

  // One key for the lifetime of one run, minted when the run starts. It is the
  // only thing standing between a retried request and a second charge, so the
  // button stays disabled until the run settles rather than relying on it twice.
  const keyRef = useRef<string | null>(null);

  const run = useCallback(async () => {
    if (running) return;
    setConfirming(false);
    setError(null);
    setRejections([]);
    setPhase("merging");
    keyRef.current = crypto.randomUUID();

    try {
      const response = await fetch(`/api/projects/${projectId}/plan`, {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current },
      });

      if (!response.ok) {
        // A failure before the stream opened still answers a real status.
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The plan run failed. Try again.");
        return;
      }

      const terminal = await readPlanStream(response, setPhase);
      if (!terminal) {
        setError("The connection dropped before the plan finished. Reload to see whether it landed.");
        return;
      }
      if (terminal.error) setError(terminal.error);
      if (terminal.scenes) {
        // A re-run replaces the planner's scenes and keeps the manual ones, so
        // the list it returns is the whole truth about this project.
        setScenes(terminal.scenes);
      }
      if (terminal.rejected) setRejections(terminal.rejected);
    } catch {
      setError("The plan run failed. Try again.");
    } finally {
      setPhase(null);
      keyRef.current = null;
    }
  }, [projectId, running]);

  // Applied locally the moment a control changes, so the preview and the batch
  // react without waiting for the round trip.
  const patchScene = useCallback((sceneId: string, patch: ScenePatch) => {
    setScenes((previous) =>
      previous.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene))
    );
  }, []);

  const removeScene = useCallback((sceneId: string) => {
    setScenes((previous) => previous.filter((scene) => scene.id !== sceneId));
  }, []);

  const addScene = useCallback(
    (created: { id: string; startMs: number; durationMs: number; overlayText: string }) => {
      // Built to match exactly what the server wrote, so the row reads the same
      // before and after a reload: a manual scene has no cited line, no chart
      // and no planner score, which is spec `0002`'s NULL invariant (AC-79).
      const scene: SceneSummary = {
        id: created.id,
        startMs: created.startMs,
        durationMs: created.durationMs,
        sourceText: null,
        visualType: "text",
        emotion: null,
        layoutTemplate: "text-card",
        overlayText: created.overlayText,
        chart: null,
        chartRejectionReason: null,
        strength: null,
        included: true,
        origin: "manual",
        userEditedAt: new Date(),
      };
      setScenes((previous) =>
        [...previous, scene].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
      );
    },
    []
  );

  // Every scene that can actually be exported, in plan order.
  const batchScenes = useMemo<BatchScene[]>(
    () =>
      scenes
        // Position is taken before excluding, so a clip's number keeps matching
        // the row the creator is looking at.
        .map((scene, position) => ({ scene, position }))
        .filter(({ scene }) => scene.included)
        .map(({ scene, position }) => {
          const renderable = toRenderable(scene, bitmaps);
          return renderable
            ? {
                id: scene.id,
                index: position + 1,
                startMs: scene.startMs,
                durationMs: scene.durationMs,
                renderable,
              }
            : null;
        })
        .filter((entry): entry is BatchScene => entry !== null),
    [scenes, bitmaps]
  );

  const includedCount = scenes.filter((scene) => scene.included).length;
  const manualCount = scenes.filter((scene) => scene.origin === "manual").length;

  /**
   * How many charts the honesty check dropped, read from the scenes themselves
   * rather than from the last run's response.
   *
   * That is the whole reason `chart_rejection_reason` is a column: the count
   * used to live in this component's state and was gone on reload, so the
   * product's central promise stopped being answerable the moment the page was
   * refreshed (AC-87).
   */
  const droppedCharts = scenes.filter((scene) => scene.chartRejectionReason).length;

  /**
   * How much review work a re-run would destroy (AC-89).
   *
   * Counted from `user_edited_at` and from nothing else. `overlay_text` is
   * written by the planner at plan time and `included = false` is written by
   * the surplus rule, so either as a proxy would tell a creator who restyled
   * ten scenes that nothing was at risk, immediately before deleting all of it.
   */
  const touchedCount = scenes.filter(
    (scene) => scene.origin === "planner" && scene.userEditedAt !== null
  ).length;

  const rejectedScenes = useMemo(
    () => rejections.filter((r) => r.kind === "scene").length,
    [rejections]
  );
  // Twenty scenes failing one way is one problem, not twenty.
  const distinctReasons = useMemo(
    () => Array.from(new Set(rejections.map((r) => r.reason))).slice(0, 5),
    [rejections]
  );

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between gap-4">
        <h2
          className="text-sm font-semibold uppercase tracking-wide"
          style={{ color: "var(--broll-muted)" }}
        >
          Scenes
        </h2>

        <button
          type="button"
          onClick={() => (isRerun && scenes.length > 0 ? setConfirming(true) : run())}
          disabled={running}
          className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
          style={{
            background: "var(--broll-accent)",
            color: "var(--broll-accent-foreground)",
          }}
        >
          {running
            ? "Planning…"
            : scenes.length > 0
              ? "Re-run plan"
              : "Plan scenes"}
        </button>
      </div>

      {/* Nothing plans on its own, including the free first run (AC-56). */}
      {!running && scenes.length === 0 && !error && (
        <p className="mt-3 text-sm" style={{ color: "var(--broll-muted)" }}>
          {isRerun
            ? `Planning again costs ${rerunPrice}.`
            : "The first plan for this project is included."}
        </p>
      )}

      {confirming && (
        <div className="broll-glow mt-4 rounded-lg px-4 py-3">
          <p className="text-sm">
            Re-running costs <strong>{rerunPrice}</strong> and replaces the{" "}
            {scenes.filter((s) => s.origin === "planner").length} planned scenes below.
            {/* Named, not implied: a creator deciding whether to spend needs to
                know what the money buys and what it costs them (AC-89). */}
            {touchedCount > 0 ? (
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
            )}{" "}
            {manualCount > 0
              ? `The ${manualCount} scene${manualCount === 1 ? "" : "s"} you added by hand ${manualCount === 1 ? "is" : "are"} kept.`
              : "Scenes you add by hand are always kept."}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={run}
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

      {running && (
        <p
          className="mt-4 text-sm"
          role="status"
          aria-live="polite"
          style={{ color: "var(--broll-accent)" }}
        >
          {PHASE_LABELS[phase] ?? "Working"}…
        </p>
      )}

      {error && (
        <p className="mt-4 text-sm" role="alert" style={{ color: "#ff6b6b" }}>
          {error}
        </p>
      )}

      {(droppedCharts > 0 || rejectedScenes > 0) && (
        <div className="mt-3 text-sm" style={{ color: "var(--broll-muted)" }}>
          <p>
            {droppedCharts > 0 && (
              <>
                {droppedCharts} chart{droppedCharts === 1 ? "" : "s"} dropped because the
                numbers were not in the line they cited.{" "}
              </>
            )}
            {rejectedScenes > 0 && (
              <>
                {rejectedScenes} scene{rejectedScenes === 1 ? "" : "s"} rejected as
                malformed.
              </>
            )}
          </p>

          {/* The reason, not just the count: a run where everything was
              rejected is unfixable if all it reports is how many (AC-24). */}
          {distinctReasons.length > 0 && (
            <ul className="mt-2 grid gap-1">
              {distinctReasons.map((reason) => (
                <li key={reason} className="text-xs">
                  · {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {batchScenes.length > 0 && (
        <BatchExport batchScenes={batchScenes} width={outputWidth} height={outputHeight} fps={fps} />
      )}

      {/* An empty archive is not an export, so the gate says what is missing
          rather than handing over a zip with nothing in it (AC-90). */}
      {scenes.length > 0 && batchScenes.length === 0 && (
        <p className="broll-glass mt-6 rounded-lg px-4 py-3 text-sm" role="status">
          {includedCount === 0
            ? "Nothing is switched on to export yet. Tick “Include in export” on at least one scene."
            : "None of the included scenes can be drawn yet. Pick a template that this project can render, or generate a character set first."}
        </p>
      )}

      {scenes.length > 0 && (
        <ul className="mt-4 grid gap-2">
          {scenes.map((scene, position) => (
            <li
              key={scene.id}
              className="broll-glass rounded-lg px-4 py-3"
              style={scene.included ? undefined : { opacity: 0.55 }}
            >
              <div className="flex gap-4">
                <span
                  className="broll-tabular text-sm shrink-0 pt-0.5"
                  style={{ color: "var(--broll-accent)" }}
                >
                  {formatClock(scene.startMs)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed">
                    {scene.sourceText ?? <em>Added by hand</em>}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: "var(--broll-muted)" }}>
                    {scene.layoutTemplate}
                    {scene.emotion ? ` · ${scene.emotion}` : ""}
                    {` · ${(scene.durationMs / 1000).toFixed(1)}s`}
                    {scene.chart ? ` · chart: ${scene.chart.title}` : ""}
                    {/* A manual scene has no score, and a missing score is shown
                        as absent rather than as zero — zero would read as "the
                        planner thought this was worthless" (AC-84). */}
                    {scene.strength !== null
                      ? ` · strength ${scene.strength.toFixed(2)}`
                      : " · added by hand"}
                  </p>

                  {/* Keyed off the current template, not off the column: a scene
                      styled away from chart-full keeps its chart but shows no
                      citation, because those numbers are not on screen (AC-86). */}
                  {scene.layoutTemplate === "chart-full" && scene.chart && scene.sourceText && (
                    <SceneCitation sourceText={scene.sourceText} chart={scene.chart} />
                  )}

                  {/* A downgrade reads as a decision rather than a bug, and it
                      survives a reload because it is a column (AC-87). */}
                  {scene.chartRejectionReason && (
                    <p className="mt-1 text-xs" style={{ color: "var(--broll-muted)" }}>
                      Shown as text, not a chart: {scene.chartRejectionReason}. The number
                      stays out rather than being guessed at.
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
                    onChange={(patch) => patchScene(scene.id, patch)}
                    onDelete={() => removeScene(scene.id)}
                  />

                  <SceneRenderRow
                    scene={scene}
                    bitmaps={bitmaps}
                    index={position + 1}
                    outputWidth={outputWidth}
                    outputHeight={outputHeight}
                    fps={fps}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddScene
        projectId={projectId}
        segments={transcriptChoices}
        atCap={manualCount >= MAX_MANUAL_SCENES_PER_PROJECT}
        onAdded={addScene}
      />
    </section>
  );
}

/**
 * Read the NDJSON stream, updating the phase as it goes, and return the last
 * line — the terminal one carrying the plan or the error (AC-52).
 *
 * A phase line and the heartbeat are the same shape, so anything carrying
 * `phase` updates the label and anything else is the result. Returns null if
 * the stream ended without one, which is a dropped connection rather than a
 * failed run: the route finishes its charge, call, write and refund server
 * side regardless (AC-59), so the money is settled even though the result is
 * lost on screen.
 */
async function readPlanStream(
  response: Response,
  onPhase: (phase: string) => void
): Promise<TerminalLine | null> {
  if (!response.body) {
    // No streaming body (a test double, or a proxy that buffered it): the whole
    // payload is text, and the last line is still the result.
    const text = await response.text();
    return lastJsonLine(text);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: TerminalLine | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // The last element is whatever arrived after the final newline: a partial
    // line, kept for the next chunk rather than parsed as a whole one.
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const parsed = parseLine(line);
      if (!parsed) continue;
      if (typeof parsed.phase === "string") {
        onPhase(parsed.phase);
      } else {
        terminal = parsed as TerminalLine;
      }
    }
  }

  const trailing = parseLine(buffer);
  if (trailing && typeof trailing.phase !== "string") terminal = trailing as TerminalLine;

  return terminal;
}

function parseLine(line: string): (TerminalLine & { phase?: string }) | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function lastJsonLine(text: string): TerminalLine | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = parseLine(lines[i]);
    if (parsed && typeof parsed.phase !== "string") return parsed as TerminalLine;
  }
  return null;
}

/**
 * A scene's preview and its render control, when the template has a renderer.
 *
 * Returns nothing for a template that is still plan only, which is two of the
 * six. Deciding that here keeps the scene list itself free of template
 * knowledge.
 */
function SceneRenderRow({
  scene,
  bitmaps,
  index,
  outputWidth,
  outputHeight,
  fps,
}: {
  scene: SceneSummary;
  bitmaps: Map<string, ImageBitmap>;
  index: number;
  outputWidth: number;
  outputHeight: number;
  fps: VideoFps;
}) {
  const renderable = useMemo(() => toRenderable(scene, bitmaps), [scene, bitmaps]);

  if (!renderable) return null;

  return (
    <>
      <ScenePreview
        renderable={renderable}
        durationMs={scene.durationMs}
        aspectWidth={outputWidth}
        aspectHeight={outputHeight}
      />
      <RenderSceneButton
        renderable={renderable}
        index={index}
        startMs={scene.startMs}
        durationMs={scene.durationMs}
        width={outputWidth}
        height={outputHeight}
        fps={fps}
      />
    </>
  );
}

/**
 * The drawable form of a scene, or null when its template has no renderer yet.
 *
 * At module scope rather than inside a component because the batch export needs
 * the same answer for the same scene. Two copies of this mapping would let the
 * list and the batch disagree about what is exportable.
 */
function toRenderable(scene: SceneSummary, bitmaps: Map<string, ImageBitmap>): Renderable | null {

    if (scene.layoutTemplate === "chart-full" && scene.chart) {
      return {
        template: "chart-full",
        scene: {
          // `type` decides the shape. Dropping it here drew every chart as
          // bars, which turned a single statistic into a one bar bar chart.
          type: scene.chart.type,
          title: scene.chart.title,
          values: scene.chart.values,
          labels: scene.chart.labels,
          unit: scene.chart.unit,
        },
      };
    }

    if (
      scene.layoutTemplate === "character-left" ||
      scene.layoutTemplate === "character-center"
    ) {
      // A scene whose cutout has not loaded still renders: the text carries it,
      // and waiting would leave the row blank for no gain.
      return {
        template: scene.layoutTemplate,
        scene: { text: scene.overlayText ?? scene.sourceText },
        image: scene.emotion ? (bitmaps.get(scene.emotion) ?? null) : null,
      };
    }

    if (scene.layoutTemplate === "text-card") {
      return {
        template: "text-card",
        scene: { text: scene.overlayText ?? scene.sourceText },
      };
    }

    return null;
}
