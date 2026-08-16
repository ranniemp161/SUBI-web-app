"use client";

import type { RefObject } from "react";
import type { SceneSummary } from "@/lib/scenes";
import type { CharacterEmotion } from "@/lib/emotions";
import { formatClock } from "@/lib/utterances";
import { sceneDrawsChart, type SceneBlocker } from "@/lib/scene-templates";
import type { Renderable } from "@/lib/render/renderable";
import { ScenePreview } from "./scene-preview";
import { SceneCitation } from "./scene-citation";
import { SceneOverrides, type ScenePatch } from "./scene-overrides";
import { RenderSceneButton } from "./render-scene-button";
import type { TranscriptChoice } from "./add-scene";
import type { ScenePhase } from "./use-render-queue";
import { Button, Card } from "@/components/ui";

/**
 * The one open scene: what it looks like, what a creator may change, and where
 * its numbers came from (spec `broll/0006` AC-102).
 */
export function SceneDetail({
  projectId,
  scene,
  position,
  renderable,
  renderState,
  committedEmotions,
  blocker,
  transcriptChoices,
  aspectWidth,
  aspectHeight,
  locked,
  reducedMotion,
  firstControlRef,
  flushRef,
  allScenes = [],
  totalIncludedCount = 1,
  readyCount = 0,
  rendering = false,
  onSelectScene,
  onChange,
  onDelete,
  onRender,
  onDownload,
}: {
  projectId: string;
  scene: SceneSummary;
  /** 1 based position in plan order, which is what the clip filename carries. */
  position: number;
  renderable: Renderable | null;
  renderState: ScenePhase | undefined;
  committedEmotions: CharacterEmotion[];
  /** Why this scene cannot render, or null (AC-138). Computed by the shell. */
  blocker: SceneBlocker | null;
  /** The stored document's lines, used to place a manual scene (AC-102). */
  transcriptChoices: TranscriptChoice[];
  aspectWidth: number;
  aspectHeight: number;
  locked: boolean;
  reducedMotion: boolean;
  /** Where Enter from the list lands (AC-107). */
  firstControlRef: RefObject<HTMLInputElement | null>;
  flushRef: RefObject<(() => void) | null>;
  allScenes?: SceneSummary[];
  totalIncludedCount?: number;
  readyCount?: number;
  rendering?: boolean;
  onSelectScene?: (id: string) => void;
  onChange: (patch: ScenePatch) => void;
  onDelete: () => void;
  onRender: () => void;
  onDownload?: () => void;
}) {
  const drawsChart = sceneDrawsChart(scene);

  return (
    <div className="flex flex-col xl:flex-row gap-6 min-h-full">
      {/* Center Column: Canvas Preview, Header, Citation, and Timeline */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        {/* Top Scene Subheader */}
        <header className="flex flex-wrap items-center justify-between gap-3 pb-1">
          <div className="flex items-center gap-2.5">
            <span
              className="broll-tabular text-sm font-bold"
              style={{ color: "var(--broll-accent)" }}
            >
              {formatClock(scene.startMs)}
            </span>
            <span className="text-sm font-bold text-white">scene {position}</span>
            <span className="broll-tabular text-xs text-zinc-400">
              {(scene.durationMs / 1000).toFixed(1)}s · {scene.layoutTemplate}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Hidden rather than disabled when the scene has nothing to draw
                (AC-138): the sentence below says what to do about it, and a
                dead button beside an explanation teaches nothing the
                explanation does not already say. */}
            {renderable && !blocker && (
              <RenderSceneButton
                width={aspectWidth}
                height={aspectHeight}
                state={renderState}
                disabled={locked}
                onRender={onRender}
              />
            )}
          </div>
        </header>

        {blocker && (
          <p
            className="rounded-xl px-4 py-3 text-xs bg-amber-500/10 border border-amber-500/20 text-amber-200"
            role="status"
          >
            {blocker.reason}{" "}
            {blocker.code === "no_character"
              ? "Attach one on the project page and this scene renders again — the plan is kept, nothing has to be re-run."
              : "Pick an emotion the character actually has, or redraw the missing one."}
          </p>
        )}

        {/* Large Canvas Preview */}
        {renderable ? (
          <div className="w-full flex flex-col items-center">
            <ScenePreview
              renderable={renderable}
              durationMs={scene.durationMs}
              aspectWidth={aspectWidth}
              aspectHeight={aspectHeight}
              reducedMotion={reducedMotion}
            />
          </div>
        ) : (
          <p className="broll-glass rounded-xl p-6 text-sm text-center text-zinc-400" role="status">
            <strong className="text-white">{scene.layoutTemplate}</strong> has no renderer yet, so this scene
            cannot be previewed or exported. Pick a template this project can draw.
          </p>
        )}

        {/* Source Citation block */}
        <Provenance
          scene={scene}
          drawsChart={drawsChart}
          transcriptChoices={transcriptChoices}
        />

        {/* Bottom Timeline Bar */}
        {allScenes.length > 0 && (
          <TimelineBar
            scenes={allScenes}
            currentSceneId={scene.id}
            onSelectScene={onSelectScene}
          />
        )}
      </div>

      {/* Right Column: Inspector Controls */}
      <div className="w-full xl:w-[320px] shrink-0 flex flex-col gap-4">
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
          position={position}
          totalIncluded={totalIncludedCount}
          durationMs={scene.durationMs}
          onChange={onChange}
          onDelete={onDelete}
        />

        {/* Bottom Render Status Card */}
        <Card className="p-4 mt-auto">
          <div className="flex items-center justify-between text-xs mb-3">
            <span className="font-bold uppercase tracking-wider text-[10px] text-zinc-400">
              Render status
            </span>
            <span className="broll-tabular font-semibold text-white">
              {readyCount} / {allScenes.length} done
            </span>
          </div>

          <Button
            type="button"
            variant="glass"
            size="sm"
            onClick={onDownload}
            disabled={readyCount === 0 || rendering}
            className="w-full"
          >
            Download zip
          </Button>
        </Card>
      </div>
    </div>
  );
}

/**
 * Where this scene came from (AC-102).
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
      <Card className="p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">
          SOURCE
        </h3>
        <p className="text-xs text-zinc-300">
          You added this scene by hand, placed at{" "}
          <span className="broll-tabular font-bold" style={{ color: "var(--broll-accent)" }}>
            {formatClock(scene.startMs)}
          </span>
          .
        </p>
        {line && (
          <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed italic">
            “{line.text}”
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">
        SOURCE
      </h3>

      {scene.sourceText && (
        <p className="text-xs text-zinc-300 leading-relaxed">
          {scene.sourceText}
        </p>
      )}

      {drawsChart && scene.chart && scene.sourceText && (
        <div className="mt-2 pt-2 border-t border-white/5">
          <SceneCitation sourceText={scene.sourceText} chart={scene.chart} />
        </div>
      )}

      {scene.chartRejectionReason && (
        <p className="mt-2 text-xs text-amber-400/90 leading-relaxed">
          <strong>Shown as text, not a chart:</strong> {scene.chartRejectionReason}. The
          number stays out rather than being guessed at.
        </p>
      )}
    </Card>
  );
}

/** Bottom timeline scrubber */
function TimelineBar({
  scenes,
  currentSceneId,
  onSelectScene,
}: {
  scenes: SceneSummary[];
  currentSceneId: string;
  onSelectScene?: (id: string) => void;
}) {
  if (scenes.length === 0) return null;

  const lastScene = scenes[scenes.length - 1];
  const maxTimeMs = lastScene ? lastScene.startMs + lastScene.durationMs : 1000;

  return (
    <div className="flex items-center gap-2 mt-auto pt-2">
      <div className="flex-1 flex items-center gap-1 h-3 p-0.5 rounded bg-[#111215] border border-white/[0.08]">
        {scenes.map((s) => {
          const isCurrent = s.id === currentSceneId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelectScene?.(s.id)}
              title={`${formatClock(s.startMs)} · Scene (${(s.durationMs / 1000).toFixed(1)}s)`}
              className={`h-full rounded-[2px] transition-all flex-1 cursor-pointer ${
                isCurrent
                  ? "bg-[var(--broll-accent)] shadow-[0_0_8px_rgba(255,252,0,0.5)] scale-y-125"
                  : "bg-white/20 hover:bg-white/40"
              }`}
            />
          );
        })}
      </div>
      <span className="text-[10px] text-zinc-500 broll-tabular font-medium">
        {formatClock(maxTimeMs)}
      </span>
    </div>
  );
}

function lineUnder(choices: TranscriptChoice[], startMs: number): TranscriptChoice | null {
  let found: TranscriptChoice | null = null;
  for (const choice of choices) {
    if (choice.startMs > startMs) break;
    found = choice;
  }
  return found;
}
