"use client";

import { SignUp } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Clerk owns the full sign-up state machine. This component automatically
 * collects every required Clerk field and only accepts an email code while
 * email verification is still pending.
 */
export default function SignUpPage() {
  const { userId } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (userId) router.push("/dashboard");
  }, [router, userId]);

  if (userId) return null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignUp
        fallbackRedirectUrl="/dashboard"
        appearance={{
          variables: {
            colorPrimary: "#2563eb",
          },
          elements: {
            rootBox: "mx-auto",
            cardBox: "shadow-xl",
            card: "border border-foreground/10 bg-background",
            headerTitle: "text-foreground text-2xl font-bold tracking-tight",
            headerSubtitle: "text-foreground/60",
            socialButtonsBlockButton:
              "border border-foreground/10 bg-foreground/5 hover:bg-foreground/10 transition-colors",
            socialButtonsBlockButtonText: "text-foreground font-medium",
            dividerLine: "bg-foreground/10",
            dividerText: "text-foreground/60",
            formFieldLabel: "text-foreground/80 font-medium",
            formFieldInput:
              "bg-foreground/5 border-foreground/10 text-foreground placeholder:text-foreground/40 focus:border-blue-500 focus:ring-blue-500",
            formButtonPrimary:
              "bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold normal-case shadow-none transition-colors",
            footer: "bg-none [&>*]:bg-transparent bg-background",
            footerActionText: "text-foreground/60",
            footerActionLink:
              "text-blue-500 hover:text-blue-400 font-medium",
          },
        }}
      />
    </main>
  );
}
