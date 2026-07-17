import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

/**
 * Sign-in page using Clerk's prebuilt component.
 *
 * No custom fields needed for login — the prebuilt component
 * handles email/password, error states, and session management.
 *
 * The appearance config restyles Clerk's card with the app's own design
 * tokens (bg-background / text-foreground / blue-600 accent) so it matches
 * the custom-built sign-up page instead of Clerk's stock white card. Tokens
 * are used instead of hex values so the card follows the user's
 * light/dark color scheme like the rest of the app.
 */
export default async function SignInPage() {
  const { userId } = await auth();
  if (userId) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignIn
        fallbackRedirectUrl="/dashboard"
        appearance={{
          variables: {
            // The accent is the one fixed color — same blue-600 in both schemes.
            colorPrimary: "#2563eb",
          },
          elements: {
            rootBox: "mx-auto",
            cardBox: "shadow-xl",
            card: "bg-background border border-foreground/10",
            headerTitle: "text-foreground text-2xl font-bold tracking-tight",
            headerSubtitle: "text-foreground/60",
            socialButtonsBlockButton:
              "border border-foreground/10 bg-foreground/5 hover:bg-foreground/10 transition-colors",
            socialButtonsBlockButtonText: "text-foreground font-medium",
            dividerLine: "bg-foreground/10",
            dividerText: "text-foreground/40",
            formFieldLabel: "text-foreground/80 font-medium",
            formFieldInput:
              "bg-foreground/5 border-foreground/10 text-foreground placeholder:text-foreground/40 focus:border-blue-500 focus:ring-blue-500",
            formButtonPrimary:
              "bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold normal-case shadow-none transition-colors",
            badge: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
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
