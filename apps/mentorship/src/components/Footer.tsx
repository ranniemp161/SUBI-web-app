"use client";

import Link from "next/link";
import Image from "next/image";

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#08080a] py-12 px-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex flex-col items-center md:items-start gap-3">
          <Link href="/">
            <Image
              src="/assets/Founder's Frame Logo V2 INCLUDING TEXT.webp"
              alt="Founder's Frame"
              width={160}
              height={40}
              className="object-contain opacity-90 hover:opacity-100 transition-opacity"
            />
          </Link>
          <p className="text-xs text-gray-400 text-center md:text-left max-w-sm">
            Empowering founders to build high-trust personal brands on YouTube and accelerate long-term enterprise growth.
          </p>
        </div>

        <div className="flex flex-wrap justify-center items-center gap-6 text-sm text-gray-400">
          <Link href="/" className="hover:text-yellow-400 transition-colors">
            Mentorship
          </Link>
          <Link href="/privacy" className="hover:text-yellow-400 transition-colors">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-yellow-400 transition-colors">
            Terms & Conditions
          </Link>
          <Link
            href="/form"
            className="hover:text-yellow-400 transition-colors font-medium text-yellow-400"
          >
            Apply Now →
          </Link>
        </div>

        <div className="text-xs text-gray-500 text-center md:text-right">
          © {new Date().getFullYear()} The Founder&apos;s Frame. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
