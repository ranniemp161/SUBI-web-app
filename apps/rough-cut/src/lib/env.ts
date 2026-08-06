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

/** Base URL of the Wallet app (buy credits). Dev: wallet is pinned to 3001. */
export const WALLET_URL = requiredUrl(
  "NEXT_PUBLIC_WALLET_URL",
  process.env.NEXT_PUBLIC_WALLET_URL,
  "http://localhost:3001"
);

/** URL to redirect users to when they want to buy credits */
export const WALLET_DASHBOARD_URL = `${WALLET_URL}/dashboard`;

/**
 * Origin of the B-Roll app — the one origin allowed to call
 * `GET /api/projects/:id/transcript` cross origin, with the user's own Clerk
 * session (spec _root/0001, AC-15). Never a wildcard: a transcript is the
 * user's own content.
 *
 * Optional, unlike `WALLET_URL`, and deliberately so. B-Roll's production
 * domain is still undecided (the b-roll high level design's open question 4),
 * so there is no correct value to require yet. Unset in production therefore
 * means **no cross origin caller is allowed at all** — the route still serves
 * same origin requests normally. Inventing a placeholder domain here would
 * either throw at import and break the deploy, or quietly authorize an origin
 * nobody owns. Once the domain exists, set the variable; nothing else changes.
 */
export const BROLL_URL: string | null =
  process.env.NEXT_PUBLIC_BROLL_URL?.replace(/\/$/, "") ??
  (process.env.NODE_ENV !== "production" ? "http://localhost:3003" : null);
