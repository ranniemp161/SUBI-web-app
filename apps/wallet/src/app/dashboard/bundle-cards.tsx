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
              className={`wallet-card wallet-fade-in relative flex flex-col p-6 ${
                isPopular ? "ring-2" : ""
              }`}
              style={{
                animationDelay: `${index * 80}ms`,
                ...(isPopular
                  ? { ringColor: "var(--wallet-accent)" }
                  : {}),
              }}
            >
              {isPopular && (
                <span
                  className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                  style={{
                    background: "var(--wallet-accent)",
                    color: "#fff",
                  }}
                >
                  Most popular
                </span>
              )}

              {/* What you pay */}
              <p
                className="text-3xl font-bold tabular-nums"
                style={{ color: "var(--wallet-text-primary)" }}
              >
                {payDollars.toLocaleString("en-US", {
                  style: "currency",
                  currency: bundle.currency.toUpperCase(),
                })}
              </p>

              {/* What you get */}
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--wallet-text-secondary)" }}
              >
                Get{" "}
                <span className="font-semibold" style={{ color: "var(--wallet-text-primary)" }}>
                  {formatUsd(bundle.creditMicros)}
                </span>{" "}
                balance
              </p>

              {/* Bonus badge */}
              {hasBonus && (
                <span
                  className="mt-3 inline-flex self-start items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={{
                    background: "var(--wallet-success-subtle)",
                    color: "var(--wallet-success)",
                  }}
                >
                  +{formatUsd(bonus * MICROS_PER_USD)} bonus
                </span>
              )}

              {/* CTA */}
              <button
                onClick={() => handleCheckout(bundle.priceId)}
                disabled={isLoading}
                className={`mt-auto pt-5 w-full rounded-lg py-2.5 text-sm font-semibold transition-all duration-200 ${
                  isLoading ? "opacity-50 cursor-not-allowed" : "hover:opacity-90 active:scale-[0.98]"
                }`}
                style={{
                  background: isPopular
                    ? "var(--wallet-accent)"
                    : "var(--wallet-surface-sunken)",
                  color: isPopular ? "#fff" : "var(--wallet-text-primary)",
                  border: isPopular
                    ? "none"
                    : "1px solid var(--wallet-border)",
                }}
              >
                {isLoading ? "Redirecting…" : "Buy now"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
