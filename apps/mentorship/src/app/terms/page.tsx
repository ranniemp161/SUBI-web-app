import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms and Conditions | The Founder's Frame Mentorship",
  description: "Terms and Conditions governing mentorship consulting services provided by The Founder's Frame.",
};

export default function TermsAndConditionsPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="glass-panel p-8 md:p-12 rounded-3xl border border-white/10 space-y-8">
        <header className="border-b border-white/10 pb-6">
          <span className="text-xs font-bold text-yellow-400 uppercase tracking-widest px-3 py-1 rounded-full bg-yellow-400/10 border border-yellow-400/20">
            Legal
          </span>
          <h1 className="text-3xl md:text-4xl font-extrabold text-white mt-4 mb-2">
            Terms and Conditions
          </h1>
          <p className="text-sm text-gray-400">
            The Founder&apos;s Frame • Last Updated: January 15, 2026
          </p>
        </header>

        <section className="space-y-4 text-gray-300 leading-relaxed">
          <h2 className="text-xl font-bold text-white">1. Agreement to Terms</h2>
          <p>
            Welcome to The Founder’s Frame. These Terms and Conditions (&ldquo;Terms&rdquo;) constitute a legally binding agreement between you (&ldquo;Client,&rdquo; &ldquo;you,&rdquo; or &ldquo;your&rdquo;) and The Founder’s Frame (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) regarding your use of our website <strong>thefoundersframe.com</strong> and our mentorship consulting services.
          </p>
          <p>
            By accessing our website, scheduling a consultation, or engaging our services, you agree to be bound by these Terms. If you do not agree with any part of these Terms, you must not use our website or services.
          </p>
        </section>

        <section className="space-y-4 text-gray-300 leading-relaxed">
          <h2 className="text-xl font-bold text-white">2. Services Description</h2>
          <p>
            The Founder’s Frame provides mentorship consulting services to help founders of established, revenue-generating companies build their personal brands on YouTube and LinkedIn. Our services include, but are not limited to:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-gray-300">
            <li>YouTube content strategy and creation guidance</li>
            <li>LinkedIn personal branding consultation</li>
            <li>Video production techniques and best practices</li>
            <li>Storytelling frameworks for founder-led content</li>
            <li>Content planning and scheduling strategies</li>
            <li>Personal brand development coaching</li>
          </ul>
        </section>

        <section className="space-y-4 text-gray-300 leading-relaxed">
          <h2 className="text-xl font-bold text-white">3. Eligibility</h2>
          <p>Our services are intended for:</p>
          <ul className="list-disc pl-6 space-y-2 text-gray-300">
            <li>Founders of established businesses with existing revenue and team momentum</li>
            <li>Individuals who are at least 18 years of age</li>
            <li>Entities with the legal capacity to enter into binding contracts</li>
          </ul>
          <p className="text-red-400 font-medium">
            Our services are not designed for beginners starting from zero, those seeking quick fame or viral hacks, or founders who wish to remain hidden from their audience.
          </p>
        </section>

        <section className="space-y-4 text-gray-300 leading-relaxed">
          <h2 className="text-xl font-bold text-white">4. Consultation and Engagement Process</h2>
          <h3 className="text-lg font-semibold text-yellow-400">4.1 Initial Consultation</h3>
          <p>
            Scheduling a consultation call through our booking system does not guarantee acceptance into our program or create a binding service agreement. Initial consultations are exploratory in nature to determine mutual fit.
          </p>
          <h3 className="text-lg font-semibold text-yellow-400">4.2 Service Agreement &amp; Right to Refuse</h3>
          <p>
            A formal service relationship begins only when both parties execute a service agreement or proposal and any required initial payment has been received. We reserve the right to refuse service to any entity at our discretion.
          </p>
        </section>

        <section className="space-y-4 text-gray-300 leading-relaxed">
          <h2 className="text-xl font-bold text-white">5. Fees and Refund Policy</h2>
          <p>
            Service fees will be communicated during the consultation process or outlined in your individual service agreement. Due to the custom and personalized nature of our executive consulting services, refunds are generally not provided once services have commenced unless explicitly stated in your agreement.
          </p>
        </section>

        <section className="space-y-4 text-gray-300 leading-relaxed">
          <h2 className="text-xl font-bold text-white">6. Client Responsibilities &amp; IP</h2>
          <p>As a client, you agree to:</p>
          <ul className="list-disc pl-6 space-y-2 text-gray-300">
            <li>Provide truthful and accurate information regarding your business and goals.</li>
            <li>Attend scheduled coaching sessions and implement agreed strategies in good faith.</li>
            <li>Respect intellectual property — provided frameworks, scripts, and strategy materials remain the proprietary property of The Founder’s Frame and are licensed for your individual business use only.</li>
          </ul>
        </section>

        <section className="space-y-4 text-gray-300 leading-relaxed">
          <h2 className="text-xl font-bold text-white">7. No Guaranteed Results Disclaimer</h2>
          <div className="p-4 rounded-xl bg-yellow-400/10 border border-yellow-400/30 text-yellow-300">
            <p className="font-semibold mb-1">Important Outcome Notice:</p>
            <p className="text-sm text-gray-300">
              While we are committed to providing high-quality strategic guidance, we cannot and do not guarantee specific monetary outcomes, subscriber growth targets, or viral views. Success depends on numerous external factors including market conditions, execution consistency, platform algorithms, and audience reception.
            </p>
          </div>
        </section>

        <section className="border-t border-white/10 pt-6 text-gray-300 space-y-2">
          <h2 className="text-lg font-bold text-white">8. Contact Information</h2>
          <p>For questions concerning these Terms and Conditions, please contact us at:</p>
          <p className="text-yellow-400 font-mono">contact@thefoundersframe.com</p>
        </section>
      </div>
    </div>
  );
}
