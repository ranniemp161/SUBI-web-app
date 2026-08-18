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
  DEFAULT_BROLL_CHARACTER_SET_MICROS,
  DEFAULT_BROLL_PLAN_RERUN_MICROS,
  DEFAULT_BROLL_OBJECT_IMAGE_MICROS,
  BROLL_CHARACTER_SET_MICROS,
  BROLL_PLAN_RERUN_MICROS,
  BROLL_OBJECT_IMAGE_MICROS,
  BROLL_CHARACTER_SET_COST_MICROS,
  BROLL_PLAN_RERUN_COST_MICROS,
  BROLL_OBJECT_IMAGE_COST_MICROS,
  BROLL_STALE_HOLD_MS,
  flatRateMicros,
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
  reserveBrollHold,
  settleBrollHold,
  settleBrollHoldQuietly,
  reclaimStaleBrollHold,
  chargeBrollPlanRerun,
  refundBrollPlanRerun,
  chargeBrollObjectImage,
  refundBrollObjectImage,
  type ReserveResult,
  type AiCutChargeResult,
  type BrollReserveResult,
  type BrollSettleOutcome,
  type BrollPlanChargeResult,
  type BrollObjectChargeResult,
} from "./ledger";
