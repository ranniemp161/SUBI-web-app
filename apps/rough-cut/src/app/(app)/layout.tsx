"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
      <nav className="border-b border-foreground/5">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
              <svg
                className="h-4 w-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <span className="text-lg font-bold text-foreground">
              Ruff Cut
            </span>
          </Link>
          <UserButton
            appearance={{
              elements: {
                avatarBox: "h-8 w-8",
              },
            }}
          />
        </div>
      </nav>
      <main className="flex-1">{children}</main>
    </div>
  );
}
