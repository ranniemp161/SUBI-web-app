import Link from "next/link";
import Image from "next/image";

const display = "font-[family-name:var(--font-heading)]";

export function MarketingHeader() {
  return (
    <nav className="sticky top-0 z-50 border-b border-[rgba(255,255,255,0.08)] bg-[#111111]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1120px] items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <div className="flex h-8 w-8 items-center justify-center shrink-0">
            <Image src="/assets/Icon myfirstcut app.png" alt="MyFirstCut Logo" width={32} height={32} className="object-contain" />
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
