/**
 * Validated cross-app URLs — the single place allowed to read them from
 * process.env. Next.js inlines NEXT_PUBLIC_* by replacing the literal
 * `process.env.NEXT_PUBLIC_X` expression at build time, so each var must be
 * referenced by its full name here, never via a dynamic lookup.
 *
 * In a production build, a missing value or one still pointing at localhost
 * throws at import time — failing the deploy's prerender step instead of
 * silently sending users to the wrong app.
 */
function requiredUrl(
  name: string,
  value: string | undefined,
  devFallback: string
): string {
  if (process.env.NODE_ENV !== "production") {
    return (value || devFallback).replace(/\/$/, "");
  }
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value.replace(/\/$/, "");
}

/** Base URL of the Rough Cut app. Dev: rough-cut is pinned to 3000. */
export const ROUGH_CUT_URL = requiredUrl(
  "NEXT_PUBLIC_ROUGH_CUT_URL",
  process.env.NEXT_PUBLIC_ROUGH_CUT_URL,
  "http://localhost:3000"
);
