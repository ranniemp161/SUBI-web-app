import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <SignIn
        fallbackRedirectUrl="/dashboard"
        appearance={{
          variables: {
            colorPrimary: "#2563eb",
          },
          elements: {
            rootBox: "mx-auto",
            cardBox: "shadow-xl",
            card: "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800",
            headerTitle: "text-zinc-900 dark:text-zinc-100 text-2xl font-bold tracking-tight",
            headerSubtitle: "text-zinc-500 dark:text-zinc-400",
            socialButtonsBlockButton:
              "border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors",
            socialButtonsBlockButtonText: "text-zinc-700 dark:text-zinc-300 font-medium",
            dividerLine: "bg-zinc-200 dark:bg-zinc-800",
            dividerText: "text-zinc-500 dark:text-zinc-400",
            formFieldLabel: "text-zinc-700 dark:text-zinc-300 font-medium",
            formFieldInput:
              "bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-blue-500",
            formButtonPrimary:
              "bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold normal-case shadow-none transition-colors",
            footer: "bg-none [&>*]:bg-transparent bg-white dark:bg-zinc-900",
            footerActionText: "text-zinc-500 dark:text-zinc-400",
            footerActionLink:
              "text-blue-600 dark:text-blue-500 hover:text-blue-500 dark:hover:text-blue-400 font-medium",
          },
        }}
      />
    </main>
  );
}
