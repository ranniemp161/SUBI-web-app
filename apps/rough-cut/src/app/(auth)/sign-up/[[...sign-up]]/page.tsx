import { SignUp } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

/**
 * Clerk owns the full sign-up state machine. This component automatically
 * collects every required Clerk field and only accepts an email code while
 * email verification is still pending.
 *
 * A server component, mirroring the sign-in page: the session resolves before
 * anything renders, so a signed-in visitor never sees the form. The previous
 * client version read useAuth() without waiting for isLoaded, so userId was
 * undefined on the first pass — it painted the whole Clerk card and only then
 * redirected. That flash is what this shape removes.
 */
export default async function SignUpPage() {
  const { userId } = await auth();
  if (userId) {
    redirect("/dashboard");
  }

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
