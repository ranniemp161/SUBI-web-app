"use client";

import * as Sentry from "@sentry/nextjs";
import { Megaphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Props = { variant: "floating" | "icon" };

type FeedbackIntegration = NonNullable<
  ReturnType<NonNullable<typeof Sentry.getFeedback>>
>;

export function FeedbackButton({ variant }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  // Looked up in an effect, never during render: the server build of the SDK
  // has no feedback API while the browser build does, so a render time
  // Sentry.getFeedback() gate makes the server render nothing while the
  // client's first render shows the button, a guaranteed hydration mismatch.
  // Starting from null keeps the first client render identical to the
  // server's; the button appears in a second pass after mount.
  const [feedback, setFeedback] = useState<FeedbackIntegration | null>(null);

  useEffect(() => {
    // getFeedback is only exported from the browser build of the SDK (the
    // server build @sentry/nextjs resolves to under Node/test module
    // resolution has no feedback API at all), so it's not guaranteed to be
    // a function even client side if the SDK hasn't finished loading yet.
    const integration = Sentry.getFeedback?.();
    if (integration) setFeedback(integration);
  }, []);

  useEffect(() => {
    // Runs after the commit that rendered the button (triggered by
    // setFeedback above), so ref.current is populated by the time
    // attachTo needs it.
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
