"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  neutral: "Neutral",
  happy: "Happy",
  surprised: "Surprised",
  thoughtful: "Thoughtful",
  skeptical: "Skeptical",
  excited: "Excited",
};

export function CharacterPanel({
  projectId,
  initialAssets,
  initialRegenerationsUsed,
  setPrice,
}: {
  projectId: string;
  initialAssets: ReviewAsset[];
  initialRegenerationsUsed: number;
  /** Formatted server side: the price env override is not public. */
  setPrice: string;
}) {
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
   *
   * The probe is a real inference, and a real inference is expensive to start:
   * `@imgly/background-removal` fetches its model and the onnxruntime WASM from
   * a third party CDN, 84 MB and 11 MB at the default `medium` model, then runs
   * it on the **main thread**. Its worker only engages with WebGPU (the source
   * computes `proxyToWorker = useWebGPU && config.proxyToWorker`, and `device`
   * defaults to `cpu`), and threads need `SharedArrayBuffer`, which needs cross
   * origin isolation headers this app does not send. So it is single threaded,
   * on the thread React and every third party script share.
   *
   * Running that for every visitor who merely opened a project was enough to
   * starve Clerk's `UserButton` past its own ten second mount budget.
   *
   * **AC-61 is unchanged.** The probe still has to pass before any request that
   * moves money; it is simply started when the user shows intent and awaited by
   * the spending action itself, which is a stricter place to check it than a
   * disabled attribute. `probeSegmentation` caches its promise, so calling this
   * repeatedly costs one download.
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

      // The pathname came down the stream and is used verbatim. The browser
      // never chooses one, and both the upload route and the commit route
      // re-check it against this project anyway (AC-70).
      await uploadPresigned(line.pathname, trimmed.blob, {
        access: "private",
        handleUploadUrl: "/api/blob/upload",
        contentType: "image/png",
      });

      showLocally(line.emotion, trimmed.blob, trimmed.width, trimmed.height);
      return {
        emotion: line.emotion,
        pathname: line.pathname,
        width: trimmed.width,
        height: trimmed.height,
      };
    },
    [showLocally]
  );

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

    // Immediately before the spend, which is what AC-61 actually asks for. The
    // reserve happens inside the request below, so nothing has moved yet.
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
        // A failure before the stream opened still answers a real status.
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The character run failed. Try again.");
        return;
      }

      const committed: CommittedAsset[] = [];
      // Turns are processed one at a time while the stream keeps draining:
      // segmentation is heavy, and running six of them at once on the main
      // thread would stall the very progress this is meant to show.
      let work = Promise.resolve();
      // A holder rather than a bare `let`, for the same reason `committed` is an
      // array: the write happens inside a callback, which TypeScript's flow
      // analysis cannot see, so a plain variable narrows to `null` at the check.
      const failure: { first: { emotion: CharacterEmotion; cause: unknown } | null } = {
        first: null,
      };

      const terminal = await readCharacterStream(response, (line) => {
        if (line.emotion && line.pathname && line.png) {
          const turn = { emotion: line.emotion, pathname: line.pathname, png: line.png };
          work = work
            .then(async () => {
              committed.push(await storeTurn(turn));
              setStatus(`Cut out ${committed.length} of ${CHARACTER_EMOTIONS.length}…`);
            })
            .catch((cause: unknown) => {
              // Keep which turn died as well as why. This branch runs only
              // after six images have been bought, so throwing the cause away
              // meant the one failure the user has already paid for was the one
              // failure nobody could diagnose.
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
        // The real cause, named. "Something failed in this browser" is equally
        // true of a blocked upload, an out of memory canvas and a rejected
        // presign, and the user cannot act on any of them without knowing
        // which. The refund promise stays, because it is still what happens.
        setError(
          `Your character was drawn, but the cutout step failed on "${failure.first.emotion}" in this browser: ${describeCause(failure.first.cause)}. Nothing was stored, and the run will refund itself.`
        );
        return;
      }
      if (!terminal?.done || committed.length !== CHARACTER_EMOTIONS.length) {
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
          assets: committed,
          costMicros: terminal.costMicros,
        }),
      });

      if (!commit.ok) {
        const body = (await commit.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Your set could not be stored.");
        return;
      }

      // A paid re-run refills the allowance, which is the point of resetting
      // `attempt` server side (AC-65).
      setRegenerationsUsed(0);
      setPhoto(null);
      await refreshAssets();
      setStatus(null);
    } catch {
      setError("The character run failed. Try again.");
    } finally {
      setBusy(null);
    }
  }, [busy, probing, photo, probe, ensureProbe, projectId, storeTurn, refreshAssets]);

  const regenerate = useCallback(
    async (emotion: CharacterEmotion) => {
      if (busy || probing || probe?.ok === false) return;
      setError(null);

      // A redraw spends too, so it earns the same check in the same place. This
      // is also the only entry point for a project that already has a set,
      // where there is no photo picker to warm the probe.
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

        const terminal = await readCharacterStream(response, (line) => {
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
        if (failure || !stored) {
          setError("The redraw could not be stored. Your previous image is untouched.");
          return;
        }

        const commit = await fetch(`/api/projects/${projectId}/character/commit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "variant", assets: [stored] }),
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

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between gap-4">
        <h2
          className="text-sm font-semibold uppercase tracking-wide"
          style={{ color: "var(--broll-muted)" }}
        >
          Character
        </h2>

        {hasSet && (
          <button
            type="button"
            onClick={() => setOnDark((value) => !value)}
            className="rounded-lg px-3 py-1.5 text-xs"
            style={{ color: "var(--broll-muted)" }}
            aria-pressed={!onDark}
          >
            {onDark ? "Show on light" : "Show on scene"}
          </button>
        )}
      </div>

      {/* Stated before the file picker, not after it (AC-66). Every clause here
          is verifiable, and the 55 days is named rather than glossed as
          "deleted immediately", because that part is Google's to control. */}
      {!hasSet && (
        <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--broll-muted)" }}>
          {PHOTO_PRIVACY_COPY}
        </p>
      )}

      {probe?.ok === false && (
        <p className="broll-glow mt-4 rounded-lg px-4 py-3 text-sm" role="alert">
          {probe.reason}
        </p>
      )}

      {!hasSet && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label
            className="broll-glass cursor-pointer rounded-lg px-4 py-2 text-sm"
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
                // Warm start on intent: the download overlaps with the user
                // reading the price and reaching for Generate, instead of
                // running for everyone who merely opened the project.
                if (accepted) void ensureProbe();
              }}
            />
          </label>

          <button
            type="button"
            onClick={generate}
            // Disabled once the probe has *failed*, not until it has passed:
            // `generate` awaits the probe itself before it spends, so a browser
            // that cannot segment still never reaches the ledger (AC-61), and a
            // browser that has not been asked yet is no longer blocked.
            disabled={running || probing || !photo || probe?.ok === false}
            className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
            style={{
              background: "var(--broll-accent)",
              color: "var(--broll-accent-foreground)",
            }}
          >
            {running ? "Generating…" : `Generate character set — ${setPrice}`}
          </button>

          {probing && (
            <span className="text-xs" style={{ color: "var(--broll-muted)" }}>
              Checking this browser…
            </span>
          )}
        </div>
      )}

      {status && (
        <p
          className="mt-4 text-sm"
          role="status"
          aria-live="polite"
          style={{ color: "var(--broll-accent)" }}
        >
          {status}
        </p>
      )}

      {error && (
        <p className="mt-4 text-sm" role="alert" style={{ color: "#ff6b6b" }}>
          {error}
        </p>
      )}

      {assets.length > 0 && (
        <>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {assets.map((asset) => (
              <li key={asset.emotion} className="broll-glass rounded-lg p-3">
                {/* Previewed on the scene background by default, with a toggle
                    (AC-20). This deliberately overrides the design brief's
                    checkerboard: the artifact worth catching is a faint light
                    fringe, and a checkerboard hides it. */}
                <div
                  className="flex aspect-3/4 items-center justify-center overflow-hidden rounded"
                  style={{ background: onDark ? "var(--broll-background)" : "#e6e6e6" }}
                >
                  {asset.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a presigned blob URL, loaded straight from the store; the optimizer would put a Function back in the image path (AC-17)
                    <img
                      src={asset.url}
                      alt={`${EMOTION_LABELS[asset.emotion]} character variant`}
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs" style={{ color: "var(--broll-muted)" }}>
                      No preview
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-sm">{EMOTION_LABELS[asset.emotion]}</span>
                  <button
                    type="button"
                    onClick={() => regenerate(asset.emotion)}
                    disabled={
                      running || probing || regenerationsLeft === 0 || probe?.ok === false
                    }
                    className="text-xs underline disabled:opacity-50"
                    style={{ color: "var(--broll-muted)" }}
                  >
                    {busy === asset.emotion ? "Redrawing…" : "Redraw"}
                  </button>
                </div>

                <p className="mt-1 broll-tabular text-xs" style={{ color: "var(--broll-muted)" }}>
                  {asset.width}×{asset.height}
                </p>

                {/* The one control whose consequence cannot be undone, so the
                    warning sits on it rather than in a help page. */}
                {asset.emotion === "neutral" && (
                  <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--broll-muted)" }}>
                    {NEUTRAL_REGEN_WARNING}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <p className="mt-3 text-sm" style={{ color: "var(--broll-muted)" }}>
            {regenerationsLeft} of {MAX_REGENERATIONS} redraws left. Redraws are free.
          </p>
        </>
      )}

      {hasSet && (
        <div className="mt-4">
          {confirmingRerun ? (
            <div className="broll-glow rounded-lg px-4 py-3">
              <p className="text-sm">
                Generating again costs <strong>{setPrice}</strong> and replaces all six
                variants with a new character drawn from a new photo. It also gives you a
                fresh set of {MAX_REGENERATIONS} redraws.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="broll-glass cursor-pointer rounded-lg px-3 py-1.5 text-sm">
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
                <button
                  type="button"
                  onClick={generate}
                  disabled={running || probing || !photo || probe?.ok === false}
                  className="rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60"
                  style={{
                    background: "var(--broll-accent)",
                    color: "var(--broll-accent-foreground)",
                  }}
                >
                  Generate for {setPrice}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRerun(false)}
                  className="rounded-lg px-3 py-1.5 text-sm"
                  style={{ color: "var(--broll-muted)" }}
                >
                  Cancel
                </button>
              </div>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--broll-muted)" }}>
                {PHOTO_PRIVACY_COPY}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingRerun(true)}
              disabled={running}
              className="text-sm underline disabled:opacity-50"
              style={{ color: "var(--broll-muted)" }}
            >
              Generate a new set from a different photo
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One short line naming why a cutout died, safe to show a user.
 *
 * Only the message, never the stack: this reaches the screen. The full object is
 * on the console for whoever is actually debugging it.
 */
function describeCause(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const trimmed = message.trim();
  if (!trimmed) return "no error message was given";
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

/** Turn order, so the grid never reshuffles as variants land. */
function sortByTurnOrder(assets: ReviewAsset[]): ReviewAsset[] {
  return [...assets].sort(
    (a, b) =>
      CHARACTER_EMOTIONS.indexOf(a.emotion) - CHARACTER_EMOTIONS.indexOf(b.emotion)
  );
}

/**
 * The generated image, decoded straight to a PNG blob.
 *
 * No canvas round trip and no JPEG anywhere (AC-19): these bytes are the PNG the
 * vendor produced, and they stay that way until the trim re-encodes them as PNG.
 */
function base64ToPngBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

/**
 * Read the NDJSON stream, handing every line to `onLine`, and return the
 * terminal one.
 *
 * The same shape as the planner's reader and for the same reason: the route
 * sends HTTP 200 before the model answers, so a failure arrives as `{"error"}`
 * inside the last line and `res.json()` would deadlock on a body still open.
 * Here the lines in between carry images rather than only phases.
 */
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
    // Anything that is neither a heartbeat nor an image is the result.
    if (!line.phase && !line.png) terminal = line;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Whatever follows the final newline is a partial line, kept for the next
    // chunk rather than parsed as a whole one.
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
