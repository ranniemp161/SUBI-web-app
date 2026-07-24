"use client";

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { env } from '@/lib/env';

export default function Navbar() {
  const pathname = usePathname();
  const isMentorshipActive = pathname.startsWith('/mentorship');

  return (
    <nav className="fixed top-0 inset-x-0 z-50 glass-panel border-b border-white/10 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <Link href="/" className="flex items-center">
          <Image 
            src="/assets/Founder's Frame Logo V2 INCLUDING TEXT.webp" 
            alt="Founder's Frame" 
            width={160} 
            height={40} 
            className="object-contain"
            priority
          />
        </Link>

        <div className="flex items-center gap-4">
          {isMentorshipActive ? (
            <Link 
              href="/mentorship/apply" 
              className="btn-animated text-sm py-2 px-5 !text-xs sm:!text-sm"
            >
              Schedule a call
            </Link>
          ) : (
            <Link 
              href={env.NEXT_PUBLIC_ROUGH_CUT_APP_URL} 
              className="text-sm font-semibold bg-gradient-to-r from-brand to-yellow-400 text-black px-5 py-2.5 rounded-full hover:from-yellow-400 hover:to-yellow-500 transition-all shadow-[0_0_15px_rgba(255,255,0,0.1)] font-heading"
            >
              Try MyFirstCut
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
