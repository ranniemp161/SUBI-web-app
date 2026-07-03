import Link from "next/link";

/**
 * Landing page — marketing hero for the Ruff Cut app.
 *
 * Server-rendered for SEO, no client JS: the FAQ accordion uses native
 * <details>/<summary>. Copy is deliberately honest about the app's
 * local-first constraints (Chromium-only export, re-selecting the source
 * file) so users aren't surprised in-app — see the FAQ section.
 */

const faqs = [
  {
    question: "Is my video uploaded anywhere?",
    answer:
      "No. Your video never leaves your computer — it's opened directly from your disk and edited in the browser. Only the extracted audio track is sent for transcription, and it's deleted the moment your transcript is ready. What we store is text and your edit decisions, never your footage.",
  },
  {
    question: "Which browsers work?",
    answer:
      "The full experience works in Chrome and Edge. Other browsers can transcribe and edit, but exporting the final video relies on technology (WebCodecs) that only Chromium-based browsers support today.",
  },
  {
    question: "Why do I have to re-select my video when I reopen a project?",
    answer:
      "Because we never store your video. Your transcript and edits are saved to your account, but the video itself only exists on your computer — so when you come back, we ask you to point at the file again and everything picks up where you left off.",
  },
  {
    question: "How fast are exports? Can I export 4K?",
    answer:
      "Exports render on your computer, not in a server queue — there's no waiting behind other users. That also means speed and maximum resolution depend on your hardware. If your device can't encode at the source resolution, pick 1080p or 720p in the export dialog. Keep the tab open until the export finishes.",
  },
  {
    question: "What formats are supported?",
    answer:
      "H.264 MP4 in, H.264 MP4 out. It's the format virtually every camera, phone, and screen recorder produces.",
  },
  {
    question: "Do I need an internet connection?",
    answer:
      "Yes, for transcription — your audio is processed in the cloud and then deleted. After that, editing, previewing, and exporting all happen locally in your browser.",
  },
  {
    question: "How is this different from Descript?",
    answer:
      "Ruff Cut focuses on one thing: turning raw footage into a clean rough cut by editing text — silences, retakes, and filler removed. Your media never sits in anyone's cloud, there's nothing to install, and there's no timeline to wrestle with.",
  },
  {
    question: "How do I get access?",
    answer:
      "With an access code from the Skool community. Enter it when you create your account.",
  },
];

const steps = [
  {
    number: "1",
    title: "Pick your footage",
    description:
      "Choose a video from your computer. It stays there — only the audio is sent off to be transcribed.",
  },
  {
    number: "2",
    title: "Edit the text",
    description:
      "Silence, retakes, and dead air are already flagged. Accept, adjust, or reject each cut like editing a document.",
  },
  {
    number: "3",
    title: "Export in your browser",
    description:
      "Your final MP4 renders right on your machine and saves straight to disk. No render queue, no upload.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Navigation */}
      <nav className="sticky top-0 z-10 border-b border-foreground/5 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500">
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
            <span className="text-lg font-bold text-foreground">Ruff Cut</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="#faq"
              className="hidden text-sm font-medium text-foreground/60 transition-colors hover:text-foreground sm:block"
            >
              FAQ
            </Link>
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

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden px-6 pb-20 pt-24 sm:pt-32">
          {/* Ambient glow behind the headline; decorative only. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-blue-600/10 blur-3xl"
          />
          <div className="relative mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-1.5 text-sm font-medium text-blue-400">
              Edit your video like a document
            </div>

            <h1 className="text-5xl font-bold leading-tight tracking-tight text-foreground sm:text-6xl">
              Raw footage to a{" "}
              <span className="bg-gradient-to-r from-blue-500 to-cyan-400 bg-clip-text text-transparent">
                rough cut
              </span>
              <br />
              in minutes
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-foreground/60">
              Ruff Cut finds the silence, retakes, and dead air in your footage,
              then lets you cut it all by editing text — not a timeline. Your
              video never leaves your computer.
            </p>

            <div className="mt-10 flex items-center justify-center gap-4">
              <Link
                href="/sign-up"
                id="cta-get-started"
                className="rounded-lg bg-blue-600 px-8 py-3 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:bg-blue-500 hover:shadow-blue-500/30"
              >
                Get Started Free
              </Link>
              <Link
                href="#how-it-works"
                className="rounded-lg border border-foreground/10 px-8 py-3 text-base font-semibold text-foreground/70 transition-colors hover:border-foreground/20 hover:text-foreground"
              >
                How it works
              </Link>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-20 px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-3xl font-bold tracking-tight text-foreground">
              Three steps to a clean cut
            </h2>
            <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-3">
              {steps.map((step) => (
                <div key={step.number} className="relative">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 text-base font-bold text-blue-400">
                    {step.number}
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-foreground/50">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="px-6 py-20">
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 sm:grid-cols-3">
            <div className="rounded-xl border border-foreground/5 bg-foreground/[0.02] p-6 transition-colors hover:border-foreground/10 hover:bg-foreground/[0.04]">
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

            <div className="rounded-xl border border-foreground/5 bg-foreground/[0.02] p-6 transition-colors hover:border-foreground/10 hover:bg-foreground/[0.04]">
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
                Automatically finds silence, retakes, and dead air. Proposes
                cuts you can accept, adjust, or reject.
              </p>
            </div>

            <div className="rounded-xl border border-foreground/5 bg-foreground/[0.02] p-6 transition-colors hover:border-foreground/10 hover:bg-foreground/[0.04]">
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
        </section>

        {/* Privacy callout */}
        <section className="px-6 py-20">
          <div className="mx-auto max-w-4xl rounded-2xl border border-blue-500/15 bg-gradient-to-br from-blue-500/[0.07] to-cyan-500/[0.04] p-10 text-center sm:p-14">
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10">
              <svg
                className="h-6 w-6 text-blue-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              Your video never leaves your computer
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-foreground/60">
              Ruff Cut is local-first. Your footage is opened straight from your
              disk, edited in the browser, and exported back to your disk. Only
              the audio track travels — sent for transcription and deleted the
              moment your transcript is ready. We store your words and your
              edits, never your video.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 px-6 py-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-center text-3xl font-bold tracking-tight text-foreground">
              Questions, answered honestly
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-base text-foreground/50">
              What Ruff Cut does, what it doesn&apos;t, and what to expect
              before you start.
            </p>
            <div className="mt-10 space-y-3">
              {faqs.map((faq) => (
                <details
                  key={faq.question}
                  className="group rounded-xl border border-foreground/5 bg-foreground/[0.02] transition-colors open:border-foreground/10 open:bg-foreground/[0.04]"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 text-base font-medium text-foreground [&::-webkit-details-marker]:hidden">
                    {faq.question}
                    <svg
                      className="h-5 w-5 shrink-0 text-foreground/40 transition-transform group-open:rotate-45"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                  </summary>
                  <p className="px-6 pb-5 text-sm leading-relaxed text-foreground/60">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="px-6 pb-24 pt-4">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              Ready to cut the dead air?
            </h2>
            <div className="mt-8">
              <Link
                href="/sign-up"
                id="cta-bottom"
                className="rounded-lg bg-blue-600 px-8 py-3 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:bg-blue-500 hover:shadow-blue-500/30"
              >
                Get Started Free
              </Link>
            </div>
            <p className="mt-6 text-xs text-foreground/30">
              Best in Chrome or Edge — video export needs technology only
              Chromium browsers support today.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-foreground/5 px-6 py-8">
        <div className="mx-auto max-w-6xl text-center text-sm text-foreground/30">
          © {new Date().getFullYear()} Ruff Cut. Built for creators.
        </div>
      </footer>
    </div>
  );
}
