import type { Metadata } from "next";
import FadeIn from "@/components/FadeIn";

export const metadata: Metadata = {
  title: "Privacy Policy | The Founder's Frame Mentorship",
  description: "Privacy Policy for The Founder's Frame mentorship consulting services and website.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="relative overflow-hidden z-0 max-w-4xl mx-auto px-6 py-12">
      {/* AMBIENT FIXED GRADIENTS */}
      <div className="fixed top-[-20%] left-[-10%] w-[600px] h-[600px] bg-yellow-400/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-yellow-400/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />

      {/* FLOATING ABSTRACT BOXES */}
      <div className="absolute inset-0 pointer-events-none z-[-1] overflow-hidden opacity-60">
        <div className="absolute top-[15%] left-[4%] w-32 h-32 border border-white/10 rounded-2xl rotate-12 shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-br from-white/5 to-transparent animate-float" />
        <div className="absolute top-[65%] right-[5%] w-44 h-44 border border-white/10 rounded-3xl -rotate-[15deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-tl from-white/5 to-transparent animate-float-delayed" />
      </div>

      <FadeIn>
        <div className="glass-panel p-8 md:p-12 rounded-3xl border border-white/10 space-y-8 relative z-10">
          <header className="border-b border-white/10 pb-6">
            <span className="text-xs font-bold text-yellow-400 uppercase tracking-widest px-3 py-1 rounded-full bg-yellow-400/10 border border-yellow-400/20">
              Legal
            </span>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white mt-4 mb-2">
              Privacy Policy
            </h1>
            <p className="text-sm text-gray-400">
              The Founder&apos;s Frame • Last Updated: January 15, 2026
            </p>
          </header>

          <section className="space-y-4 text-gray-300 leading-relaxed">
            <h2 className="text-xl font-bold text-white">1. Introduction</h2>
            <p>
              Welcome to The Founder’s Frame (“we,” “our,” or “us”). We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website <strong>thefoundersframe.com</strong> and use our mentorship services.
            </p>
            <p>
              Please read this privacy policy carefully. If you do not agree with the terms of this privacy policy, please do not access the site or submit your personal information.
            </p>
          </section>

          <section className="space-y-4 text-gray-300 leading-relaxed">
            <h2 className="text-xl font-bold text-white">2. Information We Collect</h2>

            <h3 className="text-lg font-semibold text-yellow-400">Information You Provide to Us</h3>
            <p>We collect personal information that you voluntarily provide to us when you:</p>
            <ul className="list-disc pl-6 space-y-2 text-gray-300">
              <li>Fill out contact forms on our website</li>
              <li>Schedule a consultation call through Calendly</li>
              <li>Subscribe to our email list</li>
              <li>Communicate with us via email at <strong>contact@thefoundersframe.com</strong></li>
            </ul>

            <p>The personal information we collect may include:</p>
            <ul className="list-disc pl-6 space-y-1 text-gray-300">
              <li>Name</li>
              <li>Email address</li>
              <li>Phone number</li>
              <li>Company name</li>
              <li>Business &amp; revenue details</li>
              <li>Any other information you choose to provide</li>
            </ul>

            <h3 className="text-lg font-semibold text-yellow-400 pt-4">Information Automatically Collected</h3>
            <p>When you visit our website, we automatically collect certain information about your device and browsing behavior through:</p>
            <ul className="list-disc pl-6 space-y-2 text-gray-300">
              <li><strong>Google Analytics:</strong> Device IP, browser type, pages visited, referring URLs, time spent, and city/country location metrics.</li>
              <li><strong>Meta Pixel (Facebook Pixel):</strong> Actions taken on our website, page conversion tracking, and custom event telemetry.</li>
              <li><strong>Cookies:</strong> Small data tokens stored on your browser to optimize user experience.</li>
            </ul>
          </section>

          <section className="space-y-4 text-gray-300 leading-relaxed">
            <h2 className="text-xl font-bold text-white">3. How We Use Your Information</h2>
            <p>We use the information we collect or receive to:</p>
            <ul className="list-disc pl-6 space-y-2 text-gray-300">
              <li>Provide and improve our mentorship services and schedule exploratory consultations.</li>
              <li>Communicate with you regarding program updates, service offerings, and transactional notices.</li>
              <li>Analyze website performance and optimize user navigation experience.</li>
              <li>Deliver relevant advertising across platforms via Meta Pixel and track campaign efficiency.</li>
              <li>Comply with applicable legal obligations and safety regulations.</li>
            </ul>
          </section>

          <section className="space-y-4 text-gray-300 leading-relaxed">
            <h2 className="text-xl font-bold text-white">4. Email Marketing &amp; Opt-Out</h2>
            <p>
              When you submit your contact information, we may send you marketing communications regarding founder strategy, content frameworks, and program availability. You may opt out at any time by clicking the &ldquo;unsubscribe&rdquo; link at the bottom of any email or contacting us directly at <strong>contact@thefoundersframe.com</strong>.
            </p>
            <p className="text-yellow-400 font-medium">
              We will never sell, rent, or lease your email address or business information to third parties.
            </p>
          </section>

          <section className="space-y-4 text-gray-300 leading-relaxed">
            <h2 className="text-xl font-bold text-white">5. Third-Party Service Providers</h2>
            <p>We share data with trusted service providers strictly to operate our business, including:</p>
            <ul className="list-disc pl-6 space-y-2 text-gray-300">
              <li><strong>Calendly:</strong> Consultation scheduling (<a href="https://calendly.com/privacy" target="_blank" rel="noopener noreferrer" className="text-yellow-400 underline">Privacy Policy</a>)</li>
              <li><strong>Google Analytics:</strong> Website metrics (<a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-yellow-400 underline">Privacy Policy</a>)</li>
              <li><strong>Meta (Facebook/Instagram):</strong> Advertising analytics (<a href="https://www.facebook.com/privacy/explanation" target="_blank" rel="noopener noreferrer" className="text-yellow-400 underline">Privacy Policy</a>)</li>
            </ul>
          </section>

          <section className="space-y-4 text-gray-300 leading-relaxed">
            <h2 className="text-xl font-bold text-white">6. Managing Cookies</h2>
            <p>
              You can configure your browser settings to refuse or delete cookies at any time. Note that disabling certain essential cookies may impact specific website features.
            </p>
          </section>

          <section className="border-t border-white/10 pt-6 text-gray-300 space-y-2">
            <h2 className="text-lg font-bold text-white">7. Contact Us</h2>
            <p>If you have any questions about this Privacy Policy, please reach out to us at:</p>
            <p className="text-yellow-400 font-mono">contact@thefoundersframe.com</p>
          </section>
        </div>
      </FadeIn>
    </div>
  );
}
