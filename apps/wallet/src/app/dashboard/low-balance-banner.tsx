"use client";

import { formatUsd, RETAIL_MICROS_PER_MINUTE, chargeMicrosForSeconds } from "@repo/ui";

interface LowBalanceBannerProps {
  balanceMicros: number;
  autorechargeEnabled: boolean;
  autorechargeThresholdMicros: number | null;
}

/** Balance below which the banner shows (~5 min of transcription). */
const LOW_THRESHOLD_MICROS = chargeMicrosForSeconds(5 * 60);

/**
 * A calm inline banner that appears when the balance is running low. Shows
 * when auto-recharge is off and balance is below ~5 min, or when auto-recharge
 * is on but the balance has dipped below the user's threshold.
 */
export function LowBalanceBanner({
  balanceMicros,
  autorechargeEnabled,
  autorechargeThresholdMicros,
}: LowBalanceBannerProps) {
  const isLow =
    (!autorechargeEnabled && balanceMicros < LOW_THRESHOLD_MICROS) ||
    (autorechargeEnabled &&
      autorechargeThresholdMicros != null &&
      balanceMicros < autorechargeThresholdMicros);

  if (!isLow) return null;

  const estimatedMinutes = Math.max(
    0,
    Math.floor(balanceMicros / RETAIL_MICROS_PER_MINUTE)
  );

  return (
    <div
      className="wallet-fade-in flex items-start gap-3 rounded-xl px-5 py-4"
      role="alert"
      style={{
        background: "var(--wallet-warning-subtle)",
        border: "1px solid var(--wallet-warning)",
        borderColor: "color-mix(in srgb, var(--wallet-warning) 30%, transparent)",
      }}
    >
      <svg
        className="mt-0.5 h-5 w-5 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={{ color: "var(--wallet-warning)" }}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
        />
      </svg>

      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium"
          style={{ color: "var(--wallet-text-primary)" }}
        >
          Your balance is low
        </p>
        <p
          className="mt-0.5 text-sm"
          style={{ color: "var(--wallet-text-secondary)" }}
        >
          {formatUsd(balanceMicros)} remaining (about {estimatedMinutes}{" "}
          {estimatedMinutes === 1 ? "minute" : "minutes"}).{" "}
          {!autorechargeEnabled
            ? "Add funds or turn on auto-recharge to keep going."
            : "Auto-recharge will top up your balance shortly."}
        </p>
      </div>

      {!autorechargeEnabled && (
        <div className="flex shrink-0 gap-2">
          <a
            href="#add-funds"
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{
              background: "var(--wallet-accent)",
              color: "#fff",
            }}
          >
            Add funds
          </a>
          <a
            href="#auto-recharge"
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{
              background: "var(--wallet-surface)",
              color: "var(--wallet-text-primary)",
              border: "1px solid var(--wallet-border)",
            }}
          >
            Auto-recharge
          </a>
        </div>
      )}
    </div>
  );
}
