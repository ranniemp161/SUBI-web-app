import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { ROUGH_CUT_URL } from "@/lib/env";

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
            className="sticky top-0 z-10"
            style={{
              background: "var(--broll-background)",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div className="max-w-[1200px] mx-auto px-8 h-16 flex items-center justify-between">
              <span
                className="font-bold text-[17px] tracking-tight"
                style={{ fontFamily: "var(--font-space-grotesk)" }}
              >
                B-Roll Generator
              </span>
              <div className="flex items-center gap-6">
                <a
                  href={ROUGH_CUT_URL}
                  className="text-sm font-medium transition-colors"
                  style={{ color: "var(--broll-muted)" }}
                >
                  ← Back to Ruff Cut
                </a>
                <UserButton />
              </div>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
