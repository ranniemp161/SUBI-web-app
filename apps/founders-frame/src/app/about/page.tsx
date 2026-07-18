import Link from 'next/link';
import Image from 'next/image';
import { env } from '@/lib/env';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SpotlightCard from '@/components/SpotlightCard';
import FadeIn from '@/components/FadeIn';

export default function About() {
  return (
    <main className="min-h-screen bg-[#0c0c0e] text-white font-sans overflow-x-hidden selection:bg-brand/30 relative z-0">
      {/* Ambient background gradients */}
      <div className="fixed top-[-20%] left-[-10%] w-[600px] h-[600px] bg-brand/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-brand/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />

      {/* Floating abstract tiny boxes scattered across the page */}
      <div className="absolute inset-0 pointer-events-none z-[-1] overflow-hidden opacity-60">
        <div className="absolute top-[10%] left-[5%] w-32 h-32 border border-white/10 rounded-2xl rotate-12 shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-br from-white/5 to-transparent animate-float" />
        <div className="absolute top-[30%] right-[8%] w-48 h-48 border border-white/10 rounded-3xl -rotate-[15deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-tl from-white/5 to-transparent animate-float-delayed" />
        <div className="absolute top-[50%] left-[12%] w-24 h-24 border border-white/10 rounded-xl rotate-[25deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-br from-white/5 to-transparent animate-float-slow" />
        <div className="absolute top-[70%] right-[6%] w-40 h-40 border border-white/10 rounded-2xl -rotate-[10deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-tr from-white/5 to-transparent animate-float" />
        <div className="absolute top-[90%] left-[10%] w-36 h-36 border border-white/10 rounded-2xl rotate-[18deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-tl from-white/5 to-transparent animate-float-delayed" />
      </div>

      <Navbar />

      {/* Main Content */}
      <div className="max-w-4xl mx-auto pt-32 pb-24 px-6 space-y-8">
        
        {/* Meet the Founder Hero Card */}
        <FadeIn>
          <SpotlightCard className="glass-panel p-8 md:p-12 flex flex-col md:flex-row gap-8 items-center md:items-start relative overflow-hidden">
            <div className="w-48 h-48 md:w-56 md:h-56 rounded-full overflow-hidden shrink-0">
              <Image src="/assets/TJ-image.png" alt="TJ - Founder" width={224} height={224} className="object-cover w-full h-full" />
            </div>
            <div className="space-y-4 text-center md:text-left pt-2">
              <h4 className="text-brand font-semibold text-[10px] md:text-xs tracking-widest uppercase">Meet the founder</h4>
              <h1 className="text-4xl md:text-5xl font-heading font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent pb-1 leading-tight">
                Hi, I&apos;m TJ. <br /> I put founders in the frame.
              </h1>
              <p className="text-gray-400 text-sm md:text-base leading-relaxed max-w-lg mx-auto md:mx-0">
                I started The Founder&apos;s Frame to help business owners build their brand and presence on social media. The founders I work with don&apos;t lack stories worth telling — they lack the hours and the tools to turn a raw recording into something they&apos;re proud to post.
              </p>
            </div>
          </SpotlightCard>
        </FadeIn>

        {/* Grid Section */}
        <section className="grid md:grid-cols-2 gap-8">
          {/* Card 1 */}
          <FadeIn delay={0.2}>
            <SpotlightCard className="glass-panel p-8 space-y-4 h-full">
              <h4 className="text-brand font-semibold text-[10px] md:text-xs tracking-widest uppercase">The Goal</h4>
              <h2 className="text-2xl md:text-3xl font-heading font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent leading-tight pb-1">
                Every founder, on camera, consistently.
              </h2>
              <p className="text-gray-400 text-sm md:text-base leading-relaxed">
                Your customers are on social media, and they buy from people they see and trust. The goal of The Founder&apos;s Frame is simple: make showing up so easy that consistency stops being a discipline problem. Record once, publish everywhere, week after week.
              </p>
            </SpotlightCard>
          </FadeIn>
          
          {/* Card 2 */}
          <FadeIn delay={0.4}>
            <SpotlightCard className="glass-panel p-8 space-y-4 h-full">
              <h4 className="text-brand font-semibold text-[10px] md:text-xs tracking-widest uppercase">Why it exists</h4>
              <h2 className="text-2xl md:text-3xl font-heading font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent leading-tight pb-1">
                The edit was killing the message.
              </h2>
              <p className="text-gray-400 text-sm md:text-base leading-relaxed">
                Coaching founders on brand, I watched the same story repeat: great on camera, buried in post-production. Editing software built for professionals was the wall between their message and their audience. So instead of teaching around the wall, we started building tools that remove it.
              </p>
            </SpotlightCard>
          </FadeIn>
        </section>

        {/* How the tools fit together Card */}
        <FadeIn delay={0.2}>
          <SpotlightCard className="glass-panel p-8 md:p-12 space-y-6 relative overflow-hidden">
            <div className="w-12 h-12 bg-transparent border-2 border-brand text-brand flex items-center justify-center font-bold text-2xl font-heading mb-6">
              FF
            </div>
            <h2 className="text-2xl md:text-3xl font-heading font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent leading-tight pb-1">
              How the tools fit together
            </h2>
            <p className="text-gray-400 text-sm md:text-base leading-relaxed max-w-2xl">
              Each Founder&apos;s Frame tool takes one production chore off your plate. <span className="font-semibold text-white">MyFirstCut</span> turns raw footage into a rough cut today. <span className="font-semibold text-white">MyThumbnail</span> and <span className="font-semibold text-white">Infographics</span> are coming next — one credit balance covers them all.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand text-black text-xs font-semibold">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-zap"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                MyFirstCut — live
              </span>
              <span className="inline-flex items-center px-4 py-2 rounded-full border border-white/20 text-gray-400 text-xs font-medium">
                MyThumbnail — coming soon
              </span>
              <span className="inline-flex items-center px-4 py-2 rounded-full border border-white/20 text-gray-400 text-xs font-medium">
                Infographics — coming soon
              </span>
            </div>
          </SpotlightCard>
        </FadeIn>

      </div>

      {/* CTA Section */}
      <section className="py-20 px-6 text-center">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 className="text-3xl md:text-4xl font-heading font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent pb-1">
            Ready to get in the frame?
          </h2>
          <div className="pt-4">
            <Link 
              href={env.NEXT_PUBLIC_ROUGH_CUT_APP_URL} 
              className="inline-flex items-center justify-center bg-gradient-to-r from-brand to-yellow-400 text-black px-8 py-3 rounded-full font-semibold text-sm hover:from-yellow-400 hover:to-yellow-500 transition-all shadow-[0_0_20px_rgba(255,255,0,0.2)]"
            >
              Start with MyFirstCut
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
