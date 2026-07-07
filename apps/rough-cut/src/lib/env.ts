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
