/**
 * Shared money helpers for the SUBI ecosystem (USD wallet, ADR 0002).
 *
 * The balance is stored everywhere as integer USD micros (1,000,000 = $1).
 * Money is only ever turned into a human "$X.XX" string at the display edge,
 * via `formatUsd` — never rounded in storage or math.
 *
 * These helpers are pure and dependency free so both the server billing code
 * and client components can use them. The server credits library overrides the
 * retail rate from an env var for real billing; the default here is what the
 * UI uses for its (advisory) pre-flight checks.
 */

/** 1,000,000 micros = $1. */
export const MICROS_PER_USD = 1_000_000;

/**
 * Retail rate: how many USD micros one minute of service costs. Derived from
 * the entry bundle ($19 buys ~60 min => 19,000,000 / 60). Default value; the
 * server may override it via the RETAIL_MICROS_PER_MINUTE env var.
 */
export const RETAIL_MICROS_PER_MINUTE = 83_333;

/** USD micros to charge for a number of billable seconds, at the retail rate. */
export function chargeMicrosForSeconds(
  seconds: number,
  ratePerMinute: number = RETAIL_MICROS_PER_MINUTE
): number {
  return Math.round((seconds * ratePerMinute) / 60);
}

/** Format USD micros as a "$X.XX" string (e.g. 19_000_000 -> "$19.00"). */
export function formatUsd(micros: number): string {
  return (micros / MICROS_PER_USD).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
