import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import {
  formatUsd,
  BROLL_PLAN_RERUN_MICROS,
  BROLL_CHARACTER_SET_MICROS,
} from "@repo/billing/pricing";
import { getBrollProject } from "@/lib/projects";
import { listBrollScenes } from "@/lib/scenes";
import { listCharacterAssets, regenerationsUsed } from "@/lib/assets";
import { presignAssetReads } from "@/lib/storage";
import { checkTranscriptFreshness } from "@/lib/staleness";
import { PlanPanel } from "./plan-panel";
import { CharacterPanel, type ReviewAsset } from "./character-panel";
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

  const { userId: clerkId, getToken } = await auth();
  if (!clerkId) redirect("/sign-in");

  const user = await getAuthorizedDbUser(clerkId);
  if (!user) redirect("/dashboard");

  const project = await getBrollProject(user.id, id);
  // Genuinely absent, or owned by someone else. Both answer 404 rather than
  // 403, so a project id is never confirmed to a stranger (AC-38).
  if (!project) notFound();

  const [scenes, freshness, characterAssets, regensUsed] = await Promise.all([
    listBrollScenes(user.id, id),
    // Advisory only, and never fatal: a linked project asks Ruff Cut whether
    // the edit has moved since this transcript was taken (AC-49).
    checkTranscriptFreshness({
      sourceProjectId: project.sourceProjectId,
      storedFingerprint: project.edlFingerprint,
      token: await getToken(),
    }),
    listCharacterAssets(user.id, id),
    regenerationsUsed(user.id, id),
  ]);

  // Signed here rather than fetched by the browser, so the first paint of the
  // review gate needs no round trip. The urls point at the blob host, so the
  // images still load directly and no Function sits in the data path (AC-17).
  const signed = await presignAssetReads(
    characterAssets.map((asset) => asset.pathname)
  ).catch(() => []);
  const signedFor = new Map(signed.map((entry) => [entry.pathname, entry.url]));

  const reviewAssets: ReviewAsset[] = characterAssets.map((asset) => ({
    emotion: asset.emotion,
    width: asset.width,
    height: asset.height,
    attempt: asset.attempt,
    url: signedFor.get(asset.pathname) ?? null,
  }));

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

      {/* Warns, never replaces: the stored transcript is what every scene's
          timecode is measured against, so refreshing it silently would move
          scenes under a plan the user already reviewed (AC-49). */}
      {freshness === "stale" && (
        <p
          className="broll-glow mt-6 rounded-lg px-4 py-3 text-sm"
          role="status"
        >
          The Ruff Cut edit has changed since this transcript was taken, so these
          timecodes may no longer match it. This transcript has been left exactly
          as it was — start a new b-roll project to pick up the newer cut.
        </p>
      )}

      <CharacterPanel
        projectId={project.id}
        initialAssets={reviewAssets}
        initialRegenerationsUsed={regensUsed}
        // Formatted here because the price env override is server side only.
        setPrice={formatUsd(BROLL_CHARACTER_SET_MICROS)}
      />

      <PlanPanel
        projectId={project.id}
        initialScenes={scenes}
        planRuns={project.planRuns}
        // Formatted here because the price env override is server side only.
        rerunPrice={formatUsd(BROLL_PLAN_RERUN_MICROS)}
        outputWidth={project.outputWidth}
        outputHeight={project.outputHeight}
        // Carried as a rational, never a decimal: 30000/1001 is not 29.97, and
        // the difference accumulates into visible drift over a clip.
        fps={{ numerator: project.outputFpsNum, denominator: project.outputFpsDen }}
      />

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
