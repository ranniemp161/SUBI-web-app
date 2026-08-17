import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { db } from "@repo/db";
import { brollProjects, brollScenes } from "@repo/db/schema";
import { eq, desc, inArray, sql } from "drizzle-orm";
import { formatClock } from "@/lib/utterances";
import { Badge, Card } from "@/components/ui";
import Link from "next/link";

export const metadata = {
  title: "Renders — B-Roll Generator",
};

export default async function RendersPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/sign-in");

  const user = await getAuthorizedDbUser(clerkId);
  if (!user) redirect("/dashboard");

  // Query projects for this user
  const projects = await db
    .select({
      id: brollProjects.id,
      name: brollProjects.name,
      durationMs: brollProjects.durationMs,
      style: brollProjects.style,
      createdAt: brollProjects.createdAt,
    })
    .from(brollProjects)
    .where(eq(brollProjects.userId, user.id))
    .orderBy(desc(brollProjects.createdAt));

  const projectIds = projects.map((p) => p.id);

  // Query scene statistics grouped by project
  const sceneStats =
    projectIds.length > 0
      ? await db
          .select({
            projectId: brollScenes.brollProjectId,
            totalScenes: sql<number>`count(*)`,
            includedScenes: sql<number>`count(case when ${brollScenes.included} then 1 end)`,
            renderedScenes: sql<number>`count(case when ${brollScenes.renderStatus} = 'rendered' then 1 end)`,
          })
          .from(brollScenes)
          .where(inArray(brollScenes.brollProjectId, projectIds))
          .groupBy(brollScenes.brollProjectId)
      : [];

  const statsMap = new Map(
    sceneStats.map((s) => [s.projectId, s])
  );

  return (
    <div className="max-w-[1400px] w-full mx-auto px-6 sm:px-8 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-white/[0.08]">
        <div>
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight text-white"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            Render Hub
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Export status, generated MP4 cutaways, and archives across all your projects.
          </p>
        </div>

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

      {projects.length === 0 ? (
        <Card variant="glow" className="mt-10 p-12 text-center max-w-xl mx-auto">
          <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center bg-[var(--broll-accent)]/10 text-[var(--broll-accent)]">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-white mb-2" style={{ fontFamily: "var(--font-space-grotesk)" }}>
            No renders yet
          </h2>
          <p className="text-xs text-zinc-400 leading-relaxed mb-6">
            When you plan and encode scenes in Scene Studio, your clip archives and render statuses
            will be tracked here.
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
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((proj) => {
            const stats = statsMap.get(proj.id);
            const total = Number(stats?.totalScenes ?? 0);
            const included = Number(stats?.includedScenes ?? 0);
            const rendered = Number(stats?.renderedScenes ?? 0);
            const isFullyRendered = included > 0 && rendered >= included;
            const isPartiallyRendered = rendered > 0 && rendered < included;

            return (
              <Card
                key={proj.id}
                className="p-6 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h2 className="font-bold text-base text-white truncate">
                      {proj.name}
                    </h2>
                    <Badge
                      variant={
                        isFullyRendered
                          ? "success"
                          : isPartiallyRendered
                            ? "warning"
                            : "neutral"
                      }
                      size="sm"
                    >
                      {isFullyRendered
                        ? "ALL RENDERED"
                        : isPartiallyRendered
                          ? "IN PROGRESS"
                          : total > 0
                            ? "NEEDS RENDER"
                            : "NO SCENES"}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-zinc-400 broll-tabular mb-4">
                    <span>Runtime <strong className="text-zinc-200">{formatClock(proj.durationMs)}</strong></span>
                    <span>·</span>
                    <span>Style <strong className="text-zinc-200">{proj.style}</strong></span>
                  </div>

                  {/* Render progress bar */}
                  <div className="rounded-xl p-4 bg-[#16171c] border border-white/5 mb-4">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-zinc-400 font-medium">Clips ready</span>
                      <span className="broll-tabular font-bold text-white">
                        {rendered} of {included} included
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${included > 0 ? Math.min(100, Math.round((rendered / included) * 100)) : 0}%`,
                          background: isFullyRendered ? "#34d399" : "var(--broll-accent)",
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
                  <span className="text-[11px] text-zinc-500">
                    {total} total scene{total === 1 ? "" : "s"}
                  </span>
                  <Link
                    href={`/dashboard/${proj.id}/scenes`}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-200 bg-[#16171c] hover:bg-white/10 border border-white/10 transition-colors"
                  >
                    Open Studio →
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
