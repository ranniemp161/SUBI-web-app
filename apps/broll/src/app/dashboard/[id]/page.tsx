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
import { Badge, Card, StatChip } from "@/components/ui";
import Link from "next/link";

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
  if (!project) notFound();

  const [scenes, freshness, character] = await Promise.all([
    listBrollScenes(user.id, id),
    checkTranscriptFreshness({
      sourceProjectId: project.sourceProjectId,
      storedFingerprint: project.edlFingerprint,
      token: await getToken(),
    }),
    getProjectCharacter(user.id, id),
  ]);

  const [characterAssets, regensUsed] = character
    ? await Promise.all([
        listCharacterAssets(user.id, character.id),
        regenerationsUsed(user.id, character.id),
      ])
    : [[], 0];

  const reusable = character ? [] : await listPickableCharacters(user.id);

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

  const sceneCount = scenes.length;
  const includedCount = scenes.filter((scene) => scene.included).length;
  const hasCharacter = character !== null && characterAssets.length > 0;
  const currentStep = !hasCharacter ? 2 : sceneCount === 0 ? 2 : 3;

  return (
    <div className="max-w-[1400px] w-full mx-auto px-6 sm:px-8 py-8 md:py-10">
      {/* Top Header & Next Step Row */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-8">
        {/* Left Column: Breadcrumb, Title, Metadata Chips */}
        <div className="flex-1 min-w-0">
          <nav className="flex items-center gap-1.5 text-xs text-zinc-400 mb-2">
            <Link
              href="/dashboard"
              className="hover:text-white transition-colors"
            >
              All projects
            </Link>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-300 truncate">{project.name}</span>
          </nav>

          <div className="flex items-center gap-3.5 flex-wrap">
            <h1
              className="text-3xl font-bold tracking-tight text-white"
              style={{ fontFamily: "var(--font-space-grotesk)" }}
            >
              {project.name}
            </h1>
            {hasCharacter ? (
              <Badge variant="accent">
                CHARACTER READY
              </Badge>
            ) : (
              <Badge variant="neutral">
                PHOTO NEEDED
              </Badge>
            )}
          </div>

          <dl className="mt-4 flex flex-wrap gap-2.5 text-xs">
            <StatChip label="Runtime" value={clock(project.durationMs / 1000)} />
            <StatChip label="Segments" value={transcript.segments.length} />
            <StatChip label="Word timings" value={wordCount || "none"} />
            <StatChip
              label="Frame rate"
              value={
                transcript.fps
                  ? `${(transcript.fps.numerator / transcript.fps.denominator).toFixed(2)} fps`
                  : "unknown"
              }
            />
            <StatChip
              label="Source"
              value={transcript.source.kind === "rough-cut" ? "Ruff Cut" : "Uploaded"}
            />
          </dl>
        </div>

        {/* Right Column: Next Step Guide Card */}
        <div className="w-full lg:w-[420px] shrink-0">
          <Card className="p-4 sm:p-5 relative overflow-hidden">
            <div className="flex items-center justify-between text-xs mb-2.5">
              <span className="font-bold tracking-widest text-[10px] uppercase text-zinc-400">
                NEXT STEP
              </span>
              <span className="text-zinc-400 broll-tabular font-medium">
                Step {currentStep} of 4
              </span>
            </div>

            {/* 4-Step Progress Bar */}
            <div className="grid grid-cols-4 gap-1.5 mb-3.5" aria-hidden="true">
              <div className="h-1 rounded-full bg-[var(--broll-accent)]" />
              <div
                className="h-1 rounded-full transition-colors"
                style={{
                  background: hasCharacter
                    ? "var(--broll-accent)"
                    : "rgba(255,255,255,0.15)",
                }}
              />
              <div
                className="h-1 rounded-full transition-colors"
                style={{
                  background:
                    hasCharacter && sceneCount > 0
                      ? "var(--broll-accent)"
                      : "rgba(255,255,255,0.15)",
                }}
              />
              <div className="h-1 rounded-full bg-white/15" />
            </div>

            <p className="text-xs text-zinc-300 mb-4 leading-relaxed">
              {sceneCount === 0 ? (
                "Review your character set below, then open Scene Studio to plan cutaways from your transcript."
              ) : (
                <>
                  <strong className="text-white broll-tabular">{sceneCount}</strong> scenes planned ·{" "}
                  <strong className="text-white broll-tabular">{includedCount}</strong> included in the export. Review them before you render.
                </>
              )}
            </p>

            <div className="flex items-center gap-2.5">
              <Link
                href={`/dashboard/${project.id}/scenes`}
                className="flex-1 text-center py-2.5 px-4 rounded-lg font-bold text-xs transition-colors"
                style={{
                  background: "var(--broll-accent)",
                  color: "var(--broll-accent-foreground)",
                }}
              >
                Open Scene Studio →
              </Link>
              <Link
                href={`/dashboard/${project.id}/scenes`}
                className="py-2.5 px-4 rounded-lg text-xs font-semibold text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
              >
                Export
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {/* Warns if transcript is stale */}
      {freshness === "stale" && (
        <p
          className="broll-glow mb-8 rounded-lg px-4 py-3 text-xs leading-relaxed"
          role="status"
        >
          The Ruff Cut edit has changed since this transcript was taken, so these
          timecodes may no longer match it. This transcript has been left exactly
          as it was — start a new b-roll project to pick up the newer cut.
        </p>
      )}

      {/* Reusing characters if no character yet */}
      {pickable.length > 0 && (
        <CharacterReuse
          projectId={project.id}
          projectStyle={project.style}
          characters={pickable}
        />
      )}

      {/* Character Panel (6-emotion grid + battery meter) */}
      <CharacterPanel
        projectId={project.id}
        characterName={character?.name ?? null}
        initialAssets={reviewAssets}
        initialRegenerationsUsed={regensUsed}
        setPrice={formatUsd(BROLL_CHARACTER_SET_MICROS)}
      />
    </div>
  );
}
