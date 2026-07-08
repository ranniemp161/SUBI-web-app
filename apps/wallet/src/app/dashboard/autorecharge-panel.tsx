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
  const initialThresholdDollars =
    initialThreshold != null ? String(initialThreshold / MICROS_PER_USD) : "5";
  const initialAmountDollars =
    initialAmount != null ? String(initialAmount / MICROS_PER_USD) : "19";

  const [enabled, setEnabled] = useState(initialEnabled);
  // The last-saved values (shown, read-only, once settled) vs. the in-progress
  // edit (only meaningful while isEditing is true). Keeping them separate is
  // what lets the fields lock after a save instead of staying open forever.
  const [savedThresholdDollars, setSavedThresholdDollars] = useState(
    initialThresholdDollars
  );
  const [savedAmountDollars, setSavedAmountDollars] = useState(
    initialAmountDollars
  );
  const [draftThresholdDollars, setDraftThresholdDollars] = useState(
    initialThresholdDollars
  );
  const [draftAmountDollars, setDraftAmountDollars] = useState(
    initialAmountDollars
  );
  const [isEditing, setIsEditing] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const thresholdDollars = isEditing ? draftThresholdDollars : savedThresholdDollars;
  const amountDollars = isEditing ? draftAmountDollars : savedAmountDollars;

  const thresholdMicros = Math.round(
    (parseFloat(thresholdDollars) || 0) * MICROS_PER_USD
  );
  const amountMicros = Math.round(
    (parseFloat(amountDollars) || 0) * MICROS_PER_USD
  );

  /** Mirrors the server's own checks so a bad value never round-trips just to bounce. */
  const validateDraft = useCallback((): string | null => {
    const t = parseFloat(draftThresholdDollars);
    const a = parseFloat(draftAmountDollars);
    if (!Number.isFinite(t) || t <= 0) {
      return "Enter a threshold greater than $0.";
    }
    if (!Number.isFinite(a) || a <= 0) {
      return "Enter a recharge amount greater than $0.";
    }
    if (a <= t) {
      return "The recharge amount must be greater than the threshold.";
    }
    return null;
  }, [draftThresholdDollars, draftAmountDollars]);

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
        if (isEditing) {
          setSavedThresholdDollars(draftThresholdDollars);
          setSavedAmountDollars(draftAmountDollars);
          setIsEditing(false);
          setFieldError(null);
        }
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
    [thresholdMicros, amountMicros, isEditing, draftThresholdDollars, draftAmountDollars]
  );

  const handleEditClick = useCallback(() => {
    setDraftThresholdDollars(savedThresholdDollars);
    setDraftAmountDollars(savedAmountDollars);
    setFieldError(null);
    setMessage(null);
    setIsEditing(true);
  }, [savedThresholdDollars, savedAmountDollars]);

  const handleCancelClick = useCallback(() => {
    setDraftThresholdDollars(savedThresholdDollars);
    setDraftAmountDollars(savedAmountDollars);
    setFieldError(null);
    setIsEditing(false);
  }, [savedThresholdDollars, savedAmountDollars]);

  const handleSaveSettings = useCallback(() => {
    const err = validateDraft();
    if (err) {
      setFieldError(err);
      return;
    }
    setFieldError(null);
    save(enabled);
  }, [validateDraft, save, enabled]);

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

  const handleCardSaved = useCallback(async () => {
    setSetupClientSecret(null);
    setMessage({ type: "success", text: "Card confirmed, finishing setup…" });

    // The card isn't actually persisted until Stripe's setup_intent.succeeded
    // webhook lands (async, no latency guarantee), so a brief poll here avoids
    // declaring "Card saved" before the panel can actually show it.
    let persisted = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch("/api/billing/autorecharge");
        if (res.ok) {
          const data = await res.json();
          if (data.hasCard) {
            persisted = true;
            break;
          }
        }
      } catch {
        // Network hiccup mid-poll — just retry.
      }
      if (attempt < 4) await new Promise((r) => setTimeout(r, 400));
    }

    setMessage({
      type: "success",
      text: persisted
        ? "Card saved."
        : "Card confirmed. It may take a moment to appear below.",
    });
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
          disabled={!hasCard || saving || isEditing}
          title={isEditing ? "Finish editing settings first." : undefined}
          onClick={() => save(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${
            !hasCard || saving || isEditing ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
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
              onChange={(e) => setDraftThresholdDollars(e.target.value)}
              disabled={saving || !isEditing}
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
              onChange={(e) => setDraftAmountDollars(e.target.value)}
              disabled={saving || !isEditing}
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

      {/* Threshold/amount edit state: locked + "Saved" after a successful save,
          unlocked with Save/Cancel while editing. Stops the settings from being
          re-submitted indefinitely and makes the saved state visible. */}
      {hasCard && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {fieldError ? (
            <p
              className="text-xs font-medium"
              style={{ color: "var(--wallet-danger)" }}
            >
              {fieldError}
            </p>
          ) : (
            !isEditing && (
              <p
                className="flex items-center gap-1 text-xs font-medium"
                style={{ color: "var(--wallet-success)" }}
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Saved
              </p>
            )
          )}

          <div className="ml-auto flex gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleCancelClick}
                  disabled={saving}
                  className="rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    background: "var(--wallet-surface)",
                    color: "var(--wallet-text-secondary)",
                    border: "1px solid var(--wallet-border)",
                    opacity: saving ? 0.5 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveSettings}
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
              </>
            ) : (
              <button
                onClick={handleEditClick}
                disabled={saving}
                className="rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  background: "var(--wallet-surface)",
                  color: "var(--wallet-accent)",
                  border: "1px solid var(--wallet-border)",
                  opacity: saving ? 0.5 : 1,
                }}
              >
                Edit
              </button>
            )}
          </div>
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
