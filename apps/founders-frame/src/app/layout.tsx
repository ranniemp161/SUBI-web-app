import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Founder's Frame",
  description: "Advanced tooling for video creators. Automate your edits, refine your thumbnails, and boost your engagement.",
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
      className={`${dmSans.variable} ${spaceGrotesk.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col font-sans relative" suppressHydrationWarning>
        {/* Subtle breathing grid background */}
        <div className="fixed inset-0 pointer-events-none z-[-10] flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 bg-grid-pattern opacity-10 animate-breathe mix-blend-overlay [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
        </div>
        {children}
      </body>
    </html>
  );
}
