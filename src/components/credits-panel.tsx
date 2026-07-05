"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatDuration } from "@/lib/utils";

export interface CreditsInfo {
  creditSeconds: number;
  isMember: boolean;
}

interface Bundle {
  priceId: string;
  name: string;
  /** Smallest currency unit (cents). */
  amount: number;
  currency: string;
  creditSeconds: number;
}

/** Balance below which the chip turns amber to nudge a top-up. */
const LOW_BALANCE_SECONDS = 5 * 60;

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

/**
 * Dashboard header widget: the credit balance chip plus a "Buy credits"
 * popover listing the Stripe bundles. Selecting a bundle redirects to
 * Stripe's hosted Checkout; the webhook credits the purchase and the
 * dashboard re-fetches the balance on return.
 *
 * The parent owns the open state so other UI (e.g. an "out of credits"
 * toast action) can pop the buy panel open too.
 */
export default function CreditsPanel({
  credits,
  buyOpen,
  onBuyOpenChange,
}: {
  credits: CreditsInfo | null;
  buyOpen: boolean;
  onBuyOpenChange: (open: boolean) => void;
}) {
  const [bundles, setBundles] = useState<Bundle[] | null>(null);
  const [checkoutPriceId, setCheckoutPriceId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Guards the lazy fetch without effect-body state writes (loading UI is
  // derived from `bundles == null` while the popover is open).
  const bundlesRequestedRef = useRef(false);

  // Bundles are fetched lazily on first open — most visits never buy.
  useEffect(() => {
    if (!buyOpen || bundlesRequestedRef.current) return;
    bundlesRequestedRef.current = true;
    fetch("/api/billing/bundles")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((data: Bundle[]) => setBundles(data))
      .catch(() => {
        // Allow a later open to retry.
        bundlesRequestedRef.current = false;
        toast.error("Couldn't load credit bundles", {
          description: "Please try again in a moment.",
        });
        onBuyOpenChange(false);
      });
  }, [buyOpen, onBuyOpenChange]);

  // Click-away closes the popover.
  useEffect(() => {
    if (!buyOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onBuyOpenChange(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [buyOpen, onBuyOpenChange]);

  async function startCheckout(bundle: Bundle) {
    setCheckoutPriceId(bundle.priceId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId: bundle.priceId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      window.location.assign(data.url);
    } catch (error) {
      setCheckoutPriceId(null);
      toast.error("Couldn't start checkout", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const low = credits != null && credits.creditSeconds < LOW_BALANCE_SECONDS;

  return (
    <div ref={panelRef} className="relative flex items-center gap-2">
      <span
        title="Transcription credits remaining"
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
          {credits == null ? "—" : formatDuration(credits.creditSeconds * 1000)}
        </span>
      </span>

      <button
        onClick={() => onBuyOpenChange(!buyOpen)}
        className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/25 hover:shadow-indigo-500/35 border border-white/10 transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        Buy credits
      </button>

      {buyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            onClick={() => onBuyOpenChange(false)}
            className="fixed inset-0 bg-black/75 backdrop-blur-md transition-opacity duration-300" 
          />

          {/* Modal Content */}
          <div className="relative w-full max-w-2xl transform overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c0e]/95 p-6 shadow-2xl transition-all duration-300 sm:p-8">
            {/* Header */}
            <div className="flex items-start justify-between pb-6 border-b border-white/5">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <svg className="h-5 w-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Get Transcription Credits
                </h3>
                <p className="mt-1.5 text-sm text-zinc-400">
                  Credits represent minutes of high-accuracy transcription. They never expire and rollover automatically.
                </p>
              </div>
              <button
                onClick={() => onBuyOpenChange(false)}
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {bundles == null ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 py-6">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-48 animate-shimmer rounded-xl border border-white/5 bg-white/[0.01]" />
                ))}
              </div>
            ) : bundles.length === 0 ? (
              <p className="p-8 text-center text-sm text-zinc-500">
                No bundles are available right now. Please try again later.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 py-6">
                {bundles.map((bundle) => {
                  const minutes = Math.round(bundle.creditSeconds / 60);
                  const isPopular = bundle.name.toLowerCase().includes("standard");
                  
                  return (
                    <div
                      key={bundle.priceId}
                      className={`relative flex flex-col justify-between overflow-hidden rounded-xl border p-5 transition-all duration-300 hover:-translate-y-1 ${
                        isPopular
                          ? "border-blue-500/40 bg-gradient-to-b from-blue-500/10 to-transparent shadow-lg shadow-blue-500/5"
                          : "border-white/5 bg-white/[0.02] hover:border-white/10"
                      }`}
                    >
                      {isPopular && (
                        <span className="absolute right-3 top-3 rounded-full bg-blue-500 px-2.5 py-0.5 text-[9px] font-bold tracking-wide text-white uppercase shadow-sm">
                          Best Value
                        </span>
                      )}
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          {bundle.name}
                        </span>
                        <div className="mt-2 flex items-baseline">
                          <span className="text-3xl font-extrabold text-white tracking-tight">
                            {formatPrice(bundle.amount, bundle.currency)}
                          </span>
                        </div>
                        <div className="mt-4 space-y-2">
                          <div className="flex items-center gap-2 text-sm text-zinc-200">
                            <svg className="h-4 w-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="font-semibold">{minutes} Minutes</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-zinc-400">
                            <svg className="h-3.5 w-3.5 text-zinc-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>${(bundle.amount / 100 / (bundle.creditSeconds / 3600)).toFixed(2)}/hr transcribing</span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => startCheckout(bundle)}
                        disabled={checkoutPriceId !== null}
                        className={`mt-6 inline-flex w-full items-center justify-center rounded-lg py-2.5 text-xs font-semibold transition-all duration-200 cursor-pointer ${
                          checkoutPriceId === bundle.priceId
                            ? "bg-zinc-800 text-zinc-400 cursor-not-allowed"
                            : isPopular
                            ? "bg-blue-600 text-white hover:bg-blue-500 shadow-md shadow-blue-600/25 active:scale-95"
                            : "bg-white/10 text-white hover:bg-white/15 active:scale-95"
                        }`}
                      >
                        {checkoutPriceId === bundle.priceId ? (
                          <div className="flex items-center gap-2">
                            <svg className="animate-spin h-3 w-3 text-zinc-400" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Starting checkout...
                          </div>
                        ) : (
                          "Buy Now"
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            
            <div className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-white/[0.01] border border-white/5 px-4 py-3 text-xs text-zinc-500">
              <svg className="h-4 w-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Secure checkouts powered by Stripe. Unused credits are fully refundable.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
