import { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";

export const metadata: Metadata = {
  title: "About | Ruff Cut",
  description: "Built by a founder, for founders on camera.",
};

const display = "font-[family-name:var(--font-heading)]";

export default function AboutPage() {
  return (
    <div
      className={`flex min-h-screen flex-col overflow-x-hidden bg-[#111111] font-[family-name:var(--font-sans)] text-[var(--color-foreground)] antialiased selection:bg-[#fffc00] selection:text-black`}
    >
      <MarketingHeader />

      <main className="flex flex-1 flex-col pb-24 pt-16">
        <section className="mx-auto flex w-full max-w-[960px] flex-col items-center justify-center gap-10 px-6 lg:flex-row lg:gap-12">
          <div className="shrink-0">
            <div className="relative h-64 w-64 lg:h-[340px] lg:w-[340px]">
              <Image
                src="/assets/TJ-image.png"
                alt="TJ, Founder of The Founder's Frame"
                fill
                className="object-contain"
              />
            </div>
          </div>

          <div className="flex max-w-[500px] flex-col text-center lg:text-left">
            <div className="mb-4 flex justify-center lg:justify-start">
              <span className="inline-block rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-[#8A97AC]">
                About
              </span>
            </div>
            <h1 className={`${display} mb-6 text-[36px] font-bold leading-[1.15] tracking-tight text-white sm:text-4xl lg:text-[46px]`}>
              Built by a founder, <br className="hidden lg:block" />
              for founders on camera.
            </h1>
            <p className="mb-4 text-[15px] leading-relaxed text-[#A1A1AA]">
              Hi, I&apos;m <strong className="font-semibold text-white">TJ</strong> — founder of The Founder&apos;s Frame. I help business owners build their brand and presence on social media, and <strong className="font-semibold text-white">MyFirstCut</strong> is the tool I wished existed every time a founder told me editing was the reason they stopped posting.
            </p>
            <p className="text-[15px] leading-relaxed text-[#A1A1AA]">
              I used to rely on tools like Descript for my own rough cuts — specifically for the long-form videos I produce for my Subi Shop YouTube channel with nearly 100k subscribers. But it felt too costly when all I really wanted was its core rough cut functionality. <strong className="font-semibold text-white">MyFirstCut</strong> isn&apos;t here to compete with Descript; it&apos;s here to give content creators an affordable, lightning-fast alternative to strip out the dead air without the bloat.
            </p>
          </div>
        </section>

        {/* What is MyFirstCut Section */}
        <section className="mx-auto mt-20 w-full max-w-[800px] px-6">
          <div className="flex flex-col gap-6">
            <h2 className={`${display} text-[32px] font-bold tracking-tight text-white sm:text-[40px]`}>
              What is <span className="text-[#fffc00]">MyFirstCut</span>?
            </h2>
            <div className="flex flex-col gap-5 text-[16px] leading-[1.8] text-[#A1A1AA]">
              <p>
                MyFirstCut is a browser-based, AI-powered rough cut editor designed for creators who want to strip dead air and bad takes from their raw footage without the steep learning curve of a traditional timeline editor.
              </p>
              <p>
                By treating your video&apos;s transcript like a text document, MyFirstCut lets you delete silences, retakes, and filler words with a single click. Everything processes entirely on your local machine—meaning no slow server queues, no massive video uploads, and zero privacy risks. 
              </p>
              <p>
                It&apos;s lightning fast, affordable, and built specifically to turn your raw A-roll into a publishable cut in minutes so you can focus on what actually matters: <strong className="font-semibold text-white">creating content</strong>.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-20 w-full max-w-[800px] px-6">
          <div className="rounded-[16px] bg-[#1a1a1a] p-8 sm:p-12">
            <div className="mb-8 flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center">
                <Image src="/assets/ff-logo.png" alt="The Founder's Frame Logo" width={48} height={48} className="h-full w-full object-contain" />
              </div>
              <h2 className={`${display} text-[24px] font-bold text-white`}>The Founder&apos;s Frame</h2>
            </div>
            
            <p className="mb-6 text-[15px] leading-[1.8] text-[#A1A1AA]">
              The Founder&apos;s Frame helps business owners show up on social media with confidence — building their brand, their presence, and their voice on camera. The biggest thing standing between most founders and consistent content isn&apos;t ideas or courage. It&apos;s the edit.
            </p>
            <p className="text-[15px] leading-[1.8] text-[#A1A1AA]">
              MyFirstCut is the Founder&apos;s Frame answer to that: point it at your raw take, let it strip the silences and false starts, and walk away with a rough cut you can actually publish — without learning a timeline editor.
            </p>
          </div>
        </section>

        <section className="mx-auto mt-10 grid w-full max-w-[800px] grid-cols-1 gap-6 px-6 sm:grid-cols-3">
          <div className="rounded-[16px] bg-[#1a1a1a] p-8">
            <h3 className={`${display} mb-3 text-xl font-bold text-[#fffc00]`}>1 take</h3>
            <p className="text-[14px] leading-relaxed text-[#A1A1AA]">
              Record once, flaws and all. The bad takes get cut, not re-shot.
            </p>
          </div>
          <div className="rounded-[16px] bg-[#1a1a1a] p-8">
            <h3 className={`${display} mb-3 text-xl font-bold text-[#fffc00]`}>0 uploads</h3>
            <p className="text-[14px] leading-relaxed text-[#A1A1AA]">
              Your footage never leaves your computer. Only audio travels, then it&apos;s deleted.
            </p>
          </div>
          <div className="rounded-[16px] bg-[#1a1a1a] p-8">
            <h3 className={`${display} mb-3 text-xl font-bold text-[#fffc00]`}>Minutes</h3>
            <p className="text-[14px] leading-relaxed text-[#A1A1AA]">
              From raw footage to a publishable rough cut — not an afternoon lost to editing.
            </p>
          </div>
        </section>

        <section className="mx-auto mt-24 flex flex-col items-center px-6 text-center pb-12">
          <h2 className={`${display} mb-8 text-3xl font-bold text-white sm:text-4xl`}>
            Get your first cut done today
          </h2>
          <Link
            href="/sign-up"
            className="rounded-[10px] bg-[#fffc00] px-8 py-4 text-base font-bold text-black transition-transform hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,252,0,0.25)] hover:shadow-[0_0_30px_rgba(255,252,0,0.4)]"
          >
            Get Started Free
          </Link>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
