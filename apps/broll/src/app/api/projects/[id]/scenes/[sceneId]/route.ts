import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import { z } from "zod";
import { deleteBrollScene, getSceneEditContext, updateBrollScene } from "@/lib/scenes";
import { MAX_OVERLAY_TEXT_CHARS } from "@/lib/scene-limits";
import { LAYOUT_TEMPLATES } from "@/lib/scene-schema";
import { CHARACTER_EMOTIONS } from "@/lib/emotions";
import { canUseTemplate, isCharacterTemplate } from "@/lib/scene-templates";
import { sceneCreateRateLimit, writeRateLimit } from "@/lib/rate-limit";

/**
 * `PATCH` and `DELETE` on one scene — Scene Studio's edit surface
 * (spec `broll/0005`).
 *
 * **Presentation is editable; claims are not.** A creator may change the
 * template, the emotion, the words on screen and whether the scene ships. They
 * may never change the chart's numbers or the scene's timings: both are traced
 * back to the transcript, and editing either would let a request put back a
 * figure the honesty check had just refused to store.
 *
 * That rule is enforced by the **shape** of the schema below rather than by a
 * blocklist. It names four fields and drops everything else, so a column added
 * later is unwritable until someone deliberately adds it here — there is no
 * list of forbidden fields for anyone to forget to update.
 *
 * **Unknown fields are ignored, not rejected** (AC-76). A body carrying
 * `visualType` or `chart` beside a valid caption has those fields stripped
 * before anything reads the object, and the caption still saves. `z.object`
 * rather than `z.strictObject` is what does that, and the difference is
 * deliberate: refusing the whole request would make one stray field cost the
 * edit the creator actually made, and it protects nothing extra, because a
 * stripped field never reaches a column either way.
 *
 * Excluding sets a flag rather than deleting, so it stays reversible. Deleting
 * is reserved for a scene the creator added by hand.
 */

const overrideSchema = z
  .object({
    included: z.boolean().optional(),
    overlayText: z.string().max(MAX_OVERLAY_TEXT_CHARS).nullable().optional(),
    layoutTemplate: z.enum(LAYOUT_TEMPLATES).optional(),
    emotion: z.enum(CHARACTER_EMOTIONS).nullable().optional(),
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

    // Fail open, unlike the create path below: this writes columns and spends
    // nothing at any vendor, so a Redis blip must not block a review.
    const limit = await writeRateLimit(user.id);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many edits. Try again shortly." }, { status: 429 });
    }

    const parsed = overrideSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "That edit isn't valid." }, { status: 400 });
    }
    const body = parsed.data;

    // Only when the request touches a field whose validity depends on the
    // scene's own data. An `included` toggle stays one statement.
    if (body.layoutTemplate !== undefined || body.emotion !== undefined) {
      const context = await getSceneEditContext(user.id, id, sceneId);
      if (!context) return NextResponse.json({ error: "Scene not found." }, { status: 404 });

      if (
        body.layoutTemplate !== undefined &&
        !canUseTemplate(body.layoutTemplate, {
          hasChart: context.hasChart,
          hasCharacterSet: context.committedEmotions.length > 0,
          hasObject: context.hasObject,
        })
      ) {
        return NextResponse.json(
          { error: "This scene can't be drawn as that template." },
          { status: 422 }
        );
      }

      if (body.emotion) {
        // The template **after** this request, which is what the emotion has to
        // be valid against. Judging it against the row's current template would
        // refuse the one request a creator actually makes: switch this scene to
        // a character template and set its emotion, in one go.
        const template = body.layoutTemplate ?? context.layoutTemplate;
        if (!isCharacterTemplate(template)) {
          return NextResponse.json(
            { error: "Only a character template carries an emotion." },
            { status: 422 }
          );
        }
        if (!context.committedEmotions.includes(body.emotion)) {
          return NextResponse.json(
            { error: "That emotion hasn't been generated for this project." },
            { status: 422 }
          );
        }
      }
    }

    // Ownership is enforced inside the statement, so an id belonging to someone
    // else changes nothing and lands here as a 404 rather than a 403. A 403
    // would confirm the scene exists.
    const updated = await updateBrollScene(user.id, id, sceneId, body);
    if (!updated) return NextResponse.json({ error: "Scene not found." }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    reportError("Failed to update a b-roll scene", error, { projectId: id, sceneId });
    return NextResponse.json({ error: "Couldn't save that change." }, { status: 500 });
  }
}

/**
 * `DELETE /api/projects/:id/scenes/:sceneId` — remove a scene the creator added
 * by hand (AC-81).
 *
 * **A planner scene is never deletable, and says so as a 404.** Excluding it is
 * the reversible answer, and a distinct status would tell a caller that a scene
 * it may not touch exists — the same reason another user's id answers 404.
 */
export async function DELETE(
  _request: Request,
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

    // Fails **closed**, unlike the edit path: this destroys a row, so "cannot
    // prove this is within the cap" has to mean refuse (AC-83).
    const limit = await sceneCreateRateLimit(user.id);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many changes at once. Try again shortly." },
        { status: 429 }
      );
    }

    const deleted = await deleteBrollScene(user.id, id, sceneId);
    if (!deleted) return NextResponse.json({ error: "Scene not found." }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    reportError("Failed to delete a b-roll scene", error, { projectId: id, sceneId });
    return NextResponse.json({ error: "Couldn't delete that scene." }, { status: 500 });
  }
}
