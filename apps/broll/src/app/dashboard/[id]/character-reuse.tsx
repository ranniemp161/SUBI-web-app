"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { styleLabel, type PickerCharacter } from "@/lib/character-picker";

/**
 * Attach a character this creator already owns to a project that has none
 * (spec `broll/0007` AC-123, AC-124, AC-148).
 */
export function CharacterReuse({
  projectId,
  projectStyle,
  characters,
}: {
  projectId: string;
  projectStyle: string;
  characters: PickerCharacter[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<PickerCharacter | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function attach(character: PickerCharacter) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/character`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characterId: character.id }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "That character could not be used.");
        return;
      }

      setPicked(null);
      router.refresh();
    } catch {
      setError("That character could not be used. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-8 rounded-xl p-5 bg-[#111215] border border-white/[0.08]">
      <h2
        className="text-sm font-bold tracking-tight text-white"
        style={{ fontFamily: "var(--font-space-grotesk)" }}
      >
        Reuse a character
      </h2>
      <p className="mt-1 text-xs text-zinc-400">
        You already paid for these, so using one here is free and needs no photo
        and no review.
      </p>

      <ul
        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6"
        aria-busy={busy}
      >
        {characters.map((character) => {
          const isPicked = picked?.id === character.id;
          return (
            <li key={character.id}>
              <button
                type="button"
                onClick={() => setPicked(character)}
                disabled={busy}
                aria-pressed={isPicked}
                className={`w-full rounded-xl p-2.5 text-left text-xs transition-all flex flex-col justify-between ${
                  isPicked
                    ? "bg-[#16171c] border-2 border-[var(--broll-accent)] shadow-[0_0_15px_rgba(255,252,0,0.2)]"
                    : "bg-[#141518] border border-white/[0.08] hover:border-white/20"
                } disabled:opacity-60`}
              >
                <span
                  className="w-full aspect-[3/4] flex items-center justify-center overflow-hidden rounded-lg bg-[#09090b]"
                >
                  {character.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- presigned blob URL
                    <img
                      src={character.thumbnailUrl}
                      alt={character.name}
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-[10px] text-zinc-500">
                      No preview
                    </span>
                  )}
                </span>
                <span className="mt-2 block truncate font-semibold text-white">
                  {character.name}
                </span>
                <span className="text-[10px] text-zinc-400">
                  {styleLabel(character.style)} · free
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {picked && (
        <div className="broll-glow mt-4 rounded-xl p-4">
          <p className="text-xs leading-relaxed text-zinc-200">
            {picked.style === projectStyle ? (
              <>
                <strong>{picked.name}</strong> was drawn in{" "}
                {styleLabel(picked.style)}, the style this project already uses.
                Nothing is charged.
              </>
            ) : (
              <>
                <strong>{picked.name}</strong> was drawn in{" "}
                {styleLabel(picked.style)}, so this project&apos;s style changes
                from {styleLabel(projectStyle)} to {styleLabel(picked.style)}.
                Nothing is charged.
              </>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void attach(picked)}
              disabled={busy}
              className="rounded-lg px-3.5 py-1.5 text-xs font-bold disabled:opacity-60 transition-colors"
              style={{
                background: "var(--broll-accent)",
                color: "var(--broll-accent-foreground)",
              }}
            >
              {busy ? "Using…" : `Use ${picked.name}`}
            </button>
            <button
              type="button"
              onClick={() => setPicked(null)}
              disabled={busy}
              className="rounded-lg px-3.5 py-1.5 text-xs text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 text-xs" role="alert" style={{ color: "#ff6b6b" }}>
          {error}
        </p>
      )}
    </section>
  );
}
