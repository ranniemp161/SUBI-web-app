import { uploadPresigned } from "@vercel/blob/client";

/**
 * Putting one generated PNG into the blob store from the browser.
 *
 * **Browser only**, like `segmentation.ts` and for the same reason: it is half
 * of the rule that no image byte crosses one of our Functions on a path the
 * browser can take itself (spec `broll/0004` AC-17). A generated PNG goes
 * browser to store by presigned PUT, and comes back by presigned GET.
 *
 * Extracted from `character-panel.tsx` when spec `broll/0008` gave object
 * illustrations the same upload path. Importing them from that component would
 * have pulled its eight hundred lines into the Scene Studio bundle to reach
 * three small functions.
 *
 * **The pathname is always a server value.** Every caller here is handing back a
 * pathname a route minted and streamed down, and `/api/blob/upload` re-derives
 * and re-checks it before it signs anything. Nothing in this module invents one.
 */

async function putPresigned(pathname: string, blob: Blob): Promise<void> {
  await uploadPresigned(pathname, blob, {
    access: "private",
    handleUploadUrl: "/api/blob/upload",
    contentType: "image/png",
  });
}

/**
 * Upload, and on failure refresh the Clerk session once and try again.
 *
 * A generation run is long enough that a session can lapse partway through it,
 * and the upload is the first thing after the money has already moved. Retrying
 * with a fresh token turns the most likely transient failure into a pause rather
 * than into a paid-for image the creator never receives. The **original** cause
 * is rethrown if the retry also fails, because that is the error worth reporting.
 */
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

/** The PNG a generate route streamed down, as bytes the cutout step can read. */
export function base64ToPngBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}
