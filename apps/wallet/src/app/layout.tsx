import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { ROUGH_CUT_URL } from "@/lib/env";
import Image from "next/image";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Founder's Frame Credits",
  description:
    "Manage your balance, purchase credit bundles, and configure auto-recharge.",
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
            background: "var(--wallet-surface-sunken)",
            color: "var(--wallet-text-primary)",
          }}
        >
          <header
            className="sticky top-0 z-10"
            style={{
              background: "#111111",
              borderBottom: "1px solid var(--wallet-border-subtle)",
            }}
          >
            <div className="max-w-[1200px] mx-auto px-8 h-16 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Image src="/assets/Icon myframecredits app.png" alt="Founder's Frame" width={28} height={28} className="rounded-md" />
                <span className="font-bold text-[17px] tracking-tight text-white">
                  Founder&apos;s Frame Credits
                </span>
              </div>
              <div className="flex items-center gap-6">
                <a
                  href={ROUGH_CUT_URL}
                  className="text-sm font-medium transition-colors hover:text-white"
                  style={{ color: "var(--wallet-text-secondary)" }}
                >
                  ← Back to MyFirstCut
                </a>
                <UserButton />
              </div>
            </div>
          </header>
          <main className="flex-1" style={{ background: "#111111" }}>{children}</main>
          <footer style={{ borderTop: "1px solid var(--wallet-border-subtle)", background: "#111111" }}>
            <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <a href="#" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Image src="/assets/ff-wordmark.webp" alt="The Founder's Frame" width={180} height={40} style={{ height: 40, width: "auto", margin: "-8px 0", display: "block" }} />
              </a>
              <span style={{ fontSize: 13, color: "#666" }}>A Founder&apos;s Frame product · © 2026 MyFirstCut</span>
            </div>
          </footer>
        </body>
      </html>
    </ClerkProvider>
  );
}
