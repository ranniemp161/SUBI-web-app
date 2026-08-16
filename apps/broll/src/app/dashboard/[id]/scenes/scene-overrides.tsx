"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { MAX_OVERLAY_TEXT_CHARS } from "@/lib/scene-limits";
import type { LayoutTemplate } from "@/lib/scene-schema";
import type { CharacterEmotion } from "@/lib/emotions";
import { isCharacterTemplate, templateOptionsFor } from "@/lib/scene-templates";
import { Card, Switch } from "@/components/ui";

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
  position = 1,
  totalIncluded = 1,
  durationMs = 6000,
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
  flushRef?: RefObject<(() => void) | null>;
  position?: number;
  totalIncluded?: number;
  durationMs?: number;
  /** Applied locally at once, so the preview and the batch react immediately. */
  onChange: (patch: ScenePatch) => void;
  /** Only ever called for a scene the creator added by hand (AC-81). */
  onDelete: () => void;
}) {
  const [state, setState] = useState<SaveState>("idle");
  const [deleting, setDeleting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    void save({ included: value });
  };

  const onTemplate = (value: LayoutTemplate) => {
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
  const templateChoices = templates.includes(layoutTemplate)
    ? templates
    : [layoutTemplate, ...templates];

  const charCount = (overlayText ?? "").length;

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Include in export with Switch */}
      <Card className="flex items-center justify-between p-3.5">
        <div>
          <span className="font-semibold text-xs text-white block">
            Include in export
          </span>
          <span className="text-[11px] text-zinc-400 broll-tabular">
            Clip {position} of {totalIncluded}
          </span>
        </div>

        <Switch
          ref={firstControlRef}
          checked={included}
          disabled={disabled}
          onChange={onIncluded}
          label="Include in export"
        />
      </Card>

      {/* 2. Template Picker (Visual 2x2 cards) */}
      <div>
        <span className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2.5">
          TEMPLATE
        </span>

        <div className="grid grid-cols-2 gap-2">
          {templateChoices.map((template) => {
            const isSelected = layoutTemplate === template;
            return (
              <button
                key={template}
                type="button"
                disabled={disabled}
                onClick={() => onTemplate(template)}
                className={`rounded-xl p-2.5 text-left transition-all flex flex-col justify-between cursor-pointer ${
                  isSelected
                    ? "bg-[#16171c] border-2 border-[var(--broll-accent)] shadow-[0_0_15px_rgba(255,252,0,0.15)]"
                    : "bg-[#111215] border border-white/[0.08] hover:border-white/20"
                }`}
              >
                <div className="w-full h-12 rounded bg-black/50 p-1.5 flex items-center justify-center mb-2 overflow-hidden">
                  <TemplateDiagram template={template} />
                </div>
                <span
                  className={`text-xs font-semibold truncate ${
                    isSelected ? "text-[var(--broll-accent)] font-bold" : "text-zinc-300"
                  }`}
                >
                  {template}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Emotion Picker (Pills) */}
      {isCharacterTemplate(layoutTemplate) && committedEmotions.length > 0 && (
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2.5">
            EMOTION
          </span>

          <div className="flex flex-wrap gap-1.5">
            {committedEmotions.map((value) => {
              const isSelected = emotion === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={disabled}
                  onClick={() => onEmotion(value)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                    isSelected
                      ? "bg-[var(--broll-accent)] text-[#111111] font-bold shadow-sm"
                      : "bg-[#111215] border border-white/10 text-zinc-300 hover:text-white hover:border-white/20"
                  }`}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. On-Screen Text Input */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            ON-SCREEN TEXT
          </span>
          <span className="text-[10px] font-medium text-zinc-500 broll-tabular">
            {charCount}/{MAX_OVERLAY_TEXT_CHARS}
          </span>
        </div>

        <input
          type="text"
          value={overlayText ?? ""}
          maxLength={MAX_OVERLAY_TEXT_CHARS}
          placeholder="None"
          disabled={disabled}
          onChange={(event) => onText(event.target.value)}
          className="w-full rounded-xl px-3.5 py-2.5 text-xs bg-[#111215] border border-white/[0.08] text-white placeholder-zinc-600 focus:border-[var(--broll-accent)] focus:outline-none transition-colors"
        />

        <p className="mt-1.5 text-[10px] text-zinc-500 leading-tight">
          Shown for the full {(durationMs / 1000).toFixed(1)}s. Two lines fit comfortably.
        </p>
      </div>

      {/* 5. Footer actions: Save state & Delete */}
      <div className="flex items-center justify-between pt-1">
        {origin === "manual" && (
          <button
            type="button"
            onClick={remove}
            disabled={deleting || disabled}
            className="text-xs text-red-400 hover:text-red-300 underline disabled:opacity-50 cursor-pointer"
          >
            {deleting ? "Deleting…" : "Delete this scene"}
          </button>
        )}

        <div className="ml-auto">
          {state === "saving" && (
            <span className="text-xs text-zinc-400">Saving…</span>
          )}
          {state === "failed" && (
            <span className="text-xs text-red-400" role="alert">
              Not saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Visual mini-diagram for template cards */
function TemplateDiagram({ template }: { template: LayoutTemplate }) {
  if (template === "character-left") {
    return (
      <div className="w-full h-full flex items-center gap-1.5 px-1">
        <div className="w-1/3 h-full rounded bg-zinc-600 flex items-center justify-center">
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-400" />
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <div className="w-full h-1 rounded bg-zinc-500" />
          <div className="w-4/5 h-1 rounded bg-zinc-500" />
          <div className="w-3/5 h-1 rounded bg-zinc-600" />
        </div>
      </div>
    );
  }
  if (template === "character-center") {
    return (
      <div className="w-full h-full flex items-center justify-center relative">
        <div className="w-6 h-8 rounded-t bg-zinc-600 flex items-center justify-center">
          <div className="w-3 h-3 rounded-full bg-zinc-400" />
        </div>
      </div>
    );
  }
  if (template === "chart-full") {
    return (
      <div className="w-full h-full flex items-end justify-center gap-1.5 px-2 pb-1">
        <div className="w-2 h-4 rounded-t bg-[var(--broll-accent)] opacity-80" />
        <div className="w-2 h-7 rounded-t bg-[var(--broll-accent)]" />
        <div className="w-2 h-5 rounded-t bg-[var(--broll-accent)] opacity-90" />
        <div className="w-2 h-3 rounded-t bg-[var(--broll-accent)] opacity-70" />
      </div>
    );
  }
  // text-card or fallback
  return (
    <div className="w-full h-full flex flex-col justify-center gap-1 px-2">
      <div className="w-full h-1.5 rounded bg-zinc-400" />
      <div className="w-4/5 h-1.5 rounded bg-zinc-400" />
      <div className="w-2/3 h-1.5 rounded bg-zinc-500" />
    </div>
  );
}
