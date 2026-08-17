"use client";

import { useState } from "react";
import { createProjectFromUpload, importFromRoughCut } from "@/app/actions";
import { CHARACTER_STYLES } from "@/lib/styles";
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  type AspectRatio,
} from "@/lib/aspect-ratio";
import { styleLabel, type PickerCharacter } from "@/lib/character-picker";
import { Button, Card } from "@/components/ui";

export function NewProjectForm({
  characters,
  setPrice,
}: {
  characters: PickerCharacter[];
  setPrice: string;
}) {
  const [name, setName] = useState("");
  const [style, setStyle] = useState<string>(CHARACTER_STYLES[0].id);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [format, setFormat] = useState<"srt" | "vtt" | "json" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(DEFAULT_ASPECT_RATIO);
  const [mode, setMode] = useState<"upload" | "roughcut">("upload");
  const [reference, setReference] = useState("");

  const picked = characters.find((character) => character.id === characterId) ?? null;

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
      const character = characterId ?? undefined;
      const result =
        mode === "upload"
          ? await createProjectFromUpload({
              name,
              style,
              characterId: character,
              aspectRatio,
              format: format!,
              text: text!,
            })
          : await importFromRoughCut({
              reference,
              name,
              style,
              characterId: character,
              aspectRatio,
            });
      if (result?.error) setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[760px] mx-auto px-6 sm:px-8 py-10">
      <div className="mb-8">
        <h1
          className="text-2xl sm:text-3xl font-bold tracking-tight text-white"
          style={{ fontFamily: "var(--font-space-grotesk)" }}
        >
          New project
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          Start from a timed transcript. Export one from Ruff Cut, or upload a
          subtitle file you already have.
        </p>
      </div>

      <Card variant="elevated" className="p-6 sm:p-8">
        <div className="flex gap-2 p-1 rounded-xl bg-black/50 border border-white/5 w-fit mb-6" role="tablist">
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
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                mode === id
                  ? "bg-[#1d1f26] text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="grid gap-6">
          {mode === "upload" ? (
            <div key="upload-file" className="grid gap-2">
              <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Transcript file
              </label>
              <div className="border border-dashed border-white/15 hover:border-[var(--broll-accent)]/50 rounded-xl p-6 text-center transition-colors bg-white/[0.01]">
                <input
                  type="file"
                  id="transcript-file-input"
                  accept=".srt,.vtt,.json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f);
                  }}
                  className="hidden"
                />
                <label
                  htmlFor="transcript-file-input"
                  className="cursor-pointer flex flex-col items-center gap-2"
                >
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-zinc-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <span className="text-xs font-semibold text-zinc-200">
                    {fileName ? fileName : "Click to choose .srt, .vtt, or .json file"}
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    {fileName ? `Loaded as ${format?.toUpperCase()}` : "Drag & drop or browse from disk (up to 5 MB)"}
                  </span>
                </label>
              </div>
            </div>
          ) : (
            <label key="roughcut-reference" className="grid gap-2">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Ruff Cut project link
              </span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="https://myfirstcut.app/dashboard/…"
                className="rounded-xl px-3.5 py-2.5 text-xs bg-[#141518] border border-white/10 text-white placeholder-zinc-500 focus:border-[var(--broll-accent)] focus:outline-none"
              />
              <span className="text-[11px] text-zinc-500">
                Paste the studio link, or just the project id. B-Roll fetches the
                transcript from Ruff Cut directly, with your cuts applied.
              </span>
            </label>
          )}

          <label className="grid gap-2">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
              Project name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="e.g. My video cutaways"
              required
              className="rounded-xl px-3.5 py-2.5 text-xs bg-[#141518] border border-white/10 text-white placeholder-zinc-500 focus:border-[var(--broll-accent)] focus:outline-none"
            />
          </label>

          {characters.length > 0 && (
            <div className="grid gap-3">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Character
              </span>
              <p className="text-xs text-zinc-400">
                Use one you already made, free, or start a new one for {setPrice} on the next screen.
              </p>

              <div
                role="radiogroup"
                aria-label="Character"
                className="grid grid-cols-2 gap-3 sm:grid-cols-3"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={characterId === null}
                  onClick={() => setCharacterId(null)}
                  className={`rounded-xl p-3 text-left transition-all cursor-pointer ${
                    characterId === null
                      ? "bg-[#181920] border-2 border-[var(--broll-accent)] shadow-[0_0_15px_rgba(255,252,0,0.1)]"
                      : "bg-[#141518] border border-white/10 hover:border-white/20"
                  }`}
                >
                  <span className="flex aspect-3/4 items-center justify-center rounded-lg text-xs bg-white/5 text-zinc-500">
                    Photo, later
                  </span>
                  <span className="mt-2.5 block font-bold text-xs text-white">New character</span>
                  <span className="text-[11px] text-zinc-400">{setPrice}</span>
                </button>

                {characters.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    role="radio"
                    aria-checked={characterId === character.id}
                    onClick={() => setCharacterId(character.id)}
                    className={`rounded-xl p-3 text-left transition-all cursor-pointer ${
                      characterId === character.id
                        ? "bg-[#181920] border-2 border-[var(--broll-accent)] shadow-[0_0_15px_rgba(255,252,0,0.1)]"
                        : "bg-[#141518] border border-white/10 hover:border-white/20"
                    }`}
                  >
                    <span className="flex aspect-3/4 items-center justify-center overflow-hidden rounded-lg bg-black border border-white/5">
                      {character.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={character.thumbnailUrl}
                          alt={character.name}
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-xs text-zinc-500">No preview</span>
                      )}
                    </span>
                    <span className="mt-2.5 block truncate font-bold text-xs text-white">
                      {character.name}
                    </span>
                    <span className="text-[11px] text-emerald-400 font-medium">
                      {styleLabel(character.style)} · free
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {picked ? (
            <p className="text-xs text-zinc-400">
              This project will use <strong className="text-white">{picked.name}</strong>, so its style is{" "}
              {styleLabel(picked.style)} and no character has to be generated.
            </p>
          ) : (
            <fieldset className="grid gap-2">
              <legend className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1">
                Character style
              </legend>
              <div className="flex flex-wrap gap-2">
                {CHARACTER_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyle(s.id)}
                    aria-pressed={style === s.id}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      style === s.id
                        ? "bg-[var(--broll-accent)] text-[#111111] font-bold shadow-md"
                        : "bg-[#141518] border border-white/10 text-zinc-300 hover:text-white"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="grid gap-3">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
              Frame
            </span>
            <p className="text-xs text-zinc-400">
              The shape every clip in this project is cut in. There is no way to change it once
              the project exists, so pick where the clips are going.
            </p>

            <div role="radiogroup" aria-label="Frame" className="flex flex-wrap gap-3">
              {ASPECT_RATIOS.map((id) => {
                const option = ASPECT_RATIO_OPTIONS[id];
                const selected = aspectRatio === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setAspectRatio(id)}
                    className={`flex flex-1 min-w-[180px] items-center gap-3 rounded-xl p-3 text-left transition-all cursor-pointer ${
                      selected
                        ? "bg-[#181920] border-2 border-[var(--broll-accent)] shadow-[0_0_15px_rgba(255,252,0,0.1)]"
                        : "bg-[#141518] border border-white/10 hover:border-white/20"
                    }`}
                  >
                    {/* The shape itself, drawn at the real ratio: it says more
                        than the words do, and costs nothing to draw. */}
                    <span
                      aria-hidden="true"
                      className={`shrink-0 rounded ${selected ? "bg-[var(--broll-accent)]" : "bg-white/20"}`}
                      style={{
                        width: option.width > option.height ? 40 : 24,
                        height: option.width > option.height ? 24 : 40,
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block font-bold text-xs text-white">
                        {option.label} · {option.ratio}
                      </span>
                      <span className="block text-[11px] text-zinc-400">{option.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="text-xs rounded-xl px-4 py-3 bg-red-500/10 border border-red-500/20 text-red-300"
            >
              {error}
            </p>
          )}

          <div className="pt-2">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={busy || (mode === "upload" ? !text : !reference.trim())}
              className="w-full sm:w-auto"
            >
              {busy
                ? mode === "upload"
                  ? "Reading transcript…"
                  : "Fetching from Ruff Cut…"
                : "Create project →"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
