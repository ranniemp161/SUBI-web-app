"use client";

import { formatUsd, RETAIL_MICROS_PER_MINUTE } from "@repo/ui";

interface BalanceHeroProps {
  balanceMicros: number;
  autorechargeEnabled: boolean;
  autorechargeThresholdMicros: number | null;
}

/**
 * The focal element of the wallet billing page: a large dollar balance, an
 * estimate of remaining transcription minutes, and a chip showing whether
 * auto-recharge is on (and at what threshold) or off.
 */
export function BalanceHero({
  balanceMicros,
  autorechargeEnabled,
  autorechargeThresholdMicros,
}: BalanceHeroProps) {
  const estimatedMinutes = Math.floor(balanceMicros / RETAIL_MICROS_PER_MINUTE);

  return (
    <section
      className="wallet-card wallet-fade-in relative overflow-hidden px-8 py-10 text-center"
      aria-label="Account balance"
    >
      {/* Shimmer background accent */}
      <div className="wallet-shimmer absolute inset-0 pointer-events-none opacity-50" />

      <div className="relative">
        <p
          className="text-sm font-medium tracking-wide uppercase"
          style={{ color: "var(--wallet-text-secondary)" }}
        >
          Available balance
        </p>

        <p
          className="mt-3 text-6xl font-extrabold tracking-tight tabular-nums"
          style={{ color: "var(--wallet-text-primary)" }}
        >
          {formatUsd(balanceMicros)}
        </p>

        <p
          className="mt-3 text-sm"
          style={{ color: "var(--wallet-text-tertiary)" }}
        >
          About {estimatedMinutes.toLocaleString()}{" "}
          {estimatedMinutes === 1 ? "minute" : "minutes"} of transcription
        </p>

        {/* Auto-recharge status chip */}
        <div className="mt-5 flex justify-center">
          {autorechargeEnabled && autorechargeThresholdMicros != null ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
              style={{
                background: "var(--wallet-success-subtle)",
                color: "var(--wallet-success)",
              }}
            >
              <svg
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Auto-recharge on below {formatUsd(autorechargeThresholdMicros)}
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
              style={{
                background: "var(--wallet-surface-sunken)",
                color: "var(--wallet-text-tertiary)",
              }}
            >
              Auto-recharge off
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
