import Link from "next/link";

const display = "font-[family-name:var(--font-heading)]";

export function MarketingHeader() {
  return (
    <nav className="sticky top-0 z-50 border-b border-[rgba(255,255,255,0.08)] bg-[#111111]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1120px] items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#fffc00]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
              <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
              <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
            </svg>
          </div>
          <span
            className={`${display} text-[17px] font-bold tracking-[-0.01em] text-white`}
          >
            MyFirstCut
          </span>
        </Link>
        <div className="flex items-center gap-4 sm:gap-6">
          <Link
            href="/#faq"
            className="hidden text-sm font-medium text-[#8A97AC] transition-colors hover:text-[#E8EDF6] sm:block"
          >
            FAQ
          </Link>
          <Link
            href="/about"
            className="hidden text-sm font-medium text-[#8A97AC] transition-colors hover:text-[#E8EDF6] sm:block"
          >
            About
          </Link>
          <Link
            href="/sign-in"
            className="text-sm font-medium text-[#8A97AC] transition-colors hover:text-[#E8EDF6]"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-[6px] bg-[#fffc00] px-4 py-2 text-sm font-semibold text-black transition-transform hover:scale-105 active:scale-95"
          >
            Get Started
          </Link>
        </div>
      </div>
    </nav>
  );
}
