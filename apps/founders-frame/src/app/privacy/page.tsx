import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SpotlightCard from '@/components/SpotlightCard';
import FadeIn from '@/components/FadeIn';
import { env } from '@/lib/env';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-heading font-bold text-xl md:text-2xl text-white">{title}</h2>
      <div className="space-y-4 text-gray-400 text-sm md:text-base leading-relaxed">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#0c0c0e] text-white font-sans overflow-x-hidden selection:bg-brand/30 relative z-0">
      <div className="fixed top-[-20%] left-[-10%] w-[600px] h-[600px] bg-brand/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-brand/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />

      <Navbar />

      <div className="max-w-3xl mx-auto pt-32 pb-24 px-6">
        <FadeIn>
          <SpotlightCard className="glass-panel p-8 md:p-12 text-center relative overflow-hidden mb-16">
            <h4 className="text-brand font-semibold text-[10px] md:text-xs tracking-widest uppercase mb-4">
              Legal
            </h4>
            <h1 className="text-4xl md:text-5xl font-heading font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent pb-1 leading-tight">
              Privacy Policy
            </h1>
            <p className="text-gray-500 text-xs md:text-sm mt-4">
              Last updated: July 20, 2026
            </p>
          </SpotlightCard>
        </FadeIn>

        <FadeIn>
          <div className="space-y-12">
            <p className="text-gray-400 text-sm md:text-base leading-relaxed">
              This Privacy Policy explains how The Founder&apos;s Frame (&quot;we,&quot; &quot;us,&quot; &quot;our&quot;) collects and uses information when you visit thefoundersframe.com and its related pages (&quot;the Site&quot;). It does not cover our product apps — MyFirstCut and MyFrameCredits each have their own privacy policy covering the data they process.
            </p>

            <Section title="1. Information we collect">
              <p>
                <strong className="font-semibold text-white">Contact and mentorship inquiries.</strong> If you apply for mentorship or reach out through a contact form, we collect the information you provide, such as your name, email address, and message.
              </p>
              <p>
                <strong className="font-semibold text-white">Newsletter signup.</strong> If you subscribe for updates, we collect your email address to send you updates.
              </p>
              <p>
                <strong className="font-semibold text-white">Basic usage data.</strong> Like most websites, we may collect standard technical data (e.g. browser type, pages visited) through analytics tools to understand how the Site is used.
              </p>
            </Section>

            <Section title="2. How we use your information">
              <p>
                We use this information to respond to inquiries, evaluate mentorship applications, send newsletter updates you&apos;ve opted into, and improve the Site. We do not sell your personal information.
              </p>
            </Section>

            <Section title="3. Third-party services">
              <p>
                Mentorship applications are handled through our application partner at apply.thefoundersframe.com. If you click through to MyFirstCut (
                <a href={env.NEXT_PUBLIC_ROUGH_CUT_APP_URL} className="text-brand hover:underline">{env.NEXT_PUBLIC_ROUGH_CUT_APP_URL.replace(/^https?:\/\//, '')}</a>
                ) or MyFrameCredits (
                <a href={env.NEXT_PUBLIC_WALLET_APP_URL} className="text-brand hover:underline">{env.NEXT_PUBLIC_WALLET_APP_URL.replace(/^https?:\/\//, '')}</a>
                ), you leave this Site and those apps&apos; own privacy policies apply to any account, video, or billing data you provide there.
              </p>
            </Section>

            <Section title="4. Cookies">
              <p>
                We use essential cookies to run the Site and, where enabled, lightweight analytics cookies to understand traffic. We do not use third-party advertising cookies.
              </p>
            </Section>

            <Section title="5. Data retention">
              <p>
                We keep contact and mentorship inquiry data for as long as needed to respond to you and, if you become a mentee, for the duration of that relationship. You can ask us to delete your data at any time.
              </p>
            </Section>

            <Section title="6. Your rights">
              <p>
                Depending on your location, you may have the right to access, correct, or delete the personal information we hold about you. Contact us using the details below to exercise these rights.
              </p>
            </Section>

            <Section title="7. Changes to this policy">
              <p>
                We may update this Privacy Policy from time to time. If we make material changes, we&apos;ll update the &quot;Last updated&quot; date above.
              </p>
            </Section>

            <Section title="8. Contact us">
              <p>
                Questions about this Privacy Policy? Reach out at{' '}
                <a href="mailto:legal@thefoundersframe.com" className="text-brand hover:underline">legal@thefoundersframe.com</a>.
              </p>
            </Section>
          </div>
        </FadeIn>
      </div>

      <Footer />
    </main>
  );
}
