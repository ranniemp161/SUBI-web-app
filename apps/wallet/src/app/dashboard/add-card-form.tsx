"use client";

import { useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { getStripeClient } from "@/lib/stripe-client";

interface AddCardFormProps {
  clientSecret: string;
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Confirms the SetupIntent from POST /api/billing/setup-intent with an
 * embedded Stripe Elements card form (ADR 0002/0002 decision 1, "settings
 * path"). The webhook's setup_intent.succeeded handler persists the saved
 * card onto the user once Stripe confirms it.
 */
export function AddCardForm({
  clientSecret,
  onSuccess,
  onCancel,
}: AddCardFormProps) {
  return (
    <Elements
      stripe={getStripeClient()}
      options={{ clientSecret, appearance: { theme: "flat" } }}
    >
      <AddCardFormInner onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}

function AddCardFormInner({
  onSuccess,
  onCancel,
}: Omit<AddCardFormProps, "clientSecret">) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message || "Could not save the card.");
      setSubmitting(false);
      return;
    }

    if (setupIntent?.status === "succeeded") {
      onSuccess();
      return;
    }

    setError("Card setup did not complete. Please try again.");
    setSubmitting(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 flex flex-col gap-3 rounded-lg p-4"
      style={{
        background: "var(--wallet-surface-sunken)",
        border: "1px solid var(--wallet-border-subtle)",
      }}
    >
      <PaymentElement options={{ layout: "tabs" }} />

      {error && (
        <p className="text-xs font-medium" style={{ color: "var(--wallet-danger)" }}>
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold"
          style={{
            background: "var(--wallet-surface)",
            color: "var(--wallet-text-secondary)",
            border: "1px solid var(--wallet-border)",
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!stripe || submitting}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold"
          style={{
            background: "var(--wallet-accent)",
            color: "#fff",
            opacity: !stripe || submitting ? 0.5 : 1,
          }}
        >
          {submitting ? "Saving…" : "Save card"}
        </button>
      </div>
    </form>
  );
}
