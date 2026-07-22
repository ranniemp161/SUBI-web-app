"use client";

import Link from "next/link";
import Image from "next/image";

export default function Navbar() {
  return (
    <header className="fixed top-0 inset-x-0 z-50 glass-panel border-b border-white/10 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* LOGO */}
        <Link href="/" className="flex items-center">
          <Image
            src="/assets/Founder's Frame Logo V2 INCLUDING TEXT.webp"
            alt="Founder's Frame"
            width={170}
            height={42}
            className="object-contain"
            priority
          />
        </Link>

        {/* CTA BUTTON */}
        <div className="flex items-center gap-4">
          <a
            href="https://thefoundersframe.com/form/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-animated text-sm py-2 px-5 !text-xs sm:!text-sm"
          >
            Schedule a call
          </a>
        </div>
      </div>
    </header>
  );
}
