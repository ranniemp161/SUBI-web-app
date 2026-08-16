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

export function ScenePreview({
  renderable,
  durationMs,
  aspectWidth,
  aspectHeight,
  previewWidth = 640,
  reducedMotion = false,
}: {
  renderable: Renderable;
  durationMs: number;
  aspectWidth: number;
  aspectHeight: number;
  previewWidth?: number;
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
      <div className="w-full relative rounded-xl overflow-hidden bg-black border border-white/[0.08] shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
        <canvas
          ref={canvasRef}
          width={previewWidth}
          height={height}
          style={{
            width: "100%",
            maxWidth: previewWidth,
            height: "auto",
            aspectRatio: `${aspectWidth} / ${aspectHeight}`,
            display: "block",
          }}
          aria-label={previewLabel(renderable)}
          role="img"
        />
      </div>

      <div className="w-full flex items-center justify-end mt-2">
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
