"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_CHARACTER_NAME_CHARS } from "@/lib/character-prompt";

/**
 * Rename and delete, for one character in the library (spec `broll/0007`
 * AC-135, AC-136).
 *
 * **No modal, and no confirm dialog.** This repo's established pattern is an
 * anchored, in-place control: delete arms itself in the row it belongs to and
 * asks a second time there. A dialog for a library action puts a blocking layer
 * over the very thumbnails the creator is deciding from.
 *
 * **The delete is genuinely irreversible, which is why it arms rather than
 * fires.** There is no undo to offer: the stored objects go with the rows, and
 * the six images cost $2.00 to make again. The two step is doing real work here,
 * unlike on an action a toast could take back.
 */
export function CharacterActions({
  characterId,
  name,
  inUseCount,
}: {
  characterId: string;
  name: string;
  /** Server side count. The route re-checks; this only shapes the wording. */
  inUseCount: number;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitRename(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setRenaming(false);
      setDraft(name);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/characters/${characterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Couldn't rename that character.");
        return;
      }
      setRenaming(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/characters/${characterId}`, { method: "DELETE" });
      if (!response.ok) {
        // The 409 carries the projects by name, which is the whole reason the
        // refusal exists rather than a generic failure.
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Couldn't delete that character.");
        setArming(false);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (renaming) {
    return (
      <form onSubmit={submitRename} className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={draft}
          maxLength={MAX_CHARACTER_NAME_CHARS}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Character name"
          className="min-w-0 flex-1 rounded-lg bg-[#16171c] border border-white/15 px-3 py-1.5 text-xs text-white outline-none focus:border-[var(--broll-accent)]"
        />
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--broll-accent)] text-[#111111] disabled:opacity-50 cursor-pointer"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setRenaming(false);
            setDraft(name);
            setError(null);
          }}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-300 hover:text-white cursor-pointer"
        >
          Cancel
        </button>
        {error && (
          <p role="alert" className="w-full text-[11px] text-red-300">
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setRenaming(true)}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-200 bg-[#16171c] hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
      >
        Rename
      </button>

      {arming ? (
        <>
          <span className="text-[11px] text-zinc-400">
            {inUseCount > 0
              ? "In use — this will be refused."
              : "Delete for good? The six images go too."}
          </span>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/90 text-white hover:bg-red-500 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            onClick={() => setArming(false)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-300 hover:text-white cursor-pointer"
          >
            Keep
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            setArming(true);
            setError(null);
          }}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-300/90 bg-[#16171c] hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 transition-colors cursor-pointer"
        >
          Delete
        </button>
      )}

      {error && (
        <p role="alert" className="w-full text-[11px] text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
