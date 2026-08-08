import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
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
  // is a belt-and-braces case rather than the normal path.
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/sign-in");

  // Also provisions the `users` row lazily, covering the window where Clerk
  // granted a session before the user.created webhook landed.
  //
  // NEVER `return null` from either branch. A page component that returns null
  // falls through to Next's not-found boundary, so a signed-in user in a real,
  // recoverable state gets a bare 404 with nothing to act on. That is exactly
  // what happened the first time this page was opened with a session.
  const user = await getAuthorizedDbUser(clerkId);
  if (!user) {
    return (
      <div className="max-w-[1200px] mx-auto px-8 py-24">
        <div className="broll-glow rounded-xl p-12 max-w-xl">
          <h1
            className="text-xl font-bold"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            Finishing your account setup
          </h1>
          <p className="mt-3 text-sm" style={{ color: "var(--broll-muted)" }}>
            You are signed in, but this account has no record yet. That happens
            when the email on your profile is not both your primary address and
            verified, which is the one thing membership is allowed to follow.
          </p>
          <p className="mt-3 text-sm" style={{ color: "var(--broll-muted)" }}>
            Verify your primary email address, then reload this page.
          </p>
        </div>
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
