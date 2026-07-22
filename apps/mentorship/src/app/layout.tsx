import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Founder Mentorship Program | The Founder's Frame",
  description: "Launch and scale your personal brand on YouTube with 1-on-1 strategic mentorship for established business founders.",
  keywords: ["founder mentorship", "personal brand", "YouTube for founders", "founder authority", "The Founder's Frame"],
  openGraph: {
    title: "Founder Mentorship Program | The Founder's Frame",
    description: "Build deep connection, authority, and trust through founder-led video content.",
    siteName: "The Founder's Frame",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html 
      lang="en" 
      suppressHydrationWarning
      className={`${dmSans.variable} ${spaceGrotesk.variable} h-full antialiased dark scroll-smooth`}
    >
      <body className="min-h-full flex flex-col font-sans relative selection:bg-yellow-400 selection:text-black" suppressHydrationWarning>
        {/* Subtle breathing grid background */}
        <div className="fixed inset-0 pointer-events-none z-[-10] flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 bg-grid-pattern opacity-10 animate-breathe mix-blend-overlay [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
        </div>
        <Navbar />
        <main className="flex-grow pt-24 pb-16">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
