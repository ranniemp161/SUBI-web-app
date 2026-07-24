import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WistiaPlayer from "@/components/WistiaPlayer";
import SpotlightCard from "@/components/SpotlightCard";
import FadeIn from "@/components/FadeIn";
import { 
  Sparkles, 
  Target, 
  Lightbulb, 
  ShieldAlert, 
  CheckCircle2,
  Video,
  Award,
  Zap,
  Star
} from "lucide-react";

export const metadata = {
  title: "Founder Mentorship Program | The Founder's Frame",
  description: "Launch and scale your personal brand on YouTube with 1-on-1 strategic mentorship for established business founders.",
};

const pillars = [
  {
    num: "01",
    title: "Clarify your founder story",
    desc: "So people understand who you are, what you stand for, and why your mission matters.",
  },
  {
    num: "02",
    title: "Build clear communication",
    desc: "Master skills and delivery techniques that make people listen, engage, and trust you on camera.",
  },
  {
    num: "03",
    title: "Use simple frameworks",
    desc: "Always know what to say and when to say it without spending hours staring at a blank screen.",
  },
  {
    num: "04",
    title: "Guide your audience",
    desc: "Learn how to seamlessly ask people to engage, subscribe, respond, and take high-value action.",
  },
  {
    num: "05",
    title: "Show up publicly",
    desc: "Design a scalable media strategy that supports long-term market positioning, trust, and growth.",
  },
  {
    num: "06",
    title: "Turn yourself into an asset",
    desc: "Become a long-term enterprise trust asset that reduces customer acquisition costs indefinitely.",
  },
];

export default function MentorshipPage() {
  return (
    <div className="relative overflow-hidden z-0 min-h-screen bg-[#0c0c0e]">
      {/* TOP NAVBAR */}
      <Navbar />

      {/* AMBIENT GLOW ORBS & MULTI-LAYER GRADIENTS */}
      <div className="fixed top-[-20%] left-[-10%] w-[650px] h-[650px] bg-brand/10 blur-[140px] rounded-full pointer-events-none mix-blend-screen z-[-1] animate-pulse-slow" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[650px] h-[650px] bg-amber-500/10 blur-[140px] rounded-full pointer-events-none mix-blend-screen z-[-1] animate-pulse-slow" />
      <div className="fixed top-[45%] left-[50%] -translate-x-1/2 w-[800px] h-[400px] bg-brand/5 blur-[160px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />

      {/* FLOATING ABSTRACT ARTISTIC GLASS BOXES */}
      <div className="absolute inset-0 pointer-events-none z-[-1] overflow-hidden opacity-80">
        <div className="absolute top-[8%] left-[4%] w-36 h-36 border border-brand/20 rounded-2xl rotate-12 shadow-[0_0_30px_rgba(255,255,0,0.05)] bg-gradient-to-br from-brand/10 to-transparent animate-float" />
        <div className="absolute top-[26%] right-[6%] w-52 h-52 border border-white/10 rounded-3xl -rotate-[15deg] shadow-[0_0_40px_rgba(255,255,255,0.03)] bg-gradient-to-tl from-white/5 to-transparent animate-float-delayed" />
        <div className="absolute top-[48%] left-[7%] w-32 h-32 border border-brand/15 rounded-xl rotate-[25deg] shadow-[0_0_30px_rgba(255,255,0,0.05)] bg-gradient-to-br from-brand/5 to-transparent animate-float-slow" />
        <div className="absolute top-[68%] right-[5%] w-44 h-44 border border-white/10 rounded-2xl -rotate-[10deg] shadow-[0_0_35px_rgba(255,255,255,0.03)] bg-gradient-to-tr from-white/5 to-transparent animate-float" />
        <div className="absolute top-[86%] left-[6%] w-40 h-40 border border-brand/20 rounded-2xl rotate-[18deg] shadow-[0_0_40px_rgba(255,255,0,0.05)] bg-gradient-to-tl from-brand/10 to-transparent animate-float-delayed" />
      </div>

      {/* HERO SECTION */}
      <FadeIn>
        <section className="px-6 pt-20 md:pt-24 pb-12 max-w-4xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-brand/20 via-brand/10 to-amber-500/20 border border-brand/30 text-brand text-xs font-bold tracking-wider uppercase mb-3 shadow-[0_0_20px_rgba(255,255,0,0.15)]">
            <Sparkles className="w-3.5 h-3.5 text-brand" />
            <span>Executive Founder Mentorship</span>
          </div>

          <h1 className="text-3xl md:text-5xl font-heading font-black text-white leading-tight tracking-tight mb-4 max-w-3xl mx-auto">
            I help founders launch their{" "}
            <span className="text-metallic-gold drop-shadow-[0_2px_10px_rgba(255,255,0,0.2)]">
              personal brand
            </span>{" "}
            on YouTube
          </h1>

          {/* CINEMATIC VSL VIDEO PLAYER WITH CAMERA BEZEL & CORNER CROSSHAIRS */}
          <div className="my-4 max-w-2xl md:max-w-3xl mx-auto relative group">
            {/* Live Camera Badge */}
            <div className="absolute -top-3 left-4 z-30 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/80 border border-brand/40 text-[10px] font-mono font-bold tracking-widest text-brand uppercase shadow-lg backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
              <Video className="w-3 h-3 text-brand" /> EXECUTIVE VSL
            </div>

            <div className="cinematic-video-frame overflow-hidden">
              <div className="cinematic-corner-tl" />
              <div className="cinematic-corner-tr" />
              <div className="cinematic-corner-bl" />
              <div className="cinematic-corner-br" />
              <WistiaPlayer mediaId="1ygx84trbg" />
            </div>
          </div>

          {/* PROMINENT SOLID YELLOW ANIMATED CTA BUTTON */}
          <div className="mt-5 mb-4">
            <Link
              href="/mentorship/apply"
              className="btn-animated text-base md:text-lg py-3.5 px-9"
            >
              Schedule a call
            </Link>
          </div>

          {/* ARTISTIC TRUST COPY CARD WITH GOLD ACCENTS */}
          <div className="mt-8 max-w-2xl mx-auto text-left glass-panel p-6 md:p-8 rounded-2xl border border-brand/20 shadow-[0_10px_30px_rgba(0,0,0,0.6)] space-y-3 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-brand/5 blur-2xl rounded-full pointer-events-none" />
            <p className="text-base md:text-lg font-bold text-white leading-snug flex items-center gap-2">
              <Award className="w-5 h-5 text-brand shrink-0" />
              <span>Founder visibility is no longer optional — this is how to do it properly...</span>
            </p>
            <div className="pt-3 border-t border-white/10 space-y-2 text-gray-300 text-sm md:text-base leading-relaxed">
              <p className="font-semibold text-brand flex items-center gap-2">
                <CheckCircle2 className="w-4.5 h-4.5 text-brand shrink-0" /> It starts with trust.
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
        <section className="py-16 px-6 bg-[#0f0f13]/90 border-y border-white/10 relative z-10 backdrop-blur-md">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand/10 border border-brand/20 text-brand text-xs font-bold uppercase mb-3">
              <Star className="w-3.5 h-3.5 fill-brand text-brand" /> Verified Case Study
            </div>
            <h2 className="text-xl md:text-3xl font-heading font-extrabold text-white mb-6">
              Hear from a founder I&apos;ve worked with
            </h2>

            {/* TESTIMONIAL CINEMATIC VIDEO EMBED */}
            <div className="my-6 max-w-2xl mx-auto cinematic-video-frame overflow-hidden">
              <div className="cinematic-corner-tl" />
              <div className="cinematic-corner-tr" />
              <div className="cinematic-corner-bl" />
              <div className="cinematic-corner-br" />
              <WistiaPlayer mediaId="rh2t6cw9a6" />
            </div>

            {/* CAPTION */}
            <div className="mt-4 mb-6">
              <h3 className="text-lg font-heading font-bold text-white">Oshay Duke Jackson</h3>
              <p className="text-xs md:text-sm text-gray-400 mt-1">
                Founder, Kenganda | <span className="text-brand font-semibold">1M+ Subscribers Across Platforms</span>
              </p>
            </div>

            <div>
              <Link
                href="/mentorship/apply"
                className="btn-animated text-base py-3 px-7"
              >
                Schedule a call
              </Link>
            </div>
          </div>
        </section>
      </FadeIn>

      {/* DUAL-TONE TARGET FIT CARDS */}
      <FadeIn delay={0.2}>
        <section className="py-20 px-6 max-w-6xl mx-auto relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <span className="text-xs font-bold text-brand uppercase tracking-widest px-3.5 py-1 rounded-full bg-brand/10 border border-brand/20">
              Target Fit
            </span>
            <h2 className="text-3xl md:text-4xl font-heading font-black text-white mt-4 mb-3">
              Who this is for
            </h2>
            <p className="text-base md:text-lg text-gray-300">
              Engineered exclusively for founders with existing revenue, customers, and business momentum.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="glass-panel p-8 rounded-3xl border border-brand/30 space-y-4 hover:border-brand/60 transition-all shadow-[0_10px_30px_rgba(255,255,0,0.05)] relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-brand/10 blur-2xl rounded-full group-hover:bg-brand/20 transition-all" />
              <div className="w-12 h-12 rounded-2xl bg-brand/10 border border-brand/30 flex items-center justify-center text-brand mb-2">
                <Target className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-heading font-bold text-white">The Opportunity</h3>
              <p className="text-gray-300 leading-relaxed text-sm md:text-base">
                Right now, your client relationships are largely transactional. You know the next level of long-term enterprise scale comes from personal trust built around the founder.
              </p>
            </div>

            <div className="glass-panel p-8 rounded-3xl border border-white/15 space-y-4 hover:border-brand/40 transition-all shadow-[0_10px_30px_rgba(255,255,255,0.02)] relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 blur-2xl rounded-full group-hover:bg-brand/10 transition-all" />
              <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-brand mb-2">
                <Lightbulb className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-heading font-bold text-white">The Strategic Advantage</h3>
              <p className="text-gray-300 leading-relaxed text-sm md:text-base">
                You see competitors connecting publicly and pulling ahead. What you lack is not belief, but strategy, media architecture, and execution clarity.
              </p>
            </div>
          </div>
        </section>
      </FadeIn>

      {/* FOUNDATIONAL SERVICE PILLARS WITH ILLUMINATED SPOTLIGHT CARDS */}
      <FadeIn delay={0.2}>
        <section className="py-20 px-6 bg-[#09090c]/90 border-t border-white/10 relative z-10 backdrop-blur-md">
          <div className="max-w-6xl mx-auto">
            <div className="text-center max-w-3xl mx-auto mb-12">
              <span className="text-xs font-bold text-brand uppercase tracking-widest px-3 py-1 rounded-full bg-brand/10 border border-brand/20">
                Core Methodology
              </span>
              <h2 className="text-3xl md:text-4xl font-heading font-black text-white mt-3 mb-3">
                What I help you do
              </h2>
              <p className="text-gray-400 text-base md:text-lg">
                Six foundational pillars engineered to transform founder presence into scalable enterprise leverage.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {pillars.map((pillar) => (
                <SpotlightCard key={pillar.num} className="p-8 flex flex-col justify-between group hover:border-brand/40 transition-all duration-300">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-3xl font-black text-brand tracking-wider font-mono block drop-shadow-[0_0_10px_rgba(255,255,0,0.3)]">
                        {pillar.num}
                      </span>
                      <Zap className="w-4 h-4 text-brand/40 group-hover:text-brand transition-colors" />
                    </div>
                    <h3 className="text-xl font-heading font-bold text-white mb-3 group-hover:text-brand transition-colors">
                      {pillar.title}
                    </h3>
                    <p className="text-gray-400 text-sm leading-relaxed">
                      {pillar.desc}
                    </p>
                  </div>
                  <div className="mt-6 pt-4 border-t border-white/5 flex items-center text-xs font-semibold text-brand/80 group-hover:text-brand">
                    <span>Executive Strategy</span>
                    <span className="ml-auto group-hover:translate-x-1 transition-transform">→</span>
                  </div>
                </SpotlightCard>
              ))}
            </div>
          </div>
        </section>
      </FadeIn>

      {/* WHO THIS IS NOT FOR (HIGH CONTRAST CRIMSON GLASS CARD) */}
      <FadeIn delay={0.2}>
        <section className="py-16 px-6 bg-[#121217]/90 border-y border-white/10 relative z-10 backdrop-blur-md">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <h2 className="text-2xl md:text-3xl font-heading font-extrabold text-white">
                Who this is <span className="text-red-400 underline decoration-red-500/50">NOT</span> for
              </h2>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-4 p-4 rounded-2xl bg-red-500/5 border border-red-500/20 text-gray-200 text-base md:text-lg backdrop-blur-sm">
                <span className="text-xl shrink-0">🚫</span>
                <span>This is <strong>not</strong> for beginners starting from zero without an established business.</span>
              </div>
              <div className="flex items-start gap-4 p-4 rounded-2xl bg-red-500/5 border border-red-500/20 text-gray-200 text-base md:text-lg backdrop-blur-sm">
                <span className="text-xl shrink-0">🚫</span>
                <span>This is <strong>not</strong> for people looking for viral hacks, shortcuts, or quick fame.</span>
              </div>
              <div className="flex items-start gap-4 p-4 rounded-2xl bg-red-500/5 border border-red-500/20 text-gray-200 text-base md:text-lg backdrop-blur-sm">
                <span className="text-xl shrink-0">🚫</span>
                <span>This is <strong>not</strong> for founders who want to stay completely hidden behind a logo.</span>
              </div>
            </div>

            <div className="mt-6 text-gray-300 italic text-sm md:text-base bg-white/5 p-4 rounded-2xl border border-white/10 text-center shadow-inner">
              &ldquo;If you are not willing to be visible or build a personal brand, this mentorship program will not work.&rdquo;
            </div>
          </div>
        </section>
      </FadeIn>

      {/* BOTTOM CONVERSION SECTION */}
      <FadeIn delay={0.2}>
        <section className="py-20 px-6 text-center bg-gradient-to-b from-[#0c0c0e] via-black to-black relative z-10">
          <div className="max-w-3xl mx-auto space-y-5">
            <h2 className="text-3xl md:text-5xl font-heading font-black text-white tracking-tight">
              Ready to step forward?
            </h2>
            <p className="text-gray-400 text-base md:text-lg max-w-xl mx-auto">
              Book an exploratory call to see if your business qualifies for 1-on-1 founder mentorship.
            </p>
            <div className="pt-3">
              <Link
                href="/mentorship/apply"
                className="btn-animated text-lg md:text-xl py-4 px-10"
              >
                Schedule a call
              </Link>
            </div>
          </div>
        </section>
      </FadeIn>

      {/* BOTTOM FOOTER */}
      <Footer />
    </div>
  );
}
