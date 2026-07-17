import Link from "next/link";
import Image from "next/image";

export function MarketingFooter() {
  return (
    <footer className="border-t border-[#111111] bg-[#0A0A0A] px-6 py-20">
      <div className="mx-auto flex max-w-[1120px] flex-col justify-between gap-16 lg:flex-row lg:gap-8">
        <div className="flex flex-col gap-6 lg:max-w-xs">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#fffc00] shadow-[0_0_15px_rgba(255,252,0,0.15)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3"></circle>
                <circle cx="6" cy="18" r="3"></circle>
                <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
                <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
                <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
              </svg>
            </div>
            <span className="text-xl font-bold tracking-tight text-white">
              MyFirstCut
            </span>
          </div>
          
          {/* Description */}
          <p className="text-[14.5px] leading-relaxed text-[#8A97AC]">
            Raw footage to a rough cut in minutes. All in your browser, no server required.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-2 md:grid-cols-4 lg:gap-x-10 xl:gap-x-12">
          {/* Platform Column */}
          <div className="flex flex-col gap-5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Platform</h4>
            <nav className="flex flex-col gap-3.5">
              <Link href="/dashboard" className="text-[14.5px] text-[#8A97AC] transition-colors hover:text-white">Dashboard</Link>
              <Link href="/#how-it-works" className="text-[14.5px] text-[#8A97AC] transition-colors hover:text-white">How it works</Link>
            </nav>
          </div>

          {/* Resources Column */}
          <div className="flex flex-col gap-5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Resources</h4>
            <nav className="flex flex-col gap-3.5">
              <Link href="/#faq" className="text-[14.5px] text-[#8A97AC] transition-colors hover:text-white">FAQ</Link>
              <Link href="/about" className="text-[14.5px] text-[#8A97AC] transition-colors hover:text-white">About FF</Link>
              <a href="#" className="text-[14.5px] text-[#8A97AC] transition-colors hover:text-white">Follow us on X</a>
            </nav>
          </div>

          {/* Legal Column */}
          <div className="flex flex-col gap-5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Legal</h4>
            <nav className="flex flex-col gap-3.5">
              <a href="#" className="text-[14.5px] text-[#8A97AC] transition-colors hover:text-white">Privacy Policy</a>
              <a href="#" className="text-[14.5px] text-[#8A97AC] transition-colors hover:text-white">Terms of Service</a>
            </nav>
          </div>

          {/* Contact Column */}
          <div className="flex flex-col gap-5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Contact Us</h4>
            <p className="text-[14.5px] leading-relaxed text-[#8A97AC]">
              Subscribe for updates and early access.
            </p>
            <form className="mt-1 flex w-full">
              <input 
                type="email" 
                placeholder="Email address" 
                className="w-full min-w-0 rounded-l-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-[14px] text-white placeholder:text-[#5D6B82] focus:border-white focus:outline-none focus:ring-1 focus:ring-white transition-colors"
                required
              />
              <button 
                type="submit"
                className="flex shrink-0 items-center justify-center rounded-r-md bg-white px-3 text-black transition-colors hover:bg-neutral-200"
                aria-label="Subscribe"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Bottom Area: Founder's Frame & Copyright */}
      <div className="mx-auto mt-20 flex max-w-[1120px] flex-col items-center gap-8 border-t border-[rgba(255,255,255,0.06)] pt-12 text-center">
        {/* Founder's Frame Wordmark & Socials */}
        <div className="flex flex-col items-center gap-4">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-[#5D6B82]">
            A product by
          </span>
          <div className="flex items-center justify-center gap-5">
            <a href="https://thefoundersframe.com" target="_blank" rel="noopener noreferrer" className="inline-block transition-opacity hover:opacity-80">
              <Image src="/assets/ff-wordmark.webp" alt="The Founder's Frame" width={140} height={31} className="h-6 w-auto opacity-90 grayscale contrast-125 transition-all hover:grayscale-0" style={{ height: "auto" }} />
            </a>
            {/* Social Icons */}
            <div className="flex items-center gap-4 border-l border-[rgba(255,255,255,0.1)] pl-5">
              <a href="https://twitter.com/foundersframe" target="_blank" rel="noopener noreferrer" className="text-[#5D6B82] transition-colors hover:text-white" aria-label="X (formerly Twitter)">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] fill-current">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.008 4.126H5.078z"></path>
                </svg>
              </a>
              <a href="https://github.com/foundersframe" target="_blank" rel="noopener noreferrer" className="text-[#5D6B82] transition-colors hover:text-white" aria-label="GitHub">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
                  <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z"></path>
                </svg>
              </a>
            </div>
          </div>
        </div>

        <span className="text-[13px] text-[#5D6B82]">© 2026 MyFirstCut. All rights reserved.</span>
      </div>
    </footer>
  );
}
