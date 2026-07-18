"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { FeedbackButton } from "@/components/feedback-button";
import CreditsPanel from "@/components/credits-panel";

/**
 * Layout for authenticated app pages (dashboard, editor, etc.).
 *
 * The editor (/dashboard/[id]) is a full-screen studio with its own top bar,
 * so the marketing-style app nav is hidden there. Everything else gets the
 * standard nav with logo + account button.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // /dashboard/<id> is the editor; /dashboard (list) and others keep the nav.
  const isEditor = /^\/dashboard\/[^/]+$/.test(pathname ?? "");

  if (isEditor) {
    return <div className="h-screen bg-background">{children}</div>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <nav className="border-b border-[rgba(255,255,255,0.05)] bg-[#111111]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Image
              src="/assets/Icon myfirstcut app.png"
              alt="MyFirstCut Logo"
              width={28}
              height={28}
              className="h-7 w-7 rounded-[6px]"
            />
            <span className="text-[17px] font-bold text-white tracking-tight">
              MyFirstCut
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <CreditsPanel />
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "h-8 w-8",
                },
              }}
            />
          </div>
        </div>
      </nav>
      <main className="flex-1">{children}</main>
      <footer style={{ borderTop: "1px solid var(--color-surface)", background: "#0c0c0c" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Image src="/assets/ff-wordmark.webp" alt="The Founder's Frame" width={180} height={40} style={{ height: 40, width: "auto", margin: "-8px 0", display: "block" }} />
          </Link>
          <span style={{ fontSize: 13, color: "#666" }}>A Founder&apos;s Frame product · © 2026 MyFirstCut</span>
        </div>
      </footer>
      <FeedbackButton variant="floating" />
    </div>
  );
}
