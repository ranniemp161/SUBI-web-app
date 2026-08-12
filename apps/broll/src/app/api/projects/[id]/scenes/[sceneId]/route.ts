import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import { z } from "zod";
import { updateBrollScene } from "@/lib/scenes";
import { MAX_OVERLAY_TEXT_CHARS } from "@/lib/scene-limits";
import { writeRateLimit } from "@/lib/rate-limit";

/**
 * `PATCH /api/projects/:id/scenes/:sceneId` — Scene Studio's override
 * (spec `broll/0001`, feature 6).
 *
 * Only the two fields a creator may override. Everything else about a scene is
 * either measured (the timings, which come from the cited utterance, never from
 * the model) or traced (the chart, which the honesty check proved against the
 * transcript). Letting the client set those would let a request edit a number
 * back into a chart the honesty check had already refused, which is the one
 * thing this app must never allow.
 *
 * Excluding sets a flag rather than deleting, so it stays reversible.
 */

const overrideSchema = z
  .strictObject({
    included: z.boolean().optional(),
    overlayText: z.string().max(MAX_OVERLAY_TEXT_CHARS).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Nothing to update.",
  });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, sceneId } = await params;

  try {
    const user = await getAuthorizedDbUser(clerkId);
    if (!user) {
      return NextResponse.json({ error: "Your account is not set up yet." }, { status: 403 });
    }

    const limit = await writeRateLimit(user.id);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many edits. Try again shortly." }, { status: 429 });
    }

    const parsed = overrideSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "That edit isn't valid." }, { status: 400 });
    }

    // Ownership is enforced inside the statement, so an id belonging to someone
    // else changes nothing and lands here as a 404 rather than a 403. A 403
    // would confirm the scene exists.
    const updated = await updateBrollScene(user.id, id, sceneId, parsed.data);
    if (!updated) return NextResponse.json({ error: "Scene not found." }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    reportError("Failed to update a b-roll scene", error, { projectId: id, sceneId });
    return NextResponse.json({ error: "Couldn't save that change." }, { status: 500 });
  }
}
