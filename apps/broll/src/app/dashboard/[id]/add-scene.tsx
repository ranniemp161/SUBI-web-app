"use client";

import { useState } from "react";
import { MAX_OVERLAY_TEXT_CHARS } from "@/lib/scene-limits";
import { formatClock } from "@/lib/utterances";

/**
 * Add a cutaway the planner missed (spec `broll/0005` AC-79, AC-80).
 *
 * **The creator picks a line, not a timecode.** A free timecode field would be
 * the one place in this app where a scene's start came from something other
 * than the transcript, and it would let a scene land mid word. Picking a
 * segment keeps the timing measured: the server reads that segment's own start
 * out of the stored document and never trusts a number from here.
 *
 * The new scene arrives as a text card carrying the words typed below. It can
 * be restyled like any other afterwards — this form only has to produce
 * something real enough to see.
 */

export type TranscriptChoice = {
  /** Position in the stored document, which is what the route resolves. */
  index: number;
  startMs: number;
  text: string;
};

export function AddScene({
  projectId,
  segments,
  atCap,
  onAdded,
}: {
  projectId: string;
  segments: TranscriptChoice[];
  /** At the cap the form says so rather than failing on submit (AC-82). */
  atCap: boolean;
  onAdded: (scene: {
    id: string;
    startMs: number;
    durationMs: number;
    overlayText: string;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segmentIndex, overlayText: text.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        id?: string;
        startMs?: number;
        durationMs?: number;
        error?: string;
      };

      if (!response.ok || !body.id) {
        setError(body.error ?? "Couldn't add that scene.");
        return;
      }

      onAdded({
        id: body.id,
        startMs: body.startMs ?? 0,
        durationMs: body.durationMs ?? 0,
        overlayText: text.trim(),
      });
      setText("");
      setOpen(false);
    } catch {
      setError("Couldn't add that scene.");
    } finally {
      setSaving(false);
    }
  };

  if (segments.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={atCap}
        className="broll-glass mt-4 rounded-md px-3 py-1.5 text-xs disabled:opacity-60"
      >
        {atCap ? "You've added the maximum number of scenes" : "Add a scene by hand"}
      </button>
    );
  }

  return (
    <div className="broll-glass mt-4 rounded-lg px-4 py-3">
      <p className="text-xs" style={{ color: "var(--broll-muted)" }}>
        Pick the line this cutaway sits on, and say what should be on screen.
      </p>

      <label className="mt-3 flex flex-col gap-1 text-xs" style={{ color: "var(--broll-muted)" }}>
        <span>Transcript line</span>
        <select
          value={segmentIndex}
          onChange={(event) => setSegmentIndex(Number(event.target.value))}
          className="broll-glass rounded-md px-2 py-1 text-xs"
        >
          {segments.map((segment) => (
            <option key={segment.index} value={segment.index}>
              {formatClock(segment.startMs)} · {segment.text.slice(0, 80)}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 flex flex-col gap-1 text-xs" style={{ color: "var(--broll-muted)" }}>
        <span>On screen text</span>
        <input
          type="text"
          value={text}
          maxLength={MAX_OVERLAY_TEXT_CHARS}
          placeholder="A few words"
          onChange={(event) => setText(event.target.value)}
          className="broll-glass rounded-md px-2 py-1 text-xs"
        />
      </label>

      {error && (
        <p className="mt-2 text-xs" role="alert" style={{ color: "#ff6b6b" }}>
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={submit}
          // Required here, unlike on the edit path: a text card with no text is
          // a black frame that says nothing about why it was added (AC-80).
          disabled={saving || text.trim().length === 0}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
          style={{ background: "var(--broll-accent)", color: "var(--broll-accent-foreground)" }}
        >
          {saving ? "Adding…" : "Add scene"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-lg px-3 py-1.5 text-xs"
          style={{ color: "var(--broll-muted)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
