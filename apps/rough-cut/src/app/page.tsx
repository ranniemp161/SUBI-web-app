import Link from "next/link";
import { FileText, FileVideo2, Globe, ShieldCheck, Video, Laptop, Cloud, X } from "lucide-react";

import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import SpotlightCard from "@/components/SpotlightCard";
import FadeIn from "@/components/FadeIn";

const display = "font-[family-name:var(--font-heading)]";
const mono = "font-[family-name:var(--font-sans)]";

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
      "Exports render on your computer, not in a server queue — there's no waiting behind other users. That also means speed and maximum resolution depend on your hardware: 4K encoding is heavy and is our least-tested path, so on weaker devices pick 1080p or 720p in the export dialog instead. Keep the tab open until the export finishes.",
  },
  {
    question: "What formats are supported?",
    answer:
      "H.264 MP4 in, H.264 MP4 out. It's the format virtually every camera, phone, and screen recorder produces.",
  },
  {
    question: "Do I need an internet connection?",
    answer:
      "Yes — keep your connection on while you work. Transcription runs in the cloud, and the app itself is served from the web, so exports can fail if you go offline mid-session. Rendering still happens on your machine in Chrome or Edge, and your video is never uploaded — only the audio track travels, and it's deleted after transcription.",
  },
  {
    question: "How is this different from Descript?",
    answer:
      "MyFirstCut focuses on one thing: turning raw footage into a clean rough cut by editing text — silences, retakes, and filler removed. Your video never sits in anyone's cloud, there's nothing to install, and editing is text-first — the timeline is there to show your cuts, not something you have to wrestle with.",
  },
];

const steps = [
  {
    number: "01",
    title: "Pick your footage",
    description:
      "Choose a video from your computer. It stays there — only the audio is sent off to be transcribed.",
  },
  {
    number: "02",
    title: "Edit the text",
    description:
      "Silence, retakes, and dead air are already flagged. Accept, adjust, or reject each cut like editing a document.",
  },
  {
    number: "03",
    title: "Export in your browser",
    description:
      "Your final MP4 renders right on your machine and saves straight to disk. No render queue, no upload.",
  },
];

/** Sample cuts shown in the hero app mockup — illustrative UI, not copy. */
const mockCuts = [
  {
    kind: "RETAKE",
    color: "#F0A0A0",
    time: "1:12",
    text: "“Um, okay, hold on — let me start that again.”",
  },
  {
    kind: "SILENCE",
    color: "#fffc00",
    time: "1:58",
    text: "2.4s of dead air after “finished cut.”",
  },
  {
    kind: "FILLER",
    color: "#F0A0A0",
    time: "2:31",
    text: "“uh” before “you never touch a timeline.”",
  },
];

/**
 * Deterministic pseudo-random waveform for the mockup (sine-based, so the
 * server render is stable). Red zones mark the flagged cuts; the blue
 * region is "already played" up to the playhead.
 */
const waveformBars = Array.from({ length: 72 }, (_, i) => {
  const h = 18 + Math.abs(Math.sin(i * 1.7) * 60 + Math.sin(i * 0.43) * 20);
  const cutZone = (i > 14 && i < 22) || (i > 50 && i < 54);
  return {
    height: `${Math.min(96, h).toFixed(2)}%`,
    background: cutZone
      ? "rgba(248,113,113,0.28)"
      : i < 27
        ? "#fffc00"
        : "rgba(255,252,0,0.3)",
  };
});

/** Inline "flag" chip used in the mockup transcript (RETAKE / SILENCE). */
function TranscriptChip({
  tone,
  children,
}: {
  tone: "red" | "yellow";
  children: React.ReactNode;
}) {
  const toneClasses =
    tone === "red"
      ? "border-[rgba(248,113,113,0.35)] bg-[rgba(248,113,113,0.08)] text-[#F0A0A0]"
      : "border-[rgba(255,252,0,0.3)] bg-[rgba(255,252,0,0.08)] text-[#fffc00]";
  return (
    <span
      className={`mx-1 inline-flex items-center gap-[5px] rounded-md border px-2 py-px align-middle text-[10.5px] tracking-[0.05em] ${toneClasses}`}
    >
      {children}
    </span>
  );
}

/** Struck-through "cut" text in the mockup transcript. */
function CutText({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-[rgba(248,113,113,0.06)] px-[3px] text-[#5D6B82] line-through decoration-[rgba(248,113,113,0.7)]">
      {children}
    </span>
  );
}

// Signed-in visitors are redirected to /dashboard by the Clerk middleware
// (src/proxy.ts), not here — calling auth() in this component would force a
// dynamic render and give up static/CDN serving for the marketing page.
export default function LandingPage() {
  return (
    <div
      className={`flex min-h-screen flex-col overflow-x-hidden bg-[#111111] font-[family-name:var(--font-sans)] text-[var(--color-foreground)] antialiased selection:bg-[#fffc00] selection:text-black`}
    >
      <MarketingHeader />

      <main className="flex flex-1 flex-col">
        {/* Hero Section */}
        <FadeIn className="relative px-6 pt-[88px] text-center">
          {/* Ambient glow behind the headline; decorative only. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_480px_at_50%_-10%,rgba(255,252,0,0.15),transparent_70%)]"
          />
          <div className="relative mx-auto flex max-w-[880px] flex-col items-center gap-6">
            <div
              className={`${mono} inline-flex items-center gap-2 rounded-full border border-[#fffc00]/30 bg-[#fffc00]/10 px-3.5 py-1.5 text-xs uppercase tracking-[0.04em] text-[#fffc00]`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#fffc00]" />
              Raw footage to a first cut in minutes.
            </div>

            <h1
              className={`${display} text-balance text-[44px] font-extrabold leading-[1.04] tracking-[-0.03em] sm:text-[60px] lg:text-[76px]`}
            >
              The boring part of
              <br />
              video editing,{" "}
              <span className="inline-block rounded-[10px] bg-[#fffc00]/20 px-3 text-[#fffc00] shadow-[inset_0_0_0_1px_rgba(255,252,0,0.3)]">
                done for you
              </span>
              .
            </h1>

            <p className="max-w-[640px] text-pretty text-lg leading-[1.65] text-[#8A97AC]">
              MyFirstCut&apos;s AI cuts the silence, retakes, and rambling from your raw footage and delivers one coherent first cut automatically.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3.5">
              <Link
                href="/sign-up"
                id="cta-get-started"
                className="rounded-xl bg-gradient-to-r from-[#fffc00] via-yellow-400 to-[#fffc00] bg-[length:200%_200%] animate-liquid px-7 py-3.5 text-[15px] font-semibold text-black shadow-[0_4px_24px_rgba(255,252,0,0.2)] transition-all hover:scale-105"
              >
                Get Started Free
              </Link>
              <Link
                href="#how-it-works"
                className="rounded-xl border border-[rgba(255,255,255,0.18)] px-7 py-3.5 text-[15px] font-semibold text-[#E8EDF6] transition-colors hover:border-[rgba(255,255,255,0.4)]"
              >
                How it works
              </Link>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <span
                className={`${mono} text-[10px] uppercase tracking-[0.12em] text-[#fffc00]/70`}
              >
                Exports to
              </span>
              <span
                className={`${mono} inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-[#8A97AC]`}
              >
                <Video className="h-3.5 w-3.5" aria-hidden />
                MP4
              </span>
              <span
                className={`${mono} inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-[#8A97AC]`}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden />
                DaVinci Resolve
              </span>
              <span
                className={`${mono} inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-[#8A97AC]`}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden />
                Premiere Pro
              </span>
              <span
                className={`${mono} inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-[#8A97AC]`}
              >
                <FileVideo2 className="h-3.5 w-3.5" aria-hidden />
                Final Cut Pro
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <span
                className={`${mono} inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-[#8A97AC]`}
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                Your video stays on your device
              </span>
              <span
                className={`${mono} inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-[#8A97AC]`}
              >
                <Globe className="h-3.5 w-3.5" aria-hidden />
                Runs in your browser — no install needed
              </span>
            </div>
          </div>

          {/* App mockup — illustrative editor UI. */}
          <div aria-hidden className="relative mx-auto mt-16 max-w-[1060px]">
            <div className="pointer-events-none absolute -inset-x-[60px] -top-10 h-[300px] bg-[radial-gradient(600px_260px_at_50%_40%,rgba(255,252,0,0.1),transparent_70%)]" />
            <div className="relative overflow-hidden rounded-t-[18px] border border-[rgba(255,255,255,0.1)] bg-[#0B1220] text-left shadow-[0_-20px_80px_rgba(0,0,0,0.25),0_0_0_1px_rgba(0,0,0,0.4)]">
              {/* Window chrome */}
              <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.1)] bg-[#0D1424] px-[18px] py-3">
                <div className="flex items-center gap-3.5">
                  <div className="flex gap-[7px]">
                    <span className="h-[11px] w-[11px] rounded-full bg-[#2A3448]" />
                    <span className="h-[11px] w-[11px] rounded-full bg-[#2A3448]" />
                    <span className="h-[11px] w-[11px] rounded-full bg-[#2A3448]" />
                  </div>
                  <span className={`${mono} text-[12.5px] text-[#8A97AC]`}>
                    podcast_ep42_take3.mp4
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span
                    className={`${mono} hidden text-[11.5px] text-[#5D6B82] sm:inline`}
                  >
                    14:32 → 11:07
                  </span>
                  <span className="rounded-lg bg-[#fffc00] px-3.5 py-1.5 text-[12.5px] font-semibold text-black">
                    Export MP4
                  </span>
                </div>
              </div>

              {/* Body: transcript + suggested cuts */}
              <div className="grid min-h-[340px] lg:grid-cols-[1fr_264px]">
                <div
                  className={`${mono} px-6 py-7 text-[14.5px] leading-[2.15] text-[#C7D2E4] sm:px-8 lg:border-r lg:border-[rgba(255,255,255,0.1)]`}
                >
                  <div className="mb-3.5 text-[11px] tracking-[0.08em] text-[#5D6B82]">
                    TRANSCRIPT · CLICK A WORD TO SEEK
                  </div>
                  <p className="m-0 text-pretty">
                    So today I want to show you how the whole pipeline works.
                    <CutText>
                      {" "}
                      Um, okay, hold on — let me start that again.
                    </CutText>
                    <TranscriptChip tone="red">RETAKE · 0:04</TranscriptChip>
                    Today I&apos;m walking you through the entire pipeline,
                    from raw footage to a finished cut.
                    <TranscriptChip tone="yellow">SILENCE · 2.4s</TranscriptChip>
                    And the best part is
                    <CutText> uh </CutText>
                    you never touch a timeline.
                    <span className="ml-[3px] inline-block h-[18px] w-[2px] rounded-sm bg-[#fffc00] align-text-bottom" />
                  </p>
                </div>

                <div className="hidden flex-col gap-3 bg-[#0A101C] px-5 py-6 lg:flex">
                  <div
                    className={`${mono} text-[11px] tracking-[0.08em] text-[#5D6B82]`}
                  >
                    SUGGESTED CUTS · 3
                  </div>
                  {mockCuts.map((cut) => (
                    <div
                      key={cut.time}
                      className="flex flex-col gap-2 rounded-[10px] border border-[rgba(255,255,255,0.05)] bg-[#0C1322] px-3.5 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`${mono} text-[11px] tracking-[0.05em]`}
                          style={{ color: cut.color }}
                        >
                          {cut.kind}
                        </span>
                        <span className={`${mono} text-[11px] text-[#5D6B82]`}>
                          {cut.time}
                        </span>
                      </div>
                      <div className="text-[12.5px] leading-[1.45] text-[#8A97AC]">
                        {cut.text}
                      </div>
                      <div className="flex gap-2">
                        <span className="flex-1 rounded-[7px] bg-[rgba(255,252,0,0.14)] py-[5px] text-center text-[11.5px] font-semibold text-[#fffc00]">
                          Accept
                        </span>
                        <span className="flex-1 rounded-[7px] border border-[rgba(255,255,255,0.14)] py-[5px] text-center text-[11.5px] font-semibold text-[#8A97AC]">
                          Keep
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Waveform strip */}
              <div className="relative flex h-14 items-end gap-[2px] border-t border-[rgba(255,255,255,0.1)] bg-[#0A101C] px-[18px] pb-2.5 pt-2">
                {waveformBars.map((bar, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-sm"
                    style={{ height: bar.height, background: bar.background }}
                  />
                ))}
                <span className="absolute bottom-0 left-[38%] top-0 w-[2px] bg-[#fffc00] shadow-[0_0_8px_rgba(255,252,0,0.8)]" />
              </div>
            </div>
            <div className="h-px bg-gradient-to-r from-transparent via-[rgba(255,252,0,0.5)] to-transparent" />
          </div>
        </FadeIn>

        {/* How it works */}
        <FadeIn id="how-it-works" className="mx-auto max-w-[1060px] scroll-mt-20 px-6 pb-10 pt-20 sm:pt-[110px]">
          <h2
            className={`${display} mb-14 text-center text-[32px] font-bold tracking-[-0.02em] sm:text-[40px]`}
          >
            Three steps to a clean cut
          </h2>
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-3">
            {steps.map((step) => (
              <SpotlightCard
                key={step.number}
                className="flex flex-col gap-3.5 pt-[22px] px-6 pb-6 rounded-3xl"
              >
                <span className={`${mono} text-[13px] text-[#fffc00]`}>
                  {step.number}
                </span>
                <h3
                  className={`${display} text-[21px] font-semibold leading-snug text-white`}
                >
                  {step.title}
                </h3>
                <p className="text-pretty text-[14.5px] leading-[1.65] text-[#8A97AC]">
                  {step.description}
                </p>
              </SpotlightCard>
            ))}
          </div>
        </FadeIn>

        {/* Feature Grid */}
        <FadeIn className="mx-auto max-w-[1060px] px-6 py-[70px]">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <SpotlightCard className="flex flex-col gap-3.5 rounded-2xl p-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-[#E8EDF6]">
                <FileVideo2 className="h-5 w-5" />
              </span>
              <h3 className="mt-2 font-semibold text-[#E8EDF6]">
                Non-Destructive
              </h3>
              <p className="text-[14.5px] leading-[1.6] text-[#8A97AC]">
                Your original video is never touched. You edit by ignoring
                sections, and exports create a brand new file.
              </p>
            </SpotlightCard>

            <SpotlightCard className="flex flex-col gap-3.5 rounded-2xl p-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-[#E8EDF6]">
                <Globe className="h-5 w-5" />
              </span>
              <h3 className="mt-2 font-semibold text-[#E8EDF6]">
                Works Anywhere
              </h3>
              <p className="text-[14.5px] leading-[1.6] text-[#8A97AC]">
                Log in from any computer and your transcripts and edits are
                waiting. Just point to the local video file to resume.
              </p>
            </SpotlightCard>

            <SpotlightCard className="flex flex-col gap-3.5 rounded-2xl p-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-[#E8EDF6]">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <h3 className="mt-2 font-semibold text-[#E8EDF6]">
                Totally Private
              </h3>
              <p className="text-[14.5px] leading-[1.6] text-[#8A97AC]">
                We don&apos;t store your video. The video never even uploads —
                only the audio track is sent for transcription.
              </p>
            </SpotlightCard>
          </div>
        </FadeIn>

        {/* Privacy callout */}
        <FadeIn className="mx-auto max-w-[1060px] px-6 py-[70px]">
          <SpotlightCard className="rounded-[32px] p-8 sm:p-14">
            <div className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr] md:gap-14">
              <div className="flex flex-col gap-[18px]">
              <span
                className={`${mono} text-xs tracking-[0.08em] text-[#fffc00]`}
              >
                LOCAL-FIRST
              </span>
              <h2
                className={`${display} text-balance text-[28px] font-bold tracking-[-0.02em] sm:text-[34px] text-white`}
              >
                Your video never leaves your computer
              </h2>
              <p className="text-pretty text-[15.5px] leading-[1.7] text-[#8A97AC]">
                MyFirstCut is local-first. Your footage is opened straight from
                your disk, edited in the browser, and exported back to your
                disk. Only the audio track travels — sent for transcription and
                deleted the moment your transcript is ready. We store your
                words and your edits, never your video.
              </p>

              {/* Disk → cloud → disk flow diagram */}
              <div aria-hidden className="mt-8 flex flex-col items-stretch max-w-sm">
                <div className="flex items-center gap-3.5 rounded-xl border border-[rgba(255,255,255,0.1)] bg-[#0C1322] px-5 py-4">
                  <span className={`${mono} w-[70px] text-xs text-[#5D6B82]`}>
                    DISK
                  </span>
                  <span className="text-sm font-medium">
                    podcast_ep42_take3.mp4 stays put
                  </span>
                </div>
                <div className="flex flex-col items-center self-center py-0.5">
                  <span className="h-3.5 w-px bg-[rgba(255,255,255,0.2)]" />
                  <span
                    className={`${mono} rounded-full border border-[rgba(255,252,0,0.3)] bg-[rgba(255,252,0,0.08)] px-2 py-0.5 text-[10.5px] text-[#fffc00]`}
                  >
                    audio only ⇅
                  </span>
                  <span className="h-3.5 w-px bg-[rgba(255,255,255,0.2)]" />
                </div>
                <div className="flex items-center gap-3.5 rounded-xl border border-[rgba(255,255,255,0.1)] bg-[#0C1322] px-5 py-4">
                  <span className={`${mono} w-[70px] text-xs text-[#5D6B82]`}>
                    CLOUD
                  </span>
                  <span className="text-sm font-medium">
                    transcript in, audio deleted
                  </span>
                </div>
                <div className="flex flex-col items-center self-center py-0.5">
                  <span className="h-7 w-px bg-[rgba(255,255,255,0.2)]" />
                </div>
                <div className="flex items-center gap-3.5 rounded-xl border border-[rgba(255,252,0,0.35)] bg-[rgba(255,252,0,0.07)] px-5 py-4">
                  <span className={`${mono} w-[70px] text-xs text-[#fffc00]`}>
                    DISK
                  </span>
                  <span className="text-sm font-medium text-[#E8EDF6]">
                    final MP4 rendered in-browser
                  </span>
                </div>
              </div>
            </div>

            {/* Illustration: Computer vs Cloud */}
            <div className="flex items-center justify-center p-8 lg:p-0">
              <div className="relative flex aspect-square w-full max-w-[320px] items-center justify-center rounded-[40px] border border-[rgba(255,252,0,0.08)] bg-gradient-to-br from-[rgba(255,252,0,0.03)] to-transparent shadow-[inset_0_0_80px_rgba(255,252,0,0.02)]">
                {/* Dotted connection */}
                <div className="absolute inset-0 flex items-center justify-center -rotate-45">
                  <div className="w-[80%] border-t-[3px] border-dotted border-[#fffc00]/20" />
                </div>
                
                {/* Computer (Local) */}
                <div className="absolute bottom-8 left-8 flex flex-col items-center gap-3">
                  <div className="flex h-[88px] w-[88px] items-center justify-center rounded-2xl border border-[#fffc00]/40 bg-[#fffc00]/10 shadow-[0_0_30px_rgba(255,252,0,0.15)] backdrop-blur-md">
                    <Laptop className="h-11 w-11 text-[#fffc00]" />
                  </div>
                  <span className="text-sm font-bold tracking-wider text-[#fffc00]">LOCAL</span>
                </div>

                {/* Cloud (Blocked) */}
                <div className="absolute right-8 top-8 flex flex-col items-center gap-3">
                  <div className="relative flex h-[88px] w-[88px] items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 shadow-[0_0_30px_rgba(239,68,68,0.1)] backdrop-blur-md">
                    <Cloud className="h-11 w-11 text-red-400" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <X className="h-16 w-16 text-red-500 opacity-80" strokeWidth={2.5} />
                    </div>
                  </div>
                  <span className="text-sm font-bold tracking-wider text-red-400 opacity-80">CLOUD</span>
                </div>
              </div>
            </div>
            </div>
          </SpotlightCard>
        </FadeIn>

        {/* FAQ */}
        <FadeIn id="faq" className="mx-auto max-w-[700px] px-6 py-[90px]">
          <h2
            className={`${display} mb-2.5 text-center text-[32px] font-bold tracking-[-0.02em] sm:text-[40px]`}
          >
            Questions, answered honestly
          </h2>
          <p className="mb-11 text-center text-[15px] text-[#8A97AC]">
            What MyFirstCut does, what it doesn&apos;t, and what to expect before
            you start.
          </p>
          <div className="flex flex-col gap-3">
            {faqs.map((faq, i) => (
              <SpotlightCard key={faq.question} className="rounded-2xl p-0">
                <details
                  name="faq-accordion"
                  open={i === 0}
                  className="group rounded-2xl border border-[rgba(255,255,255,0.05)] bg-[#0A101C] transition-colors open:border-[rgba(255,252,0,0.35)] open:bg-[#111111]"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-[22px] py-[18px] text-left text-[15.5px] font-semibold text-[#E8EDF6] [&::-webkit-details-marker]:hidden">
                    {faq.question}
                    <span className="flex h-[22px] w-[22px] flex-none items-center justify-center text-lg font-normal text-[#5D6B82] transition-transform group-open:rotate-45 group-open:text-[#fffc00]">
                      +
                    </span>
                  </summary>
                  <p className="px-[22px] pb-5 text-[14.5px] leading-[1.7] text-[#8A97AC]">
                    {faq.answer}
                  </p>
                </details>
              </SpotlightCard>
            ))}
          </div>
        </FadeIn>

        {/* Bottom CTA */}
        <FadeIn className="mx-auto max-w-[880px] px-6 py-[100px] text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_320px_at_50%_100%,rgba(255,252,0,0.1),transparent_70%)]"
          />
          <div className="relative flex flex-col items-center gap-[22px]">
            <h2
              className={`${display} text-balance text-[36px] font-extrabold tracking-[-0.025em] sm:text-[52px]`}
            >
              Ready to cut the{" "}
              <span className="text-[#5D6B82] line-through decoration-[rgba(248,113,113,0.7)]">
                dead air
              </span>
              ?
            </h2>
            <Link
              href="/sign-up"
              className="rounded-xl bg-gradient-to-r from-[#fffc00] via-yellow-400 to-[#fffc00] bg-[length:200%_200%] animate-liquid px-8 py-4 text-[16px] font-semibold text-black shadow-[0_0_40px_rgba(255,252,0,0.3)] transition-all hover:scale-105"
            >
              Get Started Free
            </Link>
            <p className={`${mono} text-xs text-[#5D6B82]`}>
              Start transforming your content today.
            </p>
            <p className="text-[12.5px] text-[#3D4A5F]">
              Best in Chrome or Edge — video export needs technology only
              Chromium browsers support today.
            </p>
          </div>
        </FadeIn>
        
        <MarketingFooter />
      </main>

    </div>
  );
}
