import { SignIn } from "@clerk/nextjs";

/**
 * Sign-in page using Clerk's prebuilt component.
 *
 * No custom fields needed for login — the prebuilt component
 * handles email/password, error states, and session management.
 */
export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignIn
        fallbackRedirectUrl="/dashboard"
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "bg-foreground/5 border border-foreground/10 shadow-xl",
          },
        }}
      />
    </main>
  );
}
