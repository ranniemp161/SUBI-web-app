"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideoFps } from "@repo/transcript";
import type { SceneSummary } from "@/lib/scenes";
import type { CharacterEmotion } from "@/lib/emotions";
import { MAX_MANUAL_SCENES_PER_PROJECT } from "@/lib/scene-limits";
import { sceneDrawsChart } from "@/lib/scene-templates";
import { loadCharacterBitmaps } from "@/lib/render/character-assets";
import { toRenderable } from "@/lib/render/to-renderable";
import { AddScene, type TranscriptChoice } from "./add-scene";
import { PHASE_LABELS, readPlanStream, type PlanRejection } from "./plan-stream";
import { SceneDetail } from "./scene-detail";
import { SceneRow } from "./scene-row";
import type { ScenePatch } from "./scene-overrides";
import { StudioBar } from "./studio-bar";
import { ONE_PANE_QUERY, REDUCED_MOTION_QUERY, useMediaQuery } from "./use-media-query";
import { useRenderQueue, type RenderJob } from "./use-render-queue";

/**
 * Scene Studio: the list and detail review screen (spec `broll/0006`).
 *
 * **The screen a creator spends their review in.** They arrive with ten to
 * twenty proposed scenes and about two seconds of attention for each, so the
 * list is built for judgement and the detail pane for one scene at a time. The
 * bar holds state and every way out, and the page body never scrolls, so the
 * bar can never be scrolled away from and the two panes never fight over one
 * scrollbar.
 *
 * **This shell owns four things at once**, which is real complexity in one file
 * and worth naming: the selection, the filter, the keyboard, and the render
 * queue. They live together because each of them is a fact about the screen
 * rather than about any one row, and threading them through twenty rows as
 * props would re-render the whole list whenever any of them moved.
 *
 * **Nothing here writes a claim.** Chart values and scene timings appear on no
 * surface of this screen. Spec `0005` drew that line and this one is a layout
 * spec with no authority to widen it.
 */

type FilterKey = "all" | "included" | "excluded" | "chart" | "text" | "manual";

const FILTERS: { key: FilterKey; label: string; match: (scene: SceneSummary) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "included", label: "Included", match: (scene) => scene.included },
  { key: "excluded", label: "Excluded", match: (scene) => !scene.included },
  // The same predicate the row marker and the citation use, so the chip means
  // "this scene will draw a chart" rather than "this row has chart data
  // stored" (AC-105).
  { key: "chart", label: "Chart on screen", match: sceneDrawsChart },
  {
    key: "text",
    label: "Downgraded to text",
    match: (scene) => scene.chartRejectionReason !== null,
  },
  { key: "manual", label: "Added by hand", match: (scene) => scene.origin === "manual" },
];

/** The list pane's share of the content width, and the bounds it never leaves. */
const LIST_PANE = { basis: "40%", min: 360, max: 560 };

export function SceneStudio({
  projectId,
  projectName,
  initialScenes,
  initialSceneId,
  planRuns,
  rerunPrice,
  outputWidth,
  outputHeight,
  fps,
  committedEmotions,
  transcriptChoices,
  stale,
}: {
  projectId: string;
  projectName: string;
  initialScenes: SceneSummary[];
  /** The scene named in the URL on arrival, if any (AC-103). */
  initialSceneId: string | null;
  planRuns: number;
  /** Formatted server side: the price env override is not public. */
  rerunPrice: string;
  outputWidth: number;
  outputHeight: number;
  /** Carried as a rational, never a decimal: 30000/1001 is not 29.97. */
  fps: VideoFps;
  committedEmotions: CharacterEmotion[];
  transcriptChoices: TranscriptChoice[];
  /** The Ruff Cut edit has moved since this transcript was taken (AC-114). */
  stale: boolean;
}) {
  const [scenes, setScenes] = useState<SceneSummary[]>(initialScenes);
  const [selectedId, setSelectedId] = useState<string | null>(initialSceneId);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [adding, setAdding] = useState(false);
  const [narrowDetailOpen, setNarrowDetailOpen] = useState(false);

  const [phase, setPhase] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [rejections, setRejections] = useState<PlanRejection[]>([]);
  const [bitmaps, setBitmaps] = useState<Map<string, ImageBitmap>>(new Map());

  const onePane = useMediaQuery(ONE_PANE_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);

  const queue = useRenderQueue({ width: outputWidth, height: outputHeight, fps });

  const listRef = useRef<HTMLUListElement | null>(null);
  const firstControlRef = useRef<HTMLInputElement | null>(null);
  /** Set by the open scene's caption field, so a re-run can settle it (AC-116). */
  const flushEditRef = useRef<(() => void) | null>(null);
  /** True when the selection moved by key, so focus should follow it. */
  const focusSelectedRef = useRef(false);

  const planning = phase !== null;
  const isRerun = planRuns > 0;

  // ── Character cutouts ────────────────────────────────────────────────────
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
        // A missing character set is not an error worth interrupting the review
        // for: those scenes draw their text and say nothing about images.
      });
    return () => {
      active = false;
    };
  }, [projectId, emotionsUsed]);

  // ── Selection ────────────────────────────────────────────────────────────
  /**
   * Which scene is open, resolved rather than stored (AC-103).
   *
   * Derived during render on purpose. The fallback used to be an effect that
   * corrected the state after the fact, which is one wasted render and one
   * frame of an empty pane every time a re-run replaced the ids. Resolving it
   * here means a dangling scene id is impossible to observe at all: the moment
   * the id names nothing, this reads as the first scene.
   *
   * The fallback is the first scene in **plan order across the whole project**,
   * never the filtered subset, so filtering can never empty the detail pane.
   */
  const selected =
    scenes.find((scene) => scene.id === selectedId) ?? scenes[0] ?? null;
  const openSceneId = selected?.id ?? null;

  // Written with `history.replaceState` rather than a router navigation: the
  // arrow keys move this on every press, and a server round trip per press
  // would make a twenty scene pass unusable. The URL still carries the open
  // scene, so a copied link reopens it, and a fallback rewrites it rather than
  // leaving a dangling parameter behind (AC-103).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (openSceneId === url.searchParams.get("scene")) return;
    if (openSceneId) url.searchParams.set("scene", openSceneId);
    else url.searchParams.delete("scene");
    window.history.replaceState(null, "", url);
  }, [openSceneId]);

  // ── Derived reads ────────────────────────────────────────────────────────
  const positions = useMemo(() => {
    // Taken before excluding, so a clip's number keeps matching the row the
    // creator is looking at.
    const map = new Map<string, number>();
    scenes.forEach((scene, i) => map.set(scene.id, i + 1));
    return map;
  }, [scenes]);

  const renderables = useMemo(() => {
    const map = new Map<string, ReturnType<typeof toRenderable>>();
    for (const scene of scenes) map.set(scene.id, toRenderable(scene, bitmaps));
    return map;
  }, [scenes, bitmaps]);

  const counts = useMemo(() => {
    const map = {} as Record<FilterKey, number>;
    for (const entry of FILTERS) map[entry.key] = scenes.filter(entry.match).length;
    return map;
  }, [scenes]);

  const visible = useMemo(() => {
    const match = FILTERS.find((entry) => entry.key === filter)?.match ?? (() => true);
    return scenes.filter(match);
  }, [scenes, filter]);

  const includedCount = scenes.filter((scene) => scene.included).length;
  const manualCount = scenes.filter((scene) => scene.origin === "manual").length;
  const plannerCount = scenes.filter((scene) => scene.origin === "planner").length;

  /**
   * How many charts the honesty check dropped, read from the scenes themselves
   * rather than from the last run's response, so it survives a reload (AC-87).
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

  const exportable = useMemo(
    () => scenes.filter((scene) => scene.included && renderables.get(scene.id)),
    [scenes, renderables]
  );

  // ── Edits ────────────────────────────────────────────────────────────────
  const patchScene = useCallback((sceneId: string, patch: ScenePatch) => {
    setScenes((previous) =>
      previous.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene))
    );
  }, []);

  const removeScene = useCallback((sceneId: string) => {
    setScenes((previous) => previous.filter((scene) => scene.id !== sceneId));
  }, []);

  const toggleInclude = useCallback(
    (scene: SceneSummary, included: boolean) => {
      patchScene(scene.id, { included });
      // Not debounced: a toggle is one deliberate action, and both this and the
      // detail pane's checkbox write through the same PATCH, so the two can
      // never disagree about a scene's state (AC-104).
      void fetch(`/api/projects/${projectId}/scenes/${scene.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ included }),
      }).catch(() => {
        // The row keeps the creator's intent on screen. A failed toggle shows
        // up on the next load rather than snapping back under their hand.
      });
    },
    [patchScene, projectId]
  );

  const onAdded = useCallback(
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
      // The scene a creator just made is the one they want to look at (AC-109).
      setSelectedId(created.id);
      setAdding(false);
    },
    []
  );

  // ── The plan run ─────────────────────────────────────────────────────────
  // One key for the lifetime of one run, minted when the run starts. It is the
  // only thing standing between a retried request and a second charge, so the
  // button stays disabled until the run settles rather than relying on it twice.
  const keyRef = useRef<string | null>(null);

  const runPlan = useCallback(async () => {
    if (planning) return;

    // Settled, not dropped: a caption typed a moment ago is sent now, while the
    // scene it belongs to still exists. Left on the debounce it would fire
    // after the run had replaced that scene and answer 404 with nobody
    // watching (AC-116).
    flushEditRef.current?.();

    setPlanError(null);
    setRejections([]);
    setAdding(false);
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
        setPlanError(body.error ?? "The plan run failed. Try again.");
        return;
      }

      const terminal = await readPlanStream(response, setPhase);
      if (!terminal) {
        setPlanError(
          "The connection dropped before the plan finished. Reload to see whether it landed."
        );
        return;
      }
      if (terminal.error) setPlanError(terminal.error);
      if (terminal.scenes) {
        // A re-run replaces the planner's scenes and keeps the manual ones, so
        // the list it returns is the whole truth about this project. Every
        // render phase and every held clip belongs to scenes that may no longer
        // exist, so the queue starts again from nothing.
        queue.reset();
        setScenes(terminal.scenes);
      }
      if (terminal.rejected) setRejections(terminal.rejected);
    } catch {
      setPlanError("The plan run failed. Try again.");
    } finally {
      setPhase(null);
      keyRef.current = null;
    }
  }, [planning, projectId, queue]);

  // ── Rendering ────────────────────────────────────────────────────────────
  const jobFor = useCallback(
    (scene: SceneSummary): RenderJob | null => {
      const renderable = renderables.get(scene.id);
      if (!renderable) return null;
      return {
        id: scene.id,
        index: positions.get(scene.id) ?? 1,
        startMs: scene.startMs,
        durationMs: scene.durationMs,
        renderable,
      };
    },
    [renderables, positions]
  );

  const renderAll = useCallback(() => {
    const jobs = exportable
      .map(jobFor)
      .filter((job): job is RenderJob => job !== null);
    queue.enqueue(jobs);
  }, [exportable, jobFor, queue]);

  const renderOne = useCallback(
    (scene: SceneSummary) => {
      const job = jobFor(scene);
      // The one clip goes straight to the creator: they asked for this scene,
      // not for an archive (AC-117).
      if (job) queue.enqueue([{ ...job, downloadWhenDone: true }]);
    },
    [jobFor, queue]
  );

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const select = useCallback((id: string, fromKey: boolean) => {
    setSelectedId(id);
    setAdding(false);
    focusSelectedRef.current = fromKey;
    if (!fromKey) setNarrowDetailOpen(true);
  }, []);

  useEffect(() => {
    if (!focusSelectedRef.current) return;
    focusSelectedRef.current = false;
    listRef.current
      ?.querySelector<HTMLElement>('button[aria-current="true"]')
      ?.focus();
  }, [openSceneId]);

  const onListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      // A single key binding never fires while typing (AC-107). Space toggling
      // inclusion while a creator writes a caption is a data loss bug wearing a
      // shortcut's clothes.
      if (isTypingTarget(event.target)) return;
      if (visible.length === 0) return;

      const currentIndex = visible.findIndex((scene) => scene.id === openSceneId);
      const step = (delta: number) => {
        event.preventDefault();
        // A selection hidden by the active chip is not in this list, so the
        // keys start from the end nearest the direction of travel rather than
        // refusing to move.
        const from = currentIndex === -1 ? (delta > 0 ? -1 : visible.length) : currentIndex;
        const next = Math.min(visible.length - 1, Math.max(0, from + delta));
        select(visible[next].id, true);
      };

      switch (event.key) {
        case "ArrowDown":
        case "j":
          step(1);
          return;
        case "ArrowUp":
        case "k":
          step(-1);
          return;
        case " ": {
          // The row's own checkbox handles its own space press natively;
          // toggling here as well would cancel it out.
          if (isCheckbox(event.target)) return;
          if (!selected || planning) return;
          event.preventDefault();
          toggleInclude(selected, !selected.included);
          return;
        }
        case "Enter": {
          if (!selected) return;
          event.preventDefault();
          setNarrowDetailOpen(true);
          firstControlRef.current?.focus();
        }
      }
    },
    [visible, openSceneId, selected, planning, select, toggleInclude]
  );

  // ── Layout ───────────────────────────────────────────────────────────────
  const showDetail = !onePane || narrowDetailOpen;
  const showList = !onePane || !narrowDetailOpen;

  return (
    <div
      className="flex flex-col overflow-hidden"
      // The page body never scrolls: the bar cannot be scrolled away from, and
      // the two panes never fight for one scrollbar (AC-96). 64px is the app
      // header above this screen.
      style={{ height: "calc(100dvh - 64px)" }}
    >
      <header
        className="shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="mx-auto w-full" style={{ maxWidth: 1600 }}>
          <div className="flex items-center gap-3 px-6 pt-3">
            <Link
              href={`/dashboard/${projectId}`}
              className="text-xs"
              style={{ color: "var(--broll-muted)" }}
            >
              ← {projectName}
            </Link>
            <h1
              className="text-sm font-bold tracking-tight"
              style={{ fontFamily: "var(--font-space-grotesk)" }}
            >
              Scene Studio
            </h1>
          </div>

          <StudioBar
            sceneCount={scenes.length}
            includedCount={includedCount}
            droppedCharts={droppedCharts}
            touchedCount={touchedCount}
            manualCount={manualCount}
            plannerCount={plannerCount}
            exportableCount={exportable.length}
            readyCount={queue.readyCount}
            isRerun={isRerun}
            rerunPrice={rerunPrice}
            planPhaseLabel={phase ? (PHASE_LABELS[phase] ?? "Working") : null}
            planning={planning}
            rendering={queue.running}
            atManualCap={manualCount >= MAX_MANUAL_SCENES_PER_PROJECT}
            stale={stale}
            adding={adding}
            onPlan={runPlan}
            onAddScene={() => {
              setAdding(true);
              setNarrowDetailOpen(true);
            }}
            onRenderAll={renderAll}
            onCancelRender={queue.cancel}
            onDownload={() => queue.downloadZip(scenes.map((scene) => scene.id))}
          />

          {planError && (
            <p className="px-6 pb-2 text-xs" role="alert" style={{ color: "#ff6b6b" }}>
              {planError}
            </p>
          )}

          {rejections.length > 0 && <RejectionNote rejections={rejections} />}
        </div>
      </header>

      {scenes.length === 0 && !planning ? (
        <ZeroState isRerun={isRerun} rerunPrice={rerunPrice} onPlan={runPlan} />
      ) : (
        <div
          className="mx-auto flex w-full min-h-0 flex-1"
          style={{ maxWidth: 1600 }}
        >
          {showList && (
            <div
              className="min-h-0 overflow-y-auto px-6 py-4"
              style={
                onePane
                  ? { flex: "1 1 100%" }
                  : {
                      flex: `0 0 ${LIST_PANE.basis}`,
                      minWidth: LIST_PANE.min,
                      maxWidth: LIST_PANE.max,
                      borderRight: "1px solid rgba(255,255,255,0.08)",
                    }
              }
            >
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setFilter(entry.key)}
                    aria-pressed={filter === entry.key}
                    className="rounded-full px-2.5 py-1 text-xs"
                    style={{
                      border:
                        filter === entry.key
                          ? "1px solid var(--broll-accent)"
                          : "1px solid rgba(255,255,255,0.15)",
                      color:
                        filter === entry.key
                          ? "var(--broll-accent)"
                          : "var(--broll-muted)",
                    }}
                  >
                    {entry.label} <span className="broll-tabular">{counts[entry.key]}</span>
                  </button>
                ))}
              </div>

              {visible.length === 0 ? (
                // Says so and offers to clear itself, and leaves the selection
                // exactly where it was (AC-105, AC-103).
                <div className="broll-glass mt-4 rounded-lg px-4 py-3" role="status">
                  <p className="text-sm">No scene matches this filter.</p>
                  <button
                    type="button"
                    onClick={() => setFilter("all")}
                    className="mt-2 text-xs underline"
                    style={{ color: "var(--broll-muted)" }}
                  >
                    Show all {scenes.length} scenes
                  </button>
                </div>
              ) : (
                <ul
                  ref={listRef}
                  onKeyDown={onListKeyDown}
                  aria-label="Proposed scenes"
                  aria-busy={planning}
                  className="mt-3 grid gap-2"
                  // Visibly inert while a run replaces everything in it
                  // (AC-116). The controls are disabled too, so this is
                  // belt and braces rather than the only guard.
                  style={planning ? { pointerEvents: "none", opacity: 0.5 } : undefined}
                >
                  {visible.map((scene) => (
                    <SceneRow
                      key={scene.id}
                      scene={scene}
                      position={positions.get(scene.id) ?? 1}
                      selected={scene.id === openSceneId}
                      renderable={renderables.get(scene.id) ?? null}
                      renderState={queue.states[scene.id]}
                      aspectWidth={outputWidth}
                      aspectHeight={outputHeight}
                      locked={planning}
                      onSelect={() => select(scene.id, false)}
                      onToggleInclude={(included) => toggleInclude(scene, included)}
                    />
                  ))}
                </ul>
              )}

              <p className="mt-4 text-xs" style={{ color: "var(--broll-muted)" }}>
                Arrow keys or <kbd>j</kbd> and <kbd>k</kbd> move down the list, space
                includes or excludes, enter opens the controls.
              </p>
            </div>
          )}

          {showDetail && (
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4" style={{ minWidth: 0 }}>
              {onePane && (
                <button
                  type="button"
                  onClick={() => setNarrowDetailOpen(false)}
                  className="mb-3 text-xs underline"
                  style={{ color: "var(--broll-muted)" }}
                >
                  ← Back to the list
                </button>
              )}

              {adding ? (
                <AddScene
                  projectId={projectId}
                  segments={transcriptChoices}
                  onAdded={onAdded}
                  onCancel={() => setAdding(false)}
                />
              ) : selected ? (
                <SceneDetail
                  key={selected.id}
                  projectId={projectId}
                  scene={selected}
                  position={positions.get(selected.id) ?? 1}
                  renderable={renderables.get(selected.id) ?? null}
                  renderState={queue.states[selected.id]}
                  committedEmotions={committedEmotions}
                  transcriptChoices={transcriptChoices}
                  aspectWidth={outputWidth}
                  aspectHeight={outputHeight}
                  locked={planning}
                  reducedMotion={reducedMotion}
                  firstControlRef={firstControlRef}
                  flushRef={flushEditRef}
                  onChange={(patch) => patchScene(selected.id, patch)}
                  onDelete={() => removeScene(selected.id)}
                  onRender={() => renderOne(selected)}
                />
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A project with no plan yet (AC-115).
 *
 * Two empty panes would be a screen that looks broken. This names what a plan
 * costs and offers to run one, which is the only thing there is to do here.
 */
function ZeroState({
  isRerun,
  rerunPrice,
  onPlan,
}: {
  isRerun: boolean;
  rerunPrice: string;
  onPlan: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="broll-glow max-w-md rounded-lg px-6 py-5 text-center">
        <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-space-grotesk)" }}>
          No scenes yet
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--broll-muted)" }}>
          {/* Nothing plans on its own, including the free first run (AC-56). */}
          {isRerun
            ? `Planning again costs ${rerunPrice}.`
            : "The first plan for this project is included. It reads the transcript and proposes the cutaways worth cutting to."}
        </p>
        <button
          type="button"
          onClick={onPlan}
          className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold"
          style={{
            background: "var(--broll-accent)",
            color: "var(--broll-accent-foreground)",
          }}
        >
          {isRerun ? `Plan scenes for ${rerunPrice}` : "Plan scenes"}
        </button>
      </div>
    </div>
  );
}

/**
 * What the last run threw away, and why.
 *
 * The reason, not just the count: a run where everything was rejected is
 * unfixable if all it reports is how many (spec `0003` AC-24). Twenty scenes
 * failing one way is one problem, not twenty, so the reasons are deduplicated.
 */
function RejectionNote({ rejections }: { rejections: PlanRejection[] }) {
  const scenesRejected = rejections.filter((r) => r.kind === "scene").length;
  const reasons = Array.from(new Set(rejections.map((r) => r.reason))).slice(0, 3);

  return (
    <div className="px-6 pb-2 text-xs" style={{ color: "var(--broll-muted)" }}>
      {scenesRejected > 0 && (
        <p>
          {scenesRejected} scene{scenesRejected === 1 ? "" : "s"} rejected as malformed.
        </p>
      )}
      {reasons.map((reason) => (
        <p key={reason}>· {reason}</p>
      ))}
    </div>
  );
}

/**
 * Whether a key press is someone typing rather than someone navigating.
 *
 * A checkbox is an `input` and is deliberately not counted: space on it is the
 * same action the shortcut performs, and the browser already does it.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName === "INPUT") return !isCheckbox(target);
  return false;
}

function isCheckbox(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement &&
    (target.type === "checkbox" || target.type === "radio")
  );
}
