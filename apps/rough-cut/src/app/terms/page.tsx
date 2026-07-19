import { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import SpotlightCard from "@/components/SpotlightCard";
import FadeIn from "@/components/FadeIn";
import { WALLET_URL } from "@/lib/env";

export const metadata: Metadata = {
  title: "Terms of Service | Ruff Cut",
  description: "The terms that govern your use of MyFirstCut.",
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

export default function TermsPage() {
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
            Terms of Service
          </h1>
          <p className="mb-16 text-center text-[14px] text-[#5D6B82]">
            Last updated: July 20, 2026
          </p>

          <SpotlightCard className="flex flex-col gap-10 p-8 sm:p-12 rounded-[32px]">
            <p className="text-[15px] leading-[1.8] text-[#A1A1AA]">
              These Terms of Service (&quot;Terms&quot;) govern your use of
              MyFirstCut (&quot;the Service&quot;), operated by The
              Founder&apos;s Frame (&quot;we,&quot; &quot;us,&quot;
              &quot;our&quot;). By creating an account or using the Service,
              you agree to these Terms. If you do not agree, do not use the
              Service.
            </p>

            <Section title="1. The Service">
              <p>
                MyFirstCut is a browser-based, AI-assisted rough-cut video
                editor. You upload or select raw footage locally; only the
                extracted audio is sent to our infrastructure for
                transcription, and it is deleted once transcription
                completes. Editing, cutting, and export happen in your
                browser.
              </p>
            </Section>

            <Section title="2. Accounts">
              <p>
                You must create an account (via our authentication provider,
                Clerk) to use the Service. You&apos;re responsible for
                keeping your credentials secure and for all activity under
                your account. You must be at least 18 years old, or the age
                of majority in your jurisdiction, to use the Service.
              </p>
            </Section>

            <Section title="3. Credits and billing">
              <p>
                Transcription, AI Cut, and related features are metered and
                paid for using credits managed through our companion wallet
                app (
                <a
                  href={WALLET_URL}
                  className="text-[#fffc00] hover:underline"
                >
                  {WALLET_URL.replace(/^https?:\/\//, "")}
                </a>
                ), processed via Stripe. Credits are consumed as you use
                metered features; pricing and bundle sizes are shown at time
                of purchase and may change going forward. Credits are
                generally non-refundable except where required by law or
                stated otherwise at purchase.
              </p>
            </Section>

            <Section title="4. Acceptable use">
              <p>You agree not to use the Service to:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  Upload, transcribe, or process content you don&apos;t have
                  the rights to use.
                </li>
                <li>
                  Attempt to disrupt, reverse-engineer, or gain unauthorized
                  access to the Service or its infrastructure.
                </li>
                <li>
                  Use the Service to generate or distribute unlawful,
                  infringing, or harmful content.
                </li>
                <li>
                  Circumvent rate limits, credit metering, or other technical
                  restrictions.
                </li>
              </ul>
            </Section>

            <Section title="5. Your content">
              <p>
                You retain all ownership rights to your footage, audio,
                transcripts, and any cuts or exports you create with the
                Service. We claim no ownership over your content. You grant
                us only the limited rights necessary to process your audio
                (e.g. transcription, AI cut suggestions) in order to provide
                the Service to you.
              </p>
            </Section>

            <Section title="6. AI-generated suggestions">
              <p>
                Transcripts and AI Cut suggestions are generated using
                third-party AI models (Deepgram, Google Gemini) and may
                contain errors. You are responsible for reviewing any
                AI-generated suggestion before relying on or publishing the
                resulting edit.
              </p>
            </Section>

            <Section title="7. Termination">
              <p>
                You may stop using the Service and close your account at any
                time. We may suspend or terminate your access if you violate
                these Terms, misuse the Service, or if required by law. Upon
                termination, your right to use the Service ends immediately;
                sections that by their nature should survive (e.g. content
                ownership, limitation of liability) will continue to apply.
              </p>
            </Section>

            <Section title="8. Disclaimers and limitation of liability">
              <p>
                The Service is provided &quot;as is&quot; without warranties
                of any kind, express or implied. To the fullest extent
                permitted by law, The Founder&apos;s Frame will not be liable
                for any indirect, incidental, or consequential damages
                arising from your use of the Service, including loss of data
                or content resulting from browser crashes, lost local files,
                or third-party service outages.
              </p>
            </Section>

            <Section title="9. Changes to these Terms">
              <p>
                We may update these Terms from time to time. If we make
                material changes, we&apos;ll update the &quot;Last
                updated&quot; date above and, where appropriate, notify you
                directly. Continued use of the Service after changes take
                effect constitutes acceptance of the updated Terms.
              </p>
            </Section>

            <Section title="10. Governing law">
              <p>
                These Terms are governed by the laws applicable to The
                Founder&apos;s Frame&apos;s place of operation, without
                regard to conflict-of-law principles, unless otherwise
                required by applicable local law.
              </p>
            </Section>

            <Section title="11. Contact us">
              <p>
                Questions about these Terms? Reach out at{" "}
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
            <Link href="/privacy" className="text-[#fffc00] hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </FadeIn>
      </main>

      <MarketingFooter />
    </div>
  );
}
