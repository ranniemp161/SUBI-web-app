"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { MAX_OBJECT_ATTEMPTS } from "@/lib/object-prompt";
import {
  ObjectGenerationError,
  describeProgress,
  drawSceneObject,
} from "@/lib/object-generate";
import { Badge, Button, Card } from "@/components/ui";

/**
 * The Draw control for one scene's illustration (spec `broll/0008`).
 *
 * The four steps behind the button live in `object-generate.ts`, shared with the
 * studio bar's batch action; this component owns the button, the status line and
 * the attempt count, and nothing else.
 *
 * **An empty scene says so, loudly.** Illustrations are drawn on demand, so a
 * freshly planned object scene has none — that is the design, not a failure, but
 * it is also the one thing standing between the creator and a clip. So the card
 * carries the accent border and a stated "Not drawn yet" until an image exists,
 * and the button is the screen's primary action rather than one more grey
 * control. The sentence explaining it is not repeated here: the detail pane
 * already states the block above the preview, in the same accent. Once there is an image the card drops back to ordinary chrome: a
 * redraw is optional, and shouting about it would train the creator to ignore
 * the state that matters.
 *
 * **The subject is shown and is not editable.** It is a claim traced back to the
 * line the scene cites, and this app's rule is that presentation is editable and
 * claims are not — letting a creator type a new subject here would be exactly
 * the fabrication the trace exists to prevent, with an extra step.
 */
export function ObjectPanel({
  projectId,
  sceneId,
  subject,
  attempt,
  hasImage,
  price,
  disabled = false,
  onGenerated,
}: {
  projectId: string;
  sceneId: string;
  /** The traced noun phrase this scene illustrates. */
  subject: string;
  /** How many illustrations this scene has already had. */
  attempt: number;
  hasImage: boolean;
  /** Formatted server side: the price env override is not public. */
  price: string;
  disabled?: boolean;
  /** Applied locally at once, so the preview redraws without a reload. */
  onGenerated: (pathname: string) => void;
}) {
  // Only ever used to refresh a lapsed session before retrying an upload.
  // Nothing here reads the token's value.
  const { getToken } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = status !== null;
  const atCap = attempt >= MAX_OBJECT_ATTEMPTS;

  const generate = useCallback(async () => {
    if (busy || disabled || atCap) return;
    setError(null);
    setStatus("Drawing…");

    try {
      const { pathname } = await drawSceneObject({
        projectId,
        sceneId,
        getToken,
        onProgress: (progress) => setStatus(describeProgress(progress)),
      });
      onGenerated(pathname);
    } catch (cause) {
      setError(
        cause instanceof ObjectGenerationError
          ? cause.message
          : "Couldn't finish that illustration. Try again."
      );
    } finally {
      setStatus(null);
    }
  }, [busy, disabled, atCap, projectId, sceneId, getToken, onGenerated]);

  return (
    <Card
      className={`flex flex-col gap-2.5 p-3.5 ${
        hasImage
          ? ""
          : "border-[var(--broll-accent)]/40 bg-[var(--broll-accent)]/[0.04]"
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            ILLUSTRATION
          </span>
          {!hasImage && (
            <Badge size="sm" variant="accent">
              Not drawn yet
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs font-semibold text-white">{subject}</p>
        <p className="mt-1 text-[10px] leading-tight text-zinc-500">
          Taken from the line this scene cites, so it can&rsquo;t be edited. Always drawn
          flat 2D, whatever style the character is.
        </p>
      </div>

      <Button
        type="button"
        variant={hasImage ? "glass" : "primary"}
        disabled={busy || disabled || atCap}
        onClick={generate}
        className="w-full"
      >
        {busy
          ? status
          : atCap
            ? "No redraws left"
            : hasImage
              ? `Draw it again — ${price}`
              : `Draw it — ${price}`}
      </Button>

      <p className="text-[10px] text-zinc-500 broll-tabular">
        {attempt} of {MAX_OBJECT_ATTEMPTS} drawn
      </p>

      {error && (
        <p className="text-[11px] text-red-400" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
