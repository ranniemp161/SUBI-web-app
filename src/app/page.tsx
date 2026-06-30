import Link from "next/link";

/**
 * Landing page — marketing hero for the Rough Cut app.
 *
 * Server-rendered for SEO. Explains what the app does,
 * highlights key features, and directs users to sign up.
 */
export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Navigation */}
      <nav className="border-b border-foreground/5">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
              <svg
                className="h-4 w-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <span className="text-lg font-bold text-foreground">
              Rough Cut
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/sign-in"
              className="text-sm font-medium text-foreground/60 transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              id="hero-get-started"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-1.5 text-sm font-medium text-blue-400">
            Edit your video like a document
          </div>

          <h1 className="text-5xl font-bold leading-tight tracking-tight text-foreground sm:text-6xl">
            Raw footage to{" "}
            <span className="bg-gradient-to-r from-blue-500 to-cyan-400 bg-clip-text text-transparent">
              rough cut
            </span>
            <br />
            in minutes
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-foreground/60">
            Upload your raw video, and Rough Cut automatically removes silence,
            retakes, and dead air. Edit like a document — not a timeline. Export
            directly from your browser.
          </p>

          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              href="/sign-up"
              id="cta-get-started"
              className="rounded-lg bg-blue-600 px-8 py-3 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:bg-blue-500 hover:shadow-blue-500/30"
            >
              Get Started Free
            </Link>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="mx-auto mt-24 grid max-w-5xl grid-cols-1 gap-8 sm:grid-cols-3">
          <div className="rounded-xl border border-foreground/5 bg-foreground/[0.02] p-6">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
              <svg
                className="h-5 w-5 text-purple-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              Text-based editing
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-foreground/50">
              Edit your video by editing the transcript. Delete words to cut
              segments. Click to seek. No timeline dragging.
            </p>
          </div>

          <div className="rounded-xl border border-foreground/5 bg-foreground/[0.02] p-6">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <svg
                className="h-5 w-5 text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              Auto-detects cuts
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-foreground/50">
              Automatically finds silence, retakes, and dead air. Proposes cuts
              you can accept, adjust, or reject.
            </p>
          </div>

          <div className="rounded-xl border border-foreground/5 bg-foreground/[0.02] p-6">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
              <svg
                className="h-5 w-5 text-orange-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              Browser-based rendering
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-foreground/50">
              Preview your edits and export the final cut directly in your
              browser — no waiting on a render queue.
            </p>
          </div>
        </div>

        {/* Browser Compatibility Note */}
        <div className="mx-auto mt-16 max-w-md text-center text-xs text-foreground/30">
          <p>
            Rough Cut requires Chrome or Edge for video export. All other
            features work in any modern browser.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-foreground/5 px-6 py-8">
        <div className="mx-auto max-w-6xl text-center text-sm text-foreground/30">
          © {new Date().getFullYear()} Rough Cut. Built for creators.
        </div>
      </footer>
    </div>
  );
}
