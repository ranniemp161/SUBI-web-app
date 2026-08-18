"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { VideoFps } from "@repo/transcript";
import { formatUsd } from "@repo/billing/pricing";
import { drawSceneObject } from "@/lib/object-generate";
import type { SceneSummary } from "@/lib/scenes";
import type { CharacterEmotion } from "@/lib/emotions";
import { MAX_MANUAL_SCENES_PER_PROJECT } from "@/lib/scene-limits";
import {
  isCharacterTemplate,
  isObjectTemplate,
  sceneBlocker,
  sceneDrawsChart,
  type SceneBlocker,
} from "@/lib/scene-templates";
import { loadCharacterBitmaps } from "@/lib/render/character-assets";
import { loadObjectBitmaps } from "@/lib/render/object-assets";
import { toRenderable, type SceneBitmaps } from "@/lib/render/to-renderable";
import { formatClock } from "@/lib/utterances";
import { AddScene, type TranscriptChoice } from "./add-scene";
import { PHASE_LABELS, readPlanStream, type PlanRejection } from "./plan-stream";
import { SceneDetail } from "./scene-detail";
import { SceneRow } from "./scene-row";
import { StudioBar } from "./studio-bar";
import { ONE_PANE_QUERY, REDUCED_MOTION_QUERY, useMediaQuery } from "./use-media-query";
import { useRenderQueue, type RenderJob } from "./use-render-queue";

type FilterKey =
  | "all"
  | "included"
  | "excluded"
  | "chart"
  | "object"
  | "text"
  | "manual";

const FILTERS: { key: FilterKey; label: string; match: (scene: SceneSummary) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "included", label: "Included", match: (scene) => scene.included },
  { key: "excluded", label: "Excluded", match: (scene) => !scene.included },
  { key: "chart", label: "Chart on screen", match: sceneDrawsChart },
  {
    key: "object",
    label: "Object on screen",
    match: (scene) => scene.object !== null && isObjectTemplate(scene.layoutTemplate),
  },
  {
    // One chip for both downgrades. A creator scanning for "what did the honesty
    // check take away from me" is asking one question, not two, and splitting it
    // would put two nearly identical chips side by side.
    key: "text",
    label: "Downgraded to text",
    match: (scene) =>
      scene.chartRejectionReason !== null || scene.objectRejectionReason !== null,
  },
  { key: "manual", label: "Added by hand", match: (scene) => scene.origin === "manual" },
];

/** The list pane's share of the content width, and the bounds it never leaves. */
const LIST_PANE = { basis: "36%", min: 360, max: 480 };

export function SceneStudio({
  projectId,
  projectName,
  initialScenes,
  initialSceneId,
  planRuns,
  rerunPrice,
  objectImagePriceMicros,
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
  rerunPrice: string;
  /**
   * What one illustration costs, in micros, resolved **server side**.
   *
   * The raw figure rather than a formatted string, because the bar multiplies it
   * by however many are missing. The env override carries no `NEXT_PUBLIC_`
   * prefix, so reading it in the browser would silently resolve to the default —
   * the same trap `rerunPrice` avoids by arriving pre-formatted.
   */
  objectImagePriceMicros: number;
  outputWidth: number;
  outputHeight: number;
  fps: VideoFps;
  committedEmotions: CharacterEmotion[];
  transcriptChoices: TranscriptChoice[];
  stale: boolean;
}) {
  const [scenes, setScenes] = useState<SceneSummary[]>(initialScenes);
  const [selectedId, setSelectedId] = useState<string | null>(initialSceneId);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [narrowDetailOpen, setNarrowDetailOpen] = useState(false);

  const [phase, setPhase] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [rejections, setRejections] = useState<PlanRejection[]>([]);
  const [characterBitmaps, setCharacterBitmaps] = useState<Map<string, ImageBitmap>>(
    new Map()
  );
  const [objectBitmaps, setObjectBitmaps] = useState<Map<string, ImageBitmap>>(new Map());
  const [drawingObjects, setDrawingObjects] = useState(false);
  const [objectBatchError, setObjectBatchError] = useState<string | null>(null);

  const onePane = useMediaQuery(ONE_PANE_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  // Only ever handed to the upload retry, which refreshes a lapsed session.
  const { getToken } = useAuth();

  const queue = useRenderQueue({ width: outputWidth, height: outputHeight, fps });

  const listRef = useRef<HTMLUListElement | null>(null);
  const firstControlRef = useRef<HTMLInputElement | null>(null);
  const flushEditRef = useRef<(() => void) | null>(null);
  const focusSelectedRef = useRef(false);

  const planning = phase !== null;
  const isRerun = planRuns > 0;

  /**
   * The emotions this plan actually composites, as one stable string.
   *
   * A string rather than an array because it is an effect dependency: a fresh
   * array every render would re-download the whole character set on every
   * keystroke. Read off `isCharacterTemplate` rather than a hardcoded pair, so
   * `character-plus-object` pulls its cutout too.
   */
  const emotionKey = useMemo(
    () =>
      Array.from(
        new Set(
          scenes
            .filter((scene) => isCharacterTemplate(scene.layoutTemplate) && scene.emotion)
            .map((scene) => scene.emotion as string)
        )
      )
        .sort()
        .join(" "),
    [scenes]
  );

  /**
   * The scenes that have an illustration to draw, as one stable string, for the
   * same reason `emotionKey` is one.
   *
   * Keyed off `objectAssetPath` rather than off the template alone: a scene on
   * an object template with nothing generated yet has nothing to fetch, and
   * asking for it would spend a round trip to be told so.
   */
  const objectKey = useMemo(
    () =>
      scenes
        .filter((scene) => isObjectTemplate(scene.layoutTemplate) && scene.objectAssetPath)
        .map((scene) => scene.id)
        .sort()
        .join(" "),
    [scenes]
  );

  useEffect(() => {
    if (emotionKey === "") return;
    let active = true;
    loadCharacterBitmaps(projectId, emotionKey.split(" "))
      .then((loaded) => {
        if (active) setCharacterBitmaps(loaded);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId, emotionKey]);

  useEffect(() => {
    if (objectKey === "") return;
    let active = true;
    loadObjectBitmaps(projectId, objectKey.split(" "))
      .then((loaded) => {
        if (active) setObjectBitmaps(loaded);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId, objectKey]);

  const selected =
    scenes.find((scene) => scene.id === selectedId) ?? scenes[0] ?? null;
  const openSceneId = selected?.id ?? null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (openSceneId === url.searchParams.get("scene")) return;
    if (openSceneId) url.searchParams.set("scene", openSceneId);
    else url.searchParams.delete("scene");
    window.history.replaceState(null, "", url);
  }, [openSceneId]);

  const positions = useMemo(() => {
    const map = new Map<string, number>();
    scenes.forEach((scene, i) => map.set(scene.id, i + 1));
    return map;
  }, [scenes]);

  const bitmaps = useMemo<SceneBitmaps>(
    () => ({ characters: characterBitmaps, objects: objectBitmaps }),
    [characterBitmaps, objectBitmaps]
  );

  const renderables = useMemo(() => {
    const map = new Map<string, ReturnType<typeof toRenderable>>();
    for (const scene of scenes) map.set(scene.id, toRenderable(scene, bitmaps));
    return map;
  }, [scenes, bitmaps]);

  /**
   * Why each scene cannot render, keyed by id (AC-138).
   *
   * Deliberately **not** derived from `renderables` or `bitmaps`: those depend
   * on an async decode, and a blocker that appeared and vanished as images
   * landed would be noise rather than information. `committedEmotions` is server
   * state and settled on the first render.
   */
  const blockers = useMemo(() => {
    const map = new Map<string, SceneBlocker | null>();
    for (const scene of scenes) {
      map.set(scene.id, sceneBlocker(scene, { committedEmotions }));
    }
    return map;
  }, [scenes, committedEmotions]);

  const counts = useMemo(() => {
    const map = {} as Record<FilterKey, number>;
    for (const entry of FILTERS) map[entry.key] = scenes.filter(entry.match).length;
    return map;
  }, [scenes]);

  const visible = useMemo(() => {
    const match = FILTERS.find((entry) => entry.key === filter)?.match ?? (() => true);
    let list = scenes.filter(match);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (s) =>
          (s.sourceText && s.sourceText.toLowerCase().includes(q)) ||
          (s.overlayText && s.overlayText.toLowerCase().includes(q)) ||
          formatClock(s.startMs).includes(q)
      );
    }
    return list;
  }, [scenes, filter, searchQuery]);

  const includedCount = scenes.filter((scene) => scene.included).length;
  const manualCount = scenes.filter((scene) => scene.origin === "manual").length;
  const plannerCount = scenes.filter((scene) => scene.origin === "planner").length;
  const droppedCharts = scenes.filter((scene) => scene.chartRejectionReason).length;
  const touchedCount = scenes.filter(
    (scene) => scene.origin === "planner" && scene.userEditedAt !== null
  ).length;

  const exportable = useMemo(
    () => scenes.filter((scene) => scene.included && renderables.get(scene.id)),
    [scenes, renderables]
  );

  /**
   * Included scenes the batch will skip (AC-138).
   *
   * Counted off `scenes` rather than `exportable` so it does not depend on the
   * bitmap decode, for the same reason `blockers` does not.
   */
  const blockedCount = useMemo(
    () => scenes.filter((scene) => scene.included && blockers.get(scene.id)).length,
    [scenes, blockers]
  );

  /**
   * Included scenes blocked only for want of an illustration (spec `broll/0008`).
   *
   * **This list is what keeps the product's own principle true.** Illustrations
   * are drawn on demand so a creator only pays for the ones they keep, but the
   * brief also says a user who clicks generate and then export all should get
   * usable output — and on demand means an object scene nobody opened has no
   * image, which the batch would silently skip. So Render all offers to draw the
   * missing ones first, once, with the total price on the button.
   *
   * Separate from `blockedCount` because these are the blocks a creator can
   * clear from this screen by spending. A missing character is not; it needs a
   * character attached on the project page.
   */
  const needingImages = useMemo(
    () =>
      scenes.filter(
        (scene) =>
          scene.included && blockers.get(scene.id)?.code === "no_object_image"
      ),
    [scenes, blockers]
  );

  /**
   * Apply a change to one scene locally.
   *
   * Takes `Partial<SceneSummary>` rather than `ScenePatch`: every `ScenePatch` is
   * one of these, but not every local change is a field the PATCH route accepts.
   * A freshly drawn illustration is written by its own route and then reflected
   * here, and typing this as the edit body would have meant either widening what
   * the edit route claims to accept or keeping a second updater.
   */
  const patchScene = useCallback((sceneId: string, patch: Partial<SceneSummary>) => {
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
      void fetch(`/api/projects/${projectId}/scenes/${scene.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ included }),
      }).catch(() => {});
    },
    [patchScene, projectId]
  );

  const onAdded = useCallback(
    (created: { id: string; startMs: number; durationMs: number; overlayText: string }) => {
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
        object: null,
        objectRejectionReason: null,
        objectAssetPath: null,
        objectAttempt: 0,
        strength: null,
        included: true,
        origin: "manual",
        userEditedAt: new Date(),
      };
      setScenes((previous) =>
        [...previous, scene].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
      );
      setSelectedId(created.id);
      setAdding(false);
    },
    []
  );

  const keyRef = useRef<string | null>(null);

  const runPlan = useCallback(async () => {
    if (planning) return;

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
        // The same map the rows read, so what a scene says about itself and what
        // the queue does with it can never disagree (AC-138).
        blockedReason: blockers.get(scene.id)?.reason,
      };
    },
    [renderables, positions, blockers]
  );

  /**
   * Draw every missing illustration, one at a time.
   *
   * **Sequential rather than parallel**, for the same reason scenes render one
   * at a time: segmentation runs on the main thread, so a dozen at once is both
   * slower than doing them in order and far likelier to kill the tab.
   *
   * One scene failing does not stop the rest, matching the batch export. The
   * ones that succeed are recorded as they land, so a run that dies halfway
   * leaves real progress rather than nothing.
   */
  const drawMissingObjects = useCallback(async () => {
    if (drawingObjects || needingImages.length === 0) return;
    setObjectBatchError(null);
    setDrawingObjects(true);

    let failed = 0;
    try {
      for (const scene of needingImages) {
        try {
          const { pathname } = await drawSceneObject({
            projectId,
            sceneId: scene.id,
            getToken,
          });
          patchScene(scene.id, {
            objectAssetPath: pathname,
            objectAttempt: scene.objectAttempt + 1,
          });
        } catch {
          failed += 1;
        }
      }
    } finally {
      setDrawingObjects(false);
      if (failed > 0) {
        setObjectBatchError(
          `${failed} illustration${failed === 1 ? "" : "s"} couldn't be drawn. Nothing was charged for those; try them individually.`
        );
      }
    }
  }, [drawingObjects, needingImages, projectId, getToken, patchScene]);

  const renderAll = useCallback(() => {
    const jobs = exportable
      .map(jobFor)
      .filter((job): job is RenderJob => job !== null);
    queue.enqueue(jobs);
  }, [exportable, jobFor, queue]);

  const renderOne = useCallback(
    (scene: SceneSummary) => {
      const job = jobFor(scene);
      if (job) queue.enqueue([{ ...job, downloadWhenDone: true }]);
    },
    [jobFor, queue]
  );

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
      if (isTypingTarget(event.target)) return;
      if (visible.length === 0) return;

      const currentIndex = visible.findIndex((scene) => scene.id === openSceneId);
      const step = (delta: number) => {
        event.preventDefault();
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

  const showDetail = !onePane || narrowDetailOpen;
  const showList = !onePane || !narrowDetailOpen;

  return (
    <div
      className="flex flex-col overflow-hidden bg-black"
      style={{ height: "calc(100dvh - 56px)" }}
    >
      {/* Studio Header Bar */}
      <header
        className="shrink-0 bg-black/90 backdrop-blur-md"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="mx-auto w-full max-w-[1700px]">
          <div className="flex items-center gap-3 px-6 pt-2.5">
            <Link
              href={`/dashboard/${projectId}`}
              className="text-xs text-zinc-400 hover:text-white transition-colors"
            >
              ← {projectName}
            </Link>
            <span className="text-zinc-600">/</span>
            <h1
              className="text-xs font-bold tracking-tight text-white uppercase tracking-wider"
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
            blockedCount={blockedCount}
            needingImagesCount={needingImages.length}
            missingImagesPrice={formatUsd(
              objectImagePriceMicros * needingImages.length
            )}
            drawingObjects={drawingObjects}
            objectBatchError={objectBatchError}
            readyCount={queue.readyCount}
            isRerun={isRerun}
            rerunPrice={rerunPrice}
            planPhaseLabel={phase ? (PHASE_LABELS[phase] ?? "Working") : null}
            planning={planning}
            rendering={queue.running}
            atManualCap={manualCount >= MAX_MANUAL_SCENES_PER_PROJECT}
            stale={stale}
            adding={adding}
            zipError={queue.zipError}
            onPlan={runPlan}
            onAddScene={() => {
              setAdding(true);
              setNarrowDetailOpen(true);
            }}
            onRenderAll={renderAll}
            onCancelRender={queue.cancel}
            onDownload={() => queue.downloadZip(scenes.map((scene) => scene.id))}
            onDrawMissingObjects={() => void drawMissingObjects()}
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
          className="mx-auto flex w-full min-h-0 flex-1 max-w-[1700px]"
        >
          {/* Left Column: Scene List & Filters */}
          {showList && (
            <div
              className="min-h-0 overflow-y-auto px-5 py-4 flex flex-col"
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
              {/* Search Bar */}
              <div className="relative mb-2.5 shrink-0">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search transcript or on-screen text"
                  className="w-full rounded-xl pl-8 pr-3 py-2 text-xs bg-[#111215] border border-white/[0.08] text-white placeholder-zinc-500 focus:border-[var(--broll-accent)] focus:outline-none transition-colors"
                />
                <svg
                  className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              {/* Filter Chips */}
              <div className="flex flex-wrap gap-1.5 mb-3 shrink-0">
                {FILTERS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setFilter(entry.key)}
                    aria-pressed={filter === entry.key}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                      filter === entry.key
                        ? "bg-[var(--broll-accent)]/10 border border-[var(--broll-accent)] text-[var(--broll-accent)] font-semibold shadow-sm"
                        : "bg-[#111215] border border-white/10 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {entry.label} <span className="broll-tabular font-bold">{counts[entry.key]}</span>
                  </button>
                ))}
              </div>

              {visible.length === 0 ? (
                <div className="broll-glass mt-4 rounded-xl p-6 text-center" role="status">
                  <p className="text-xs text-zinc-400">No scene matches this filter or search.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setFilter("all");
                      setSearchQuery("");
                    }}
                    className="mt-2 text-xs font-semibold text-[var(--broll-accent)] underline"
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
                  className="grid gap-2 overflow-y-auto pr-1 flex-1"
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
                      blocker={blockers.get(scene.id) ?? null}
                      onSelect={() => select(scene.id, false)}
                      onToggleInclude={(included) => toggleInclude(scene, included)}
                    />
                  ))}
                </ul>
              )}

              <p className="mt-3 text-[10px] text-zinc-500 shrink-0">
                <kbd className="px-1 py-0.5 rounded bg-white/10 text-zinc-300">↑</kbd> <kbd className="px-1 py-0.5 rounded bg-white/10 text-zinc-300">↓</kbd> or <kbd className="px-1 py-0.5 rounded bg-white/10 text-zinc-300">j</kbd>/<kbd className="px-1 py-0.5 rounded bg-white/10 text-zinc-300">k</kbd> navigate · <kbd className="px-1 py-0.5 rounded bg-white/10 text-zinc-300">space</kbd> toggle · <kbd className="px-1 py-0.5 rounded bg-white/10 text-zinc-300">enter</kbd> edit
              </p>
            </div>
          )}

          {/* Right/Center Area: Canvas Preview, Timeline, & Inspector Controls */}
          {showDetail && (
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4" style={{ minWidth: 0 }}>
              {onePane && (
                <button
                  type="button"
                  onClick={() => setNarrowDetailOpen(false)}
                  className="mb-3 text-xs underline text-zinc-400 hover:text-white"
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
                  blocker={blockers.get(selected.id) ?? null}
                  transcriptChoices={transcriptChoices}
                  aspectWidth={outputWidth}
                  aspectHeight={outputHeight}
                  locked={planning}
                  reducedMotion={reducedMotion}
                  firstControlRef={firstControlRef}
                  flushRef={flushEditRef}
                  allScenes={scenes}
                  totalIncludedCount={includedCount}
                  readyCount={queue.readyCount}
                  rendering={queue.running}
                  onSelectScene={(id) => select(id, false)}
                  onChange={(patch) => patchScene(selected.id, patch)}
                  onDelete={() => removeScene(selected.id)}
                  onRender={() => renderOne(selected)}
                  onDownload={() => queue.downloadZip(scenes.map((scene) => scene.id))}
                  objectImagePrice={formatUsd(objectImagePriceMicros)}
                  onObjectGenerated={(pathname) =>
                    patchScene(selected.id, {
                      objectAssetPath: pathname,
                      objectAttempt: selected.objectAttempt + 1,
                    })
                  }
                />
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
      <div className="broll-glow max-w-md rounded-xl p-8 text-center bg-[#111215]">
        <h2 className="text-lg font-bold text-white" style={{ fontFamily: "var(--font-space-grotesk)" }}>
          No scenes planned yet
        </h2>
        <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
          {isRerun
            ? `Planning again costs ${rerunPrice}.`
            : "The first plan for this project is included. It reads your transcript and proposes the cutaways worth cutting to."}
        </p>
        <button
          type="button"
          onClick={onPlan}
          className="mt-5 rounded-lg px-5 py-2.5 text-xs font-bold transition-all"
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

function RejectionNote({ rejections }: { rejections: PlanRejection[] }) {
  const scenesRejected = rejections.filter((r) => r.kind === "scene").length;
  const reasons = Array.from(new Set(rejections.map((r) => r.reason))).slice(0, 3);

  return (
    <div className="px-6 pb-2 text-xs text-zinc-400">
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
