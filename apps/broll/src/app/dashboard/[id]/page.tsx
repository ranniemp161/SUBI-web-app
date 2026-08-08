import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { getBrollProject } from "@/lib/projects";
import Link from "next/link";

/** `2:35`, or `1:02:35` once past an hour. Timecodes render tabular so a column of them lines up. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/sign-in");

  const user = await getAuthorizedDbUser(clerkId);
  if (!user) redirect("/dashboard");

  const project = await getBrollProject(user.id, id);
  // Genuinely absent, or owned by someone else. Both answer 404 rather than
  // 403, so a project id is never confirmed to a stranger (AC-38).
  if (!project) notFound();

  const { transcript } = project;
  const wordCount = transcript.segments.reduce(
    (n, s) => n + (s.words?.length ?? 0),
    0
  );

  return (
    <div className="max-w-[900px] mx-auto px-8 py-12">
      <Link
        href="/dashboard"
        className="text-sm"
        style={{ color: "var(--broll-muted)" }}
      >
        ← All projects
      </Link>

      <h1
        className="mt-4 text-2xl font-bold tracking-tight"
        style={{ fontFamily: "var(--font-space-grotesk)" }}
      >
        {project.name}
      </h1>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="inline" style={{ color: "var(--broll-muted)" }}>
            Runtime{" "}
          </dt>
          <dd className="inline broll-tabular">{clock(project.durationMs / 1000)}</dd>
        </div>
        <div>
          <dt className="inline" style={{ color: "var(--broll-muted)" }}>
            Segments{" "}
          </dt>
          <dd className="inline broll-tabular">{transcript.segments.length}</dd>
        </div>
        <div>
          <dt className="inline" style={{ color: "var(--broll-muted)" }}>
            Word timings{" "}
          </dt>
          <dd className="inline broll-tabular">{wordCount || "none"}</dd>
        </div>
        <div>
          <dt className="inline" style={{ color: "var(--broll-muted)" }}>
            Frame rate{" "}
          </dt>
          <dd className="inline broll-tabular">
            {/* Null on a subtitle import, and shown as unknown rather than as a
                plausible looking default. A transcript without a timebase is one
                whose timecodes cannot be trusted, and pretending otherwise is
                exactly the fabrication this format exists to prevent. */}
            {transcript.fps
              ? `${(transcript.fps.numerator / transcript.fps.denominator).toFixed(2)} fps`
              : "unknown"}
          </dd>
        </div>
        <div>
          <dt className="inline" style={{ color: "var(--broll-muted)" }}>
            Source{" "}
          </dt>
          <dd className="inline">
            {transcript.source.kind === "rough-cut" ? "Ruff Cut" : "Uploaded"}
          </dd>
        </div>
      </dl>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--broll-muted)" }}>
        Parsed segments
      </h2>

      <ul className="mt-4 grid gap-2">
        {transcript.segments.map((segment, i) => (
          <li
            key={`${segment.start}-${i}`}
            className="broll-glass rounded-lg px-4 py-3 flex gap-4"
          >
            <span
              className="broll-tabular text-sm shrink-0 pt-0.5"
              style={{ color: "var(--broll-accent)" }}
            >
              {clock(segment.start)}
            </span>
            <span className="text-sm leading-relaxed">{segment.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
