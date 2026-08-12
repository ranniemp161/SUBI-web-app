"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawRenderable, type Renderable } from "@/lib/render/renderable";

/**
 * Shows what a scene will actually look like, in the page.
 *
 * Without this the only way to see a scene is to render it, download the MP4
 * and open it in a video player, which is a slow and silly loop for judging
 * whether an infographic reads correctly. The drawing is already a pure
 * function of elapsed time and takes any 2D context, so the same code that
 * feeds the encoder feeds this canvas. That is the point: the preview cannot
 * drift from the render, because there is only one renderer.
 *
 * It holds a settled frame by default rather than looping. A page of scenes
 * each animating forever is noise, and burns a core for nothing.
 */

/** Long enough to be past the entrance, so the still shows the settled figure. */
const SETTLED_MS = 2_000;

export function ScenePreview({
  renderable,
  durationMs,
  aspectWidth,
  aspectHeight,
  previewWidth = 320,
}: {
  renderable: Renderable;
  durationMs: number;
  /** The project's output size, used only for the aspect ratio here. */
  aspectWidth: number;
  aspectHeight: number;
  previewWidth?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const height = Math.max(1, Math.round((previewWidth * aspectHeight) / aspectWidth));

  const paint = useCallback(
    (elapsedMs: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      // Drawing is written in ratios of the frame, so a small canvas is the
      // same picture at a smaller size, not a different layout.
      drawRenderable(ctx, renderable, {
        width: canvas.width,
        height: canvas.height,
        elapsedMs,
      });
    },
    [renderable]
  );

  // The settled still, redrawn whenever the scene or the size changes.
  useEffect(() => {
    if (!playing) paint(SETTLED_MS);
  }, [paint, playing, previewWidth, height]);

  useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now();

    const step = () => {
      const elapsed = performance.now() - startedAt;
      if (elapsed >= durationMs) {
        paint(SETTLED_MS);
        setPlaying(false);
        return;
      }
      paint(elapsed);
      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [playing, durationMs, paint]);

  return (
    <div className="mt-2">
      <canvas
        ref={canvasRef}
        width={previewWidth}
        height={height}
        className="rounded-md"
        style={{ width: previewWidth, height, display: "block" }}
        aria-label={previewLabel(renderable)}
        role="img"
      />
      <button
        type="button"
        onClick={() => setPlaying(true)}
        disabled={playing}
        className="mt-1 text-xs underline disabled:opacity-60"
        style={{ color: "var(--broll-muted)" }}
      >
        {playing ? "Playing" : "Play the motion"}
      </button>
    </div>
  );
}

/** A short description of the frame, for anyone using a screen reader. */
function previewLabel(renderable: Renderable): string {
  if (renderable.template === "chart-full") {
    return `Preview: chart, ${renderable.scene.title}`;
  }
  if (renderable.template === "text-card") {
    return renderable.scene.text
      ? `Preview: text card reading ${renderable.scene.text}`
      : "Preview: empty text card";
  }
  return renderable.scene.text
    ? `Preview: character with the words ${renderable.scene.text}`
    : "Preview: character with no on screen text";
}
