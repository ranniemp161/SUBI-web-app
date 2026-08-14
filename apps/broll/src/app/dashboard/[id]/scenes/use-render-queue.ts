"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoFps } from "@repo/transcript";
import { sceneClipFilename } from "@/lib/render/clip-filename";
import type { Renderable } from "@/lib/render/renderable";
import { startRender } from "@/lib/render/run-render";
import type { RenderSceneRequest } from "@/lib/render/types";
import { buildZip, type ZipEntry } from "@/lib/render/zip";

/**
 * The one place on this screen that knows what is rendering
 * (spec `broll/0006` AC-108, AC-117).
 *
 * **Why it is a hook in the shell rather than state in a component.** Until
 * this screen existed, one component both started a render and displayed it, so
 * all of this lived privately inside `batch-export.tsx`. The studio splits those
 * two jobs: the bar starts a batch, the rows display each scene's progress, and
 * the detail pane starts a single scene. Three components reading one truth
 * means the truth has to live above all three.
 *
 * **One driver, one encode at a time** (AC-117). Both entry points enqueue here,
 * so the app's rule that scenes render in order rather than racing holds because
 * there is one queue, not because nobody presses two buttons. Encoding is GPU
 * and memory heavy: a dozen encoders on a laptop is slower than doing them in
 * order and far likelier to kill the tab.
 *
 * **One scene failing does not stop the batch** (AC-32). A failure is recorded
 * and the loop moves on, finished clips are held between runs so a retry zips
 * alongside them, and the zip is built in plan order rather than completion
 * order so the archive reads like the timeline.
 *
 * **This state is the browser session's only** (AC-108). Nothing is written to
 * the database, so after a reload every row honestly reads as not yet rendered
 * rather than claiming a status the page cannot know. `broll_scenes.render_status`
 * stays unwritten and unread.
 *
 * Rendering is free (AC-35): nothing in here touches the ledger.
 */

export type ScenePhase =
  | { phase: "queued" }
  | { phase: "rendering"; ratio: number }
  | { phase: "done"; bytes: number }
  | { phase: "failed"; message: string };

export interface RenderJob {
  id: string;
  /** 1 based position in the plan, which is what the filename carries. */
  index: number;
  startMs: number;
  durationMs: number;
  renderable: Renderable;
  /**
   * Hand this one clip straight to the creator when it lands.
   *
   * The detail pane's single scene button sets it, because a creator who
   * renders one scene wants that file, not an archive. A batch never does.
   */
  downloadWhenDone?: boolean;
}

export interface RenderQueue {
  /** Every scene this session has a phase for. Absent means not yet rendered. */
  states: Record<string, ScenePhase>;
  running: boolean;
  /** The scene encoding right now, or null. */
  currentId: string | null;
  readyCount: number;
  failedIds: string[];
  /** Refused, not doubled, for a scene already queued or rendering (AC-117). */
  enqueue: (jobs: RenderJob[]) => void;
  /** Stops after the scene in flight, exactly as the batch always has. */
  cancel: () => void;
  /** Builds the zip in the given order and hands it over. */
  downloadZip: (orderedIds: string[]) => void;
  /** Clears every phase and every held clip. A re-run replaces the scenes. */
  reset: () => void;
}

export function useRenderQueue({
  width,
  height,
  fps,
}: {
  width: number;
  height: number;
  fps: VideoFps;
}): RenderQueue {
  const [states, setStates] = useState<Record<string, ScenePhase>>({});
  const [running, setRunning] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const queueRef = useRef<RenderJob[]>([]);
  // `currentId` is read inside `enqueue`, which must not be rebuilt every time
  // a scene starts encoding, or the bar's handlers would change mid batch.
  const currentIdRef = useRef<string | null>(null);
  const drainingRef = useRef(false);
  const cancelRef = useRef(false);
  const mountedRef = useRef(true);
  // Held between runs so a retry of one failure can still zip the rest.
  const clipsRef = useRef<Map<string, ZipEntry>>(new Map());
  // The encode settings, read through a ref so the drain loop is mounted once
  // and never torn down mid render by a prop identity change.
  const outputRef = useRef({ width, height, fps });

  useEffect(() => {
    outputRef.current = { width, height, fps };
  }, [width, height, fps]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // A render outlives a navigation. Nothing here can cancel the worker the
      // driver owns, but every state write after this point is dropped rather
      // than warned about.
      mountedRef.current = false;
    };
  }, []);

  const setPhase = useCallback((id: string, phase: ScenePhase) => {
    if (!mountedRef.current) return;
    setStates((previous) => ({ ...previous, [id]: phase }));
  }, []);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setRunning(true);

    for (;;) {
      if (cancelRef.current) {
        // Everything still waiting loses its queued phase, so the rows stop
        // claiming they are about to start.
        const abandoned = queueRef.current.splice(0);
        if (mountedRef.current && abandoned.length > 0) {
          setStates((previous) => {
            const next = { ...previous };
            for (const job of abandoned) {
              if (next[job.id]?.phase === "queued") delete next[job.id];
            }
            return next;
          });
        }
        break;
      }

      const job = queueRef.current.shift();
      if (!job) break;

      currentIdRef.current = job.id;
      setCurrentId(job.id);
      setPhase(job.id, { phase: "rendering", ratio: 0 });

      const { width: w, height: h, fps: rate } = outputRef.current;
      const request = {
        type: "render",
        ...job.renderable,
        width: w,
        height: h,
        fps: rate,
        durationMs: job.durationMs,
      } as RenderSceneRequest;

      try {
        const handle = startRender(request, (ratio) =>
          setPhase(job.id, { phase: "rendering", ratio })
        );
        const buffer = await handle.done;
        const data = new Uint8Array(buffer);
        const name = sceneClipFilename({
          index: job.index,
          startMs: job.startMs,
          fps: rate,
        });
        clipsRef.current.set(job.id, { name, data });
        setPhase(job.id, { phase: "done", bytes: data.length });
        if (job.downloadWhenDone) downloadClip(data, name);
      } catch (error) {
        // Recorded, not thrown: the batch carries on to the next scene (AC-32).
        setPhase(job.id, {
          phase: "failed",
          message: error instanceof Error ? error.message : "Render failed.",
        });
      }
    }

    currentIdRef.current = null;
    setCurrentId(null);
    setRunning(false);
    drainingRef.current = false;
  }, [setPhase]);

  const enqueue = useCallback(
    (jobs: RenderJob[]) => {
      cancelRef.current = false;
      const accepted: RenderJob[] = [];

      for (const job of jobs) {
        const alreadyWaiting = queueRef.current.some((queued) => queued.id === job.id);
        // Refused rather than started twice: a second encoder for one scene is
        // the exact hazard one queue exists to remove (AC-117).
        if (alreadyWaiting || currentIdRef.current === job.id) continue;
        accepted.push(job);
      }

      if (accepted.length === 0) return;

      queueRef.current.push(...accepted);
      setStates((previous) => {
        const next = { ...previous };
        for (const job of accepted) next[job.id] = { phase: "queued" };
        return next;
      });
      void drain();
    },
    [drain]
  );

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const downloadZip = useCallback((orderedIds: string[]) => {
    // Plan order rather than completion order, so the archive reads like the
    // timeline even when a retry finished last.
    const ordered = orderedIds
      .map((id) => clipsRef.current.get(id))
      .filter((entry): entry is ZipEntry => Boolean(entry));
    if (ordered.length === 0) return;

    const archive = buildZip(ordered);
    // `archive.buffer` rather than the view: TypeScript's BlobPart does not
    // accept a Uint8Array over a generic ArrayBufferLike, and the view spans
    // the whole buffer here anyway.
    saveBlob(
      new Blob([archive.buffer as ArrayBuffer], { type: "application/zip" }),
      "b-roll-clips.zip"
    );
  }, []);

  const reset = useCallback(() => {
    queueRef.current = [];
    clipsRef.current = new Map();
    setStates({});
  }, []);

  const entries = Object.entries(states);

  return {
    states,
    running,
    currentId,
    readyCount: entries.filter(([, state]) => state.phase === "done").length,
    failedIds: entries
      .filter(([, state]) => state.phase === "failed")
      .map(([id]) => id),
    enqueue,
    cancel,
    downloadZip,
    reset,
  };
}

/** Saves one encoded clip as a file, via a temporary anchor. */
function downloadClip(data: Uint8Array, filename: string): void {
  saveBlob(new Blob([data.buffer as ArrayBuffer], { type: "video/mp4" }), filename);
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
