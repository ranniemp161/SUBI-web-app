"use client";

import { WALLET_DASHBOARD_URL } from "@/lib/env";
import { formatUsd, chargeMicrosForSeconds } from "@repo/ui";

export interface CreditsInfo {
  balanceMicros: number;
  isMember: boolean;
}

/** Balance below which the chip turns amber to nudge a top-up (~5 min of credit). */
const LOW_BALANCE_MICROS = chargeMicrosForSeconds(5 * 60);

/**
 * Dashboard header widget: the credit balance chip plus a "Buy credits"
 * button that redirects to the Wallet app.
 */
export default function CreditsPanel({
  credits,
}: {
  credits: CreditsInfo | null;
}) {
  const low = credits != null && credits.balanceMicros < LOW_BALANCE_MICROS;
  const walletUrl = WALLET_DASHBOARD_URL;

  return (
    <div className="relative flex items-center gap-2">
      <span
        title="Wallet balance remaining"
        className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold tabular-nums border backdrop-blur-md transition-all duration-300 ${
          low
            ? "bg-amber-500/10 text-amber-300 border-amber-500/30 animate-glow-amber"
            : "bg-blue-500/5 text-blue-200 border-blue-500/25 animate-glow-blue"
        }`}
      >
        <svg className={`h-3.5 w-3.5 ${low ? "text-amber-400" : "text-blue-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>
          {credits == null ? "—" : formatUsd(credits.balanceMicros)}
        </span>
      </span>

      <a
        href={walletUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/25 hover:shadow-indigo-500/35 border border-white/10 transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer no-underline"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        Add funds
      </a>
    </div>
  );
}
