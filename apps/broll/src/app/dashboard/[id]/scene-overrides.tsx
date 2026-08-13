"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_OVERLAY_TEXT_CHARS } from "@/lib/scene-limits";
import type { LayoutTemplate } from "@/lib/scene-schema";
import type { CharacterEmotion } from "@/lib/emotions";
import { isCharacterTemplate, templateOptionsFor } from "@/lib/scene-templates";

/**
 * Scene Studio's edit controls: how a scene looks, whether it ships, and (for a
 * scene the creator added) whether it stays at all (spec `broll/0005`).
 *
 * **Presentation is editable; claims are not.** The template, the emotion, the
 * words on screen and the include flag are all a creator's to choose. The
 * chart's numbers and the scene's timings are not offered here at all, because
 * both are traced back to the transcript and editing either would let someone
 * publish a figure the app had just refused to invent. That is the whole line,
 * and it is drawn at whether a field carries a claim rather than at how hard
 * the field is to build.
 *
 * **A template this scene cannot draw is never offered**, rather than offered
 * and rejected (AC-75). `templateOptionsFor` is shared with the route, so the
 * picker and the server cannot disagree about what is allowed.
 *
 * Saves are optimistic and debounced. Typing is the common case and a round
 * trip per keystroke would make the field feel broken; the preview beside this
 * redraws from local state immediately either way.
 */

/** Long enough to coalesce typing, short enough to feel saved. */
const SAVE_DEBOUNCE_MS = 600;

type SaveState = "idle" | "saving" | "failed";

export type ScenePatch = {
  included?: boolean;
  overlayText?: string | null;
  layoutTemplate?: LayoutTemplate;
  emotion?: CharacterEmotion | null;
};

export function SceneOverrides({
  projectId,
  sceneId,
  included,
  overlayText,
  layoutTemplate,
  emotion,
  origin,
  hasChart,
  committedEmotions,
  onChange,
  onDelete,
}: {
  projectId: string;
  sceneId: string;
  included: boolean;
  overlayText: string | null;
  layoutTemplate: LayoutTemplate;
  emotion: CharacterEmotion | null;
  origin: string;
  /** Gates `chart-full`: a scene with no chart cannot draw one (AC-75). */
  hasChart: boolean;
  /** Gates the character templates and fills the emotion picker (AC-77). */
  committedEmotions: CharacterEmotion[];
  /** Applied locally at once, so the preview and the batch react immediately. */
  onChange: (patch: ScenePatch) => void;
  /** Only ever called for a scene the creator added by hand (AC-81). */
  onDelete: () => void;
}) {
  const [state, setState] = useState<SaveState>("idle");
  const [deleting, setDeleting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    async (patch: ScenePatch) => {
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

  const onTemplate = (value: LayoutTemplate) => {
    // The server clears the emotion off a non character template in the same
    // statement (AC-93); mirrored here so the preview stops compositing a
    // character the moment the picker changes rather than after the round trip.
    const patch: ScenePatch = isCharacterTemplate(value)
      ? { layoutTemplate: value }
      : { layoutTemplate: value, emotion: null };
    onChange(patch);
    void save({ layoutTemplate: value });
  };

  const onEmotion = (value: CharacterEmotion) => {
    onChange({ emotion: value });
    void save({ emotion: value });
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        onDelete();
        return;
      }
      setState("failed");
    } catch {
      setState("failed");
    } finally {
      setDeleting(false);
    }
  };

  const templates = templateOptionsFor({
    hasChart,
    hasCharacterSet: committedEmotions.length > 0,
  });
  // A template with no renderer, or one whose data has since gone, is still the
  // row's value. Listing it keeps the select honest about what is stored rather
  // than silently showing a different template than the scene will draw.
  const templateChoices = templates.includes(layoutTemplate)
    ? templates
    : [layoutTemplate, ...templates];

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

      <label className="flex items-center gap-2 text-xs" style={{ color: "var(--broll-muted)" }}>
        <span className="shrink-0">Template</span>
        <select
          value={layoutTemplate}
          onChange={(event) => onTemplate(event.target.value as LayoutTemplate)}
          className="broll-glass rounded-md px-2 py-1 text-xs"
        >
          {templateChoices.map((template) => (
            <option key={template} value={template}>
              {template}
            </option>
          ))}
        </select>
      </label>

      {/* Only on a character template, and only from what this project has
          actually generated. An emotion nobody generated cannot be composited,
          so it is never offered (AC-77). */}
      {isCharacterTemplate(layoutTemplate) && committedEmotions.length > 0 && (
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--broll-muted)" }}>
          <span className="shrink-0">Emotion</span>
          <select
            value={emotion ?? ""}
            onChange={(event) => onEmotion(event.target.value as CharacterEmotion)}
            className="broll-glass rounded-md px-2 py-1 text-xs"
          >
            {emotion === null && <option value="">Pick one</option>}
            {committedEmotions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      )}

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

      {/* A planner scene is never deletable: excluding it is the reversible
          answer, and a re-run rewrites it anyway (AC-81). */}
      {origin === "manual" && (
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className="text-xs underline disabled:opacity-60"
          style={{ color: "var(--broll-muted)" }}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      )}

      {state === "saving" && <span className="text-xs" style={{ color: "var(--broll-muted)" }}>Saving…</span>}
      {state === "failed" && (
        <span className="text-xs" role="alert" style={{ color: "#ff6b6b" }}>
          Not saved
        </span>
      )}
    </div>
  );
}
