/**
 * Shared helpers for validating our own Vercel Blob store's public URLs.
 *
 * `BLOB_READ_WRITE_TOKEN` is formatted `vercel_blob_rw_<storeId>_<secret>`, and
 * `<storeId>` (lowercased) is the same identifier used as the subdomain of
 * every public blob URL — e.g. `https://<storeId>.public.blob.vercel-storage.com/...`.
 * We derive the expected hostname once so a server route can confirm a
 * client-supplied blob URL actually belongs to *our* store before handing it
 * to a third party (Deepgram) to fetch — otherwise an authenticated user could
 * point Deepgram at an arbitrary public blob under someone else's store.
 */
function deriveExpectedBlobHostname(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const match = token?.match(/^vercel_blob_rw_([a-z0-9]+)_/i);
  return match ? `${match[1].toLowerCase()}.public.blob.vercel-storage.com` : null;
}

const expectedBlobHostname = deriveExpectedBlobHostname();

/**
 * True if `url` is a public Vercel Blob object URL that belongs to our store.
 * Falls back to a same-domain-suffix check (still safe against SSRF — no
 * internal hosts are ever reachable under this domain) if the read-write
 * token doesn't parse into the expected shape.
 */
export function isOwnBlobUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }

  if (expectedBlobHostname) return hostname === expectedBlobHostname;
  return hostname.endsWith(".public.blob.vercel-storage.com");
}

/**
 * The canonical pathname a project's transcription audio is uploaded under.
 *
 * The blob-token route enforces this exact value (uniqueness comes from the
 * store's `addRandomSuffix`, not the pathname), which guarantees every upload
 * lands under the `projects/` prefix — the orphan sweep
 * (/api/cron/blob-sweep) lists that prefix, so a client that could pick its
 * own pathname could park blobs where the sweep never looks.
 */
export function uploadPathnameForProject(projectId: string): string {
  return `projects/${projectId}/audio`;
}

/**
 * Recover the owning projectId from one of our blob URLs
 * (`.../projects/<projectId>/<file>`), so routes acting on a client-supplied
 * blob URL (e.g. blob-cleanup) can verify the caller owns that project.
 * Returns null if the URL doesn't parse or doesn't follow the convention.
 */
export function projectIdFromBlobUrl(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/^\/projects\/([^/]+)\//);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}
