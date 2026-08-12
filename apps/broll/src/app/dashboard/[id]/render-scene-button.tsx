"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoFps } from "@repo/transcript";
import { checkRenderCapability } from "@/lib/render/capability";
import { sceneClipFilename } from "@/lib/render/clip-filename";
import type { ChartFullScene } from "@/lib/render/chart-full";
import type { RenderResponseMessage, RenderSceneRequest } from "@/lib/render/types";

/**
 * Renders one `chart-full` scene to an MP4 and downloads it (spec `0001`
 * Phase 4, AC-29 and AC-33).
 *
 * The capability check runs **on mount**, not on click. AC-29's wording is that
 * nothing fails mid export after credits are spent, so a browser that cannot
 * encode has to say so before the user has invested anything in the scene, not
 * after they press the button.
 *
 * Export is free (AC-35). Nothing here touches the ledger, and there is
 * deliberately no confirmation step: rendering costs the user nothing, so a
 * price gate would be inventing friction.
 */

type Status =
  | { phase: "checking" }
  | { phase: "unsupported"; reason: string }
  | { phase: "idle" }
  | { phase: "rendering"; ratio: number }
  | { phase: "failed"; message: string };

export function RenderSceneButton({
  scene,
  index,
  startMs,
  durationMs,
  width,
  height,
  fps,
}: {
  scene: ChartFullScene;
  /** 1 based position in the plan, which is what the filename carries. */
  index: number;
  startMs: number;
  durationMs: number;
  width: number;
  height: number;
  fps: VideoFps;
}) {
  const [status, setStatus] = useState<Status>({ phase: "checking" });
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    let active = true;
    checkRenderCapability(width, height).then((result) => {
      if (!active) return;
      setStatus(result.supported ? { phase: "idle" } : { phase: "unsupported", reason: result.reason });
    });
    return () => {
      active = false;
    };
  }, [width, height]);

  // A worker outlives a click, so it has to be torn down when the row unmounts
  // mid render. Otherwise an encode keeps running against a canvas nobody is
  // waiting for.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const render = useCallback(() => {
    if (status.phase === "rendering") return;
    setStatus({ phase: "rendering", ratio: 0 });

    const worker = new Worker(new URL("../../../workers/render-worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    const finish = () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };

    worker.onmessage = (event: MessageEvent<RenderResponseMessage>) => {
      const message = event.data;

      if (message.type === "progress") {
        setStatus({ phase: "rendering", ratio: message.ratio });
        return;
      }

      if (message.type === "done") {
        downloadMp4(message.buffer, sceneClipFilename({ index, startMs, fps }));
        setStatus({ phase: "idle" });
        finish();
        return;
      }

      if (message.type === "canceled") {
        setStatus({ phase: "idle" });
        finish();
        return;
      }

      setStatus(
        message.type === "error" && message.code === "unsupported"
          ? { phase: "unsupported", reason: message.message }
          : { phase: "failed", message: message.message }
      );
      finish();
    };

    // A worker that fails to load at all never posts a message, so without this
    // the button would spin forever.
    worker.onerror = () => {
      setStatus({ phase: "failed", message: "The renderer failed to start." });
      finish();
    };

    const request: RenderSceneRequest = {
      type: "render",
      template: "chart-full",
      scene,
      width,
      height,
      fps,
      durationMs,
    };
    worker.postMessage(request);
  }, [status.phase, scene, index, startMs, durationMs, width, height, fps]);

  if (status.phase === "unsupported") {
    return (
      <p className="mt-2 text-xs" style={{ color: "var(--broll-muted)" }} role="note">
        {status.reason}
      </p>
    );
  }

  const busy = status.phase === "rendering";

  return (
    <div className="mt-2 flex items-center gap-3">
      <button
        type="button"
        onClick={render}
        disabled={busy || status.phase === "checking"}
        className="broll-glass rounded-md px-3 py-1.5 text-xs disabled:opacity-60"
      >
        {busy ? `Rendering ${Math.round(status.ratio * 100)}%` : "Render MP4"}
      </button>
      {status.phase === "failed" && (
        <span className="text-xs" style={{ color: "var(--broll-danger, #ff6b6b)" }} role="alert">
          {status.message}
        </span>
      )}
    </div>
  );
}

/** Saves the encoded bytes as a file, via a temporary anchor. */
function downloadMp4(buffer: ArrayBuffer, filename: string): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: "video/mp4" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
