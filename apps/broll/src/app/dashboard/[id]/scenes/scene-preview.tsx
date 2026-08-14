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
 *
 * **This is now the only animating canvas on the screen** (spec `broll/0006`
 * AC-101). The list draws stills through `scene-still.tsx`, which never starts a
 * loop, so "at most one preview animates" is a property of the component tree
 * rather than a rule the module level handshake below has to enforce. That
 * handshake stays as a guard, because a screen that mounts two of these later
 * should still degrade to one running loop rather than to two.
 *
 * **Canvas discipline** (spec `0001` rationale §2.9, written down from Phase 0's
 * two worst rendering bugs, and both live here now that scenes are editable):
 * reset the context before repainting, and mount the render loop once, reading
 * current values from refs. Listing the scene in the loop's dependencies would
 * tear it down on every keystroke, and under React's dev double invoke that
 * leaves two loops driving one canvas. With twenty scenes that shows up as
 * flicker and a hot fan rather than obvious ghosting.
 */

/** Long enough to be past the entrance, so the still shows the settled figure. */
const SETTLED_MS = 2_000;

/**
 * The one preview allowed to animate, as a stop callback (AC-88).
 *
 * Module scope rather than React state on purpose: this is a fact about the
 * page, not about any one row, and threading it through twenty scenes as props
 * would make every row re-render whenever any other row was hovered. A creator
 * dragging the pointer down a long list would otherwise leave a trail of
 * looping canvases, which is the cost this whole design exists to avoid.
 */
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
  /** The project's output size, used only for the aspect ratio here. */
  aspectWidth: number;
  aspectHeight: number;
  /**
   * The canvas backing store. The element itself fills the pane up to this
   * width, and the drawing is written in ratios of the frame, so a narrower
   * pane is the same picture at a smaller size rather than a different layout.
   */
  previewWidth?: number;
  /** Nothing plays on hover or on focus while this is true (AC-111). */
  reducedMotion?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);

  // Hazard 2: the loop reads what it draws through refs, never through a
  // dependency, so typing in the text field beside it cannot restart it. The
  // refs are synced in an effect rather than during render, which is the only
  // sanctioned way to write one.
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

    // Hazard 1: reset before repainting, every frame. A stray transform or a
    // globalAlpha below 1 left behind makes the repaint itself scaled or
    // translucent, and the previous frame bleeds through. It presents as
    // compositing ghosting and is really bookkeeping.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;

    // Drawing is written in ratios of the frame, so a small canvas is the
    // same picture at a smaller size, not a different layout.
    drawRenderable(ctx, renderableRef.current, {
      width: canvas.width,
      height: canvas.height,
      elapsedMs,
    });
  }, []);

  // The settled still does depend on the scene: it has no loop to tear down,
  // so repainting on every edit is exactly what should happen.
  useEffect(() => {
    if (!playing) paint(SETTLED_MS);
  }, [paint, playing, renderable, previewWidth, height]);

  useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now();

    // Claiming stops whichever preview was animating before this one, so a
    // pointer travelling down the list leaves nothing running behind it.
    const stop = () => setPlaying(false);
    claimPlayback(stop);

    const step = () => {
      // The scene's real duration, so what a creator watches is the length the
      // clip will actually be rather than a fixed preview loop.
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

  // Hover plays it (AC-88). Focus does too, so this is reachable without a
  // pointer, and the button below stays for touch, which has no hover at all.
  // All three paths go through the same state, so the one animating preview
  // rule holds however playback started.
  //
  // Under reduced motion none of the automatic paths is attached at all
  // (AC-111): the preview shows its settled still and plays only when a creator
  // asks for it. Attaching the handlers and ignoring them inside would still
  // start and stop a frame loop on every pointer pass.
  const autoPlay = reducedMotion
    ? {}
    : {
        onMouseEnter: () => setPlaying(true),
        onMouseLeave: () => setPlaying(false),
        onFocus: () => setPlaying(true),
        onBlur: () => setPlaying(false),
      };

  return (
    <div {...autoPlay}>
      <canvas
        ref={canvasRef}
        width={previewWidth}
        height={height}
        className="broll-glow rounded-lg"
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
      <button
        type="button"
        onClick={() => setPlaying(true)}
        disabled={playing}
        className="mt-2 text-xs underline disabled:opacity-60"
        style={{ color: "var(--broll-muted)" }}
      >
        {playing
          ? "Playing"
          : `Play the motion (${(durationMs / 1000).toFixed(1)}s)`}
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
