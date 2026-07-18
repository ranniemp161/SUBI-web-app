import Link from 'next/link';
import Image from 'next/image';
import { env } from '@/lib/env';
import { Check, ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SpotlightCard from '@/components/SpotlightCard';
import FadeIn from '@/components/FadeIn';
import HeroHeadline from '@/components/HeroHeadline';
import ProductShowcase from '@/components/ProductShowcase';

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0c0c0e] text-white font-sans overflow-x-hidden selection:bg-brand/30 relative z-0">
      {/* Ambient background gradients */}
      <div className="fixed top-[-20%] left-[-10%] w-[600px] h-[600px] bg-brand/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-brand/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />

      {/* Floating abstract tiny boxes scattered across the page */}
      <div className="absolute inset-0 pointer-events-none z-[-1] overflow-hidden opacity-60">
        <div className="absolute top-[20%] left-[5%] w-32 h-32 border border-white/10 rounded-2xl rotate-12 shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-br from-white/5 to-transparent animate-float" />
        <div className="absolute top-[40%] right-[8%] w-48 h-48 border border-white/10 rounded-3xl -rotate-[15deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-tl from-white/5 to-transparent animate-float-delayed" />
        <div className="absolute top-[60%] left-[12%] w-24 h-24 border border-white/10 rounded-xl rotate-[25deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-br from-white/5 to-transparent animate-float-slow" />
        <div className="absolute top-[80%] right-[6%] w-40 h-40 border border-white/10 rounded-2xl -rotate-[10deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-tr from-white/5 to-transparent animate-float" />
        <div className="absolute top-[92%] left-[10%] w-36 h-36 border border-white/10 rounded-2xl rotate-[18deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-tl from-white/5 to-transparent animate-float-delayed" />
      </div>

      <Navbar />

      {/* Hero Section */}
      <FadeIn>
        <section className="relative pt-40 pb-20 px-6 lg:pt-48 lg:pb-32 flex flex-col items-center text-center overflow-hidden">
          {/* Abstract Background Shapes */}
          <div className="absolute inset-0 pointer-events-none flex justify-center z-0">
            <div className="absolute -top-20 md:-top-10 -left-32 md:-left-10 w-[24rem] h-[24rem] md:w-[32rem] md:h-[32rem] border-2 border-white/10 rounded-[3rem] md:rounded-[5rem] rotate-[15deg] shadow-[0_0_50px_rgba(255,255,255,0.03)] bg-gradient-to-br from-white/5 to-transparent" />
            <div className="absolute top-40 md:top-20 -right-40 md:-right-20 w-[28rem] h-[28rem] md:w-[40rem] md:h-[40rem] border-2 border-white/10 rounded-[4rem] md:rounded-[6rem] -rotate-[12deg] shadow-[0_0_50px_rgba(255,255,255,0.03)] bg-gradient-to-tl from-white/5 to-transparent" />
            
            {/* Floating Product Icons */}
            <div className="absolute top-20 left-[15%] opacity-40 animate-float blur-[1px]">
              <Image src="/assets/icon-myfirstcut.webp" alt="MyFirstCut" width={70} height={70} />
            </div>
            <div className="absolute bottom-32 left-[10%] opacity-30 animate-float-delayed blur-[2px]">
              <Image src="/assets/icon-mythumbnail.webp" alt="MyThumbnail" width={50} height={50} />
            </div>
            <div className="absolute top-32 right-[20%] opacity-30 animate-float-slow blur-[1px]">
              <Image src="/assets/icon-myinfographics.webp" alt="Infographics" width={80} height={80} />
            </div>
            <div className="absolute bottom-40 right-[15%] opacity-40 animate-float">
              <Image src="/assets/icon-mytitlegen.webp" alt="Title Generator" width={60} height={60} />
            </div>
          </div>

          <div className="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-panel text-xs text-gray-300 font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-brand"></span>
            MyFirstCut is live <span className="text-gray-500">and mentorship is open</span>
          </div>

          <HeroHeadline />

          <p className="relative text-base md:text-lg text-gray-400 max-w-xl mx-auto leading-relaxed mb-10">
            Founders Frame gives business owners and content creators the mindset, the strategy, and the AI tools to grow on YouTube and social media, and to turn that attention into customers.
          </p>

          <div className="relative flex flex-col sm:flex-row justify-center items-center gap-4 mb-8 z-10">
            <Link 
              href={env.NEXT_PUBLIC_ROUGH_CUT_APP_URL} 
              className="w-full sm:w-auto inline-flex items-center justify-center bg-gradient-to-r from-brand via-yellow-400 to-brand bg-[length:200%_200%] animate-liquid text-black px-6 py-2.5 rounded-full font-semibold text-sm md:text-base transition-all shadow-[0_0_20px_rgba(255,255,0,0.2)]"
            >
              Start with MyFirstCut
            </Link>
            <Link
              href="#products"
              className="w-full sm:w-auto inline-flex items-center justify-center glass-panel text-white px-6 py-2.5 rounded-full font-medium text-sm md:text-base hover:bg-white/10 transition-colors"
            >
              See the toolkit
            </Link>
          </div>

          <p className="relative text-xs text-gray-500 max-w-md mx-auto">
            No subscription. Pay only for what you use. <br className="hidden sm:block" /> Your footage never leaves your computer.
          </p>
        </section>
      </FadeIn>

      {/* Toolkit Section */}
      <FadeIn delay={0.2}>
        <section id="products" className="py-24 px-6 relative">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col lg:flex-row gap-8 lg:items-end justify-between mb-16">
              <div className="space-y-4">
                <h4 className="text-brand font-semibold text-xs tracking-widest uppercase">The Toolkit</h4>
                <h2 className="text-4xl md:text-5xl font-heading font-bold max-w-lg bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent pb-1">
                  One credit balance. <br /> Every tool you need to post.
                </h2>
              </div>
              <p className="text-gray-400 max-w-sm text-lg">
                The hardest parts of publishing, handled. Founder&apos;s Frame Credits work across the whole suite, starting with MyFirstCut today.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {/* MyFirstCut Card */}
              <SpotlightCard className="glow-panel p-8 flex flex-col group">
                <div className="mb-8">
                  <span className="inline-block bg-brand text-black text-xs font-bold px-3 py-1 rounded-full mb-6 uppercase tracking-wider">
                    Available Now
                  </span>
                  <div className="w-14 h-14 bg-brand/10 rounded-xl flex items-center justify-center mb-6">
                    <Image src="/assets/icon-myfirstcut.webp" alt="MyFirstCut" width={32} height={32} />
                  </div>
                  <h3 className="text-3xl font-heading font-bold mb-4">MyFirstCut</h3>
                  <p className="text-gray-400 leading-relaxed">
                    Raw footage to a rough cut in minutes. It finds the silences, retakes, and dead air. You edit by editing text, not a timeline. Local-first: your video never leaves your computer.
                  </p>
                </div>
                <div className="mt-auto pt-8">
                  <Link href={env.NEXT_PUBLIC_ROUGH_CUT_APP_URL} className="inline-flex items-center gap-2 text-brand font-semibold group-hover:underline">
                    Try it free <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </SpotlightCard>

              {/* MyThumbnail Card */}
              <SpotlightCard className="glass-panel p-8 flex flex-col opacity-60 hover:opacity-100 transition-opacity">
                <div className="mb-8">
                  <span className="inline-block bg-white/10 text-white text-xs font-bold px-3 py-1 rounded-full mb-6 uppercase tracking-wider">
                    Coming Soon
                  </span>
                  <div className="w-14 h-14 bg-white/5 rounded-xl flex items-center justify-center mb-6">
                    <Image src="/assets/icon-mythumbnail.webp" alt="MyThumbnail" width={32} height={32} />
                  </div>
                  <h3 className="text-3xl font-heading font-bold mb-4">MyThumbnail</h3>
                  <p className="text-gray-400 leading-relaxed">
                    Scroll-stopping thumbnails generated from your video and your face. No design skills, no Photoshop.
                  </p>
                </div>
              </SpotlightCard>

              {/* Infographics Card */}
              <SpotlightCard className="glass-panel p-8 flex flex-col opacity-60 hover:opacity-100 transition-opacity">
                <div className="mb-8">
                  <span className="inline-block bg-white/10 text-white text-xs font-bold px-3 py-1 rounded-full mb-6 uppercase tracking-wider">
                    Coming Soon
                  </span>
                  <div className="w-14 h-14 bg-white/5 rounded-xl flex items-center justify-center mb-6">
                    <Image src="/assets/icon-myinfographics.webp" alt="Infographics" width={32} height={32} />
                  </div>
                  <h3 className="text-3xl font-heading font-bold mb-4">Infographics</h3>
                  <p className="text-gray-400 leading-relaxed">
                    Data visualization that makes sense. Turn boring stats into engaging graphics for your audience.
                  </p>
                </div>
              </SpotlightCard>
            </div>
          </div>
        </section>
      </FadeIn>

      {/* Why Founders Stall Section */}
      <FadeIn delay={0.2}>
        <section id="why-us" className="py-24 px-6 relative">
          <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-8">
              <h4 className="text-brand font-semibold text-xs tracking-widest uppercase">Why Founders Stall</h4>
              <h2 className="text-4xl md:text-5xl font-heading font-bold leading-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent pb-1">
                It&apos;s never the ideas. <br /> It&apos;s everything after them.
              </h2>
              <p className="text-gray-400 text-lg leading-relaxed max-w-lg">
                Most business owners record one video, spend a weekend fighting an editor, and never post again. Founders Frame removes the production wall with tools that make each chore a five-minute job, and closes the strategy gap with mentorship from someone who publishes every day.
              </p>
              <ul className="space-y-6 pt-4">
                <li className="flex gap-4">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-brand text-black flex items-center justify-center mt-0.5">
                    <Check className="w-4 h-4" strokeWidth={3} />
                  </div>
                  <p className="text-gray-300"><strong className="text-white">No subscriptions.</strong> One credit balance, pay-as-you-go across every tool.</p>
                </li>
                <li className="flex gap-4">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-brand text-black flex items-center justify-center mt-0.5">
                    <Check className="w-4 h-4" strokeWidth={3} />
                  </div>
                  <p className="text-gray-300"><strong className="text-white">No learning curve.</strong> If you can edit a document, you can edit your video.</p>
                </li>
                <li className="flex gap-4">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-brand text-black flex items-center justify-center mt-0.5">
                    <Check className="w-4 h-4" strokeWidth={3} />
                  </div>
                  <p className="text-gray-300"><strong className="text-white">No cloud uploads.</strong> Your footage stays on your machine, start to finish.</p>
                </li>
              </ul>
            </div>
            
            <ProductShowcase />
          </div>
        </section>
      </FadeIn>

      {/* Mentorship Section */}
      <FadeIn delay={0.2}>
        <section id="mentorship" className="py-24 px-6 relative">
          <div className="max-w-7xl mx-auto">
            <SpotlightCard className="glow-panel p-8 md:p-14 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-64 h-64 bg-brand/10 blur-[100px] rounded-full pointer-events-none" />
              <div className="grid lg:grid-cols-2 gap-12 items-center relative z-10">
                <div className="space-y-6">
                  <h4 className="text-brand font-semibold text-xs tracking-widest uppercase">Mentorship</h4>
                  <h2 className="text-4xl md:text-5xl font-heading font-bold leading-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent pb-1">
                    Tools speed you up. Strategy makes it work.
                  </h2>
                  <p className="text-gray-400 text-lg leading-relaxed">
                    Work with TJ directly on the things software cannot do for you: your positioning, your content strategy, your delivery on camera, and the mindset to keep publishing when you would rather quit. Everything taught is what TJ actually uses to run his own channel every single day, including the AI workflows that let one person publish like a whole team.
                  </p>
                  <div className="pt-2">
                    <a
                      href="https://apply.thefoundersframe.com"
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-2 bg-gradient-to-r from-brand via-yellow-400 to-brand bg-[length:200%_200%] animate-liquid text-black px-8 py-3 rounded-full font-semibold text-sm md:text-base transition-all shadow-[0_0_20px_rgba(255,255,0,0.2)]"
                    >
                      Apply for mentorship <ArrowRight className="w-4 h-4" />
                    </a>
                  </div>
                </div>
                <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[#0c0c0e]">
                  <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10 bg-white/[0.03]">
                    <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                    <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                    <span className="w-2.5 h-2.5 rounded-full bg-brand/40" />
                  </div>
                  <Image
                    src="/assets/subi-shop-channel.webp"
                    alt="TJ's YouTube channel, The Subi Shop"
                    width={1360}
                    height={836}
                    className="w-full h-auto object-cover"
                  />
                  <p className="text-gray-500 text-xs md:text-sm px-4 py-3 text-center border-t border-white/10">
                    Taught from a channel that publishes every day, not from theory.
                  </p>
                </div>
              </div>
            </SpotlightCard>
          </div>
        </section>
      </FadeIn>

      {/* Quote Section */}
      <FadeIn delay={0.2}>
        <section id="about" className="py-24 px-6 relative">
          <SpotlightCard className="max-w-4xl mx-auto glass-panel p-10 md:p-16">
            <div className="absolute top-0 right-0 w-64 h-64 bg-brand/10 blur-[100px] rounded-full pointer-events-none" />
            
            <div className="flex flex-col md:flex-row gap-10 items-center md:items-start relative z-10">
              <div className="w-32 h-32 rounded-full overflow-hidden shrink-0">
                <Image src="/assets/tj-portrait.webp" alt="TJ - Founder" width={448} height={448} className="object-cover w-full h-full" />
              </div>
              <div className="space-y-6 text-center md:text-left">
                <p className="text-2xl md:text-3xl font-heading font-medium leading-relaxed">
                  &quot;I left the corporate world, moved to Uganda, and opened a shoe shop. It failed badly. But the YouTube channel I started to save it now pays for my whole life, and it taught me everything I teach here.&quot;
                </p>
                <div>
                  <p className="font-semibold text-brand">TJ</p>
                  <p className="text-gray-400 text-sm">Founder, The Founder&apos;s Frame</p>
                </div>
                <Link href="/about" className="inline-flex items-center gap-2 text-brand hover:underline font-medium mt-4">
                  Read TJ&apos;s story <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </SpotlightCard>
        </section>
      </FadeIn>

      {/* Final CTA */}
      <FadeIn delay={0.2}>
        <section className="py-32 px-6 text-center">
          <div className="max-w-3xl mx-auto space-y-8">
            <h2 className="text-5xl md:text-6xl font-heading font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent pb-2">
              Post your first video this week.
            </h2>
            <p className="text-xl text-gray-400">
              Start with MyFirstCut today, and when you are ready to grow faster, mentorship is open. The tools and the strategy live in one place.
            </p>
            <div className="pt-8">
              <Link 
                href={env.NEXT_PUBLIC_ROUGH_CUT_APP_URL} 
                className="inline-flex items-center justify-center bg-gradient-to-r from-brand via-yellow-400 to-brand bg-[length:200%_200%] animate-liquid text-black px-10 py-4 rounded-full font-semibold text-lg transition-all shadow-[0_0_30px_rgba(255,255,0,0.3)]"
              >
                Get started free
              </Link>
            </div>
          </div>
        </section>
      </FadeIn>

      <Footer />
    </main>
  );
}
