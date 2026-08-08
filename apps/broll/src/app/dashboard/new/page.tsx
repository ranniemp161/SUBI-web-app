"use client";

import { useState } from "react";
import { createProjectFromUpload } from "@/app/actions";
import { CHARACTER_STYLES } from "@/lib/styles";

/**
 * The file is read in the browser and its text sent to the server action, which
 * keeps this a plain JSON call rather than a multipart upload. Subtitle files
 * are text and small; the transcript package caps a document at 5 MB and says
 * so by name when a file exceeds it.
 */
export default function NewProjectPage() {
  const [name, setName] = useState("");
  const [style, setStyle] = useState<string>(CHARACTER_STYLES[0].id);
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [format, setFormat] = useState<"srt" | "vtt" | "json" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setError(null);
    const lower = file.name.toLowerCase();
    const detected = lower.endsWith(".srt")
      ? "srt"
      : lower.endsWith(".vtt")
        ? "vtt"
        : lower.endsWith(".json")
          ? "json"
          : null;

    if (!detected) {
      setError("Choose an .srt, .vtt, or .json transcript.");
      return;
    }

    setFileName(file.name);
    setFormat(detected);
    setText(await file.text());
    // Seed the project name from the filename; the user can still change it.
    if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text || !format) {
      setError("Choose a transcript file first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // On success the action redirects, so control never returns here.
      const result = await createProjectFromUpload({ name, style, format, text });
      if (result?.error) setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[720px] mx-auto px-8 py-12">
      <h1
        className="text-2xl font-bold tracking-tight"
        style={{ fontFamily: "var(--font-space-grotesk)" }}
      >
        New project
      </h1>
      <p className="mt-2 text-sm" style={{ color: "var(--broll-muted)" }}>
        Start from a timed transcript. Export one from Ruff Cut, or upload a
        subtitle file you already have.
      </p>

      <form onSubmit={onSubmit} className="mt-8 grid gap-6">
        <label className="grid gap-2">
          <span className="text-sm font-medium">Transcript file</span>
          <input
            type="file"
            accept=".srt,.vtt,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
            className="text-sm file:mr-4 file:rounded-md file:border-0 file:px-4 file:py-2 file:font-semibold"
            style={{ color: "var(--broll-muted)" }}
          />
          {fileName && (
            <span className="text-xs" style={{ color: "var(--broll-muted)" }}>
              {fileName} · read as {format?.toUpperCase()}
            </span>
          )}
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Project name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
            className="rounded-md px-3 py-2 text-sm"
            style={{
              background: "var(--broll-surface-alt)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          />
        </label>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Character style</legend>
          <div className="flex gap-3 mt-1">
            {CHARACTER_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStyle(s.id)}
                aria-pressed={style === s.id}
                className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                style={
                  style === s.id
                    ? {
                        background: "var(--broll-accent)",
                        color: "var(--broll-accent-foreground)",
                      }
                    : {
                        background: "var(--broll-surface-alt)",
                        color: "var(--broll-foreground)",
                      }
                }
              >
                {s.label}
              </button>
            ))}
          </div>
        </fieldset>

        {error && (
          <p
            role="alert"
            className="text-sm rounded-md px-3 py-2"
            style={{ background: "rgba(255,80,80,0.1)", color: "#ff8080" }}
          >
            {error}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={busy || !text}
            className="px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-40"
            style={{
              background: "var(--broll-accent)",
              color: "var(--broll-accent-foreground)",
            }}
          >
            {busy ? "Reading transcript…" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
