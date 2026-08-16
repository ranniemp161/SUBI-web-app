"use client";

import { useMemo, useState } from "react";
import { MAX_OVERLAY_TEXT_CHARS } from "@/lib/scene-limits";
import { formatClock } from "@/lib/utterances";

/**
 * Add a cutaway the planner missed (spec `broll/0005` AC-79, AC-80;
 * spec `broll/0006` AC-109).
 *
 * **The creator picks a line, not a timecode.** A free timecode field would be
 * the one place in this app where a scene's start came from something other
 * than the transcript, and it would let a scene land mid word. Picking a
 * segment keeps the timing measured: the server reads that segment's own start
 * out of the stored document and never trusts a number from here.
 *
 * **The picker is searchable rather than a select of every line** (AC-109). On
 * the reference project that select held 254 options, which is a scroll through
 * the whole transcript to find one sentence. Searching by text or by timecode
 * is how anyone actually looks for a line they remember.
 *
 * It takes over the detail pane rather than opening under the list, so the
 * space it needs is space the screen already has.
 *
 * The new scene arrives as a text card carrying the words typed below. It can
 * be restyled like any other afterwards; this form only has to produce
 * something real enough to see.
 */

export type TranscriptChoice = {
  /** Position in the stored document, which is what the route resolves. */
  index: number;
  startMs: number;
  text: string;
};

/** Enough to choose from without rendering the whole transcript as buttons. */
const MAX_VISIBLE_LINES = 60;

export function AddScene({
  projectId,
  segments,
  onAdded,
  onCancel,
}: {
  projectId: string;
  segments: TranscriptChoice[];
  onAdded: (scene: {
    id: string;
    startMs: number;
    durationMs: number;
    overlayText: string;
  }) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [segmentIndex, setSegmentIndex] = useState<number | null>(
    segments[0]?.index ?? null
  );
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Matched against both the words and the timecode, because a creator looking
  // for a line remembers one or the other, never reliably both.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = needle
      ? segments.filter(
          (segment) =>
            segment.text.toLowerCase().includes(needle) ||
            formatClock(segment.startMs).includes(needle)
        )
      : segments;
    return { shown: all.slice(0, MAX_VISIBLE_LINES), total: all.length };
  }, [segments, query]);

  const chosen = segments.find((segment) => segment.index === segmentIndex) ?? null;

  const submit = async () => {
    if (segmentIndex === null) return;
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
    } catch {
      setError("Couldn't add that scene.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div>
        <h2
          className="text-sm font-semibold uppercase tracking-wide"
          style={{ color: "var(--broll-muted)" }}
        >
          Add a scene
        </h2>
        <p className="mt-1 text-sm">
          Pick the line this cutaway sits on, and say what should be on screen.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--broll-muted)" }}>
        <span>Find a transcript line</span>
        <input
          type="search"
          value={query}
          placeholder="Search the words, or a timecode like 2:35"
          onChange={(event) => setQuery(event.target.value)}
          className="broll-glass rounded-md px-2 py-1.5 text-sm"
          style={{ color: "var(--broll-foreground)" }}
        />
      </label>

      {matches.shown.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--broll-muted)" }} role="status">
          No transcript line matches that.
        </p>
      ) : (
        <ul
          className="broll-glass grid max-h-[280px] gap-1 overflow-y-auto rounded-lg p-1"
          aria-label="Transcript lines"
        >
          {matches.shown.map((segment) => {
            const picked = segment.index === segmentIndex;
            return (
              <li key={segment.index}>
                <button
                  type="button"
                  onClick={() => setSegmentIndex(segment.index)}
                  aria-current={picked ? "true" : undefined}
                  className="flex w-full gap-3 rounded-md px-2 py-1.5 text-left"
                  style={{
                    background: picked ? "rgba(255,252,0,0.08)" : "transparent",
                    border: picked
                      ? "1px solid var(--broll-accent)"
                      : "1px solid transparent",
                  }}
                >
                  <span
                    className="broll-tabular shrink-0 text-xs"
                    style={{ color: "var(--broll-accent)" }}
                  >
                    {formatClock(segment.startMs)}
                  </span>
                  <span className="min-w-0 flex-1 text-xs leading-relaxed">
                    {segment.text}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {matches.total > matches.shown.length && (
        <p className="text-xs" style={{ color: "var(--broll-muted)" }}>
          Showing the first {matches.shown.length} of {matches.total} matching lines.
          Narrow the search to see the rest.
        </p>
      )}

      <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--broll-muted)" }}>
        <span>On screen text</span>
        <input
          type="text"
          value={text}
          maxLength={MAX_OVERLAY_TEXT_CHARS}
          placeholder="A few words"
          onChange={(event) => setText(event.target.value)}
          className="broll-glass rounded-md px-2 py-1.5 text-sm"
          style={{ color: "var(--broll-foreground)" }}
        />
      </label>

      {chosen && (
        <p className="text-xs" style={{ color: "var(--broll-muted)" }}>
          This scene will sit at <span className="broll-tabular">{formatClock(chosen.startMs)}</span>,
          taken from the line itself rather than typed in.
        </p>
      )}

      {error && (
        <p className="text-sm" role="alert" style={{ color: "#ff6b6b" }}>
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          // Required here, unlike on the edit path: a text card with no text is
          // a black frame that says nothing about why it was added (AC-80).
          disabled={saving || text.trim().length === 0 || segmentIndex === null}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60"
          style={{ background: "var(--broll-accent)", color: "var(--broll-accent-foreground)" }}
        >
          {saving ? "Adding…" : "Add scene"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm"
          style={{ color: "var(--broll-muted)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
