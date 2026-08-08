import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SignInButton } from "@clerk/nextjs";

/**
 * Public landing. A signed-in visitor never sees it — they go straight to the
 * dashboard, the same pattern Rough Cut's landing page uses.
 */
export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div className="max-w-[1200px] mx-auto px-8 py-24">
      <div className="max-w-2xl">
        <h1
          className="text-5xl font-bold tracking-tight leading-[1.1]"
          style={{ fontFamily: "var(--font-space-grotesk)" }}
        >
          You talked about it at{" "}
          <span className="broll-tabular" style={{ color: "var(--broll-accent)" }}>
            2:35
          </span>
          . Here is the clip for it.
        </h1>
        <p className="mt-6 text-lg" style={{ color: "var(--broll-muted)" }}>
          Give it a timed transcript and a photo of yourself. Get back a folder
          of short, timecode-named B-roll clips you drag straight into the edit
          you are already in. Not a finished video, and not a template pack.
        </p>
        <div className="mt-10">
          <SignInButton mode="modal">
            <button
              className="px-6 py-3 rounded-lg font-semibold transition-colors"
              style={{
                background: "var(--broll-accent)",
                color: "var(--broll-accent-foreground)",
              }}
            >
              Sign in to start
            </button>
          </SignInButton>
        </div>
      </div>
    </div>
  );
}
