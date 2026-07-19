import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SpotlightCard from '@/components/SpotlightCard';
import FadeIn from '@/components/FadeIn';

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

export default function TermsPage() {
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
              Terms of Service
            </h1>
            <p className="text-gray-500 text-xs md:text-sm mt-4">
              Last updated: July 20, 2026
            </p>
          </SpotlightCard>
        </FadeIn>

        <FadeIn>
          <div className="space-y-12">
            <p className="text-gray-400 text-sm md:text-base leading-relaxed">
              These Terms of Service (&quot;Terms&quot;) govern your use of thefoundersframe.com (&quot;the Site&quot;), operated by The Founder&apos;s Frame (&quot;we,&quot; &quot;us,&quot; &quot;our&quot;). By using the Site, you agree to these Terms. Our product apps — MyFirstCut and MyFrameCredits — have their own separate terms covering account use, credits, and billing.
            </p>

            <Section title="1. The Site">
              <p>
                The Site is a marketing and educational resource covering personal branding, content strategy, and mentorship for founders and business owners, along with links to our product suite.
              </p>
            </Section>

            <Section title="2. Mentorship program">
              <p>
                Applications for mentorship are submitted through our application partner (apply.thefoundersframe.com) and reviewed at our discretion. Acceptance into the mentorship program, its scope, and any associated fees are governed by a separate agreement provided at the time of acceptance, not by these Terms.
              </p>
            </Section>

            <Section title="3. Acceptable use">
              <p>You agree not to:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Use the Site for any unlawful purpose or to violate any applicable law.</li>
                <li>Attempt to disrupt, scrape at scale, or gain unauthorized access to the Site or its infrastructure.</li>
                <li>Misrepresent your identity or affiliation when submitting a contact or mentorship inquiry.</li>
              </ul>
            </Section>

            <Section title="4. Intellectual property">
              <p>
                All content on the Site — including text, videos, graphics, and the Founder&apos;s Frame name and logo — is owned by us or our licensors and protected by applicable intellectual property laws. You may not reproduce or redistribute Site content without our permission, beyond normal personal, non-commercial use (e.g. sharing a link).
              </p>
            </Section>

            <Section title="5. Third-party links">
              <p>
                The Site links to our product apps (MyFirstCut, MyFrameCredits) and external services (e.g. our mentorship application partner, social platforms). We aren&apos;t responsible for the content, terms, or privacy practices of those third-party destinations once you leave the Site.
              </p>
            </Section>

            <Section title="6. Disclaimers and limitation of liability">
              <p>
                The Site and its content are provided &quot;as is&quot; without warranties of any kind. Educational and strategy content shared on the Site reflects our own experience and opinions, not guaranteed outcomes. To the fullest extent permitted by law, The Founder&apos;s Frame will not be liable for any indirect, incidental, or consequential damages arising from your use of the Site.
              </p>
            </Section>

            <Section title="7. Changes to these Terms">
              <p>
                We may update these Terms from time to time. If we make material changes, we&apos;ll update the &quot;Last updated&quot; date above. Continued use of the Site after changes take effect constitutes acceptance of the updated Terms.
              </p>
            </Section>

            <Section title="8. Governing law">
              <p>
                These Terms are governed by the laws applicable to The Founder&apos;s Frame&apos;s place of operation, without regard to conflict-of-law principles, unless otherwise required by applicable local law.
              </p>
            </Section>

            <Section title="9. Contact us">
              <p>
                Questions about these Terms? Reach out at{' '}
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
