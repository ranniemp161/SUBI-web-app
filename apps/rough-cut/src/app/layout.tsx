import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { FloatingBoxes } from "@/components/floating-boxes";
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ruff Cut — Automated Video Editing",
  description:
    "Turn raw footage into a clean rough cut. Remove silence, retakes, and dead air, then edit like a document instead of a timeline. Your video never leaves your computer.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        suppressHydrationWarning
        className={`${dmSans.variable} ${spaceGrotesk.variable} h-full antialiased`}
      >
        <body
          className="min-h-full flex flex-col relative"
          suppressHydrationWarning
        >
          {/* Subtle breathing grid background */}
          <div className="fixed inset-0 pointer-events-none z-[-10] flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 bg-grid-pattern opacity-10 animate-breathe mix-blend-overlay [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
          </div>
          <FloatingBoxes />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
