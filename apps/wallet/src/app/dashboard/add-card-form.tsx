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
  let stripePromise;
  try {
    stripePromise = getStripeClient();
  } catch (err) {
    console.error("Stripe client failed to initialize:", err);
    return (
      <p
        className="mt-4 text-xs font-medium"
        style={{ color: "var(--wallet-danger)" }}
      >
        Billing is misconfigured (Stripe key missing). Card setup is
        unavailable right now.
      </p>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
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

    try {
      const { error: confirmError, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
      });

      if (confirmError) {
        setError(confirmError.message || "Could not save the card.");
        return;
      }

      if (setupIntent?.status === "succeeded") {
        onSuccess();
        return;
      }

      setError("Card setup did not complete. Please try again.");
    } catch (err) {
      console.error("Card confirm failed:", err);
      setError("Something went wrong saving the card. Please try again.");
    } finally {
      setSubmitting(false);
    }
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
