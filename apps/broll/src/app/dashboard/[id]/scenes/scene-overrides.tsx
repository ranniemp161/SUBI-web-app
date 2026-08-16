"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
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
 * the field is to build. Spec `broll/0006` is a layout spec and has no
 * authority to widen that set, so it did not.
 *
 * **A template this scene cannot draw is never offered**, rather than offered
 * and rejected (AC-75). `templateOptionsFor` is shared with the route, so the
 * picker and the server cannot disagree about what is allowed.
 *
 * Saves are optimistic and debounced. Typing is the common case and a round
 * trip per keystroke would make the field feel broken; the preview above this
 * redraws from local state immediately either way.
 *
 * **Laid out as a column now**, not a wrapping row: it lives in the detail pane
 * under the preview rather than inside a list item (spec `0006` AC-102). Same
 * logic, same debounce, same optimistic save.
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
  disabled = false,
  firstControlRef,
  flushRef,
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
  /** Inert while a plan run is in flight (spec `0006` AC-116). */
  disabled?: boolean;
  /** Where Enter from the list lands (spec `0006` AC-107). */
  firstControlRef?: RefObject<HTMLInputElement | null>;
  /**
   * Lets the shell settle a half typed caption before a plan re-run starts.
   *
   * Without it, a creator who types and immediately re-runs fires a PATCH
   * against a scene the run has already replaced, and the edit is lost with a
   * 404 nobody sees (spec `0006` AC-116).
   */
  flushRef?: RefObject<(() => void) | null>;
  /** Applied locally at once, so the preview and the batch react immediately. */
  onChange: (patch: ScenePatch) => void;
  /** Only ever called for a scene the creator added by hand (AC-81). */
  onDelete: () => void;
}) {
  const [state, setState] = useState<SaveState>("idle");
  const [deleting, setDeleting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The caption typed but not yet sent, or null when nothing is pending. */
  const pendingTextRef = useRef<string | null>(null);

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

  /** Sends whatever is waiting on the debounce, right now. */
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingTextRef.current;
    pendingTextRef.current = null;
    if (pending === null) return;
    void save({ overlayText: pending.trim() === "" ? null : pending.trim() });
  }, [save]);

  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = flush;
    return () => {
      if (flushRef.current === flush) flushRef.current = null;
    };
  }, [flushRef, flush]);

  // A pending save must not outlive the scene it belongs to. Without this,
  // selecting another scene mid keystroke fires a PATCH carrying this scene's
  // text under the next scene's id.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingTextRef.current = null;
    };
  }, [sceneId]);

  const onText = (value: string) => {
    onChange({ overlayText: value });
    pendingTextRef.current = value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pendingTextRef.current = null;
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
  // scene's value. Listing it keeps the select honest about what is stored
  // rather than silently showing a different template than the scene will draw.
  const templateChoices = templates.includes(layoutTemplate)
    ? templates
    : [layoutTemplate, ...templates];

  return (
    <div className="grid gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          ref={firstControlRef}
          type="checkbox"
          checked={included}
          disabled={disabled}
          onChange={(event) => onIncluded(event.target.checked)}
        />
        Include in export
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--broll-muted)" }}>
          <span className="shrink-0">Template</span>
          <select
            value={layoutTemplate}
            disabled={disabled}
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
            actually generated. An emotion nobody generated cannot be
            composited, so it is never offered (AC-77). */}
        {isCharacterTemplate(layoutTemplate) && committedEmotions.length > 0 && (
          <label className="flex items-center gap-2 text-xs" style={{ color: "var(--broll-muted)" }}>
            <span className="shrink-0">Emotion</span>
            <select
              value={emotion ?? ""}
              disabled={disabled}
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
      </div>

      <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--broll-muted)" }}>
        <span>On screen text</span>
        <input
          type="text"
          value={overlayText ?? ""}
          maxLength={MAX_OVERLAY_TEXT_CHARS}
          placeholder="None"
          disabled={disabled}
          onChange={(event) => onText(event.target.value)}
          className="broll-glass w-full rounded-md px-2 py-1.5 text-sm"
          style={{ color: "var(--broll-foreground)" }}
        />
      </label>

      <div className="flex items-center gap-3">
        {/* A planner scene is never deletable: excluding it is the reversible
            answer, and a re-run rewrites it anyway (AC-81). */}
        {origin === "manual" && (
          <button
            type="button"
            onClick={remove}
            disabled={deleting || disabled}
            className="text-xs underline disabled:opacity-60"
            style={{ color: "var(--broll-muted)" }}
          >
            {deleting ? "Deleting…" : "Delete this scene"}
          </button>
        )}

        {state === "saving" && (
          <span className="text-xs" style={{ color: "var(--broll-muted)" }}>
            Saving…
          </span>
        )}
        {state === "failed" && (
          <span className="text-xs" role="alert" style={{ color: "#ff6b6b" }}>
            Not saved
          </span>
        )}
      </div>
    </div>
  );
}
