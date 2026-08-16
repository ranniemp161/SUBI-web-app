import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { formatUsd, BROLL_CHARACTER_SET_MICROS } from "@repo/billing/pricing";
import { getBrollProject } from "@/lib/projects";
import { getProjectCharacter, listPickableCharacters } from "@/lib/characters";
import type { PickerCharacter } from "@/lib/character-picker";
import { listBrollScenes } from "@/lib/scenes";
import { listCharacterAssets, regenerationsUsed } from "@/lib/assets";
import { presignAssetReads } from "@/lib/storage";
import { checkTranscriptFreshness } from "@/lib/staleness";
import { CharacterPanel, type ReviewAsset } from "./character-panel";
import { CharacterReuse } from "./character-reuse";
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

  const [scenes, freshness, character] = await Promise.all([
    listBrollScenes(user.id, id),
    // Advisory only, and never fatal: a linked project asks Ruff Cut whether
    // the edit has moved since this transcript was taken (AC-49).
    checkTranscriptFreshness({
      sourceProjectId: project.sourceProjectId,
      storedFingerprint: project.edlFingerprint,
      token: await getToken(),
    }),
    // The images belong to a character now, so this page reads them through the
    // one the project points at. Null means the project has none yet, which is
    // the state the review gate already handled as "no assets".
    getProjectCharacter(user.id, id),
  ]);

  const [characterAssets, regensUsed] = character
    ? await Promise.all([
        listCharacterAssets(user.id, character.id),
        regenerationsUsed(user.id, character.id),
      ])
    : [[], 0];

  // Offered only while this project has no character, which is what makes "no
  // swap in this feature" true of the screen as well as of the route (spec
  // `broll/0007` AC-123). The two lists are therefore never both non empty.
  const reusable = character ? [] : await listPickableCharacters(user.id);

  // Signed here rather than fetched by the browser, so the first paint of the
  // review gate needs no round trip. The urls point at the blob host, so the
  // images still load directly and no Function sits in the data path (AC-17).
  const signed = await presignAssetReads([
    ...characterAssets.map((asset) => asset.pathname),
    ...reusable.map((entry) => entry.neutralPathname),
  ]).catch(() => []);
  const signedFor = new Map(signed.map((entry) => [entry.pathname, entry.url]));

  const reviewAssets: ReviewAsset[] = characterAssets.map((asset) => ({
    emotion: asset.emotion,
    width: asset.width,
    height: asset.height,
    attempt: asset.attempt,
    url: signedFor.get(asset.pathname) ?? null,
  }));

  const pickable: PickerCharacter[] = reusable.map((entry) => ({
    id: entry.id,
    name: entry.name,
    style: entry.style,
    thumbnailUrl: signedFor.get(entry.neutralPathname) ?? null,
  }));

  const { transcript } = project;
  const wordCount = transcript.segments.reduce(
    (n, s) => n + (s.words?.length ?? 0),
    0
  );

  // The studio card's whole summary, from the query this page already ran.
  const sceneCount = scenes.length;
  const includedCount = scenes.filter((scene) => scene.included).length;

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

      {/* Above the generate path on purpose: reusing a character is free and
          instant, and a creator who owns one should see that before they are
          asked for a photograph and two dollars. */}
      {pickable.length > 0 && (
        <CharacterReuse
          projectId={project.id}
          projectStyle={project.style}
          characters={pickable}
        />
      )}

      <CharacterPanel
        projectId={project.id}
        // Named so the paid re-run can say which character it is leaving
        // behind rather than "the current one" (spec `broll/0007` AC-129).
        characterName={character?.name ?? null}
        initialAssets={reviewAssets}
        initialRegenerationsUsed={regensUsed}
        // Formatted here because the price env override is server side only.
        setPrice={formatUsd(BROLL_CHARACTER_SET_MICROS)}
      />

      {/* The plan lives on its own screen now (AC-94). This card states where
          the plan stands and opens it; the review itself needs the width and
          the two panes that this page cannot give it. */}
      <section className="broll-glass mt-10 rounded-lg px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2
              className="text-sm font-semibold uppercase tracking-wide"
              style={{ color: "var(--broll-muted)" }}
            >
              Scene Studio
            </h2>
            <p className="mt-1 text-sm">
              {sceneCount === 0 ? (
                "No scenes planned yet."
              ) : (
                <>
                  <span className="broll-tabular">{sceneCount}</span> scene
                  {sceneCount === 1 ? "" : "s"} planned,{" "}
                  <span className="broll-tabular">{includedCount}</span> included in the
                  export.
                </>
              )}
            </p>
          </div>

          <Link
            href={`/dashboard/${project.id}/scenes`}
            className="rounded-lg px-4 py-2 text-sm font-semibold"
            style={{
              background: "var(--broll-accent)",
              color: "var(--broll-accent-foreground)",
            }}
          >
            {sceneCount === 0 ? "Plan scenes" : "Open Scene Studio"}
          </Link>
        </div>
      </section>
    </div>
  );
}
