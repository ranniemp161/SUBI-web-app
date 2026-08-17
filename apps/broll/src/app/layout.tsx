import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { ROUGH_CUT_URL } from "@/lib/env";
import Link from "next/link";
import { NavLinks } from "./nav-links";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "B-Roll Generator",
  description:
    "Turn a timed transcript and a photo into a folder of timecode-named B-roll clips, ready to drag into your edit.",
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
          suppressHydrationWarning
          className="min-h-full flex flex-col"
          style={{
            background: "var(--broll-background)",
            color: "var(--broll-foreground)",
          }}
        >
          <header
            className="sticky top-0 z-30 shrink-0"
            style={{
              background: "rgba(0, 0, 0, 0.85)",
              backdropFilter: "blur(12px)",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div className="w-full max-w-[1600px] mx-auto px-6 sm:px-8 h-14 flex items-center justify-between">
              <div className="flex items-center gap-8">
                <Link href="/dashboard" className="flex items-center gap-2.5 group">
                  <span
                    className="w-6 h-6 rounded-md flex items-center justify-center font-black text-xs shrink-0 transition-transform group-hover:scale-105"
                    style={{
                      background: "var(--broll-accent)",
                      color: "var(--broll-accent-foreground)",
                      boxShadow: "0 0 12px var(--broll-brand-muted)",
                    }}
                  >
                    B
                  </span>
                  <span
                    className="font-bold text-[15px] tracking-tight text-white"
                    style={{ fontFamily: "var(--font-space-grotesk)" }}
                  >
                    B-Roll Generator
                  </span>
                </Link>

                <NavLinks />
              </div>

              <div className="flex items-center gap-5">
                <a
                  href={ROUGH_CUT_URL}
                  className="text-xs font-medium transition-colors hover:text-white"
                  style={{ color: "var(--broll-muted)" }}
                >
                  ← Back to Ruff Cut
                </a>
                <div className="flex items-center">
                  <UserButton />
                </div>
              </div>
            </div>
          </header>
          <main className="flex-1 flex flex-col">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
