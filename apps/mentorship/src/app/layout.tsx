import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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
    <html lang="en" className={`${inter.variable} scroll-smooth`}>
      <body className="bg-[#0c0c0e] text-gray-100 antialiased min-h-screen flex flex-col justify-between selection:bg-yellow-400 selection:text-black">
        <Navbar />
        <main className="flex-grow pt-24 pb-16">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
