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
              Terms and Conditions
            </h1>
            <p className="text-gray-500 text-xs md:text-sm mt-4">
              Last Updated: January 15, 2026
            </p>
          </SpotlightCard>
        </FadeIn>

        <FadeIn>
          <div className="space-y-12">
            <Section title="1. Agreement to Terms">
              <p>
                Welcome to The Founder’s Frame. These Terms and Conditions (“Terms”) constitute a legally binding agreement between you (“Client,” “you,” or “your”) and The Founder’s Frame (“we,” “us,” or “our”) regarding your use of our website thefoundersframe.com and our mentorship consulting services.
              </p>
              <p>
                By accessing our website, scheduling a consultation, or engaging our services, you agree to be bound by these Terms. If you do not agree with any part of these Terms, you must not use our website or services.
              </p>
            </Section>

            <Section title="2. Services Description">
              <p>
                The Founder’s Frame provides mentorship consulting services to help founders of established, revenue-generating companies build their personal brands on YouTube and LinkedIn. Our services include, but are not limited to:
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li>YouTube content strategy and creation guidance</li>
                <li>LinkedIn personal branding consultation</li>
                <li>Video production techniques and best practices</li>
                <li>Storytelling frameworks for founder-led content</li>
                <li>Content planning and scheduling strategies</li>
                <li>Personal brand development coaching</li>
              </ul>
              <p>
                The specific scope of services will be outlined in individual service agreements or proposals.
              </p>
            </Section>

            <Section title="3. Eligibility">
              <p>Our services are intended for:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Founders of established businesses with existing revenue</li>
                <li>Business owners with teams or plans to build teams</li>
                <li>Individuals who are at least 18 years of age</li>
                <li>Entities with the legal capacity to enter into binding contracts</li>
              </ul>
              <p>
                Our services are not designed for beginners starting from zero, those seeking quick fame or hacks, or founders who wish to remain hidden from their audience.
              </p>
            </Section>

            <Section title="4. Consultation and Engagement Process">
              <SubSection title="4.1 Initial Consultation">
                <p>
                  Scheduling a consultation call through our Calendly booking system does not guarantee acceptance into our program or create a binding service agreement. Initial consultations are exploratory in nature to determine mutual fit.
                </p>
              </SubSection>

              <SubSection title="4.2 Service Agreement">
                <p>A formal service relationship begins only when:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Both parties have agreed to specific terms, scope, and pricing</li>
                  <li>Any required payment or deposit has been received</li>
                  <li>A written service agreement or proposal has been executed (if applicable)</li>
                </ul>
              </SubSection>

              <SubSection title="4.3 Right to Refuse Service">
                <p>
                  We reserve the right to refuse service to any individual or entity for any reason, including but not limited to:
                </p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Misalignment with our service offerings</li>
                  <li>Concerns about the ability to deliver results</li>
                  <li>Behavior that violates our professional standards</li>
                </ul>
              </SubSection>
            </Section>

            <Section title="5. Fees and Payment">
              <SubSection title="5.1 Pricing">
                <p>
                  Service fees will be communicated during the consultation process or outlined in your service agreement. Prices are subject to change, but any agreed-upon pricing will be honored for the duration of the service period.
                </p>
              </SubSection>

              <SubSection title="5.2 Payment Terms">
                <p>Payment terms will be specified in your service agreement and may include:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Upfront payment in full</li>
                  <li>Deposit with installment payments</li>
                  <li>Monthly retainer arrangements</li>
                </ul>
              </SubSection>

              <SubSection title="5.3 Late Payment">
                <p>Late payments may result in:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Suspension of services until payment is received</li>
                  <li>Late fees as specified in your service agreement</li>
                  <li>Termination of the service relationship</li>
                </ul>
              </SubSection>

              <SubSection title="5.4 Refund Policy">
                <p>
                  Due to the personalized nature of our consulting services, refunds are generally not provided once services have commenced. Specific refund terms, if any, will be outlined in your individual service agreement.
                </p>
              </SubSection>
            </Section>

            <Section title="6. Client Responsibilities">
              <p>As a client, you agree to:</p>

              <SubSection title="6.1 Provide Accurate Information">
                <ul className="list-disc space-y-2 pl-5">
                  <li>Supply truthful and accurate information about your business, goals, and circumstances</li>
                  <li>Notify us promptly of any changes that may affect our ability to deliver services</li>
                </ul>
              </SubSection>

              <SubSection title="6.2 Active Participation">
                <ul className="list-disc space-y-2 pl-5">
                  <li>Attend scheduled calls and meetings</li>
                  <li>Complete any assigned tasks or homework</li>
                  <li>Implement recommendations in good faith</li>
                  <li>Communicate openly about challenges and progress</li>
                </ul>
              </SubSection>

              <SubSection title="6.3 Respect Intellectual Property">
                <ul className="list-disc space-y-2 pl-5">
                  <li>Not record, reproduce, or distribute our proprietary materials without written permission</li>
                  <li>Use provided frameworks, templates, and strategies only for your own business</li>
                </ul>
              </SubSection>

              <SubSection title="6.4 Professional Conduct">
                <ul className="list-disc space-y-2 pl-5">
                  <li>Treat our team with respect and professionalism</li>
                  <li>Provide reasonable notice for scheduling changes</li>
                  <li>Communicate in a timely manner regarding questions or concerns</li>
                </ul>
              </SubSection>
            </Section>

            <Section title="7. Our Responsibilities and Limitations">
              <SubSection title="7.1 Professional Service">
                <p>
                  We will provide services with reasonable care and skill, based on our expertise and experience in personal branding and content creation for founders.
                </p>
              </SubSection>

              <SubSection title="7.2 No Guaranteed Results">
                <p>
                  <strong className="text-white">Important:</strong> While we are committed to providing high-quality guidance and support, we cannot and do not guarantee specific outcomes, including but not limited to:
                </p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Specific subscriber or follower growth numbers</li>
                  <li>Revenue increases or business growth metrics</li>
                  <li>Viral content or guaranteed audience engagement</li>
                  <li>Any particular return on investment</li>
                </ul>
                <p>
                  Success depends on numerous factors outside our control, including your implementation, market conditions, platform algorithm changes, audience preferences, and external circumstances.
                </p>
              </SubSection>

              <SubSection title="7.3 Not Professional Advice">
                <p>Our services constitute business coaching and mentorship. We are not:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Legal advisors (consult an attorney for legal matters)</li>
                  <li>Financial advisors (consult a financial professional for investment advice)</li>
                  <li>Tax advisors (consult a tax professional for tax matters)</li>
                  <li>Mental health professionals (seek appropriate professional help if needed)</li>
                </ul>
              </SubSection>
            </Section>

            <Section title="8. Intellectual Property">
              <SubSection title="8.1 Our Content">
                <p>
                  All content on our website, including text, graphics, logos, images, videos, and software, is the property of The Founder’s Frame and is protected by copyright and intellectual property laws. You may not:
                </p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Reproduce, distribute, or create derivative works without our written permission</li>
                  <li>Use our branding, materials, or methodologies to offer competing services</li>
                  <li>Remove copyright or proprietary notices from any content</li>
                </ul>
              </SubSection>

              <SubSection title="8.2 Client Content">
                <p>You retain ownership of any content you create. By working with us, you grant us permission to:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Review and provide feedback on your content</li>
                  <li>Use anonymized examples of your work for educational purposes (with your explicit permission)</li>
                  <li>Display your testimonials, success stories, or case studies (with your explicit written consent)</li>
                </ul>
              </SubSection>

              <SubSection title="8.3 Frameworks and Templates">
                <p>
                  Any proprietary frameworks, templates, or strategies we provide are licensed to you for your personal business use only. You may not:
                </p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Resell, redistribute, or commercialize these materials</li>
                  <li>Teach or train others using our proprietary methods</li>
                  <li>Claim ownership or authorship of our methodologies</li>
                </ul>
              </SubSection>
            </Section>

            <Section title="9. Confidentiality">
              <SubSection title="9.1 Your Information">
                <p>
                  We will maintain the confidentiality of your business information, strategies, and personal details shared during our engagement, except:
                </p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>When required by law</li>
                  <li>When you give us explicit permission to share</li>
                  <li>When using anonymized information for educational purposes</li>
                </ul>
              </SubSection>

              <SubSection title="9.2 Our Methods">
                <p>
                  You agree to keep confidential any proprietary methods, frameworks, or strategies we share with you that are not publicly available.
                </p>
              </SubSection>
            </Section>

            <Section title="10. Testimonials and Case Studies">
              <SubSection title="10.1 Permission to Use">
                <p>
                  By providing a testimonial or agreeing to be featured as a case study, you grant us a perpetual, worldwide, royalty-free license to use your:
                </p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Name, business name, and likeness</li>
                  <li>Testimonial text or video</li>
                  <li>Business results and metrics you’ve authorized us to share</li>
                  <li>Before-and-after content examples</li>
                </ul>
              </SubSection>

              <SubSection title="10.2 Right to Decline">
                <p>
                  You are never obligated to provide a testimonial or participate in a case study. Your decision will not affect the quality of service you receive.
                </p>
              </SubSection>

              <SubSection title="10.3 Accuracy">
                <p>
                  Any results or testimonials featured on our website represent individual experiences and should not be interpreted as guaranteed or typical results.
                </p>
              </SubSection>
            </Section>

            <Section title="11. Termination">
              <SubSection title="11.1 Termination by Client">
                <p>
                  You may terminate our service relationship by providing written notice to{' '}
                  <a href="mailto:contact@thefoundersframe.com" className="text-brand hover:underline">contact@thefoundersframe.com</a>. Termination terms, including any applicable refunds or fees, will be governed by your individual service agreement.
                </p>
              </SubSection>

              <SubSection title="11.2 Termination by Us">
                <p>We reserve the right to terminate the service relationship immediately if:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>You breach these Terms or your service agreement</li>
                  <li>You engage in abusive, threatening, or inappropriate behavior toward our team</li>
                  <li>You fail to make required payments</li>
                  <li>We determine we cannot effectively serve your needs</li>
                  <li>Continuing the relationship would violate our policies or values</li>
                </ul>
              </SubSection>

              <SubSection title="11.3 Effect of Termination">
                <p>Upon termination:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>You must cease using any proprietary materials we’ve provided</li>
                  <li>Any outstanding payments become immediately due</li>
                  <li>We will no longer be obligated to provide services</li>
                  <li>Confidentiality obligations continue after termination</li>
                </ul>
              </SubSection>
            </Section>

            <Section title="12. Disclaimers and Limitation of Liability">
              <SubSection title="12.1 Service Provided “As Is”">
                <p>Our services are provided on an “as is” and “as available” basis. We make no warranties, expressed or implied, regarding:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Uninterrupted or error-free service</li>
                  <li>Specific results or outcomes</li>
                  <li>Compatibility with your specific circumstances</li>
                  <li>Accuracy or completeness of information provided</li>
                </ul>
              </SubSection>

              <SubSection title="12.2 Third-Party Platforms">
                <p>We provide guidance on using third-party platforms (YouTube, LinkedIn, etc.), but we:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Do not control these platforms or their algorithms</li>
                  <li>Cannot guarantee your account standing or compliance with platform policies</li>
                  <li>Are not responsible for platform changes, suspensions, or policies</li>
                  <li>Recommend you review and comply with all platform terms of service</li>
                </ul>
              </SubSection>

              <SubSection title="12.3 Limitation of Liability">
                <p>To the maximum extent permitted by law, The Founder’s Frame shall not be liable for:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Any indirect, incidental, special, consequential, or punitive damages</li>
                  <li>Loss of profits, revenue, data, or business opportunities</li>
                  <li>Damages resulting from your use or inability to use our services</li>
                  <li>Any damages exceeding the amount you paid us in the 12 months prior to the claim</li>
                </ul>
              </SubSection>

              <SubSection title="12.4 Force Majeure">
                <p>
                  We are not liable for any failure or delay in performing our obligations due to circumstances beyond our reasonable control, including but not limited to acts of God, natural disasters, pandemics, government actions, technical failures, or other unforeseen events.
                </p>
              </SubSection>
            </Section>

            <Section title="13. Indemnification">
              <p>
                You agree to indemnify, defend, and hold harmless The Founder’s Frame, its owners, employees, and contractors from any claims, damages, losses, liabilities, and expenses (including legal fees) arising from:
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Your breach of these Terms</li>
                <li>Your violation of any law or third-party rights</li>
                <li>Content you create or publish based on our guidance</li>
                <li>Your business practices or relationships with your customers</li>
                <li>Any misrepresentation you make to us or others</li>
              </ul>
            </Section>

            <Section title="14. Website Use">
              <SubSection title="14.1 Acceptable Use">
                <p>When using our website, you agree not to:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Violate any applicable laws or regulations</li>
                  <li>Infringe on intellectual property rights</li>
                  <li>Transmit viruses, malware, or harmful code</li>
                  <li>Attempt to gain unauthorized access to our systems</li>
                  <li>Scrape, harvest, or collect information about other users</li>
                  <li>Use the website for any unlawful or unauthorized purpose</li>
                </ul>
              </SubSection>

              <SubSection title="14.2 User Accounts">
                <p>If we provide you with account access for any purpose:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>You are responsible for maintaining the confidentiality of your login credentials</li>
                  <li>You are responsible for all activities under your account</li>
                  <li>You must notify us immediately of any unauthorized access</li>
                  <li>We reserve the right to suspend or terminate accounts that violate these Terms</li>
                </ul>
              </SubSection>
            </Section>

            <Section title="15. Links to Third-Party Websites">
              <p>Our website may contain links to third-party websites (YouTube, LinkedIn, Calendly, etc.). We:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Do not control or endorse these third-party sites</li>
                <li>Are not responsible for their content, privacy policies, or practices</li>
                <li>Recommend you review the terms and policies of any third-party sites you visit</li>
              </ul>
            </Section>

            <Section title="16. Privacy">
              <p>
                Your use of our services is also governed by our Privacy Policy. By using our services, you consent to the collection and use of information as described in the Privacy Policy.
              </p>
            </Section>

            <Section title="17. Communication">
              <SubSection title="17.1 Electronic Communications">
                <p>By using our services, you consent to receive electronic communications from us, including:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Service-related emails</li>
                  <li>Marketing communications (you may unsubscribe at any time)</li>
                  <li>Updates to these Terms or our policies</li>
                </ul>
              </SubSection>

              <SubSection title="17.2 Contact Information">
                <p>For any questions, concerns, or notices regarding these Terms, please contact us at:</p>
                <p className="pl-4">
                  Email:{' '}
                  <a href="mailto:contact@thefoundersframe.com" className="text-brand hover:underline">contact@thefoundersframe.com</a>
                  <br />
                  Website:{' '}
                  <a href="https://thefoundersframe.com" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">thefoundersframe.com</a>
                </p>
              </SubSection>

              <SubSection title="17.3 Official Notices">
                <p>
                  Any legal notices must be sent in writing to the email address above. Notices are considered received when we send a confirmation of receipt.
                </p>
              </SubSection>
            </Section>

            <Section title="18. Dispute Resolution">
              <SubSection title="18.1 Informal Resolution">
                <p>
                  Before pursuing formal legal action, you agree to first contact us at{' '}
                  <a href="mailto:contact@thefoundersframe.com" className="text-brand hover:underline">contact@thefoundersframe.com</a> to attempt to resolve any disputes informally.
                </p>
              </SubSection>

              <SubSection title="18.2 Governing Law">
                <p>
                  These Terms shall be governed by and construed in accordance with applicable laws, without regard to conflict of law provisions.
                </p>
              </SubSection>

              <SubSection title="18.3 Jurisdiction">
                <p>
                  You agree that any legal action or proceeding related to these Terms shall be brought exclusively in competent courts of jurisdiction, and you consent to the personal jurisdiction of such courts.
                </p>
              </SubSection>
            </Section>

            <Section title="19. Severability">
              <p>
                If any provision of these Terms is found to be unenforceable or invalid, that provision will be limited or eliminated to the minimum extent necessary, and the remaining provisions will remain in full force and effect.
              </p>
            </Section>

            <Section title="20. Entire Agreement">
              <p>
                These Terms, together with any service agreements and our Privacy Policy, constitute the entire agreement between you and The Founder’s Frame regarding your use of our services and supersede all prior agreements and understandings.
              </p>
            </Section>

            <Section title="21. Waiver">
              <p>
                Our failure to enforce any right or provision of these Terms will not be considered a waiver of those rights. Any waiver of any provision of these Terms will be effective only if in writing and signed by an authorized representative.
              </p>
            </Section>

            <Section title="22. Assignment">
              <p>
                You may not assign or transfer these Terms or your rights and obligations under them without our prior written consent. We may assign these Terms at any time without notice or consent.
              </p>
            </Section>

            <Section title="23. Updates to Terms">
              <p>We reserve the right to modify these Terms at any time. We will notify you of any changes by:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Posting the new Terms on this page</li>
                <li>Updating the “Last Updated” date</li>
                <li>Sending an email notification for material changes (if you’re an active client)</li>
              </ul>
              <p>
                Your continued use of our services after any modifications indicates your acceptance of the updated Terms. If you do not agree to the modified Terms, you must discontinue use of our services.
              </p>
            </Section>

            <Section title="24. Survival">
              <p>
                The following sections shall survive termination of these Terms: Intellectual Property, Confidentiality, Disclaimers and Limitation of Liability, Indemnification, Dispute Resolution, and any other provisions that by their nature should survive.
              </p>
            </Section>

            <Section title="25. Contact Information">
              <p>For questions about these Terms and Conditions, please contact us:</p>
              <p className="pl-4">
                Email:{' '}
                <a href="mailto:contact@thefoundersframe.com" className="text-brand hover:underline">contact@thefoundersframe.com</a>
                <br />
                Website:{' '}
                <a href="https://thefoundersframe.com" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">thefoundersframe.com</a>
              </p>
              <p className="mt-4 text-gray-300 font-medium">
                By using The Founder’s Frame website and services, you acknowledge that you have read, understood, and agree to be bound by these Terms and Conditions.
              </p>
            </Section>
          </div>
        </FadeIn>
      </div>

      <Footer />
    </main>
  );
}
