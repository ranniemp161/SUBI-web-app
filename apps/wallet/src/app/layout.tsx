import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { ROUGH_CUT_URL } from "@/lib/env";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SUBI Wallet — Billing & Credits",
  description:
    "Manage your SUBI balance, purchase credit bundles, and configure auto-recharge. Your centralized billing portal for the SUBI ecosystem.",
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
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
            className="sticky top-0 z-10 backdrop-blur-md"
            style={{
              background:
                "color-mix(in srgb, var(--wallet-surface) 85%, transparent)",
              borderBottom: "1px solid var(--wallet-border-subtle)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div className="max-w-5xl mx-auto px-8 h-16 flex items-center justify-between">
              <span className="font-bold text-xl tracking-tight">
                SUBI Wallet
              </span>
              <div className="flex items-center gap-4">
                <a
                  href={ROUGH_CUT_URL}
                  className="text-sm font-medium transition-colors hover:opacity-80"
                  style={{ color: "var(--wallet-text-secondary)" }}
                >
                  Back to Rough Cut
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
