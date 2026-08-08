"use client";

import { useState } from "react";
import { createProjectFromUpload, importFromRoughCut } from "@/app/actions";
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
  const [mode, setMode] = useState<"upload" | "roughcut">("upload");
  const [reference, setReference] = useState("");

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
    setError(null);

    if (mode === "upload" && (!text || !format)) {
      setError("Choose a transcript file first.");
      return;
    }
    if (mode === "roughcut" && !reference.trim()) {
      setError("Paste a Ruff Cut project link.");
      return;
    }

    setBusy(true);
    try {
      // On success either action redirects, so control never returns here.
      const result =
        mode === "upload"
          ? await createProjectFromUpload({ name, style, format: format!, text: text! })
          : await importFromRoughCut({ reference, name, style });
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

      <div className="mt-8 flex gap-2" role="tablist">
        {(
          [
            ["upload", "Upload a file"],
            ["roughcut", "Import from Ruff Cut"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => {
              setMode(id);
              setError(null);
            }}
            className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
            style={
              mode === id
                ? { background: "var(--broll-surface-alt)", color: "var(--broll-foreground)" }
                : { background: "transparent", color: "var(--broll-muted)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="mt-6 grid gap-6">
        {/* The keys are load-bearing, not decoration. Both branches render an
            <input> in the same slot, so without distinct keys React reuses the
            DOM node and the field flips from uncontrolled (the file input, which
            has no `value`) to controlled (the text input, which does). That is
            the "changing an uncontrolled input to be controlled" warning, and it
            also means the two fields would share element state. */}
        {mode === "upload" ? (
          <label key="upload-file" className="grid gap-2">
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
        ) : (
          <label key="roughcut-reference" className="grid gap-2">
            <span className="text-sm font-medium">Ruff Cut project link</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="https://myfirstcut.app/dashboard/…"
              className="rounded-md px-3 py-2 text-sm"
              style={{
                background: "var(--broll-surface-alt)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            />
            <span className="text-xs" style={{ color: "var(--broll-muted)" }}>
              Paste the studio link, or just the project id. B-Roll fetches the
              transcript from Ruff Cut directly, with the cut already applied, so
              every timecode is relative to your finished edit.
            </span>
          </label>
        )}

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
            disabled={busy || (mode === "upload" ? !text : !reference.trim())}
            className="px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-40"
            style={{
              background: "var(--broll-accent)",
              color: "var(--broll-accent-foreground)",
            }}
          >
            {busy
              ? mode === "upload"
                ? "Reading transcript…"
                : "Fetching from Ruff Cut…"
              : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
