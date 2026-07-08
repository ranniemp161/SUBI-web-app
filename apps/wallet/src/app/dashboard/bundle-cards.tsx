"use client";

import { useState } from "react";
import { formatUsd, MICROS_PER_USD } from "@repo/ui";

interface Bundle {
  priceId: string;
  name: string;
  /** Stripe minor unit (cents) — what the user pays. */
  amount: number;
  currency: string;
  /** USD micros credited to the balance. */
  creditMicros: number;
}

interface BundleCardsProps {
  bundles: Bundle[];
}

/**
 * The add-funds section: bundle cards showing what you pay, what balance you
 * get, and the bonus on larger tiers. Each card triggers the Stripe Checkout
 * flow through the existing `/api/billing/checkout` endpoint.
 */
export function BundleCards({ bundles }: BundleCardsProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

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
        window.location.href = data.url;
      } else {
        alert(data.error || "Failed to start checkout");
        setLoadingId(null);
      }
    } catch {
      alert("Failed to start checkout");
      setLoadingId(null);
    }
  }

  return (
    <section id="add-funds" aria-label="Add funds">
      <h2
        className="text-lg font-semibold mb-4"
        style={{ color: "var(--wallet-text-primary)" }}
      >
        Add funds
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {bundles.map((bundle, index) => {
          const payDollars = bundle.amount / 100;
          const getCreditDollars = bundle.creditMicros / MICROS_PER_USD;
          const bonus = getCreditDollars - payDollars;
          const hasBonus = bonus >= 0.01;
          const isLoading = loadingId === bundle.priceId;
          const isPopular = index === 1;

          return (
            <div
              key={bundle.priceId}
              className={`wallet-fade-in group relative flex flex-col rounded-3xl transition-all duration-500 ease-out hover:-translate-y-1 hover:shadow-2xl ${
                isPopular ? "shadow-blue-500/20" : "shadow-black/5"
              }`}
              style={{ animationDelay: `${index * 80}ms` }}
            >
              {/* Premium Gradient Border Background for Popular Card */}
              {isPopular && (
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-blue-400 via-blue-600 to-purple-600 opacity-80 group-hover:opacity-100 transition-opacity duration-500" />
              )}
              {/* Standard Border Background for Others */}
              {!isPopular && (
                <div className="absolute inset-0 rounded-3xl bg-[var(--wallet-border)] group-hover:bg-[var(--wallet-accent)] transition-colors duration-500" />
              )}

              {/* Inner Card Content */}
              <div className="relative flex flex-col flex-1 m-[1px] p-7 rounded-[23px] bg-[var(--wallet-surface)] z-10 overflow-hidden">
                {/* Subtle top inner shadow/highlight */}
                <div className="absolute inset-0 pointer-events-none rounded-[23px] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]" />
                
                {/* Subtle background glow for popular */}
                {isPopular && (
                  <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />
                )}

                {isPopular && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 flex justify-center">
                    <span className="rounded-b-xl px-4 py-1.5 text-[10px] font-extrabold uppercase tracking-widest text-white shadow-md whitespace-nowrap"
                          style={{ background: "linear-gradient(135deg, var(--wallet-accent), #8b5cf6)" }}>
                      Most popular
                    </span>
                  </div>
                )}

                {/* What you pay */}
                <div className={`${isPopular ? 'mt-8' : 'mt-4'} flex flex-col`}>
                  <p className={`text-5xl font-extrabold tabular-nums tracking-tighter ${isPopular ? 'text-transparent bg-clip-text bg-gradient-to-br from-white to-gray-400' : 'text-[var(--wallet-text-primary)]'}`}>
                    {payDollars.toLocaleString("en-US", {
                      style: "currency",
                      currency: bundle.currency.toUpperCase(),
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    })}
                  </p>
                </div>

                {/* What you get */}
                <p className="mt-3 text-sm text-[var(--wallet-text-secondary)] font-medium">
                  Get{" "}
                  <span className="font-bold text-[var(--wallet-text-primary)]">
                    {formatUsd(bundle.creditMicros)}
                  </span>{" "}
                  balance
                </p>

                {/* Bonus badge */}
                <div className="mt-5 h-8">
                  {hasBonus && (
                    <span className="inline-flex self-start items-center rounded-lg px-3 py-1 text-xs font-bold tracking-wide"
                          style={{
                            background: isPopular ? "rgba(74, 222, 128, 0.15)" : "var(--wallet-success-subtle)",
                            color: "var(--wallet-success)",
                            border: isPopular ? "1px solid rgba(74, 222, 128, 0.2)" : "1px solid transparent"
                          }}>
                      +{formatUsd(bonus * MICROS_PER_USD)} bonus
                    </span>
                  )}
                </div>

                <div className="flex-1 min-h-[1.5rem]" />

                {/* CTA */}
                <button
                  onClick={() => handleCheckout(bundle.priceId)}
                  disabled={isLoading}
                  className={`mt-4 w-full rounded-2xl py-3.5 text-[15px] font-bold transition-all duration-300 flex items-center justify-center gap-2 ${
                    isLoading ? "opacity-50 cursor-not-allowed" : "active:scale-[0.98] hover:-translate-y-0.5"
                  } ${
                    isPopular 
                      ? "bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40" 
                      : "bg-white/5 hover:bg-white/10 text-[var(--wallet-text-primary)] border border-white/5 hover:border-white/10"
                  }`}
                >
                  {isLoading ? (
                    <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : null}
                  {isLoading ? "Redirecting…" : "Buy now"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
