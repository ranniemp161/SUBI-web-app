"use client";

import { useState } from "react";
import { MICROS_PER_USD } from "@repo/ui";

interface Bundle {
  priceId: string;
  name: string;
  amount: number;
  currency: string;
  creditMicros: number;
}

interface BundleCardsProps {
  bundles: Bundle[];
}

function redirectTo(url: string) {
  window.location.href = url;
}

export function BundleCards({ bundles }: BundleCardsProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  
  // Default to the second bundle (usually the popular $25 one) if available, else the first.
  const defaultSelected = bundles.length > 1 ? bundles[1].priceId : bundles[0]?.priceId;
  const [selectedPriceId, setSelectedPriceId] = useState<string | undefined>(defaultSelected);

  async function handleCheckout(priceId: string) {
    setLoadingId(priceId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      const data = await res.json();
      if (data.url) {
        redirectTo(data.url);
      } else {
        alert(data.error || "Failed to start checkout");
        setLoadingId(null);
      }
    } catch {
      alert("Failed to start checkout");
      setLoadingId(null);
    }
  }

  const selectedBundle = bundles.find((b) => b.priceId === selectedPriceId) || bundles[0];
  const selectedPayDollars = selectedBundle ? selectedBundle.amount / 100 : 0;

  return (
    <section 
      id="add-funds" 
      aria-label="Add funds"
      className="wallet-fade-in flex flex-col p-6 rounded-2xl"
      style={{ background: "var(--wallet-surface)", border: "1px solid var(--wallet-border)" }}
    >
      <h2
        className="text-lg font-bold"
        style={{ color: "var(--wallet-text-primary)" }}
      >
        Add funds
      </h2>
      <p className="text-xs mt-1 mb-5" style={{ color: "var(--wallet-text-secondary)" }}>
        $1 &approx; 12 minutes of transcription + AI cut.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {bundles.map((bundle, index) => {
          const payDollars = bundle.amount / 100;
          const getCreditDollars = bundle.creditMicros / MICROS_PER_USD;
          // Approximate minutes (12 min per dollar)
          const approxMins = Math.round(getCreditDollars * 12);
          
          const isPopular = index === 1;
          const isSelected = selectedPriceId === bundle.priceId;

          return (
            <button
              key={bundle.priceId}
              onClick={() => setSelectedPriceId(bundle.priceId)}
              className={`relative flex flex-col rounded-xl py-4 items-center text-center transition-all duration-200 ${
                isSelected ? "border-[1.5px]" : "border-[1.5px] border-transparent hover:bg-white/5"
              }`}
              style={{
                background: isSelected ? "rgba(255, 252, 0, 0.05)" : "var(--wallet-surface-sunken)",
                borderColor: isSelected ? "#fffc00" : "transparent",
              }}
            >
              {isPopular && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">
                  <span className="rounded-[4px] px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-black whitespace-nowrap bg-[#fffc00]">
                    POPULAR
                  </span>
                </div>
              )}

              <p className={`text-2xl font-bold tabular-nums tracking-tighter ${isSelected ? "text-[#fffc00]" : "text-[var(--wallet-text-primary)]"}`}>
                ${payDollars}
              </p>

              <p className="mt-1 text-[10px] font-medium" style={{ color: "var(--wallet-text-tertiary)" }}>
                &approx; {approxMins} min
              </p>
            </button>
          );
        })}
      </div>

      <button
        onClick={() => {
          if (selectedPriceId) handleCheckout(selectedPriceId);
        }}
        disabled={loadingId !== null || !selectedPriceId}
        className={`w-full rounded-full py-3 text-[14px] font-bold transition-all duration-200 flex items-center justify-center ${
          loadingId !== null ? "opacity-50 cursor-not-allowed" : "active:scale-[0.98] hover:bg-[#fffc00]/90"
        }`}
        style={{ background: "#fffc00", color: "#000" }}
      >
        {loadingId !== null ? (
          <span className="inline-block w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
        ) : (
          `Add $${selectedPayDollars.toFixed(2)} to balance`
        )}
      </button>
      
      <p className="text-center mt-3 text-[10px]" style={{ color: "var(--wallet-text-tertiary)" }}>
        You pay ${selectedPayDollars.toFixed(2)} &mdash; the full amount becomes credit.
      </p>
    </section>
  );
}
