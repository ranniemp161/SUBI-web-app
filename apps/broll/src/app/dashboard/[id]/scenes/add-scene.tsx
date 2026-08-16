"use client";

import { useMemo, useState } from "react";
import { MAX_OVERLAY_TEXT_CHARS } from "@/lib/scene-limits";
import { formatClock } from "@/lib/utterances";
import { Button, Card } from "@/components/ui";

export type TranscriptChoice = {
  /** Position in the stored document, which is what the route resolves. */
  index: number;
  startMs: number;
  text: string;
};

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
    <Card className="p-6 flex flex-col gap-4">
      <div>
        <h2
          className="text-base font-bold text-white tracking-tight"
          style={{ fontFamily: "var(--font-space-grotesk)" }}
        >
          Add a scene
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          Pick the line this cutaway sits on, and say what should be on screen.
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-xs text-zinc-400">
        <span className="font-semibold text-zinc-300">Find a transcript line</span>
        <input
          type="search"
          value={query}
          placeholder="Search the words, or a timecode like 2:35"
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-xl px-3.5 py-2.5 text-xs bg-[#141518] border border-white/10 text-white placeholder-zinc-500 focus:border-[var(--broll-accent)] focus:outline-none"
        />
      </label>

      {matches.shown.length === 0 ? (
        <p className="text-xs text-zinc-500 py-3 text-center" role="status">
          No transcript line matches that search.
        </p>
      ) : (
        <ul
          className="grid max-h-[260px] gap-1 overflow-y-auto rounded-xl p-1.5 bg-[#0e0f12] border border-white/5"
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
                  className={`flex w-full gap-3 rounded-lg px-3 py-2 text-left transition-all cursor-pointer ${
                    picked
                      ? "bg-[var(--broll-accent)]/10 border border-[var(--broll-accent)]"
                      : "border border-transparent hover:bg-white/5"
                  }`}
                >
                  <span
                    className="broll-tabular shrink-0 text-xs font-bold"
                    style={{ color: "var(--broll-accent)" }}
                  >
                    {formatClock(segment.startMs)}
                  </span>
                  <span className="min-w-0 flex-1 text-xs leading-relaxed text-zinc-200">
                    {segment.text}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {matches.total > matches.shown.length && (
        <p className="text-[11px] text-zinc-500">
          Showing the first {matches.shown.length} of {matches.total} matching lines.
        </p>
      )}

      <label className="flex flex-col gap-1.5 text-xs text-zinc-400">
        <span className="font-semibold text-zinc-300">On screen text</span>
        <input
          type="text"
          value={text}
          maxLength={MAX_OVERLAY_TEXT_CHARS}
          placeholder="A few words"
          onChange={(event) => setText(event.target.value)}
          className="w-full rounded-xl px-3.5 py-2.5 text-xs bg-[#141518] border border-white/10 text-white placeholder-zinc-500 focus:border-[var(--broll-accent)] focus:outline-none"
        />
      </label>

      {chosen && (
        <p className="text-xs text-zinc-400">
          This scene will sit at <strong className="text-white broll-tabular">{formatClock(chosen.startMs)}</strong>,
          taken from the transcript segment.
        </p>
      )}

      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2.5 pt-2">
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={submit}
          disabled={saving || text.trim().length === 0 || segmentIndex === null}
        >
          {saving ? "Adding…" : "Add scene"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </Card>
  );
}
