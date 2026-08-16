"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { uploadPresigned } from "@vercel/blob/client";
import { CHARACTER_EMOTIONS, type CharacterEmotion } from "@/lib/emotions";
import {
  ACCEPTED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  MAX_REGENERATIONS,
  NEUTRAL_REGEN_WARNING,
  PHOTO_PRIVACY_COPY,
} from "@/lib/character-prompt";
import {
  probeSegmentation,
  removeCharacterBackground,
  type ProbeResult,
} from "@/lib/segmentation";
import { trimTransparent } from "@/lib/trim";
import { Badge, Button, Card } from "@/components/ui";

/**
 * The character pipeline's whole browser half (spec `broll/0004`).
 *
 * A client component because it does the pixels work: it reads a stream that
 * pushes one generated image at a time, and for each one removes the background,
 * trims it to the character, and uploads it **straight to storage** with a
 * presigned PUT. No image byte crosses one of our Functions on a path the
 * browser can take itself (AC-17).
 *
 * The order of operations is the money design, not a preference. The capability
 * probe runs and must pass before Generate is enabled, because the user pays
 * before the browser does its half of the work (AC-61); the commit call at the
 * end is what settles the hold, so a run abandoned in between refunds itself.
 */

export type ReviewAsset = {
  emotion: CharacterEmotion;
  width: number;
  height: number;
  attempt: number;
  /** A presigned GET, signed server side. Null only if signing failed. */
  url: string | null;
};

type TurnLine = {
  /**
   * The opening line of both streams: the character this run is writing.
   *
   * Handed straight back to `commit`, which re-validates it against the signed
   * in user rather than trusting it. The browser never invents one.
   */
  characterId?: string;
  emotion?: CharacterEmotion;
  pathname?: string;
  png?: string;
  phase?: string;
  done?: boolean;
  costMicros?: number;
  error?: string;
  code?: string;
};

type CommittedAsset = {
  emotion: CharacterEmotion;
  pathname: string;
  width: number;
  height: number;
};

const ACCEPT_ATTRIBUTE = ACCEPTED_PHOTO_TYPES.join(",");

const EMOTION_LABELS: Record<CharacterEmotion, string> = {
  excited: "Excited",
  happy: "Happy",
  neutral: "Neutral",
  skeptical: "Skeptical",
  surprised: "Surprised",
  thoughtful: "Thoughtful",
};

/** A sibling project that draws with the same character (spec `broll/0007` AC-133). */
type UsingProject = { id: string; name: string };

export function CharacterPanel({
  projectId,
  characterName,
  initialAssets,
  initialRegenerationsUsed,
  setPrice,
}: {
  projectId: string;
  /** The character this project draws with, so the re-run copy can name it. */
  characterName: string | null;
  initialAssets: ReviewAsset[];
  initialRegenerationsUsed: number;
  /** Formatted server side: the price env override is not public. */
  setPrice: string;
}) {
  const router = useRouter();
  // Only ever used to refresh a lapsed session before retrying an upload, see
  // `storeTurn`. Nothing here reads the token's value.
  const { getToken } = useAuth();
  const [assets, setAssets] = useState<ReviewAsset[]>(initialAssets);
  const [regenerationsUsed, setRegenerationsUsed] = useState(initialRegenerationsUsed);
  const [photo, setPhoto] = useState<File | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [probing, setProbing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "set" | CharacterEmotion>(null);
  const [error, setError] = useState<string | null>(null);
  const [onDark, setOnDark] = useState(true);
  const [confirmingRerun, setConfirmingRerun] = useState(false);
  const [detaching, setDetaching] = useState(false);
  const [showHowRedrawsWork, setShowHowRedrawsWork] = useState(false);
  // The other projects a redraw would change. Empty until the read below
  // answers, which is the honest starting state: silence, never a claim that
  // nothing else uses this face.
  const [alsoUsedBy, setAlsoUsedBy] = useState<UsingProject[]>([]);

  // Every object URL this component mints, so none leaks. Six 1K PNGs held past
  // their use is real memory, and a regeneration mints more.
  const previewUrls = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
    },
    []
  );

  /**
   * Run the capability probe, or reuse the answer. **Never on mount.**
   */
  const ensureProbe = useCallback(async (): Promise<ProbeResult> => {
    setProbing(true);
    try {
      const result = await probeSegmentation();
      setProbe(result.ok ? { ok: true } : { ok: false, reason: result.reason });
      return result;
    } finally {
      setProbing(false);
    }
  }, []);

  const showLocally = useCallback((emotion: CharacterEmotion, blob: Blob, width: number, height: number) => {
    const url = URL.createObjectURL(blob);
    previewUrls.current.push(url);
    // Shown the moment it is cut, not when the run ends: variants populate
    // progressively and there is never an unqualified spinner for the whole run
    // (AC-21).
    setAssets((current) => {
      const next = current.filter((asset) => asset.emotion !== emotion);
      next.push({ emotion, width, height, attempt: 0, url });
      return sortByTurnOrder(next);
    });
  }, []);

  /** Cut out, trim, and upload one generated image. The heavy half of a turn. */
  const storeTurn = useCallback(
    async (line: Required<Pick<TurnLine, "emotion" | "pathname" | "png">>) => {
      const generated = base64ToPngBlob(line.png);
      const cut = await removeCharacterBackground(generated);
      const trimmed = await trimTransparent(cut);

      await putPresignedWithRetry(line.pathname, trimmed.blob, getToken);

      showLocally(line.emotion, trimmed.blob, trimmed.width, trimmed.height);
      return {
        emotion: line.emotion,
        pathname: line.pathname,
        width: trimmed.width,
        height: trimmed.height,
      };
    },
    [showLocally, getToken]
  );

  /**
   * Detach this project from its character (AC-137).
   *
   * **Moves no money and deletes nothing**, which is why it needs no confirm
   * beyond arming the button: the character stays in the library, the project's
   * character scenes stay planned, and attaching one again makes them
   * renderable with no re-plan. Nothing here is undone by a refund.
   */
  const detach = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/character`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Explicit null, not an omitted field: the route distinguishes the two,
        // because `{}` is a malformed request and this is an intention.
        body: JSON.stringify({ characterId: null }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Couldn't detach that character.");
        return;
      }
      setDetaching(false);
      router.refresh();
    } catch {
      setError("Couldn't detach that character. Try again.");
    }
  }, [projectId, router]);

  /**
   * Which other projects a redraw would change (AC-133).
   */
  const refreshUsage = useCallback(async () => {
    setAlsoUsedBy(await fetchOtherProjectsUsing(projectId));
  }, [projectId]);

  useEffect(() => {
    if (!characterName) return;
    let cancelled = false;

    async function load() {
      const others = await fetchOtherProjectsUsing(projectId);
      if (!cancelled) setAlsoUsedBy(others);
    }
    void load();

    return () => {
      cancelled = true;
    };
  }, [characterName, projectId]);

  /** Replace the local previews with freshly signed urls for what is stored. */
  const refreshAssets = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/character/urls`);
    if (!response.ok) return;
    const body = (await response.json()) as { assets?: ReviewAsset[] };
    if (body.assets) setAssets(sortByTurnOrder(body.assets));
  }, [projectId]);

  const generate = useCallback(async () => {
    if (busy || probing || !photo || probe?.ok === false) return;
    setConfirmingRerun(false);
    setError(null);

    const capability = await ensureProbe();
    if (!capability.ok) {
      setError(capability.reason);
      return;
    }

    setBusy("set");
    setStatus("Drawing your character…");

    const form = new FormData();
    form.append("photo", photo);

    try {
      const response = await fetch(`/api/projects/${projectId}/character`, {
        method: "POST",
        body: form,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The character run failed. Try again.");
        return;
      }

      const committed: CommittedAsset[] = [];
      let work = Promise.resolve();
      const failure: { first: { emotion: CharacterEmotion; cause: unknown } | null } = {
        first: null,
      };

      const run: { characterId: string | null } = { characterId: null };

      const terminal = await readCharacterStream(response, (line) => {
        if (line.characterId) {
          run.characterId = line.characterId;
          return;
        }
        if (line.emotion && line.pathname && line.png) {
          const turn = { emotion: line.emotion, pathname: line.pathname, png: line.png };
          work = work
            .then(async () => {
              committed.push(await storeTurn(turn));
              setStatus(`Cut out ${committed.length} of ${CHARACTER_EMOTIONS.length}…`);
            })
            .catch((cause: unknown) => {
              failure.first = failure.first ?? { emotion: turn.emotion, cause };
              console.error("[character] cutout failed", turn.emotion, cause);
            });
        } else if (line.phase) {
          setStatus(`Drawing your character… ${line.done ?? 0} of ${CHARACTER_EMOTIONS.length}`);
        }
      });

      await work;

      if (terminal?.error) {
        setError(terminal.error);
        return;
      }
      if (failure.first) {
        setError(
          `Your character was drawn, but the cutout step failed on "${failure.first.emotion}" in this browser: ${describeCause(failure.first.cause)}. Nothing was stored, and the run will refund itself.`
        );
        return;
      }
      if (
        !terminal?.done ||
        committed.length !== CHARACTER_EMOTIONS.length ||
        !run.characterId
      ) {
        setError(
          "The connection dropped before the set finished. Nothing was charged — reload and try again."
        );
        return;
      }

      setStatus("Storing your set…");
      const commit = await fetch(`/api/projects/${projectId}/character/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "set",
          characterId: run.characterId,
          assets: committed,
          costMicros: terminal.costMicros,
        }),
      });

      if (!commit.ok) {
        const body = (await commit.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Your set could not be stored.");
        return;
      }

      setRegenerationsUsed(0);
      setPhoto(null);
      await refreshAssets();
      await refreshUsage();
      router.refresh();
      setStatus(null);
    } catch {
      setError("The character run failed. Try again.");
    } finally {
      setBusy(null);
    }
  }, [
    busy,
    probing,
    photo,
    probe,
    ensureProbe,
    projectId,
    storeTurn,
    refreshAssets,
    refreshUsage,
    router,
  ]);

  const regenerate = useCallback(
    async (emotion: CharacterEmotion) => {
      if (busy || probing || probe?.ok === false) return;
      setError(null);

      const capability = await ensureProbe();
      if (!capability.ok) {
        setError(capability.reason);
        return;
      }

      setBusy(emotion);
      setStatus(`Redrawing ${EMOTION_LABELS[emotion].toLowerCase()}…`);

      try {
        const response = await fetch(`/api/projects/${projectId}/character/regenerate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ emotion }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "The redraw failed. Try again.");
          return;
        }

        let stored: CommittedAsset | null = null;
        let work = Promise.resolve();
        let failure: unknown = null;
        const run: { characterId: string | null } = { characterId: null };

        const terminal = await readCharacterStream(response, (line) => {
          if (line.characterId) {
            run.characterId = line.characterId;
            return;
          }
          if (line.emotion && line.pathname && line.png) {
            const turn = { emotion: line.emotion, pathname: line.pathname, png: line.png };
            work = work
              .then(async () => {
                stored = await storeTurn(turn);
              })
              .catch((cause) => {
                failure = failure ?? cause;
              });
          }
        });

        await work;

        if (terminal?.error) {
          setError(terminal.error);
          return;
        }
        if (failure || !stored || !run.characterId) {
          setError("The redraw could not be stored. Your previous image is untouched.");
          return;
        }

        const commit = await fetch(`/api/projects/${projectId}/character/commit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "variant",
            characterId: run.characterId,
            assets: [stored],
          }),
        });

        if (!commit.ok) {
          const body = (await commit.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "The redraw could not be stored.");
          return;
        }

        setRegenerationsUsed((used) => used + 1);
        await refreshAssets();
        setStatus(null);
      } catch {
        setError("The redraw failed. Try again.");
      } finally {
        setBusy(null);
      }
    },
    [busy, probing, probe, ensureProbe, projectId, storeTurn, refreshAssets]
  );

  const hasSet = assets.length === CHARACTER_EMOTIONS.length;
  const regenerationsLeft = Math.max(0, MAX_REGENERATIONS - regenerationsUsed);
  const running = busy !== null;

  // Build the display list of 6 emotions
  const displayEmotions: CharacterEmotion[] = [
    "excited",
    "happy",
    "neutral",
    "skeptical",
    "surprised",
    "thoughtful",
  ];

  return (
    <section className="mt-8">
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4">
        <div>
          <h2
            className="text-base font-bold tracking-tight text-white"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            Character set
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Six emotions generated from your photo. Hover a card to redraw it.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Light / Dark Mode Toggle */}
          <div className="flex items-center rounded-lg bg-[#141518] p-0.5 border border-white/10 text-xs">
            <button
              type="button"
              onClick={() => setOnDark(true)}
              className={`px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${
                onDark
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
              aria-pressed={onDark}
            >
              On dark
            </button>
            <button
              type="button"
              onClick={() => setOnDark(false)}
              className={`px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${
                !onDark
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
              aria-pressed={!onDark}
            >
              On light
            </button>
          </div>

          {hasSet && !confirmingRerun && (
            <Button
              type="button"
              variant="glass"
              size="sm"
              onClick={() => setConfirmingRerun(true)}
              disabled={running}
            >
              New set from a photo
            </Button>
          )}

          {/* Detach (AC-137). Arms in place rather than opening a dialog, the
              same pattern the characters page uses — but the wording is much
              softer than delete's, because this genuinely takes nothing away:
              the character keeps existing and can be reattached for free. */}
          {hasSet && !confirmingRerun && !detaching && (
            <Button
              type="button"
              variant="glass"
              size="sm"
              onClick={() => setDetaching(true)}
              disabled={running}
            >
              Detach
            </Button>
          )}
          {detaching && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-zinc-400">
                Use no character here? The character itself is kept.
              </span>
              <Button
                type="button"
                variant="glass"
                size="sm"
                onClick={detach}
                disabled={running}
              >
                Detach
              </Button>
              <button
                type="button"
                onClick={() => setDetaching(false)}
                className="px-2 py-1 font-semibold text-zinc-300 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stated before the file picker, not after it (AC-66). */}
      {!hasSet && (
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          {PHOTO_PRIVACY_COPY}
        </p>
      )}

      {probe?.ok === false && (
        <p className="broll-glow mt-4 rounded-lg px-4 py-3 text-xs" role="alert">
          {probe.reason}
        </p>
      )}

      {!hasSet && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label
            className="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium bg-[#141518] border border-white/10 hover:border-white/20 transition-colors"
            style={{ opacity: running ? 0.6 : 1 }}
          >
            {photo ? photo.name : "Choose a photo"}
            <input
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              disabled={running}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setError(
                  file && file.size > MAX_PHOTO_BYTES
                    ? "That photo is over 10 MB. Try a smaller one."
                    : null
                );
                const accepted = file && file.size <= MAX_PHOTO_BYTES ? file : null;
                setPhoto(accepted);
                if (accepted) void ensureProbe();
              }}
            />
          </label>

          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={generate}
            disabled={running || probing || !photo || probe?.ok === false}
          >
            {running ? "Generating…" : `Generate character set — ${setPrice}`}
          </Button>

          {probing && (
            <span className="text-xs text-zinc-400">
              Checking this browser…
            </span>
          )}
        </div>
      )}

      {status && (
        <p
          className="mt-4 text-xs font-semibold"
          role="status"
          aria-live="polite"
          style={{ color: "var(--broll-accent)" }}
        >
          {status}
        </p>
      )}

      {error && (
        <p className="mt-4 text-xs" role="alert" style={{ color: "#ff6b6b" }}>
          {error}
        </p>
      )}

      {hasSet && alsoUsedBy.length > 0 && (
        <p className="broll-glow mt-4 rounded-lg px-4 py-3 text-xs leading-relaxed" role="status">
          This character is also used by{" "}
          {alsoUsedBy.map((project, index) => (
            <span key={project.id}>
              {index > 0 && (index === alsoUsedBy.length - 1 ? " and " : ", ")}
              <strong>{project.name}</strong>
            </span>
          ))}
          . Redrawing a variant changes it there too.
        </p>
      )}

      {/* 6 Emotion Cards Grid */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {displayEmotions.map((emotion) => {
          const asset = assets.find((a) => a.emotion === emotion);
          const isBase = emotion === "neutral";
          const isBusyThis = busy === emotion;

          return (
            <div
              key={emotion}
              className={`rounded-xl p-3 bg-[#111215] border transition-all relative flex flex-col justify-between group ${
                isBusyThis
                  ? "border-[var(--broll-accent)] shadow-[0_0_20px_rgba(255,252,0,0.2)]"
                  : "border-white/[0.08] hover:border-white/20"
              }`}
            >
              {/* Card Header Tag */}
              <div className="flex items-center justify-between min-h-[18px] mb-2">
                <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">
                  {asset?.url ? "" : "PLACEHOLDER"}
                </span>
                {isBase && (
                  <Badge variant="accent" size="sm">
                    Base
                  </Badge>
                )}
              </div>

              {/* Avatar / Character cutout image frame */}
              <div
                className="w-full aspect-[3/4] rounded-lg flex items-center justify-center overflow-hidden relative transition-colors"
                style={{
                  background: onDark ? "#0c0d10" : "#e6e6e8",
                }}
              >
                {asset?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- presigned direct blob url
                  <img
                    src={asset.url}
                    alt={`${EMOTION_LABELS[emotion]} character variant`}
                    className="max-h-full max-w-full object-contain drop-shadow-sm transition-transform duration-200 group-hover:scale-105"
                  />
                ) : (
                  <svg
                    className="w-20 h-20 opacity-30 text-zinc-400"
                    viewBox="0 0 100 100"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <circle cx="50" cy="35" r="22" />
                    <path d="M15 90 C15 65 30 55 50 55 C70 55 85 65 85 90 Z" />
                  </svg>
                )}

                {/* Hover Redraw Action Overlay */}
                {hasSet && (
                  <div className="absolute inset-0 bg-black/75 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-1.5 transition-opacity p-2 text-center">
                    <Button
                      type="button"
                      variant="primary"
                      size="xs"
                      onClick={() => regenerate(emotion)}
                      disabled={
                        running || probing || regenerationsLeft === 0 || probe?.ok === false
                      }
                      className="w-full"
                    >
                      {isBusyThis ? "Redrawing…" : "Redraw"}
                    </Button>
                    <span className="text-[10px] text-zinc-400">
                      {regenerationsLeft > 0 ? "Free redraw" : "0 left"}
                    </span>
                  </div>
                )}
              </div>

              {/* Card Footer */}
              <div className="mt-3 flex items-center justify-between gap-1 text-xs">
                <span className="font-semibold text-white">
                  {EMOTION_LABELS[emotion]}
                </span>
                <span className="text-[10px] text-zinc-400 broll-tabular font-medium">
                  {asset ? `${asset.width}×${asset.height}` : "814×1094"}
                </span>
              </div>

              {/* Warning on neutral */}
              {isBase && (
                <p className="mt-2 text-[10px] text-zinc-500 leading-tight">
                  {NEUTRAL_REGEN_WARNING}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* 12-Segment Redraw Allowance Battery Bar */}
      {hasSet && (
        <Card className="mt-4 p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* 12 Segments */}
            <div className="flex items-center gap-1 shrink-0" aria-hidden="true">
              {Array.from({ length: MAX_REGENERATIONS }, (_, i) => {
                const filled = i < regenerationsLeft;
                return (
                  <div
                    key={i}
                    className="w-2.5 h-4 rounded-[2px] transition-all"
                    style={{
                      background: filled ? "var(--broll-accent)" : "rgba(255, 255, 255, 0.12)",
                      boxShadow: filled ? "0 0 6px rgba(255,252,0,0.3)" : "none",
                    }}
                  />
                );
              })}
            </div>

            <p className="text-xs text-zinc-300">
              <strong className="text-white broll-tabular">
                {regenerationsLeft} of {MAX_REGENERATIONS} redraws left for this character
              </strong>{" "}
              · free, and the allowance follows the character wherever it is used.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowHowRedrawsWork(!showHowRedrawsWork)}
            className="text-xs font-semibold text-zinc-300 hover:text-white transition-colors shrink-0 underline cursor-pointer"
          >
            How redraws work
          </button>
        </Card>
      )}

      {showHowRedrawsWork && (
        <Card variant="subtle" className="mt-2.5 p-4 text-xs text-zinc-300 leading-relaxed">
          <h4 className="font-bold text-white mb-1">Character Redraw Allowance</h4>
          <p>
            Each generated character set includes {MAX_REGENERATIONS} free redraws.
            Because generated characters can be reused across multiple projects, this
            allowance is tied directly to the character rather than a single project.
            Redrawing an emotion updates that character wherever it is currently in use.
          </p>
        </Card>
      )}

      {/* Confirmation box when user wants to generate a new character from a photo */}
      {hasSet && confirmingRerun && (
        <div className="broll-glow mt-4 rounded-xl p-4 sm:p-5">
          <p className="text-xs leading-relaxed text-zinc-200">
            Generating again costs <strong>{setPrice}</strong> and draws a new
            character from a new photo. This project switches to it, with a fresh
            set of {MAX_REGENERATIONS} redraws.{" "}
            {characterName ? <strong>{characterName}</strong> : "The current character"}{" "}
            is kept
            {alsoUsedBy.length > 0
              ? `, and the ${alsoUsedBy.length === 1 ? "project" : "projects"} using it stay${alsoUsedBy.length === 1 ? "s" : ""} on it.`
              : ", so you can come back to it or delete it."}
          </p>
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            <label className="cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/15 border border-white/10 transition-colors">
              {photo ? photo.name : "Choose a photo"}
              <input
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setPhoto(file);
                  if (file) void ensureProbe();
                }}
              />
            </label>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={generate}
              disabled={running || probing || !photo || probe?.ok === false}
            >
              Generate for {setPrice}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingRerun(false)}
            >
              Cancel
            </Button>
          </div>
          <p className="mt-2.5 text-[11px] text-zinc-400 leading-relaxed">
            {PHOTO_PRIVACY_COPY}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * The other projects drawing with this project's character (AC-133).
 */
async function fetchOtherProjectsUsing(projectId: string): Promise<UsingProject[]> {
  const response = await fetch(`/api/projects/${projectId}/character`);
  if (!response.ok) return [];
  const body = (await response.json()) as { usedBy?: UsingProject[] };
  return (body.usedBy ?? []).filter((project) => project.id !== projectId);
}

function describeCause(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const trimmed = message.trim();
  if (!trimmed) return "no error message was given";
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

function sortByTurnOrder(assets: ReviewAsset[]): ReviewAsset[] {
  return [...assets].sort(
    (a, b) =>
      CHARACTER_EMOTIONS.indexOf(a.emotion) - CHARACTER_EMOTIONS.indexOf(b.emotion)
  );
}

async function putPresigned(pathname: string, blob: Blob): Promise<void> {
  await uploadPresigned(pathname, blob, {
    access: "private",
    handleUploadUrl: "/api/blob/upload",
    contentType: "image/png",
  });
}

export async function putPresignedWithRetry(
  pathname: string,
  blob: Blob,
  getToken: (options: { skipCache: boolean }) => Promise<unknown>
): Promise<void> {
  try {
    await putPresigned(pathname, blob);
  } catch (cause) {
    await getToken({ skipCache: true }).catch(() => null);
    try {
      await putPresigned(pathname, blob);
    } catch {
      throw cause;
    }
  }
}

function base64ToPngBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

async function readCharacterStream(
  response: Response,
  onLine: (line: TurnLine) => void
): Promise<TurnLine | null> {
  if (!response.body) {
    const text = await response.text();
    return lastTerminalLine(text, onLine);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: TurnLine | null = null;

  const handle = (raw: string) => {
    const line = parseLine(raw);
    if (!line) return;
    onLine(line);
    if (!line.phase && !line.png) terminal = line;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }

  handle(buffer);
  return terminal;
}

function lastTerminalLine(
  text: string,
  onLine: (line: TurnLine) => void
): TurnLine | null {
  let terminal: TurnLine | null = null;
  for (const raw of text.split("\n")) {
    const line = parseLine(raw);
    if (!line) continue;
    onLine(line);
    if (!line.phase && !line.png) terminal = line;
  }
  return terminal;
}

function parseLine(raw: string): TurnLine | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as TurnLine;
  } catch {
    return null;
  }
}
