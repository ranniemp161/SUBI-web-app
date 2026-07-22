import Link from "next/link";
import WistiaPlayer from "@/components/WistiaPlayer";
import SpotlightCard from "@/components/SpotlightCard";
import FadeIn from "@/components/FadeIn";
import { 
  Sparkles, 
  Target, 
  Lightbulb, 
  Compass, 
  Users, 
  TrendingUp, 
  ShieldAlert, 
  CheckCircle2, 
  ArrowRight 
} from "lucide-react";

export default function MentorshipPage() {
  return (
    <div className="relative overflow-hidden z-0">
      {/* AMBIENT FIXED GRADIENTS */}
      <div className="fixed top-[-20%] left-[-10%] w-[600px] h-[600px] bg-yellow-400/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-yellow-400/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />

      {/* FLOATING ABSTRACT BOXES SCATTERED ACROSS PAGE */}
      <div className="absolute inset-0 pointer-events-none z-[-1] overflow-hidden opacity-70">
        <div className="absolute top-[10%] left-[5%] w-32 h-32 border border-white/10 rounded-2xl rotate-12 shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-br from-white/5 to-transparent animate-float" />
        <div className="absolute top-[28%] right-[7%] w-48 h-48 border border-white/10 rounded-3xl -rotate-[15deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-tl from-white/5 to-transparent animate-float-delayed" />
        <div className="absolute top-[48%] left-[9%] w-28 h-28 border border-white/10 rounded-xl rotate-[25deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-br from-white/5 to-transparent animate-float-slow" />
        <div className="absolute top-[70%] right-[6%] w-40 h-40 border border-white/10 rounded-2xl -rotate-[10deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-tr from-white/5 to-transparent animate-float" />
        <div className="absolute top-[88%] left-[7%] w-36 h-36 border border-white/10 rounded-2xl rotate-[18deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-tl from-white/5 to-transparent animate-float-delayed" />
      </div>

      {/* HERO SECTION */}
      <FadeIn>
        <section className="px-6 pt-6 pb-20 max-w-5xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 text-xs font-bold tracking-wider uppercase mb-8 shadow-[0_0_20px_rgba(255,255,0,0.1)]">
            <Sparkles className="w-4 h-4 text-yellow-400" />
            Executive Founder Mentorship
          </div>

          <h1 className="text-4xl md:text-6xl font-black text-white leading-tight tracking-tight mb-8">
            I help founders launch their{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-yellow-400 to-amber-500">
              personal brand
            </span>{" "}
            on YouTube
          </h1>

          {/* MAIN VSL VIDEO EMBED */}
          <div className="my-10 max-w-4xl mx-auto shadow-[0_0_50px_rgba(255,255,0,0.15)]">
            <WistiaPlayer mediaId="1ygx84trbg" />
          </div>

          {/* CTA BUTTON */}
          <div className="my-8">
            <Link
              href="/form"
              className="btn-animated text-lg px-8 py-4 shadow-xl"
            >
              Schedule a call
            </Link>
          </div>

          {/* TRUST COPY BLOCK */}
          <div className="mt-12 max-w-2xl mx-auto text-left glass-panel p-8 rounded-2xl border border-white/10 space-y-4">
            <p className="text-lg md:text-xl font-bold text-white leading-snug">
              Founder visibility is no longer optional — this is how to do it properly.
            </p>
            <div className="pt-2 border-t border-white/10 space-y-3 text-gray-300 text-base leading-relaxed">
              <p className="font-semibold text-yellow-400 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" /> It starts with trust.
              </p>
              <p>
                When founders step forward to share their story, their wins, their setbacks, and their passion, customers connect. They feel part of the journey.
              </p>
              <p>
                When done well, the relationship lasts, and customers naturally tell others about the business.
              </p>
            </div>
          </div>
        </section>
      </FadeIn>

      {/* SOCIAL PROOF SECTION */}
      <FadeIn delay={0.2}>
        <section className="py-20 px-6 bg-[#0f0f13]/80 border-y border-white/10 relative z-10 backdrop-blur-md">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl font-extrabold text-yellow-400 mb-8">
              Don&apos;t just take my word for it — hear from a founder I&apos;ve worked with
            </h2>

            {/* TESTIMONIAL VIDEO EMBED */}
            <div className="my-8 shadow-[0_0_40px_rgba(0,0,0,0.8)]">
              <WistiaPlayer mediaId="rh2t6cw9a6" />
            </div>

            {/* CAPTION */}
            <div className="mt-6 mb-8">
              <h3 className="text-xl font-bold text-white">Oshay Duke Jackson</h3>
              <p className="text-sm text-gray-400 mt-1">
                Founder, Kenganda | <span className="text-yellow-400 font-semibold">1M+ Subscribers Across Platforms</span>
              </p>
            </div>

            <div>
              <Link
                href="/form"
                className="btn-animated text-base px-6 py-3"
              >
                Schedule a call
              </Link>
            </div>
          </div>
        </section>
      </FadeIn>

      {/* WHO THIS IS FOR */}
      <FadeIn delay={0.2}>
        <section className="py-24 px-6 max-w-6xl mx-auto relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-bold text-yellow-400 uppercase tracking-widest px-3 py-1 rounded-full bg-yellow-400/10 border border-yellow-400/20">
              Target Fit
            </span>
            <h2 className="text-3xl md:text-5xl font-black text-white mt-4 mb-4">
              Who this is for
            </h2>
            <p className="text-lg md:text-xl text-gray-300">
              This is for founders who already have a business with customers and momentum.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="glass-panel p-8 rounded-2xl border-t-4 border-t-yellow-400 space-y-3 hover:border-yellow-400/80 transition-all">
              <div className="w-12 h-12 rounded-xl bg-yellow-400/10 flex items-center justify-center text-yellow-400 mb-4">
                <Target className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white">The Problem</h3>
              <p className="text-gray-400 leading-relaxed">
                Right now, your relationships are mostly transactional. You know the next level of sustainable scale comes from personal trust in the founder.
              </p>
            </div>

            <div className="glass-panel p-8 rounded-2xl border-t-4 border-t-yellow-400 space-y-3 hover:border-yellow-400/80 transition-all">
              <div className="w-12 h-12 rounded-xl bg-yellow-400/10 flex items-center justify-center text-yellow-400 mb-4">
                <Lightbulb className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white">The Gap</h3>
              <p className="text-gray-400 leading-relaxed">
                You can see competitors building that connection and pulling ahead. What you lack is not belief, but strategy and execution clarity.
              </p>
            </div>
          </div>
        </section>
      </FadeIn>

      {/* WHAT I HELP YOU DO (SERVICE PILLARS) */}
      <FadeIn delay={0.2}>
        <section className="py-24 px-6 bg-[#09090c]/90 border-t border-white/10 relative z-10 backdrop-blur-md">
          <div className="max-w-6xl mx-auto">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl md:text-5xl font-black text-white mb-4">
                What I help you do
              </h2>
              <p className="text-gray-400 text-lg">
                Six foundational pillars engineered to transform founder presence into enterprise leverage.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              <SpotlightCard
                number="01"
                title="Clarify your founder story"
                description="So people understand who you are, what you stand for, and why your mission matters."
                icon={<Sparkles className="w-5 h-5" />}
              />
              <SpotlightCard
                number="02"
                title="Build clear communication"
                description="Master skills and delivery techniques that make people listen, engage, and trust you on camera."
                icon={<Compass className="w-5 h-5" />}
              />
              <SpotlightCard
                number="03"
                title="Use simple frameworks"
                description="Always know what to say and when to say it without spending hours staring at a blank screen."
                icon={<Target className="w-5 h-5" />}
              />
              <SpotlightCard
                number="04"
                title="Guide your audience"
                description="Learn how to seamlessly ask people to engage, subscribe, respond, and take high-value action."
                icon={<Users className="w-5 h-5" />}
              />
              <SpotlightCard
                number="05"
                title="Show up publicly"
                description="Design a scalable media strategy that supports long-term market positioning, trust, and growth."
                icon={<TrendingUp className="w-5 h-5" />}
              />
              <SpotlightCard
                number="06"
                title="Turn yourself into an asset"
                description="Become a long-term enterprise trust asset that reduces customer acquisition costs indefinitely."
                icon={<CheckCircle2 className="w-5 h-5" />}
              />
            </div>
          </div>
        </section>
      </FadeIn>

      {/* WHO THIS IS NOT FOR */}
      <FadeIn delay={0.2}>
        <section className="py-20 px-6 bg-[#121217]/80 border-y border-white/10 relative z-10 backdrop-blur-md">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-3 mb-8">
              <ShieldAlert className="w-8 h-8 text-red-500" />
              <h2 className="text-3xl font-extrabold text-white">
                Who this is <span className="text-red-500">NOT</span> for
              </h2>
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-4 p-5 rounded-xl bg-red-500/5 border border-red-500/20 text-gray-200 text-lg">
                <span className="text-xl">🚫</span>
                <span>This is <strong>not</strong> for beginners starting from zero without an established business.</span>
              </div>
              <div className="flex items-start gap-4 p-5 rounded-xl bg-red-500/5 border border-red-500/20 text-gray-200 text-lg">
                <span className="text-xl">🚫</span>
                <span>This is <strong>not</strong> for people looking for viral hacks, shortcuts, or quick fame.</span>
              </div>
              <div className="flex items-start gap-4 p-5 rounded-xl bg-red-500/5 border border-red-500/20 text-gray-200 text-lg">
                <span className="text-xl">🚫</span>
                <span>This is <strong>not</strong> for founders who want to stay completely hidden behind a logo.</span>
              </div>
            </div>

            <p className="mt-8 text-gray-400 italic text-base bg-white/5 p-4 rounded-xl border border-white/10 text-center">
              &ldquo;If you are not willing to be visible or build a personal brand, this mentorship program will not work.&rdquo;
            </p>
          </div>
        </section>
      </FadeIn>

      {/* BOTTOM CTA */}
      <FadeIn delay={0.2}>
        <section className="py-24 px-6 text-center bg-gradient-to-b from-[#0c0c0e] to-black relative z-10">
          <div className="max-w-3xl mx-auto space-y-6">
            <h2 className="text-4xl md:text-5xl font-black text-white tracking-tight">
              Ready to step forward?
            </h2>
            <p className="text-gray-400 text-lg max-w-xl mx-auto">
              Book an exploratory call to see if your business qualifies for 1-on-1 founder mentorship.
            </p>
            <div className="pt-4">
              <Link
                href="/form"
                className="btn-animated text-xl px-10 py-5 shadow-[0_0_40px_rgba(255,255,0,0.2)]"
              >
                Schedule a call <ArrowRight className="w-5 h-5 hidden" />
              </Link>
            </div>
          </div>
        </section>
      </FadeIn>
    </div>
  );
}
