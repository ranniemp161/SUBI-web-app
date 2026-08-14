"use client";

import { useEffect, useState } from "react";
import { checkRenderCapability } from "@/lib/render/capability";
import type { ScenePhase } from "./use-render-queue";

/**
 * Renders the open scene to an MP4 and downloads it (spec `0001` Phase 4,
 * AC-29, AC-33; spec `0006` AC-117).
 *
 * **It no longer owns a `Worker`.** It used to construct one per click, beside a
 * batch export that owned another, so pressing this while "Render all" was
 * running put two encoders on one laptop, which is exactly what the batch was
 * built to avoid. It now enqueues into the studio's single render queue, so one
 * encode runs at a time because there is one queue rather than because nobody
 * presses two buttons. The one clip download stays: a creator who renders one
 * scene wants that file, not an archive.
 *
 * The capability check still runs **on mount**, not on click. AC-29's wording is
 * that nothing fails mid export after credits are spent, so a browser that
 * cannot encode has to say so before the user has invested anything in the
 * scene, not after they press the button.
 *
 * Export is free (AC-35). Nothing here touches the ledger, and there is
 * deliberately no confirmation step: rendering costs the user nothing, so a
 * price gate would be inventing friction.
 */

type Capability =
  | { phase: "checking" }
  | { phase: "unsupported"; reason: string }
  | { phase: "ready" };

export function RenderSceneButton({
  width,
  height,
  state,
  disabled = false,
  onRender,
}: {
  width: number;
  height: number;
  /** This scene's phase in the shared queue, or undefined if it has none. */
  state: ScenePhase | undefined;
  /** Inert while a plan run is in flight (AC-116). */
  disabled?: boolean;
  onRender: () => void;
}) {
  const [capability, setCapability] = useState<Capability>({ phase: "checking" });

  useEffect(() => {
    let active = true;
    checkRenderCapability(width, height).then((result) => {
      if (!active) return;
      setCapability(
        result.supported ? { phase: "ready" } : { phase: "unsupported", reason: result.reason }
      );
    });
    return () => {
      active = false;
    };
  }, [width, height]);

  if (capability.phase === "unsupported") {
    return (
      <p className="text-xs" style={{ color: "var(--broll-muted)" }} role="note">
        {capability.reason}
      </p>
    );
  }

  // Already in the queue: the button says so rather than adding a second job,
  // which the queue would refuse anyway (AC-117).
  const busy = state?.phase === "queued" || state?.phase === "rendering";

  const label =
    state?.phase === "queued"
      ? "Queued"
      : state?.phase === "rendering"
        ? `Rendering ${Math.round(state.ratio * 100)}%`
        : "Render this clip";

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onRender}
        disabled={busy || disabled || capability.phase === "checking"}
        className="broll-glass rounded-md px-3 py-1.5 text-xs disabled:opacity-60"
      >
        {label}
      </button>
      {state?.phase === "failed" && (
        <span className="text-xs" role="alert" style={{ color: "#ff6b6b" }}>
          {state.message}
        </span>
      )}
    </div>
  );
}
