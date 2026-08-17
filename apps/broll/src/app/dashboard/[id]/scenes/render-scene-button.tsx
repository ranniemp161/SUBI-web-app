"use client";

import { useEffect, useState } from "react";
import { checkRenderCapability } from "@/lib/render/capability";
import type { ScenePhase } from "./use-render-queue";
import { Button } from "@/components/ui";

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
    checkRenderCapability(width, height)
      .then((result) => {
        if (!active) return;
        setCapability(
          result.supported ? { phase: "ready" } : { phase: "unsupported", reason: result.reason }
        );
      })
      .catch(() => {
        if (active) {
          setCapability({
            phase: "unsupported",
            reason:
              "Couldn't check whether this browser can encode video, so rendering is unavailable here. Try Chrome or Edge on a desktop.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [width, height]);

  if (capability.phase === "unsupported") {
    return (
      <p className="text-xs text-zinc-400" role="note">
        {capability.reason}
      </p>
    );
  }

  const busy = state?.phase === "queued" || state?.phase === "rendering";

  const label =
    state?.phase === "queued"
      ? "Queued"
      : state?.phase === "rendering"
        ? `Rendering ${Math.round(state.ratio * 100)}%`
        : "Render this clip";

  return (
    <div className="flex items-center gap-2.5">
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={onRender}
        disabled={busy || disabled || capability.phase === "checking"}
      >
        {label}
      </Button>
      {state?.phase === "failed" && (
        <span className="text-xs" role="alert" style={{ color: "#ff6b6b" }}>
          {state.message}
        </span>
      )}
    </div>
  );
}
