import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { db } from "@repo/db";
import { brollProjects } from "@repo/db/schema";
import { eq, desc } from "drizzle-orm";
import { WALLET_URL } from "@/lib/env";
import { formatUsd } from "@repo/billing/pricing";
import { Badge, Card } from "@/components/ui";
import Link from "next/link";

function formatRuntime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function Dashboard() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/sign-in");

  const user = await getAuthorizedDbUser(clerkId);
  if (!user) {
    return (
      <div className="max-w-[1200px] mx-auto px-8 py-24">
        <Card variant="glow" className="p-12 max-w-xl">
          <h1
            className="text-xl font-bold"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            Finishing your account setup
          </h1>
          <p className="mt-3 text-sm text-zinc-400">
            You are signed in, but this account has no record yet. That happens
            when the email on your profile is not both your primary address and
            verified, which is the one thing membership is allowed to follow.
          </p>
          <p className="mt-3 text-sm text-zinc-400">
            Verify your primary email address, then reload this page.
          </p>
        </Card>
      </div>
    );
  }

  const projects = await db
    .select({
      id: brollProjects.id,
      name: brollProjects.name,
      durationMs: brollProjects.durationMs,
      style: brollProjects.style,
      lastOpenedAt: brollProjects.lastOpenedAt,
      createdAt: brollProjects.createdAt,
    })
    .from(brollProjects)
    .where(eq(brollProjects.userId, user.id))
    .orderBy(desc(brollProjects.createdAt))
    .limit(12);

  return (
    <div className="max-w-[1400px] w-full mx-auto px-6 sm:px-8 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-white/[0.08]">
        <div>
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight text-white"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            Your projects
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Each project turns a timed transcript and a photo into timecode-named B-roll clips.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <a
            href={`${WALLET_URL}/dashboard`}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#141518] border border-white/10 text-zinc-300 hover:text-white transition-colors broll-tabular"
          >
            Balance <strong className="text-white">{formatUsd(user.balanceMicros)}</strong> · Top up →
          </a>

          <Link
            href="/dashboard/new"
            className="px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md"
            style={{
              background: "var(--broll-accent)",
              color: "var(--broll-accent-foreground)",
            }}
          >
            + New project
          </Link>
        </div>
      </div>

      {projects.length === 0 ? (
        <Card variant="glow" className="mt-10 p-12 text-center max-w-xl mx-auto">
          <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center bg-[var(--broll-accent)]/10 text-[var(--broll-accent)]">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-white mb-2" style={{ fontFamily: "var(--font-space-grotesk)" }}>
            No projects yet
          </h2>
          <p className="text-xs text-zinc-400 leading-relaxed mb-6">
            A project starts with a timed transcript, either exported from Ruff
            Cut or uploaded as an SRT, VTT, or JSON file.
          </p>
          <Link
            href="/dashboard/new"
            className="inline-block px-5 py-2.5 rounded-lg text-xs font-bold transition-all shadow-lg"
            style={{
              background: "var(--broll-accent)",
              color: "var(--broll-accent-foreground)",
            }}
          >
            Create your first project
          </Link>
        </Card>
      ) : (
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/${p.id}`}
              className="rounded-xl p-5 bg-[#111215] border border-white/[0.08] hover:border-white/20 transition-all group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="font-bold text-base text-white group-hover:text-[var(--broll-accent)] transition-colors truncate">
                    {p.name}
                  </h3>
                  <Badge variant="neutral" size="sm" className="shrink-0">
                    {p.style}
                  </Badge>
                </div>

                <div className="flex items-center gap-3 text-xs text-zinc-400 broll-tabular">
                  <span>Runtime <strong className="text-zinc-200">{formatRuntime(p.durationMs / 1000)}</strong></span>
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-white/5 flex items-center justify-between text-xs">
                <span className="text-[11px] text-zinc-500">
                  {new Date(p.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span className="font-semibold text-xs text-[var(--broll-accent)] group-hover:underline">
                  Open studio →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
