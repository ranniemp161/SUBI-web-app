import { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import SpotlightCard from "@/components/SpotlightCard";
import FadeIn from "@/components/FadeIn";

export const metadata: Metadata = {
  title: "Privacy Policy | Ruff Cut",
  description: "How MyFirstCut collects, uses, and protects your data.",
};

const display = "font-[family-name:var(--font-heading)]";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className={`${display} text-[22px] font-bold text-white`}>
        {title}
      </h2>
      <div className="flex flex-col gap-4 text-[15px] leading-[1.8] text-[#A1A1AA]">
        {children}
      </div>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <div
      className={`flex min-h-screen flex-col overflow-x-hidden bg-[#111111] font-[family-name:var(--font-sans)] text-[var(--color-foreground)] antialiased selection:bg-[#fffc00] selection:text-black`}
    >
      <MarketingHeader />

      <main className="flex flex-1 flex-col pb-24 pt-16">
        <FadeIn className="mx-auto w-full max-w-[800px] px-6">
          <div className="mb-4 flex justify-center">
            <span className="inline-block rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-[#8A97AC]">
              Legal
            </span>
          </div>
          <h1
            className={`${display} mb-4 text-center text-[36px] font-bold leading-[1.15] tracking-tight text-white sm:text-4xl lg:text-[46px]`}
          >
            Privacy Policy
          </h1>
          <p className="mb-16 text-center text-[14px] text-[#5D6B82]">
            Last updated: July 20, 2026
          </p>

          <SpotlightCard className="flex flex-col gap-10 p-8 sm:p-12 rounded-[32px]">
            <p className="text-[15px] leading-[1.8] text-[#A1A1AA]">
              This Privacy Policy explains how The Founder&apos;s Frame
              (&quot;we,&quot; &quot;us,&quot; &quot;our&quot;) collects, uses,
              and protects information when you use MyFirstCut (&quot;the
              Service&quot;), a browser-based rough-cut video editor. By using
              the Service, you agree to the practices described here.
            </p>

            <Section title="1. Information we collect">
              <p>
                <strong className="font-semibold text-white">
                  Account information.
                </strong>{" "}
                When you sign up, our authentication provider (Clerk)
                collects your name, email address, and sign-in credentials.
              </p>
              <p>
                <strong className="font-semibold text-white">
                  Audio from your footage.
                </strong>{" "}
                MyFirstCut never uploads your source video to our servers.
                When you start a project, only the extracted audio track is
                uploaded (directly to our storage provider, Vercel Blob) so
                it can be transcribed. That audio file is deleted as soon as
                transcription completes.
              </p>
              <p>
                <strong className="font-semibold text-white">
                  Transcripts and edit data.
                </strong>{" "}
                The text transcript of your audio, the edit decision list
                (EDL) you create, and related project metadata (titles,
                timestamps, cut points) are stored so your project persists
                across sessions.
              </p>
              <p>
                <strong className="font-semibold text-white">
                  Usage and billing data.
                </strong>{" "}
                We record credit/token balances and usage events (e.g.
                minutes transcribed, AI Cut runs) tied to your account so we
                can bill accurately through our wallet app.
              </p>
            </Section>

            <Section title="2. How we use your information">
              <p>
                We use the information above to operate the Service: to
                authenticate you, transcribe and process your audio, generate
                AI-assisted cut suggestions, maintain your saved projects,
                meter and bill usage, and communicate with you about your
                account (e.g. transactional emails).
              </p>
              <p>
                We do not sell your personal information, and we do not use
                your footage, audio, or transcripts to train third-party
                models beyond what is required to generate results for your
                own project.
              </p>
            </Section>

            <Section title="3. Third-party service providers">
              <p>
                We rely on the following processors to run the Service, each
                bound by their own privacy and security terms:
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong className="font-semibold text-white">Clerk</strong>{" "}
                  — authentication and account management.
                </li>
                <li>
                  <strong className="font-semibold text-white">
                    Vercel Blob
                  </strong>{" "}
                  — temporary storage for extracted audio, deleted after
                  transcription.
                </li>
                <li>
                  <strong className="font-semibold text-white">
                    Deepgram
                  </strong>{" "}
                  — speech-to-text transcription of your audio.
                </li>
                <li>
                  <strong className="font-semibold text-white">
                    Google Gemini
                  </strong>{" "}
                  — AI-assisted cut suggestions generated from your
                  transcript.
                </li>
                <li>
                  <strong className="font-semibold text-white">
                    Stripe
                  </strong>{" "}
                  — payment processing for credits, handled through our
                  wallet app.
                </li>
                <li>
                  <strong className="font-semibold text-white">Pusher</strong>{" "}
                  — real-time status updates (e.g. &quot;transcription
                  ready&quot;) for your open project.
                </li>
                <li>
                  <strong className="font-semibold text-white">Sentry</strong>{" "}
                  — error monitoring, to help us diagnose and fix bugs.
                </li>
              </ul>
            </Section>

            <Section title="4. Your video never leaves your device">
              <p>
                MyFirstCut is built so your raw video file is processed
                entirely in your browser. Only the extracted audio is
                transmitted for transcription, and that upload is deleted
                once transcription finishes. Reopening a project later
                requires you to reselect your original source file locally —
                we don&apos;t keep a server-side copy of your video at any
                point.
              </p>
            </Section>

            <Section title="5. Data retention">
              <p>
                Account information, transcripts, EDL/project data, and usage
                records are retained for as long as your account is active,
                or as needed to provide the Service and comply with legal
                obligations. Extracted audio is deleted immediately after
                transcription, as described above. You can request deletion
                of your account and associated data at any time by contacting
                us.
              </p>
            </Section>

            <Section title="6. Cookies">
              <p>
                We use essential cookies for authentication (via Clerk) and
                session management. We do not use third-party advertising
                cookies.
              </p>
            </Section>

            <Section title="7. Your rights">
              <p>
                Depending on your location, you may have the right to access,
                correct, export, or delete your personal information. To
                exercise any of these rights, contact us using the details
                below.
              </p>
            </Section>

            <Section title="8. Changes to this policy">
              <p>
                We may update this Privacy Policy from time to time. If we
                make material changes, we&apos;ll update the &quot;Last
                updated&quot; date above and, where appropriate, notify you
                directly.
              </p>
            </Section>

            <Section title="9. Contact us">
              <p>
                Questions about this Privacy Policy? Reach out at{" "}
                <a
                  href="mailto:legal@thefoundersframe.com"
                  className="text-[#fffc00] hover:underline"
                >
                  legal@thefoundersframe.com
                </a>
                .
              </p>
            </Section>
          </SpotlightCard>

          <p className="mt-8 text-center text-[14px] text-[#5D6B82]">
            See also our{" "}
            <Link href="/terms" className="text-[#fffc00] hover:underline">
              Terms of Service
            </Link>
            .
          </p>
        </FadeIn>
      </main>

      <MarketingFooter />
    </div>
  );
}
