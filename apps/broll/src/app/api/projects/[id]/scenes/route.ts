import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import { z } from "zod";
import { getBrollProject } from "@/lib/projects";
import { createManualScene } from "@/lib/scenes";
import { MAX_OVERLAY_TEXT_CHARS, MAX_MANUAL_SCENES_PER_PROJECT } from "@/lib/scene-limits";
import { sceneCreateRateLimit } from "@/lib/rate-limit";

/**
 * `POST /api/projects/:id/scenes` — add a cutaway the planner missed
 * (spec `broll/0005` AC-79 to AC-83).
 *
 * **The creator picks a transcript segment, not a timecode.** A free timecode
 * field would let a scene land in the middle of a word, and it would be the one
 * place in this app where a timing came from something other than the
 * transcript. Picking a segment keeps `start_ms` measured: it is that segment's
 * own start, read from the stored document.
 *
 * The row carries `origin = 'manual'`, which is what makes it survive a plan
 * re-run and what makes it deletable. Its four planner columns stay NULL, so
 * spec `0002`'s invariant holds unchanged: a hand added scene has no line
 * behind it and no planner score.
 */

const createSchema = z.strictObject({
  /** An index into the stored transcript's segments, not a timecode. */
  segmentIndex: z.int().nonnegative(),
  /**
   * Required, unlike on the edit path. A hand added scene starts as a text
   * card, and a text card with no text is a black frame — nothing on screen
   * says what the creator meant to add.
   */
  overlayText: z.string().min(1).max(MAX_OVERLAY_TEXT_CHARS),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const user = await getAuthorizedDbUser(clerkId);
    if (!user) {
      return NextResponse.json({ error: "Your account is not set up yet." }, { status: 403 });
    }

    // Fails **closed** (AC-83). This brings rows into being, so a limiter that
    // cannot answer must refuse rather than wave it through.
    const limit = await sceneCreateRateLimit(user.id);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many scenes at once. Try again shortly." },
        { status: 429 }
      );
    }

    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      // Named rather than generic, because both failures are ones the creator
      // can act on: an empty caption, or one past the length limit. Create
      // refuses an over long caption rather than truncating it (AC-80) — an
      // edit silently losing its tail is worse than being told.
      return NextResponse.json(
        {
          error: `A scene needs some on screen text, up to ${MAX_OVERLAY_TEXT_CHARS} characters.`,
        },
        { status: 422 }
      );
    }

    // Owner scoped, and the source of the one measured value here.
    const project = await getBrollProject(user.id, id);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

    const segment = project.transcript.segments[parsed.data.segmentIndex];
    if (!segment) {
      return NextResponse.json(
        { error: "That transcript line doesn't exist." },
        { status: 422 }
      );
    }

    // Seconds in the document, milliseconds everywhere the database is
    // involved — the same conversion `utterances.ts` makes, and the reason a
    // scene's start is never a number anyone typed.
    const startMs = Math.max(0, Math.round(segment.start * 1000));

    const created = await createManualScene(user.id, id, {
      startMs,
      overlayText: parsed.data.overlayText.trim(),
    });

    if (created === "at_cap") {
      return NextResponse.json(
        {
          error: `You can add up to ${MAX_MANUAL_SCENES_PER_PROJECT} scenes by hand on one project.`,
        },
        { status: 409 }
      );
    }
    // Ownership is proved inside the insert, so a project that is not this
    // user's writes nothing and answers 404 here, never 403.
    if (!created) return NextResponse.json({ error: "Project not found." }, { status: 404 });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    reportError("Failed to add a b-roll scene", error, { projectId: id });
    return NextResponse.json({ error: "Couldn't add that scene." }, { status: 500 });
  }
}
