"use client";

import { useEffect, useRef } from "react";
import { drawRenderable, type Renderable } from "@/lib/render/renderable";

/**
 * One frame of a scene, in its row (spec `broll/0006` AC-100, AC-101).
 *
 * **This canvas never loops, and that is the whole design.** Before this screen
 * existed, every scene in the list carried a full preview that animated on
 * hover, and a module level handshake kept them from all running at once. Twenty
 * frame loops held back by a shared variable is a rule you have to keep; twenty
 * canvases that each draw once and stop is a fact about the code. The detail
 * pane's preview is now the only animating canvas on the screen, so AC-88's
 * "at most one preview animates" is true by construction (AC-101).
 *
 * It draws **one frame per change of its inputs**: the scene changing, or the
 * character cutout arriving. Never on a timer, never on an animation frame.
 *
 * Drawn through the same `drawRenderable` and the same `toRenderable` mapping
 * the encoder uses, so a still cannot show something the clip will not.
 */

/** Long enough to be past the entrance, so the still shows the settled figure. */
const SETTLED_MS = 2_000;

export function SceneStill({
  renderable,
  width,
  aspectWidth,
  aspectHeight,
  label,
}: {
  renderable: Renderable;
  width: number;
  /** The project's output size, used only for the aspect ratio here. */
  aspectWidth: number;
  aspectHeight: number;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const height = Math.max(1, Math.round((width * aspectHeight) / aspectWidth));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // The same reset the preview does before every repaint. A still repaints on
    // every edit, so a transform or an alpha left behind by the previous draw
    // would bleed the old frame through exactly as it does in a loop.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;

    // Drawing is written in ratios of the frame, so a small canvas is the same
    // picture at a smaller size, not a different layout.
    drawRenderable(ctx, renderable, {
      width: canvas.width,
      height: canvas.height,
      elapsedMs: SETTLED_MS,
    });
  }, [renderable, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="rounded-md shrink-0"
      style={{ width, height, display: "block" }}
      role="img"
      aria-label={label}
    />
  );
}

/**
 * The stand in for a template nobody has written a drawer for yet.
 *
 * Labelled rather than blank (AC-100): two of the six templates have no
 * renderer, and an empty box in a list of pictures reads as a scene that failed
 * rather than one the app cannot draw.
 */
export function StillPlaceholder({
  width,
  aspectWidth,
  aspectHeight,
  template,
}: {
  width: number;
  aspectWidth: number;
  aspectHeight: number;
  template: string;
}) {
  const height = Math.max(1, Math.round((width * aspectHeight) / aspectWidth));

  return (
    <div
      className="broll-glass rounded-md shrink-0 flex items-center justify-center px-1 text-center"
      style={{ width, height }}
      role="img"
      aria-label={`No preview: ${template} has no renderer yet`}
    >
      <span className="text-[9px] leading-tight" style={{ color: "var(--broll-muted)" }}>
        No preview yet
      </span>
    </div>
  );
}
