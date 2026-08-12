"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_OVERLAY_TEXT_CHARS } from "@/lib/scene-limits";

/**
 * Scene Studio's two overrides: whether a scene is exported, and the words
 * burned on screen (spec `broll/0001`, feature 6).
 *
 * Only these two. Every other field is either measured or traced: the timings
 * come from the cited utterance rather than the model, and the chart survived
 * the honesty check against the transcript. Making those editable would let a
 * creator put back a number the app had just refused to invent, which is the
 * one thing it must never allow.
 *
 * **Excluding never deletes.** It sets a flag, so a creator who excludes a
 * scene and changes their mind has lost nothing.
 *
 * Saves are optimistic and debounced. Typing is the common case and a round
 * trip per keystroke would make the field feel broken; the preview beside this
 * redraws from local state immediately either way.
 */

/** Long enough to coalesce typing, short enough to feel saved. */
const SAVE_DEBOUNCE_MS = 600;

type SaveState = "idle" | "saving" | "failed";

export function SceneOverrides({
  projectId,
  sceneId,
  included,
  overlayText,
  onChange,
}: {
  projectId: string;
  sceneId: string;
  included: boolean;
  overlayText: string | null;
  /** Applied locally at once, so the preview and the batch react immediately. */
  onChange: (patch: { included?: boolean; overlayText?: string | null }) => void;
}) {
  const [state, setState] = useState<SaveState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    async (patch: { included?: boolean; overlayText?: string | null }) => {
      setState("saving");
      try {
        const response = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        setState(response.ok ? "idle" : "failed");
      } catch {
        setState("failed");
      }
    },
    [projectId, sceneId]
  );

  // A pending save must not outlive the row. Without this, editing and then
  // re-running the plan fires a PATCH against a scene that no longer exists.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onText = (value: string) => {
    onChange({ overlayText: value });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void save({ overlayText: value.trim() === "" ? null : value.trim() });
    }, SAVE_DEBOUNCE_MS);
  };

  const onIncluded = (value: boolean) => {
    onChange({ included: value });
    // Not debounced: a toggle is one deliberate action, and waiting to save it
    // would leave the export set ambiguous if the tab closed.
    void save({ included: value });
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs" style={{ color: "var(--broll-muted)" }}>
        <input
          type="checkbox"
          checked={included}
          onChange={(event) => onIncluded(event.target.checked)}
        />
        Include in export
      </label>

      <label className="flex flex-1 items-center gap-2 text-xs" style={{ color: "var(--broll-muted)" }}>
        <span className="shrink-0">On screen text</span>
        <input
          type="text"
          value={overlayText ?? ""}
          maxLength={MAX_OVERLAY_TEXT_CHARS}
          placeholder="None"
          onChange={(event) => onText(event.target.value)}
          className="broll-glass min-w-0 flex-1 rounded-md px-2 py-1 text-xs"
        />
      </label>

      {state === "saving" && <span className="text-xs" style={{ color: "var(--broll-muted)" }}>Saving…</span>}
      {state === "failed" && (
        <span className="text-xs" role="alert" style={{ color: "#ff6b6b" }}>
          Not saved
        </span>
      )}
    </div>
  );
}
