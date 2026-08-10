import "server-only";
import { ROUGH_CUT_URL } from "@/lib/env";
import { reportError } from "@repo/server-shared/observability";

/**
 * Has the Ruff Cut edit moved since this transcript was taken? (AC-49.)
 *
 * **Warns, never replaces.** The stored transcript is the thing every scene's
 * timecode is measured against, so silently refreshing it would move every
 * scene under a plan the user already reviewed. The user is told, and re-import
 * stays their decision.
 *
 * Server to server with a forwarded Clerk session token, for the same reason
 * `importFromRoughCut` is: b-roll gets its own domain, so a browser fetch would
 * hinge on the `SameSite` value Clerk puts on its session cookie, which is
 * Clerk's setting and not ours.
 *
 * **Best effort by design.** Any failure — Ruff Cut down, the project deleted,
 * a slow response — answers `"unknown"` and shows no warning. A staleness hint
 * is not worth failing a page render over, and a false "your transcript is
 * stale" would be worse than saying nothing.
 */

/** Bounded so a slow neighbour cannot hold this page open. */
const FRESHNESS_TIMEOUT_MS = 4_000;

export type Freshness = "fresh" | "stale" | "unknown";

export async function checkTranscriptFreshness(input: {
  sourceProjectId: string | null;
  storedFingerprint: string | null;
  token: string | null;
}): Promise<Freshness> {
  const { sourceProjectId, storedFingerprint, token } = input;

  // An uploaded transcript has no source edit to drift from.
  if (!sourceProjectId || !storedFingerprint || !token) return "unknown";

  try {
    const response = await fetch(
      `${ROUGH_CUT_URL}/api/projects/${sourceProjectId}/transcript`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(FRESHNESS_TIMEOUT_MS),
      }
    );

    if (!response.ok) return "unknown";

    // Read the fingerprint without running the full document through Zod: this
    // is a comparison, not an import, and nothing here is stored.
    const document = (await response.json()) as {
      source?: { edlFingerprint?: string | null };
    };
    const current = document.source?.edlFingerprint ?? null;
    if (!current) return "unknown";

    return current === storedFingerprint ? "fresh" : "stale";
  } catch (error) {
    // Includes the timeout. Never rethrows: this check is an advisory.
    reportError("Could not check transcript freshness", error, { sourceProjectId });
    return "unknown";
  }
}
