/**
 * The canonical pathname a project's transcription audio is uploaded under.
 *
 * Pure string logic, no server-only imports — needed by the client upload
 * flow (`dashboard/page.tsx`, calling Vercel Blob's `upload()` directly from
 * the browser) as well as server routes. Kept in its own zero-dependency
 * module, separate from `lib/blob.ts`'s server-only helpers (`del`, Sentry
 * reporting): a client component importing this can't drag those into the
 * browser bundle.
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
