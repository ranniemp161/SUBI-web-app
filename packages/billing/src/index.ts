/**
 * @repo/billing — the single implementation of the money invariant.
 *
 * `./pricing` is pure (rates, metering, conversions) and safe to import
 * anywhere. `./ledger` runs the statements that move money and needs a
 * database, so it is server-only. This barrel re-exports both for the common
 * server-side case; import `@repo/billing/pricing` directly from anywhere a
 * database client must not be pulled in.
 */

export {
  DEFAULT_RETAIL_MICROS_PER_MINUTE,
  RETAIL_MICROS_PER_MINUTE,
  TRANSCRIPTION_COST_MICROS_PER_SECOND,
  AI_CUT_COST_MICROS_PER_SECOND,
  FALLBACK_HOLD_SECONDS,
  STALE_HOLD_MS,
  chargeMicrosForSeconds,
  costSecondsForDurationMs,
  secondsFromDeepgramDuration,
  currentMonthKey,
  memberGrantSeconds,
  memberGrantMicros,
} from "./pricing";

export {
  reserveCredits,
  reclaimStaleHold,
  settleHold,
  settleHoldQuietly,
  depositPurchase,
  chargeAiCut,
  refundAiCut,
  ensureMonthlyGrant,
  type ReserveResult,
  type AiCutChargeResult,
} from "./ledger";
