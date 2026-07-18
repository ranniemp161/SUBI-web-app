import Link from 'next/link';
import Image from 'next/image';
import { env } from '@/lib/env';

export default function Footer() {
  return (
    <footer className="border-t border-white/10 pt-16 pb-8 px-6 bg-[#0c0c0e] relative overflow-hidden">
      {/* Subtle ambient gradient specifically for the footer */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-brand/5 blur-[120px] rounded-[100%] pointer-events-none mix-blend-screen z-[-1]" />
      
      <div className="max-w-7xl mx-auto relative z-10">
        <div className="grid md:grid-cols-4 gap-10 mb-16">
          <div className="md:col-span-2 space-y-6">
            <Link href="/" className="inline-block opacity-80 hover:opacity-100 transition-opacity">
              <Image 
                src="/assets/Founder's Frame Logo V2 INCLUDING TEXT.webp" 
                alt="Founder's Frame" 
                width={140} 
                height={35} 
                className="object-contain"
              />
            </Link>
            <p className="text-gray-400 max-w-xs text-sm leading-relaxed">
              Tools that help business owners build their brand and presence on social media.
            </p>
          </div>
          
          <div>
            <h4 className="text-white font-semibold mb-6 tracking-wide bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">PRODUCTS</h4>
            <ul className="space-y-4 text-sm text-gray-400">
              <li><Link href={env.NEXT_PUBLIC_ROUGH_CUT_APP_URL} className="hover:text-brand transition-colors">MyFirstCut</Link></li>
              <li><span className="text-gray-600">MyThumbnail — soon</span></li>
              <li><span className="text-gray-600">Infographics — soon</span></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-6 tracking-wide bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">COMPANY</h4>
            <ul className="space-y-4 text-sm text-gray-400">
              <li><Link href="/about" className="hover:text-brand transition-colors">About TJ</Link></li>
              <li><Link href={env.NEXT_PUBLIC_WALLET_APP_URL} className="hover:text-brand transition-colors">Credits & billing</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="pt-8 border-t border-white/10 flex justify-center text-center text-xs text-gray-500 w-full">
          <p>&copy; {new Date().getFullYear()} The Founder&apos;s Frame. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
