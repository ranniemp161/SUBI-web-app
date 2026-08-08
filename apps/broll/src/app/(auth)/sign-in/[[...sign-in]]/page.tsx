import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

/**
 * Themed to this app's palette rather than Clerk's defaults: dark surfaces, Key
 * Yellow primary, and near-black text on yellow because white on yellow fails
 * contrast. See src/app/globals.css.
 */
export default async function SignInPage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <SignIn
        fallbackRedirectUrl="/dashboard"
        appearance={{
          variables: {
            colorPrimary: "#fffc00",
          },
          elements: {
            rootBox: "mx-auto",
            card: "bg-[#0c0c0e] border border-white/10",
            headerTitle: "text-white",
            headerSubtitle: "text-[#aaaaaa]",
            formFieldLabel: "text-white",
            formFieldInput: "bg-[#2c2c2c] text-white border-white/10",
            formButtonPrimary:
              "bg-[#fffc00] text-[#111111] hover:bg-[#2997ff] hover:text-white text-sm font-semibold normal-case shadow-none transition-colors",
            footerActionLink: "text-[#2997ff] hover:text-[#fffc00]",
          },
        }}
      />
    </main>
  );
}
