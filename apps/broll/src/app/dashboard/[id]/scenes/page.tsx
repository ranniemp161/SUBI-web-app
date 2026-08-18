import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import {
  formatUsd,
  BROLL_OBJECT_IMAGE_MICROS,
  BROLL_PLAN_RERUN_MICROS,
} from "@repo/billing/pricing";
import { getBrollProject } from "@/lib/projects";
import { getProjectCharacter } from "@/lib/characters";
import { listBrollScenes } from "@/lib/scenes";
import { listCharacterAssets } from "@/lib/assets";
import { checkTranscriptFreshness } from "@/lib/staleness";
import { SceneStudio } from "./scene-studio";

/**
 * Scene Studio, on its own route (spec `broll/0006` AC-94, AC-95).
 *
 * **The same authorization as the project page, statement for statement.** A
 * second route that loads a project is a second place the owner check has to be
 * right, so this one runs the same `auth()`, the same `getAuthorizedDbUser`,
 * and the same owner scoped queries. A project id the signed in user does not
 * own answers 404 rather than 403, so an id is never confirmed to a stranger.
 *
 * No new endpoint and no new column (AC-113): every value below comes from a
 * query the project page already ran.
 */
export default async function SceneStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scene?: string }>;
}) {
  const { id } = await params;
  const { scene: sceneParam } = await searchParams;

  const { userId: clerkId, getToken } = await auth();
  if (!clerkId) redirect("/sign-in");

  const user = await getAuthorizedDbUser(clerkId);
  if (!user) redirect("/dashboard");

  const project = await getBrollProject(user.id, id);
  // Genuinely absent, or owned by someone else. Both answer 404 rather than
  // 403, so a project id is never confirmed to a stranger (AC-95).
  if (!project) notFound();

  const [scenes, freshness, character] = await Promise.all([
    listBrollScenes(user.id, id),
    // Advisory only, and never fatal: a linked project asks Ruff Cut whether
    // the edit has moved since this transcript was taken. It reaches the
    // creator inside the studio because scene timecodes are exactly what it
    // warns about (AC-114).
    checkTranscriptFreshness({
      sourceProjectId: project.sourceProjectId,
      storedFingerprint: project.edlFingerprint,
      token: await getToken(),
    }),
    // Which character this project draws with, if any. The committed emotions
    // below are read from it rather than from the project, because the images
    // belong to the character now.
    getProjectCharacter(user.id, id),
  ]);

  const characterAssets = character
    ? await listCharacterAssets(user.id, character.id)
    : [];

  return (
    <SceneStudio
      projectId={project.id}
      projectName={project.name}
      initialScenes={scenes}
      // Read here rather than in the browser so the right scene is open in the
      // first paint of a shared link (AC-103).
      initialSceneId={typeof sceneParam === "string" ? sceneParam : null}
      planRuns={project.planRuns}
      // Formatted here because the price env override is server side only.
      rerunPrice={formatUsd(BROLL_PLAN_RERUN_MICROS)}
      // Raw micros rather than a formatted string: the studio multiplies it by
      // however many illustrations are missing. Resolved here for the same
      // reason — the override carries no `NEXT_PUBLIC_` prefix, so a browser
      // read would silently resolve to the default.
      objectImagePriceMicros={BROLL_OBJECT_IMAGE_MICROS}
      outputWidth={project.outputWidth}
      outputHeight={project.outputHeight}
      // Carried as a rational, never a decimal: 30000/1001 is not 29.97, and
      // the difference accumulates into visible drift over a clip.
      fps={{ numerator: project.outputFpsNum, denominator: project.outputFpsDen }}
      // What this project has actually generated, which is what gates the
      // character templates and fills the emotion picker (AC-75, AC-77).
      committedEmotions={characterAssets.map((asset) => asset.emotion)}
      // The lines a hand added scene may sit on, and the lines a manual scene's
      // provenance block is looked up in. The index is what the route resolves
      // the timing from, so it must be the position in the stored document
      // rather than anything computed for display (AC-79).
      transcriptChoices={project.transcript.segments.map((segment, index) => ({
        index,
        startMs: Math.max(0, Math.round(segment.start * 1000)),
        text: segment.text,
      }))}
      stale={freshness === "stale"}
    />
  );
}
