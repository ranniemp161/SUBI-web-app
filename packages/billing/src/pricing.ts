/**
 * Rates, metering, and the conversions between them — the pure half of billing,
 * and the ecosystem's only definition of what a minute of service costs.
 *
 * Nothing here imports anything, so this module is safe to pull into a client
 * component. **Import it by its own subpath** (`@repo/billing/pricing`), never
 * through the `@repo/billing` barrel: the barrel also re-exports `./ledger`,
 * which reaches the database, and bundling that into the browser is both a
 * mistake and a build error (see the `server-only` guard there).
 *
 * Money is integer USD micros everywhere (1,000,000 = $1); it becomes a
 * human "$X.XX" string only at the display edge, via `formatUsd`, and is never
 * rounded in storage or math.
 */

/** 1,000,000 micros = $1. */
export const MICROS_PER_USD = 1_000_000;

/**
 * Retail rate default: how many USD micros one minute of service costs.
 * Derived from the entry bundle ($19 buys ~60 min => 19,000,000 / 60).
 */
export const DEFAULT_RETAIL_MICROS_PER_MINUTE = 83_333;

/**
 * Retail rate in force, from the RETAIL_MICROS_PER_MINUTE env var (so the
 * client can retune pricing without a redeploy), falling back to the default
 * above. Prices are config, not code.
 *
 * On the server this is the real rate. In the browser the env var is not
 * exposed (it carries no NEXT_PUBLIC_ prefix, deliberately — a retail rate is
 * not a client secret but it is not client business either), so this resolves
 * to the default. That is why every client-side use of it is advisory: a
 * pre-flight "you probably can't afford this" hint, never the charge. The
 * charge is always computed server-side, in `./ledger`.
 */
export const RETAIL_MICROS_PER_MINUTE =
  Number(process.env.RETAIL_MICROS_PER_MINUTE) ||
  DEFAULT_RETAIL_MICROS_PER_MINUTE;

/**
 * USD micros to charge for a number of billable seconds, at the retail rate.
 * `ratePerMinute` is overridable so a caller can price against a rate other
 * than the one in force (bundle math, "what would this cost at $X" previews).
 */
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

/**
 * Resolve a flat, per-action price from an env var, falling back to a default.
 *
 * The primitive every rate above this line is missing: they all price per
 * *second*, because everything charged until now has been video duration. A
 * b-roll character set is priced per image call and a plan re-run per call, so
 * neither has a seconds slot to plug into.
 *
 * Deliberately stricter than `RETAIL_MICROS_PER_MINUTE`'s `Number(x) || default`:
 *
 * - An empty or whitespace env var falls back, rather than parsing to `0`.
 *   `Number("")` is `0`, so the loose form would silently make an action free.
 * - A configured `0` is honoured, because "free for now" is a real thing a
 *   client may want to switch on. That is exactly why the `||` idiom is wrong
 *   here — it cannot tell a deliberate zero from an absent value.
 * - A negative or non-integer value falls back rather than throwing. A bad env
 *   var must not take the app down, and money is integer micros everywhere.
 */
export function flatRateMicros(
  configured: string | undefined,
  fallback: number
): number {
  if (configured == null || configured.trim() === "") return fallback;
  const n = Number(configured);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * B-Roll retail prices — flat per action, not per second.
 *
 * $2.00 a character emotion set and $0.25 a scene-plan re-run, decided
 * 2026-08-09 and **tentative pending client review**. Env-overridable for
 * exactly that reason: a reprice is a Vercel env change and a redeploy, never a
 * code change (the repo's standing rule that prices are config, not code).
 *
 * $2.00 is ~2.4x our cost at the `gemini-3-pro-image` tier Phase 0 actually
 * measured, and ~4.9x if the `gemini-3.1-flash-image` A/B wins later — chosen so
 * the number is healthy either way and the tier question does not gate Phase 2.
 * The working is in `docs/specs/broll/0001-high-level-design/index.md` §8.1.
 *
 * Same client-side caveat as `RETAIL_MICROS_PER_MINUTE`: neither var carries a
 * `NEXT_PUBLIC_` prefix, so a browser always resolves the default. Showing
 * "Generate — $2.00" from these is fine; the charge is always computed in
 * `./ledger` on the server.
 */
export const DEFAULT_BROLL_CHARACTER_SET_MICROS = 2_000_000;
export const DEFAULT_BROLL_PLAN_RERUN_MICROS = 250_000;

export const BROLL_CHARACTER_SET_MICROS = flatRateMicros(
  process.env.BROLL_CHARACTER_SET_MICROS,
  DEFAULT_BROLL_CHARACTER_SET_MICROS
);
export const BROLL_PLAN_RERUN_MICROS = flatRateMicros(
  process.env.BROLL_PLAN_RERUN_MICROS,
  DEFAULT_BROLL_PLAN_RERUN_MICROS
);

/**
 * Fallback real-world cost estimates for b-roll, in USD micros per action.
 *
 * Only a fallback: AC-16 wants `cost_micros` populated from the Gemini call's
 * **real reported usage**, which is not known until the call returns. These are
 * what the reserve row carries until `settleBrollHold` trues it up, and what a
 * caller with no usage metadata in hand falls back to.
 *
 * The character-set figure is six images at the Pro tier's $0.134 plus roughly
 * $0.03 of multi-turn image input. The plan figure is a rough placeholder for
 * one text call over a transcript — it has never been measured, and unlike the
 * character set it was never sized against a published per-call rate. Replace
 * it with real usage data as soon as Phase 3 produces any.
 */
export const BROLL_CHARACTER_SET_COST_MICROS = 840_000;
export const BROLL_PLAN_RERUN_COST_MICROS = 2_000;

/**
 * How long a b-roll generation claim may sit before it is treated as abandoned.
 *
 * **Ten minutes, not `STALE_HOLD_MS`.** That constant is 10 seconds, sized for
 * the in-memory gap between reserving a transcription and marking it
 * processing. A character set is a ~110 s run of external image calls (measured
 * in Phase 0), so reclaiming at 10 s would steal the hold out from under a
 * generation that is still going and charge the user twice. Ten minutes is
 * roughly five times the measured run.
 */
export const BROLL_STALE_HOLD_MS = 600_000;

/**
 * Estimated real-world cost, in USD micros per second (1,000,000 = $1), used
 * to populate credit_ledger.cost_micros for margin visibility — this is our
 * cost, not the retail price the user is charged (that is delta_micros).
 *
 * TRANSCRIPTION is Deepgram-only: the AI pass no longer runs automatically
 * at transcription time (it's strictly opt-in from the studio, charged via
 * AI_CUT), so its cost lives entirely on the ai_cut ledger rows. The two
 * values are the split of the original blended $0.083/min estimate — refine
 * both once real `cost_micros` data accumulates.
 */
export const TRANSCRIPTION_COST_MICROS_PER_SECOND = 166;
export const AI_CUT_COST_MICROS_PER_SECOND = 1217;

/** Seconds held when the project has no client-reported duration. */
export const FALLBACK_HOLD_SECONDS = 60;

/**
 * How long a hold must sit untouched — and not "processing" — before it's
 * treated as abandoned by a crashed request, rather than one genuinely still
 * mid-flight between reserving and flipping status to "processing". That
 * window is pure in-memory work (URL/token building, no I/O), so it's over in
 * low single-digit milliseconds; this is deliberately generous to survive any
 * GC pause or cold-start jitter while still recovering promptly from a real
 * crash. See `reclaimStaleHold`.
 */
export const STALE_HOLD_MS = 10_000;

/** Seconds to reserve for a job, from the client-reported duration. */
export function costSecondsForDurationMs(
  durationMs: number | null | undefined
): number {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return FALLBACK_HOLD_SECONDS;
  }
  return Math.max(1, Math.ceil(durationMs / 1000));
}

/**
 * Billable seconds from Deepgram's authoritative `metadata.duration`, or null
 * when the payload doesn't carry one (null tells settleHold to keep the hold
 * as the final charge — a job that ran is never spuriously refunded).
 */
export function secondsFromDeepgramDuration(
  duration: number | null | undefined
): number | null {
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(1, Math.ceil(duration));
}

/** UTC calendar-month key for grant rows, e.g. "2026-07". */
export function currentMonthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** Monthly member grant in seconds, from MEMBER_MONTHLY_GRANT_SECONDS, default 3600. */
export function memberGrantSeconds(): number {
  const n = Number(process.env.MEMBER_MONTHLY_GRANT_SECONDS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3600;
}

/**
 * Monthly member grant in USD micros. The grant is still expressed in seconds
 * (a placeholder until the client settles the money-era grant — see ADR 0002
 * Follow-up); this converts it to micros so it deposits like any other credit.
 */
export function memberGrantMicros(): number {
  return chargeMicrosForSeconds(memberGrantSeconds());
}
