"use client";

import * as Sentry from "@sentry/nextjs";
import { Megaphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Props = { variant: "floating" | "icon" };

export function FeedbackButton({ variant }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // getFeedback is only exported from the browser build of the SDK (the
    // server build @sentry/nextjs resolves to under Node/test module
    // resolution has no feedback API at all), so it's not guaranteed to be
    // a function even client-side if the SDK hasn't finished loading yet.
    const feedback = Sentry.getFeedback?.();
    if (!feedback || !ref.current) return;
    const unsubscribe = feedback.attachTo(ref.current);
    setReady(true);
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  if (!ready && !Sentry.getFeedback?.()) return null;

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
