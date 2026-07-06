"use client";

import { useState } from "react";

type Bundle = {
  priceId: string;
  tokens: number;
  amount: number;
  currency: string;
  name?: string;
};

export function CheckoutButton({ bundle }: { bundle: Bundle }) {
  const [loading, setLoading] = useState(false);

  async function handleCheckout() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ priceId: bundle.priceId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Failed to start checkout");
        setLoading(false);
      }
    } catch {
      alert("Failed to start checkout");
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleCheckout}
      disabled={loading}
      className={`w-full flex items-center justify-between p-3 rounded-lg border dark:border-zinc-700 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span className="font-medium">{bundle.tokens} Tokens</span>
      <span className="text-zinc-600 dark:text-zinc-300 font-semibold">
        {loading ? "Loading..." : (bundle.amount / 100).toLocaleString("en-US", {
          style: "currency",
          currency: bundle.currency.toUpperCase(),
        })}
      </span>
    </button>
  );
}
