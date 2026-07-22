"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="fixed top-0 inset-x-0 z-50 glass-panel border-b border-white/10 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* LOGO */}
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/assets/Founder's Frame Logo V2 INCLUDING TEXT.webp"
            alt="Founder's Frame Mentorship"
            width={170}
            height={42}
            className="object-contain"
            priority
          />
          <span className="hidden sm:inline-block text-xs uppercase tracking-widest px-2.5 py-1 rounded-full bg-yellow-400/10 text-yellow-400 font-bold border border-yellow-400/20">
            Mentorship
          </span>
        </Link>

        {/* NAV LINKS */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-300">
          <Link
            href="/"
            className={`relative group transition-colors ${
              pathname === "/" ? "text-white font-semibold" : "hover:text-white"
            }`}
          >
            Mentorship Overview
            <span
              className={`absolute -bottom-1 left-0 h-[2px] bg-brand transition-all duration-300 ${
                pathname === "/" ? "w-full" : "w-0 group-hover:w-full"
              }`}
            ></span>
          </Link>

          <Link
            href="/privacy"
            className={`relative group transition-colors ${
              pathname === "/privacy" ? "text-white font-semibold" : "hover:text-white"
            }`}
          >
            Privacy Policy
            <span
              className={`absolute -bottom-1 left-0 h-[2px] bg-brand transition-all duration-300 ${
                pathname === "/privacy" ? "w-full" : "w-0 group-hover:w-full"
              }`}
            ></span>
          </Link>

          <Link
            href="/terms"
            className={`relative group transition-colors ${
              pathname === "/terms" ? "text-white font-semibold" : "hover:text-white"
            }`}
          >
            Terms & Conditions
            <span
              className={`absolute -bottom-1 left-0 h-[2px] bg-brand transition-all duration-300 ${
                pathname === "/terms" ? "w-full" : "w-0 group-hover:w-full"
              }`}
            ></span>
          </Link>
        </nav>

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
