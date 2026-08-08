import { auth } from "@clerk/nextjs/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { db } from "@repo/db";
import { brollProjects } from "@repo/db/schema";
import { eq, desc } from "drizzle-orm";
import { WALLET_URL } from "@/lib/env";
import { formatUsd } from "@repo/billing/pricing";

/**
 * The project list. Proves the whole spine is wired: Clerk session -> the
 * shared `users` row -> the shared database -> this app's own tables.
 *
 * NOTE the explicit column list. `broll_projects.transcript` holds a document
 * of up to 5 MB and a list never displays it, so selecting it here would move
 * tens of megabytes per page over the HTTP driver (spec broll/0002, AC-39).
 * Nothing in the database enforces that; it is a convention, so it is stated
 * where it has to hold.
 */
export default async function Dashboard() {
  // proxy.ts already rejected an anonymous request, so a missing session here
  // means something is wrong rather than merely unauthenticated.
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;

  // Also provisions the `users` row lazily, covering the window where Clerk
  // granted a session before the user.created webhook landed.
  const user = await getAuthorizedDbUser(clerkId);
  if (!user) return null;

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
    <div className="max-w-[1200px] mx-auto px-8 py-12">
      <div className="flex items-baseline justify-between">
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ fontFamily: "var(--font-space-grotesk)" }}
        >
          Your projects
        </h1>
        <a
          href={`${WALLET_URL}/dashboard`}
          className="text-sm broll-tabular"
          style={{ color: "var(--broll-muted)" }}
        >
          Balance {formatUsd(user.balanceMicros)} · Top up →
        </a>
      </div>

      {projects.length === 0 ? (
        <div className="broll-glow rounded-xl mt-8 p-12 text-center">
          <p className="text-lg font-semibold">No projects yet</p>
          <p className="mt-2 text-sm" style={{ color: "var(--broll-muted)" }}>
            A project starts with a timed transcript, either exported from Ruff
            Cut or uploaded as an SRT or VTT file.
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4">
          {projects.map((p) => (
            <li key={p.id} className="broll-glass rounded-xl p-5">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{p.name}</span>
                <span
                  className="text-sm broll-tabular"
                  style={{ color: "var(--broll-muted)" }}
                >
                  {Math.round(p.durationMs / 1000)}s · {p.style}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
