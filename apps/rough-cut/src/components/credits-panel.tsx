"use client";

import { useState, useEffect } from "react";
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
 * button that redirects to the Wallet app. Self-fetches and listens for
 * "refresh-credits" window events to update after checkout.
 */
export default function CreditsPanel() {
  const [credits, setCredits] = useState<CreditsInfo | null>(null);

  useEffect(() => {
    async function fetchCredits() {
      try {
        const response = await fetch("/api/credits");
        if (!response.ok) return;
        if (!response.headers.get("content-type")?.includes("application/json")) return;
        const data = await response.json();
        setCredits(data);
      } catch (error) {
        console.error("Failed to fetch credits:", error);
      }
    }

    fetchCredits();

    const onRefresh = () => fetchCredits();
    window.addEventListener("refresh-credits", onRefresh);
    return () => window.removeEventListener("refresh-credits", onRefresh);
  }, []);

  const low = credits != null && credits.balanceMicros < LOW_BALANCE_MICROS;
  const walletUrl = WALLET_DASHBOARD_URL;

  return (
    <div className="relative flex items-center gap-2">
      <span
        title="Wallet balance remaining"
        className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold tabular-nums border backdrop-blur-md transition-all duration-300 ${
          low
            ? "bg-amber-500/10 text-amber-300 border-amber-500/30 animate-glow-amber"
            : "bg-[#3a3a3a] text-zinc-300 border-white/5 shadow-inner"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${low ? "bg-amber-400" : "bg-[#fffc00]"}`} />
        <span>
          {credits == null ? "—" : formatUsd(credits.balanceMicros)}
        </span>
      </span>

      <a
        href={walletUrl}
        className="inline-flex items-center justify-center rounded-full bg-[#fffc00] px-4 py-1.5 text-xs font-bold text-black shadow-lg shadow-[#fffc00]/10 hover:bg-[#e6e300] hover:shadow-[#fffc00]/20 transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer no-underline"
      >
        Add funds
      </a>
    </div>
  );
}
