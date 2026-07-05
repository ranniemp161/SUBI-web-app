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
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium tabular-nums ring-1 ring-inset ${
          low
            ? "bg-amber-500/10 text-amber-200 ring-amber-400/25"
            : "bg-foreground/[0.04] text-foreground/60 ring-foreground/10"
        }`}
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        {credits == null ? "—" : formatDuration(credits.creditSeconds * 1000)}
      </span>

      <button
        onClick={() => onBuyOpenChange(!buyOpen)}
        className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 px-3 py-1.5 text-xs font-medium text-blue-200 ring-1 ring-inset ring-blue-400/25 transition-colors hover:bg-blue-500/25"
      >
        Buy credits
      </button>

      {buyOpen && (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-foreground/10 bg-background p-2 shadow-2xl shadow-black/40">
          <p className="px-2 pb-2 pt-1 text-xs text-foreground/50">
            Credits are minutes of transcription — they never expire.
          </p>
          {bundles == null ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-foreground/[0.05]" />
              ))}
            </div>
          ) : bundles.length === 0 ? (
            <p className="p-3 text-sm text-foreground/50">
              No bundles are available right now.
            </p>
          ) : (
            <ul className="space-y-1">
              {bundles.map((bundle) => (
                <li key={bundle.priceId}>
                  <button
                    onClick={() => startCheckout(bundle)}
                    disabled={checkoutPriceId !== null}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-blue-500/10 disabled:opacity-50"
                  >
                    <span>
                      <span className="block text-sm font-medium text-foreground">
                        {Math.round(bundle.creditSeconds / 60)} minutes
                      </span>
                      <span className="block text-xs text-foreground/40">{bundle.name}</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-blue-200">
                      {checkoutPriceId === bundle.priceId
                        ? "…"
                        : formatPrice(bundle.amount, bundle.currency)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
