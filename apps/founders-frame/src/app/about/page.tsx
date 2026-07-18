import Link from 'next/link';
import Image from 'next/image';
import { env } from '@/lib/env';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SpotlightCard from '@/components/SpotlightCard';
import FadeIn from '@/components/FadeIn';
import { ChapterTimeline, ChapterBlock, ChapterFigure } from '@/components/ChapterTimeline';

const apps = [
  {
    icon: '/assets/icon-myfirstcut.webp',
    name: 'MyFirstCut',
    description: 'The editor I wish I had when I started. Raw footage to a rough cut in minutes.',
    live: true,
  },
  {
    icon: '/assets/icon-mythumbnail.webp',
    name: 'MyThumbnail',
    description: 'Scroll-stopping thumbnails from your video and your face.',
    live: false,
  },
  {
    icon: '/assets/icon-myinfographics.webp',
    name: 'Infographics',
    description: 'Clean visuals for your videos and posts, no design skills needed.',
    live: false,
  },
  {
    icon: '/assets/icon-mytitlegen.webp',
    name: 'MyTitle Generator',
    description: 'Titles written for what the algorithm actually rewards.',
    live: false,
  },
];

export default function About() {
  return (
    <main className="min-h-screen bg-[#0c0c0e] text-white font-sans overflow-x-hidden selection:bg-brand/30 relative z-0">
      {/* Ambient background gradients */}
      <div className="fixed top-[-20%] left-[-10%] w-[600px] h-[600px] bg-brand/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-brand/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />

      <Navbar />

      <div className="max-w-3xl mx-auto pt-32 pb-24 px-6">

        {/* Opening card */}
        <FadeIn>
          <SpotlightCard className="glass-panel p-8 md:p-12 text-center relative overflow-hidden">
            <div className="w-44 h-44 md:w-52 md:h-52 rounded-full overflow-hidden mx-auto mb-6">
              <Image src="/assets/tj-portrait.webp" alt="TJ Subi" width={448} height={448} className="object-cover w-full h-full" />
            </div>
            <div className="space-y-4">
              <h4 className="text-brand font-semibold text-[10px] md:text-xs tracking-widest uppercase">The story of Founders Frame</h4>
              <h1 className="text-4xl md:text-5xl font-heading font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent pb-1 leading-tight">
                I&apos;m TJ Subi, and honestly, I did not plan any of this.
              </h1>
              <p className="text-gray-400 text-sm md:text-base leading-relaxed max-w-lg mx-auto">
                A few years ago I was contracting in the corporate world in the UK, and something in me knew it was not the life I wanted.
              </p>
            </div>
          </SpotlightCard>
        </FadeIn>

        {/* Chapter timeline */}
        <ChapterTimeline className="mt-20 ml-2 md:ml-4">

          <ChapterBlock number="01" title="The leap">
            <p>
              Not long after the pandemic I packed up and left, with no real plan beyond finding a freer way to live. I travelled across Africa and eventually settled in Uganda, which has been home since 2023.
            </p>
            <ChapterFigure
              src="/assets/tj-uganda.webp"
              alt="TJ with a friend in a village in Uganda"
              width={1400}
              height={788}
              caption="Uganda, home since 2023."
            />
          </ChapterBlock>

          <ChapterBlock number="02" title="The shop that failed">
            <p>
              When I arrived I started a shoe business and called it Subi Shop.
            </p>
            <blockquote className="py-4">
              <p className="text-2xl md:text-3xl font-heading font-medium leading-snug text-white">
                <span className="text-brand">&ldquo;</span>It failed, and it failed badly.<span className="text-brand">&rdquo;</span>
              </p>
            </blockquote>
            <p>
              The one thing I did alongside it was start a YouTube channel under the same name to give the shop some exposure. As the business fell apart, the channel slowly started to work.
            </p>
          </ChapterBlock>

          <ChapterBlock number="03" title="The channel finds its voice">
            <p>
              For a long time the videos went nowhere. Then I noticed something. Every time I spoke about African politics, people actually paid attention. Over time the channel found its real subject, African and global geopolitics told from an African perspective, and it kept growing.
            </p>
            <ChapterFigure
              src="/assets/subi-shop-channel.webp"
              alt="The Subi Shop YouTube channel playing a geopolitics video"
              width={1360}
              height={836}
              frame="browser"
              caption="The Subi Shop today. The shop is long gone, but the name lives on."
            />
            <p>
              What nobody tells you from the outside is how much goes into a channel. The recording, the editing, the writing, and above all the discipline of publishing again and again when you would rather quit. I had to figure all of it out to keep going. As AI got better I found ways to produce more in less time, and I paid close attention to what the algorithm actually rewards.
            </p>
            <p>
              That channel is now how I make my living. Because I still run it every single day, I stay close to what is working right now, not what worked last year. I also made a lot of mistakes along the way, and I know exactly which ones I would avoid if I started again today. That is really why Founders Frame exists.
            </p>
          </ChapterBlock>

          <ChapterBlock number="04" title="The lesson">
            <p>
              Here is the thing I wish someone had told me sooner. Chasing views for their own sake is hard, and the money from AdSense alone is slow and unreliable. Using content to market a business is a completely different game.
            </p>
            <p>
              When you build a personal brand, people come into your world and get to know you, like you, and trust you. From there, buying what you sell feels natural to them. That is the real prize, and most people never realise it is even on the table.
            </p>
          </ChapterBlock>

          <ChapterBlock number="05" title={"What I'm building"}>
            <p>
              Founders Frame is where I teach that. It is for people who want to build a personal brand that brings customers to their business, whether they are launching something new or growing something they already have. I share the strategy, the positioning, the delivery, and the AI workflows that let one person publish like a whole team. Everything I teach is what I actually use, not theory I read somewhere.
            </p>
            <p>
              To make it practical, I am building a suite of tools that handle the hardest parts of creating and publishing. As AI advances, I keep refining the tools I use on my own channel and adding them to the suite. The idea is simple. Take the work that used to eat my entire week and turn it into something you can finish in an afternoon.
            </p>

            {/* Apps showcase */}
            <SpotlightCard className="glass-panel mt-8 divide-y divide-white/5">
              {apps.map((app) => (
                <div key={app.name} className="flex items-center gap-4 p-5 md:p-6">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${app.live ? 'bg-brand/10' : 'bg-white/5'}`}>
                    <Image src={app.icon} alt={app.name} width={32} height={32} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-heading font-bold text-base md:text-lg text-white">{app.name}</h3>
                    <p className="text-gray-400 text-xs md:text-sm leading-relaxed">{app.description}</p>
                  </div>
                  {app.live ? (
                    <span className="ml-auto shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand text-black text-[10px] md:text-xs font-bold uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-black" />
                      Live
                    </span>
                  ) : (
                    <span className="ml-auto shrink-0 inline-flex items-center px-3 py-1.5 rounded-full border border-white/20 text-gray-400 text-[10px] md:text-xs font-medium uppercase tracking-wider">
                      Coming soon
                    </span>
                  )}
                </div>
              ))}
            </SpotlightCard>
            <p className="text-gray-500 text-sm leading-relaxed pt-2">
              All of these run on one credit balance. You top up once in MyFrameCredits and spend it on any tool in the suite.
            </p>
          </ChapterBlock>

        </ChapterTimeline>

      </div>

      {/* CTA Section */}
      <section className="py-20 px-6 text-center">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 className="text-3xl md:text-4xl font-heading font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent pb-1">
            If this sounds like the road you want to be on, you are in the right place.
          </h2>
          <p className="text-gray-400 text-sm md:text-base leading-relaxed max-w-xl mx-auto">
            Have a look around and start with the free content. When you are ready to move faster, the door is open.
          </p>
          <div className="pt-4">
            <Link
              href={env.NEXT_PUBLIC_ROUGH_CUT_APP_URL}
              className="inline-flex items-center justify-center bg-gradient-to-r from-brand via-yellow-400 to-brand bg-[length:200%_200%] animate-liquid text-black px-8 py-3 rounded-full font-semibold text-sm transition-all shadow-[0_0_20px_rgba(255,255,0,0.2)]"
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
