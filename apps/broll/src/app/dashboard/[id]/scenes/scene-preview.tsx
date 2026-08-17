"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawRenderable, type Renderable } from "@/lib/render/renderable";
import { Button } from "@/components/ui";

const SETTLED_MS = 2_000;

let activeStop: (() => void) | null = null;

function claimPlayback(stop: () => void): void {
  if (activeStop && activeStop !== stop) activeStop();
  activeStop = stop;
}

function releasePlayback(stop: () => void): void {
  if (activeStop === stop) activeStop = null;
}

/**
 * How tall the preview may get, whatever shape the project is cut in.
 *
 * A 9:16 clip sized only by the column's width is taller than the pane it sits
 * in, which pushes the source citation and the timeline below the fold and
 * leaves the character cropped by the viewport rather than by the frame. The
 * studio shell is a fixed height (`100dvh - 56px`), so a viewport relative cap
 * is measured against something real here; the pixel ceiling stops the preview
 * growing past a comfortable reviewing size on a tall monitor.
 */
const MAX_PREVIEW_HEIGHT = "min(60vh, 620px)";

export function ScenePreview({
  renderable,
  durationMs,
  aspectWidth,
  aspectHeight,
  previewWidth = 640,
  maxHeight = MAX_PREVIEW_HEIGHT,
  reducedMotion = false,
}: {
  renderable: Renderable;
  durationMs: number;
  aspectWidth: number;
  aspectHeight: number;
  previewWidth?: number;
  /** Any CSS length. The frame keeps its shape and shrinks to fit inside it. */
  maxHeight?: string;
  reducedMotion?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const renderableRef = useRef(renderable);
  const durationRef = useRef(durationMs);

  useEffect(() => {
    renderableRef.current = renderable;
    durationRef.current = durationMs;
  }, [renderable, durationMs]);

  const height = Math.max(1, Math.round((previewWidth * aspectHeight) / aspectWidth));

  const paint = useCallback((elapsedMs: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;

    drawRenderable(ctx, renderableRef.current, {
      width: canvas.width,
      height: canvas.height,
      elapsedMs,
    });
  }, []);

  useEffect(() => {
    if (!playing) paint(SETTLED_MS);
  }, [paint, playing, renderable, previewWidth, height]);

  useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now();

    const stop = () => setPlaying(false);
    claimPlayback(stop);

    const step = () => {
      const elapsed = performance.now() - startedAt;
      if (elapsed >= durationRef.current) {
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
      releasePlayback(stop);
    };
  }, [playing, paint]);

  const autoPlay = reducedMotion
    ? {}
    : {
        onMouseEnter: () => setPlaying(true),
        onMouseLeave: () => setPlaying(false),
        onFocus: () => setPlaying(true),
        onBlur: () => setPlaying(false),
      };

  return (
    <div {...autoPlay} className="w-full flex flex-col items-center">
      {/* Hugs the frame rather than the column, so a vertical clip is not a
          narrow picture floating in a wide black box, and the button below
          lines up with the edge of the frame it belongs to. */}
      <div className="flex flex-col max-w-full min-w-0">
        <div className="relative rounded-xl overflow-hidden bg-black border border-white/[0.08] shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
          <canvas
            ref={canvasRef}
            width={previewWidth}
            height={height}
            // A canvas is a replaced element, so `auto` on both axes with a max
            // on each keeps the frame's shape while it shrinks to fit whichever
            // limit it meets first. Setting a width and clamping the height
            // instead would squash the picture rather than scale it.
            style={{
              width: "auto",
              height: "auto",
              maxWidth: "100%",
              maxHeight,
              aspectRatio: `${aspectWidth} / ${aspectHeight}`,
              display: "block",
            }}
            aria-label={previewLabel(renderable)}
            role="img"
          />
        </div>

        <div className="flex items-center justify-end mt-2">
          <Button
            type="button"
            variant="glass"
            size="sm"
            onClick={() => setPlaying(true)}
            disabled={playing}
          >
            {playing
              ? "Playing motion…"
              : `Play motion (${(durationMs / 1000).toFixed(1)}s)`}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
