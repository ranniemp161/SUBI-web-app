"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { MICROS_PER_USD } from "@repo/ui";
import type { SavedCard } from "@/lib/stripe";
import { AddCardForm } from "./add-card-form";

interface AutorechargePanelProps {
  enabled: boolean;
  thresholdMicros: number | null;
  amountMicros: number | null;
  hasCard: boolean;
  savedCard: SavedCard | null;
  failures: number;
}

/** Brand name display map for common card brands. */
const BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
  diners: "Diners",
  jcb: "JCB",
  unionpay: "UnionPay",
};

/**
 * Auto-recharge settings card. Mirrors the OpenAI pattern: an on/off switch,
 * threshold + amount inputs, the saved card, and an add/replace card action.
 * Controls are disabled when no card is saved. Wired to the PATCH
 * /api/billing/autorecharge and POST /api/billing/setup-intent endpoints.
 */
export function AutorechargePanel({
  enabled: initialEnabled,
  thresholdMicros: initialThreshold,
  amountMicros: initialAmount,
  hasCard,
  savedCard,
  failures,
}: AutorechargePanelProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [thresholdDollars, setThresholdDollars] = useState(
    initialThreshold != null ? String(initialThreshold / MICROS_PER_USD) : "5"
  );
  const [amountDollars, setAmountDollars] = useState(
    initialAmount != null ? String(initialAmount / MICROS_PER_USD) : "19"
  );
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const thresholdMicros = Math.round(
    (parseFloat(thresholdDollars) || 0) * MICROS_PER_USD
  );
  const amountMicros = Math.round(
    (parseFloat(amountDollars) || 0) * MICROS_PER_USD
  );

  const save = useCallback(
    async (nextEnabled: boolean) => {
      setSaving(true);
      setMessage(null);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const res = await fetch("/api/billing/autorecharge", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: nextEnabled,
            thresholdMicros,
            amountMicros,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        
        const data = await res.json();
        if (!res.ok) {
          setMessage({
            type: "error",
            text: data.error || "Failed to save settings.",
          });
          return;
        }
        setEnabled(nextEnabled);
        setMessage({
          type: "success",
          text: nextEnabled
            ? "Auto-recharge is on."
            : "Auto-recharge is off.",
        });
      } catch (err) {
        console.error("Save settings failed:", err);
        const errorText = err instanceof Error && err.name === 'AbortError'
          ? "Request timed out. Please try again."
          : "Something went wrong.";
        setMessage({ type: "error", text: errorText });
      } finally {
        setSaving(false);
      }
    },
    [thresholdMicros, amountMicros]
  );

  const handleAddCard = useCallback(async () => {
    setAddingCard(true);
    setMessage(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch("/api/billing/setup-intent", {
        method: "POST",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (!res.ok || !data.clientSecret) {
        setMessage({
          type: "error",
          text: data.error || "Failed to start card setup.",
        });
        return;
      }
      setSetupClientSecret(data.clientSecret);
    } catch (err) {
      console.error("Add card setup failed:", err);
      const errorText = err instanceof Error && err.name === 'AbortError'
        ? "Request timed out. Please try again."
        : "Failed to start card setup.";
      setMessage({ type: "error", text: errorText });
    } finally {
      setAddingCard(false);
    }
  }, []);

  const handleCardSaved = useCallback(() => {
    setSetupClientSecret(null);
    setMessage({ type: "success", text: "Card saved." });
    router.refresh();
  }, [router]);

  const handleCardCancelled = useCallback(() => {
    setSetupClientSecret(null);
  }, []);

  const brandLabel =
    savedCard?.brand != null
      ? BRAND_LABELS[savedCard.brand] ?? savedCard.brand
      : null;

  return (
    <section
      id="auto-recharge"
      className="wallet-card wallet-fade-in p-6"
      aria-label="Auto-recharge settings"
      style={{ animationDelay: "160ms" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--wallet-text-primary)" }}
          >
            Auto-recharge
          </h2>
          <p
            className="mt-0.5 text-sm"
            style={{ color: "var(--wallet-text-secondary)" }}
          >
            Automatically add funds when your balance gets low.
          </p>
        </div>

        {/* Toggle switch */}
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle auto-recharge"
          disabled={!hasCard || saving}
          onClick={() => save(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${
            !hasCard || saving ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
          }`}
          style={{
            background: enabled
              ? "var(--wallet-accent)"
              : "var(--wallet-border)",
          }}
        >
          <span
            className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
            style={{
              transform: enabled ? "translateX(1.375rem)" : "translateX(0.25rem)",
            }}
          />
        </button>
      </div>

      {/* Settings fields */}
      <div
        className={`mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4 transition-opacity duration-200 ${
          !hasCard ? "opacity-40 pointer-events-none" : ""
        }`}
      >
        <label className="flex h-full flex-col justify-end gap-1.5">
          <span
            className="text-xs font-medium"
            style={{ color: "var(--wallet-text-secondary)" }}
          >
            When balance falls below
          </span>
          <div className="relative">
            <span
              className="absolute left-3 top-1/2 -translate-y-1/2 text-sm"
              style={{ color: "var(--wallet-text-tertiary)" }}
            >
              $
            </span>
            <input
              type="number"
              min="1"
              step="1"
              value={thresholdDollars}
              onChange={(e) => setThresholdDollars(e.target.value)}
              disabled={saving}
              className="w-full rounded-lg py-2 pl-7 pr-3 text-sm tabular-nums"
              style={{
                background: "var(--wallet-surface-sunken)",
                color: "var(--wallet-text-primary)",
                border: "1px solid var(--wallet-border)",
              }}
            />
          </div>
        </label>

        <label className="flex h-full flex-col justify-end gap-1.5">
          <span
            className="text-xs font-medium"
            style={{ color: "var(--wallet-text-secondary)" }}
          >
            Automatically add
          </span>
          <div className="relative">
            <span
              className="absolute left-3 top-1/2 -translate-y-1/2 text-sm"
              style={{ color: "var(--wallet-text-tertiary)" }}
            >
              $
            </span>
            <input
              type="number"
              min="1"
              step="1"
              value={amountDollars}
              onChange={(e) => setAmountDollars(e.target.value)}
              disabled={saving}
              className="w-full rounded-lg py-2 pl-7 pr-3 text-sm tabular-nums"
              style={{
                background: "var(--wallet-surface-sunken)",
                color: "var(--wallet-text-primary)",
                border: "1px solid var(--wallet-border)",
              }}
            />
          </div>
        </label>
      </div>

      {/* Save settings (when values changed but not toggling) */}
      {hasCard && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => save(enabled)}
            disabled={saving}
            className="rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors"
            style={{
              background: "var(--wallet-accent)",
              color: "#fff",
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      )}

      {/* Saved card */}
      <div
        className="mt-5 flex items-center justify-between rounded-lg px-4 py-3"
        style={{
          background: "var(--wallet-surface-sunken)",
          border: "1px solid var(--wallet-border-subtle)",
        }}
      >
        {savedCard ? (
          <div className="flex items-center gap-2">
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
              style={{ color: "var(--wallet-text-tertiary)" }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
              />
            </svg>
            <span
              className="text-sm"
              style={{ color: "var(--wallet-text-primary)" }}
            >
              {brandLabel} •••• {savedCard.last4}
            </span>
          </div>
        ) : (
          <span
            className="text-sm"
            style={{ color: "var(--wallet-text-tertiary)" }}
          >
            No card saved
          </span>
        )}

        <button
          onClick={handleAddCard}
          disabled={addingCard}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          style={{
            background: "var(--wallet-surface)",
            color: "var(--wallet-accent)",
            border: "1px solid var(--wallet-border)",
            opacity: addingCard ? 0.5 : 1,
          }}
        >
          {addingCard
            ? "Starting…"
            : savedCard
              ? "Replace card"
              : "Add card"}
        </button>
      </div>

      {/* Card setup form (Stripe Elements, confirms the SetupIntent) */}
      {setupClientSecret && (
        <AddCardForm
          clientSecret={setupClientSecret}
          onSuccess={handleCardSaved}
          onCancel={handleCardCancelled}
        />
      )}

      {/* No-card prompt */}
      {!hasCard && (
        <p
          className="mt-3 text-xs"
          style={{ color: "var(--wallet-text-tertiary)" }}
        >
          Add a card to enable auto-recharge.
        </p>
      )}

      {/* Failure notice */}
      {failures > 0 && (
        <p
          className="mt-3 text-xs"
          style={{ color: "var(--wallet-danger)" }}
        >
          {failures} recent decline{failures === 1 ? "" : "s"}. Auto-recharge
          will disable after 3 consecutive declines.
        </p>
      )}

      {/* Status message */}
      {message && (
        <p
          className="mt-3 text-xs font-medium"
          style={{
            color:
              message.type === "success"
                ? "var(--wallet-success)"
                : "var(--wallet-danger)",
          }}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
