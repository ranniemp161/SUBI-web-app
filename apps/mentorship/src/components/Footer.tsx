"use client";

import Link from "next/link";
import Image from "next/image";

export default function Footer() {
  return (
    <footer className="border-t border-white/10 pt-16 pb-8 px-6 bg-[#0c0c0e] relative overflow-hidden">
      {/* Subtle ambient yellow glow specifically for the footer */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-yellow-400/5 blur-[120px] rounded-[100%] pointer-events-none mix-blend-screen z-[-1]" />

      <div className="max-w-7xl mx-auto relative z-10">
        <div className="grid md:grid-cols-5 gap-10 mb-16">
          {/* LOGO & BRAND SLOGAN */}
          <div className="md:col-span-2 space-y-6">
            <Link href="/" className="inline-block opacity-90 hover:opacity-100 transition-opacity">
              <Image
                src="/assets/Founder's Frame Logo V2 INCLUDING TEXT.webp"
                alt="Founder's Frame Mentorship"
                width={160}
                height={40}
                className="object-contain"
              />
            </Link>
            <p className="text-gray-400 max-w-xs text-sm leading-relaxed">
              Empowering business owners to build high-trust personal brands on YouTube and convert attention into enterprise value.
            </p>
          </div>

          {/* MENTORSHIP & PROGRAM */}
          <div>
            <h4 className="text-white font-semibold mb-6 tracking-wide bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent uppercase text-xs">
              PROGRAM
            </h4>
            <ul className="space-y-4 text-sm text-gray-400">
              <li>
                <Link href="/" className="hover:text-yellow-400 transition-colors">
                  Overview
                </Link>
              </li>
              <li>
                <Link href="/form" className="hover:text-yellow-400 transition-colors font-medium text-yellow-400">
                  Apply Now →
                </Link>
              </li>
              <li>
                <span className="text-gray-600">Cohort 2026 (Open)</span>
              </li>
            </ul>
          </div>

          {/* COMPANY & ECOSYSTEM */}
          <div>
            <h4 className="text-white font-semibold mb-6 tracking-wide bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent uppercase text-xs">
              THE FRAMEWORK
            </h4>
            <ul className="space-y-4 text-sm text-gray-400">
              <li>
                <a href="https://thefoundersframe.com" target="_blank" rel="noopener noreferrer" className="hover:text-yellow-400 transition-colors">
                  Founder&apos;s Frame
                </a>
              </li>
              <li>
                <span className="text-gray-600">MyFirstCut AI</span>
              </li>
              <li>
                <span className="text-gray-600">Credits &amp; Billing</span>
              </li>
            </ul>
          </div>

          {/* LEGAL */}
          <div>
            <h4 className="text-white font-semibold mb-6 tracking-wide bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent uppercase text-xs">
              LEGAL
            </h4>
            <ul className="space-y-4 text-sm text-gray-400">
              <li>
                <Link href="/privacy" className="hover:text-yellow-400 transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-yellow-400 transition-colors">
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* BOTTOM COPYRIGHT */}
        <div className="pt-8 border-t border-white/10 flex justify-center text-center text-xs text-gray-500 w-full">
          <p>&copy; {new Date().getFullYear()} The Founder&apos;s Frame. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
