import { base64ToPngBlob, putPresignedWithRetry } from "./blob-upload";
import { removeCharacterBackground } from "./segmentation";
import { trimTransparent } from "./trim";

/**
 * Drawing one scene's illustration, end to end, from the browser
 * (spec `broll/0008`).
 *
 * **One implementation, two callers**, for the same reason `to-renderable.ts`
 * has one: the scene pane's Draw button and the studio bar's batch action are
 * the same four steps, and a second copy is how the two would drift into
 * charging or storing differently. `ObjectPanel` and `useObjectBatch` both go
 * through here.
 *
 * The order is the money design, not a preference:
 *
 * 1. **Charge and draw** — the route does both, and refunds itself if the model
 *    fails, so the creator never pays for a picture they did not get.
 * 2. **Cut out and trim** — in the browser, because that is where the
 *    segmentation model runs.
 * 3. **Upload** — straight to the store with a presigned PUT. No image byte
 *    crosses one of our Functions on a path the browser can take itself.
 * 4. **Commit last** — the row does not point at an illustration until the bytes
 *    are in the store, so an abandoned run leaves a scene still waiting for one
 *    rather than one pointing at a key with nothing behind it.
 *
 * Browser only: step 2 pulls a WASM model and touches a canvas.
 */

export type ObjectProgress =
  | { phase: "drawing" }
  /** The segmentation model is downloading. `percent` is 0 to 100. */
  | { phase: "preparing"; percent: number }
  | { phase: "storing" };

export class ObjectGenerationError extends Error {}

export async function drawSceneObject(input: {
  projectId: string;
  sceneId: string;
  /** Refreshes a lapsed Clerk session before the upload is retried. */
  getToken: (options: { skipCache: boolean }) => Promise<unknown>;
  onProgress?: (progress: ObjectProgress) => void;
}): Promise<{ pathname: string }> {
  const { projectId, sceneId, getToken, onProgress } = input;

  onProgress?.({ phase: "drawing" });

  const response = await fetch(`/api/projects/${projectId}/scenes/${sceneId}/object`, {
    method: "POST",
    // One key per call, so a double-click charges once while a deliberate
    // redraw is a genuinely new request.
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ObjectGenerationError(body.error ?? "Couldn't draw that illustration.");
  }

  const drawn = (await response.json()) as { pathname: string; png: string };

  // The first cutout of a session downloads the segmentation model, which is
  // tens of megabytes. Reporting it turns an unexplained pause right after the
  // creator paid into something they can read. Reported only while it is
  // genuinely fetching, so a warm run does not flicker.
  const cut = await removeCharacterBackground(
    base64ToPngBlob(drawn.png),
    ({ key, current, total }) => {
      if (!key.startsWith("fetch") || total <= 0) return;
      onProgress?.({
        phase: "preparing",
        percent: Math.min(100, Math.round((current / total) * 100)),
      });
    }
  );

  onProgress?.({ phase: "storing" });
  const trimmed = await trimTransparent(cut);
  await putPresignedWithRetry(drawn.pathname, trimmed.blob, getToken);

  const committed = await fetch(
    `/api/projects/${projectId}/scenes/${sceneId}/object/commit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pathname: drawn.pathname }),
    }
  );
  if (!committed.ok) {
    const failure = (await committed.json().catch(() => ({}))) as { error?: string };
    throw new ObjectGenerationError(
      failure.error ?? "The illustration was drawn but couldn't be saved."
    );
  }

  return { pathname: drawn.pathname };
}

/** What to show while a run is in flight. */
export function describeProgress(progress: ObjectProgress): string {
  switch (progress.phase) {
    case "drawing":
      return "Drawing…";
    case "preparing":
      return `Preparing the cutout tool… ${progress.percent}%`;
    default:
      return "Storing…";
  }
}
