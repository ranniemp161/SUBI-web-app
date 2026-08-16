"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { styleLabel, type PickerCharacter } from "@/lib/character-picker";

/**
 * Attach a character this creator already owns to a project that has none
 * (spec `broll/0007` AC-123, AC-124, AC-148).
 *
 * **Offered only while the project has no character**, which is why this
 * component is rendered conditionally by the page rather than deciding for
 * itself: there is no swap in this feature, so a project that already has a
 * face keeps it until it is detached.
 *
 * **The style overwrite is stated before the attach, not after it.** The creator
 * chose a style when they created this project, and reusing a character replaces
 * it, because the six images exist in exactly one style. Telling them afterwards
 * would be telling them about a change they can no longer weigh.
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

      // The whole page is server rendered from the project's character, so a
      // refresh is what shows the six variants, the redraw controls and the
      // scenes that can suddenly draw again.
      setPicked(null);
      router.refresh();
    } catch {
      setError("That character could not be used. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-12">
      <h2
        className="text-sm font-semibold uppercase tracking-wide"
        style={{ color: "var(--broll-muted)" }}
      >
        Reuse a character
      </h2>
      <p className="mt-2 text-sm" style={{ color: "var(--broll-muted)" }}>
        You already paid for these, so using one here is free and needs no photo
        and no review.
      </p>

      <ul
        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3"
        aria-busy={busy}
      >
        {characters.map((character) => (
          <li key={character.id}>
            <button
              type="button"
              onClick={() => setPicked(character)}
              disabled={busy}
              aria-pressed={picked?.id === character.id}
              className="broll-glass w-full rounded-lg p-3 text-left text-sm disabled:opacity-60"
              style={{
                border:
                  picked?.id === character.id
                    ? "1px solid var(--broll-accent)"
                    : "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <span
                className="flex aspect-3/4 items-center justify-center overflow-hidden rounded"
                style={{ background: "var(--broll-background)" }}
              >
                {character.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a presigned blob URL, loaded straight from the store; the optimizer would put a Function back in the image path (AC-17)
                  <img
                    src={character.thumbnailUrl}
                    alt={character.name}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs" style={{ color: "var(--broll-muted)" }}>
                    No preview
                  </span>
                )}
              </span>
              <span className="mt-2 block truncate font-medium">{character.name}</span>
              <span className="text-xs" style={{ color: "var(--broll-muted)" }}>
                {styleLabel(character.style)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {picked && (
        <div className="broll-glow mt-4 rounded-lg px-4 py-3">
          <p className="text-sm">
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
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void attach(picked)}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60"
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
              className="rounded-lg px-3 py-1.5 text-sm"
              style={{ color: "var(--broll-muted)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm" role="alert" style={{ color: "#ff6b6b" }}>
          {error}
        </p>
      )}
    </section>
  );
}
