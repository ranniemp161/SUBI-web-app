"use client";

import * as Sentry from "@sentry/nextjs";
import { Megaphone } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";

type Props = { variant: "floating" | "icon" };

type FeedbackIntegration = NonNullable<
  ReturnType<NonNullable<typeof Sentry.getFeedback>>
>;

// getFeedback is only exported from the browser build of the SDK (the server
// build @sentry/nextjs resolves to under Node/test module resolution has no
// feedback API at all), so it's not guaranteed to be a function even client
// side if the SDK hasn't finished loading yet.
function getFeedbackSnapshot(): FeedbackIntegration | null {
  return Sentry.getFeedback?.() ?? null;
}

// The server build has no feedback API at all, so the server never has an
// integration to report — this must match the client's FIRST render exactly,
// or React throws a hydration mismatch.
function getServerSnapshot(): FeedbackIntegration | null {
  return null;
}

// Sentry's feedback integration is registered during Sentry.init()
// (instrumentation-client.ts), which runs before this subscription is set
// up, so one re-check right after mount is enough to pick it up.
function subscribeToFeedback(onStoreChange: () => void): () => void {
  onStoreChange();
  return () => {};
}

export function FeedbackButton({ variant }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  // useSyncExternalStore (not state-in-an-effect) both keeps the first
  // client render identical to the server's — avoiding a hydration mismatch
  // — and reads Sentry's feedback integration the React-sanctioned way for
  // an external value that becomes available after mount.
  const feedback = useSyncExternalStore(
    subscribeToFeedback,
    getFeedbackSnapshot,
    getServerSnapshot
  );

  useEffect(() => {
    // Runs after the commit that rendered the button (feedback became
    // truthy), so ref.current is populated by the time attachTo needs it.
    if (!feedback || !ref.current) return;
    const unsubscribe = feedback.attachTo(ref.current);
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [feedback]);

  if (!feedback) return null;

  if (variant === "icon") {
    return (
      <button
        ref={ref}
        type="button"
        aria-label="Request a feature"
        title="Request a feature"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-foreground/10 text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        <Megaphone className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-background/90 px-4 py-2 text-sm font-medium text-foreground shadow-lg backdrop-blur transition hover:bg-foreground/10"
    >
      <Megaphone className="h-4 w-4" />
      Request a Feature
    </button>
  );
}
