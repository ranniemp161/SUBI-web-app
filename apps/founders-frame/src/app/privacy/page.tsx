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

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 pl-4 border-l-2 border-brand/30 my-4">
      <h3 className="font-semibold text-base md:text-lg text-gray-200">{title}</h3>
      <div className="space-y-2 text-gray-400 text-sm md:text-base leading-relaxed">
        {children}
      </div>
    </div>
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
              Last Updated: January 15, 2026
            </p>
          </SpotlightCard>
        </FadeIn>

        <FadeIn>
          <div className="space-y-12">
            <Section title="Introduction">
              <p>
                Welcome to The Founder’s Frame (“we,” “our,” or “us”). We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website thefoundersframe.com and use our services.
              </p>
              <p>
                Please read this privacy policy carefully. If you do not agree with the terms of this privacy policy, please do not access the site.
              </p>
            </Section>

            <Section title="Information We Collect">
              <SubSection title="Information You Provide to Us">
                <p>
                  We collect personal information that you voluntarily provide to us when you:
                </p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Fill out contact forms on our website</li>
                  <li>Schedule a consultation call through Calendly</li>
                  <li>Subscribe to our email list</li>
                  <li>Communicate with us via email at contact@thefoundersframe.com</li>
                </ul>
                <p className="mt-2">The personal information we collect may include:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Name</li>
                  <li>Email address</li>
                  <li>Phone number</li>
                  <li>Company name</li>
                  <li>Business information</li>
                  <li>Any other information you choose to provide</li>
                </ul>
              </SubSection>

              <SubSection title="Information Automatically Collected">
                <p>
                  When you visit our website, we automatically collect certain information about your device and browsing behavior through:
                </p>

                <div className="space-y-3 mt-3">
                  <p>
                    <strong className="text-white font-semibold">Google Analytics:</strong> We use Google Analytics to understand how visitors interact with our website. This includes:
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>IP address (anonymized)</li>
                    <li>Browser type and version</li>
                    <li>Pages visited and time spent on pages</li>
                    <li>Referring website</li>
                    <li>Device information (type, operating system)</li>
                    <li>Geographic location (city/country level)</li>
                  </ul>

                  <p className="pt-2">
                    <strong className="text-white font-semibold">Meta Pixel (Facebook Pixel):</strong> We use Meta Pixel to track conversions, optimize ads, and build targeted audiences. This includes:
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>Pages visited</li>
                    <li>Actions taken on our website</li>
                    <li>Device and browser information</li>
                    <li>Custom events we’ve configured</li>
                  </ul>

                  <p className="pt-2">
                    <strong className="text-white font-semibold">Cookies:</strong> We use cookies and similar tracking technologies to track activity on our website and hold certain information. You can instruct your browser to refuse all cookies or to indicate when a cookie is being sent.
                  </p>
                </div>
              </SubSection>
            </Section>

            <Section title="How We Use Your Information">
              <p>We use the information we collect or receive to:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong className="text-white font-semibold">Provide and improve our services:</strong> Schedule consultations, respond to inquiries, and deliver the mentorship consulting services you’ve requested
                </li>
                <li>
                  <strong className="text-white font-semibold">Communicate with you:</strong> Send you information about our services, updates, and marketing communications via email
                </li>
                <li>
                  <strong className="text-white font-semibold">Analyze and optimize:</strong> Understand how visitors use our website to improve user experience
                </li>
                <li>
                  <strong className="text-white font-semibold">Marketing and advertising:</strong> Show you relevant ads on Facebook and Instagram through Meta Pixel, and measure the effectiveness of our marketing campaigns
                </li>
                <li>
                  <strong className="text-white font-semibold">Comply with legal obligations:</strong> Meet any applicable legal requirements and respond to legal requests
                </li>
              </ul>
            </Section>

            <Section title="Email Marketing">
              <p>
                When you provide your email address, we may send you marketing emails about our services, content, and offers. You have the right to opt out of marketing communications at any time by:
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Clicking the “unsubscribe” link at the bottom of any marketing email</li>
                <li>
                  Contacting us at{' '}
                  <a href="mailto:contact@thefoundersframe.com" className="text-brand hover:underline">contact@thefoundersframe.com</a>{' '}
                  with your request
                </li>
              </ul>
              <p>
                We will never share, sell, or rent your email address to third parties for their marketing purposes.
              </p>
            </Section>

            <Section title="How We Share Your Information">
              <p>We do not sell, trade, or rent your personal information to third parties.</p>
              <p>
                We may share your information with third-party service providers who perform services on our behalf, including:
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li><strong className="text-white font-semibold">Calendly:</strong> For scheduling consultation calls</li>
                <li><strong className="text-white font-semibold">Google Analytics:</strong> For website analytics and performance tracking</li>
                <li><strong className="text-white font-semibold">Meta (Facebook/Instagram):</strong> For advertising and marketing purposes through Meta Pixel</li>
                <li><strong className="text-white font-semibold">Email service providers:</strong> For sending marketing and transactional emails</li>
              </ul>
              <p>
                These service providers are contractually obligated to use your information only to provide services to us and are required to protect your information.
              </p>
              <p>We may also disclose your information:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>To comply with legal obligations, court orders, or government requests</li>
                <li>To protect our rights, property, or safety, or that of others</li>
                <li>In connection with a business transaction (merger, acquisition, or sale)</li>
              </ul>
            </Section>

            <Section title="Third-Party Services">
              <p>Our website integrates with third-party services that have their own privacy policies:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  Calendly:{' '}
                  <a href="https://calendly.com/privacy" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">https://calendly.com/privacy</a>
                </li>
                <li>
                  Google Analytics:{' '}
                  <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">https://policies.google.com/privacy</a>
                </li>
                <li>
                  Meta (Facebook):{' '}
                  <a href="https://www.facebook.com/privacy/explanation" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">https://www.facebook.com/privacy/explanation</a>
                </li>
              </ul>
              <p>We encourage you to review the privacy policies of these third-party services.</p>
            </Section>

            <Section title="Cookies and Tracking Technologies">
              <p>We use cookies and similar tracking technologies including:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li><strong className="text-white font-semibold">Essential Cookies:</strong> Necessary for the website to function properly</li>
                <li><strong className="text-white font-semibold">Analytics Cookies:</strong> Google Analytics cookies that help us understand how visitors use our site</li>
                <li><strong className="text-white font-semibold">Marketing Cookies:</strong> Meta Pixel that helps us deliver relevant advertisements and measure campaign performance</li>
              </ul>
            </Section>

            <Section title="Managing Cookies">
              <p>Most web browsers allow you to control cookies through their settings. You can:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Delete existing cookies</li>
                <li>Block future cookies</li>
                <li>Receive warnings before cookies are stored</li>
              </ul>
              <p>Note that disabling cookies may affect the functionality of our website.</p>
              <p>
                To opt out of Google Analytics tracking, visit:{' '}
                <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">https://tools.google.com/dlpage/gaoptout</a>
              </p>
              <p>
                To opt out of Meta Pixel tracking, visit your Facebook ad preferences:{' '}
                <a href="https://www.facebook.com/ads/preferences" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">https://www.facebook.com/ads/preferences</a>
              </p>
            </Section>

            <Section title="Data Security">
              <p>
                We implement appropriate technical and organizational security measures to protect your personal information from unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the internet or electronic storage is 100% secure, and we cannot guarantee absolute security.
              </p>
            </Section>

            <Section title="Data Retention">
              <p>
                We retain your personal information only for as long as necessary to fulfill the purposes outlined in this privacy policy, unless a longer retention period is required or permitted by law. When you unsubscribe from our email list, we will remove your email address from our active marketing database.
              </p>
            </Section>

            <Section title="Your Privacy Rights">
              <p>Depending on your location, you may have certain rights regarding your personal information, including:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li><strong className="text-white font-semibold">Access:</strong> Request a copy of the personal information we hold about you</li>
                <li><strong className="text-white font-semibold">Correction:</strong> Request correction of inaccurate or incomplete information</li>
                <li><strong className="text-white font-semibold">Deletion:</strong> Request deletion of your personal information</li>
                <li><strong className="text-white font-semibold">Opt-out:</strong> Unsubscribe from marketing communications at any time</li>
                <li><strong className="text-white font-semibold">Object:</strong> Object to our processing of your personal information</li>
                <li><strong className="text-white font-semibold">Data portability:</strong> Request transfer of your information to another service</li>
              </ul>
              <p>
                To exercise any of these rights, please contact us at{' '}
                <a href="mailto:contact@thefoundersframe.com" className="text-brand hover:underline">contact@thefoundersframe.com</a>.
              </p>
            </Section>

            <Section title="Children’s Privacy">
              <p>
                Our services are not directed to individuals under the age of 18. We do not knowingly collect personal information from children. If you are a parent or guardian and believe your child has provided us with personal information, please contact us, and we will delete such information.
              </p>
            </Section>

            <Section title="International Data Transfers">
              <p>
                Your information may be transferred to and processed in countries other than your country of residence. These countries may have different data protection laws. By using our website and services, you consent to the transfer of your information to these countries.
              </p>
            </Section>

            <Section title="Changes to This Privacy Policy">
              <p>
                We may update this privacy policy from time to time. We will notify you of any changes by posting the new privacy policy on this page and updating the “Last Updated” date. We encourage you to review this privacy policy periodically for any changes.
              </p>
            </Section>

            <Section title="Contact Us">
              <p>If you have any questions, concerns, or requests regarding this privacy policy or our data practices, please contact us:</p>
              <p className="pl-4">
                Email:{' '}
                <a href="mailto:contact@thefoundersframe.com" className="text-brand hover:underline">contact@thefoundersframe.com</a>
                <br />
                Website:{' '}
                <a href="https://thefoundersframe.com" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">thefoundersframe.com</a>
              </p>
              <p className="mt-4 text-gray-300 font-medium">
                By using The Founder’s Frame website and services, you acknowledge that you have read and understood this Privacy Policy.
              </p>
            </Section>
          </div>
        </FadeIn>
      </div>

      <Footer />
    </main>
  );
}
