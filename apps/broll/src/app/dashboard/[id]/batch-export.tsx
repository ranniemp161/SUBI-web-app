"use client";

import { useCallback, useRef, useState } from "react";
import type { VideoFps } from "@repo/transcript";
import { sceneClipFilename } from "@/lib/render/clip-filename";
import type { Renderable } from "@/lib/render/renderable";
import { startRender } from "@/lib/render/run-render";
import type { RenderSceneRequest } from "@/lib/render/types";
import { buildZip, type ZipEntry } from "@/lib/render/zip";

/**
 * Renders every scene that has a template and downloads them as one zip
 * (spec `0001` Phase 6, AC-32 and AC-35).
 *
 * **One scene failing does not stop the batch** (AC-32). A run of twelve clips
 * where the fourth fails must still hand over the other eleven, and offer to
 * retry the one that failed on its own. Anything else means a single bad scene
 * costs the whole export.
 *
 * **Scenes render one at a time.** Encoding is GPU and memory heavy, and a
 * dozen encoders racing on a laptop is slower than doing them in order as well
 * as far more likely to fall over.
 *
 * Export is free (AC-35): nothing here touches the ledger.
 */

export interface BatchScene {
  id: string;
  /** 1 based position in the plan, which is what the filename carries. */
  index: number;
  startMs: number;
  durationMs: number;
  renderable: Renderable;
}

type SceneState =
  | { phase: "waiting" }
  | { phase: "rendering"; ratio: number }
  | { phase: "done"; bytes: number }
  | { phase: "failed"; message: string };

export function BatchExport({
  batchScenes: scenes,
  width,
  height,
  fps,
}: {
  batchScenes: BatchScene[];
  width: number;
  height: number;
  fps: VideoFps;
}) {
  const [states, setStates] = useState<Record<string, SceneState>>({});
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);
  // Held between runs so a retry of one failure can still zip the rest.
  const clipsRef = useRef<Map<string, ZipEntry>>(new Map());

  const setState = useCallback((id: string, state: SceneState) => {
    setStates((previous) => ({ ...previous, [id]: state }));
  }, []);

  const renderOne = useCallback(
    async (scene: BatchScene) => {
      setState(scene.id, { phase: "rendering", ratio: 0 });
      const request = {
        type: "render",
        ...scene.renderable,
        width,
        height,
        fps,
        durationMs: scene.durationMs,
      } as RenderSceneRequest;

      try {
        const handle = startRender(request, (ratio) =>
          setState(scene.id, { phase: "rendering", ratio })
        );
        const buffer = await handle.done;
        const data = new Uint8Array(buffer);
        clipsRef.current.set(scene.id, {
          name: sceneClipFilename({ index: scene.index, startMs: scene.startMs, fps }),
          data,
        });
        setState(scene.id, { phase: "done", bytes: data.length });
      } catch (error) {
        // Recorded, not thrown: the batch carries on to the next scene.
        setState(scene.id, {
          phase: "failed",
          message: error instanceof Error ? error.message : "Render failed.",
        });
      }
    },
    [setState, width, height, fps]
  );

  const runBatch = useCallback(
    async (subset: BatchScene[]) => {
      if (running) return;
      setRunning(true);
      cancelRef.current = false;
      for (const scene of subset) {
        if (cancelRef.current) break;
        await renderOne(scene);
      }
      setRunning(false);
    },
    [running, renderOne]
  );

  const download = useCallback(() => {
    // Zipped in plan order rather than completion order, so the archive reads
    // like the timeline even when a retry finished last.
    const ordered = scenes
      .map((scene) => clipsRef.current.get(scene.id))
      .filter((entry): entry is ZipEntry => Boolean(entry));
    if (ordered.length === 0) return;

    const archive = buildZip(ordered);
    // `archive.buffer` rather than the view: TypeScript's BlobPart does not
    // accept a Uint8Array over a generic ArrayBufferLike, and the view spans
    // the whole buffer here anyway.
    const url = URL.createObjectURL(
      new Blob([archive.buffer as ArrayBuffer], { type: "application/zip" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "b-roll-clips.zip";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [scenes]);

  if (scenes.length === 0) return null;

  const failed = scenes.filter((scene) => states[scene.id]?.phase === "failed");
  const ready = scenes.filter((scene) => states[scene.id]?.phase === "done").length;
  const current = scenes.find((scene) => states[scene.id]?.phase === "rendering");
  const currentState = current ? states[current.id] : undefined;

  return (
    <div className="broll-glass mt-6 rounded-lg px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => runBatch(scenes)}
          disabled={running}
          className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
          style={{ background: "var(--broll-accent)", color: "var(--broll-accent-foreground)" }}
        >
          {running ? "Rendering…" : `Render all ${scenes.length} clips`}
        </button>

        {running && (
          <button
            type="button"
            onClick={() => {
              cancelRef.current = true;
            }}
            className="text-xs underline"
            style={{ color: "var(--broll-muted)" }}
          >
            Stop after this one
          </button>
        )}

        {ready > 0 && !running && (
          <button
            type="button"
            onClick={download}
            className="broll-glass rounded-md px-3 py-1.5 text-xs"
          >
            Download {ready} clip{ready === 1 ? "" : "s"} as a zip
          </button>
        )}

        {failed.length > 0 && !running && (
          <button
            type="button"
            onClick={() => runBatch(failed)}
            className="broll-glass rounded-md px-3 py-1.5 text-xs"
          >
            Retry {failed.length} failed
          </button>
        )}
      </div>

      <p className="mt-2 text-xs" style={{ color: "var(--broll-muted)" }} role="status" aria-live="polite">
        {running && current
          ? `Scene ${current.index} of ${scenes.length}${
              currentState?.phase === "rendering"
                ? `, ${Math.round(currentState.ratio * 100)}%`
                : ""
            }`
          : ready === 0 && failed.length === 0
            ? "Rendering is free and happens entirely in this browser."
            : `${ready} ready${failed.length > 0 ? `, ${failed.length} failed` : ""}.`}
      </p>

      {failed.length > 0 && !running && (
        <ul className="mt-2 text-xs" style={{ color: "var(--broll-muted)" }}>
          {failed.map((scene) => {
            const state = states[scene.id];
            return (
              <li key={scene.id}>
                Scene {scene.index}: {state?.phase === "failed" ? state.message : "failed"}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
