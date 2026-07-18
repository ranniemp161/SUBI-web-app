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
      className="wallet-card wallet-fade-in relative overflow-hidden px-8 py-10 flex flex-col md:flex-row md:items-center justify-between gap-6 text-left"
      aria-label="Account balance"
    >
      {/* Shimmer background accent */}
      <div className="wallet-shimmer absolute inset-0 pointer-events-none opacity-50" />

      <div className="relative">
        <p
          className="text-[11px] font-bold tracking-widest uppercase mb-1"
          style={{ color: "var(--wallet-text-secondary)" }}
        >
          Available balance
        </p>

        <div className="flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-4">
          <p
            className="text-6xl font-bold tracking-tight tabular-nums"
            style={{ color: "var(--wallet-text-primary)" }}
          >
            {formatUsd(balanceMicros)}
          </p>

          <p
            className="text-[13px] font-medium"
            style={{ color: "var(--wallet-text-tertiary)" }}
          >
            ≈ {estimatedMinutes.toLocaleString()}{" "}
            {estimatedMinutes === 1 ? "minute" : "minutes"} of transcription
          </p>
        </div>
      </div>

      <div className="relative flex flex-col sm:flex-row items-center gap-4">
        {/* Auto-recharge status chip */}
        <div>
          {autorechargeEnabled && autorechargeThresholdMicros != null ? (
            <span
              className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-medium border"
              style={{
                background: "var(--wallet-surface-raised)",
                borderColor: "var(--wallet-border)",
                color: "var(--wallet-text-secondary)",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#fffc00" }} />
              Auto-recharge on below {formatUsd(autorechargeThresholdMicros)}
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-medium border"
              style={{
                background: "var(--wallet-surface-sunken)",
                borderColor: "var(--wallet-border-subtle)",
                color: "var(--wallet-text-tertiary)",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-gray-600" />
              Auto-recharge off
            </span>
          )}
        </div>
        
        <button
          onClick={() => document.getElementById("add-funds")?.scrollIntoView({ behavior: "smooth" })}
          className="rounded-full px-6 py-2.5 text-sm font-bold text-black transition-transform hover:scale-105 active:scale-95 shadow-sm"
          style={{ background: "#fffc00" }}
        >
          Add funds
        </button>
      </div>
    </section>
  );
}
