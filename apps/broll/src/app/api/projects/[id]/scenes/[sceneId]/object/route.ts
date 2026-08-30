import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import { chargeBrollObjectImage, refundBrollObjectImage } from "@repo/billing";
import { objectAssetPathname } from "@/lib/asset-path";
import { MAX_OBJECT_ATTEMPTS } from "@/lib/object-prompt";
import { isObjectTemplate } from "@/lib/scene-schema";
import { ObjectError, generateObjectImage, isObjectGenerationConfigured } from "@/lib/objects";
import { getObjectSceneContext } from "@/lib/scenes";
import { isStorageConfigured } from "@/lib/storage";
import { objectImageRateLimit } from "@/lib/rate-limit";

/**
 * `POST /api/projects/:id/scenes/:sceneId/object` — draw this scene's
 * illustration (spec `broll/0008`).
 *
 * **Charge, then call, then hand the PNG to the browser.** Eager rather than a
 * hold: this is one image call of about fifteen seconds, not the character set's
 * ~110 second chain, so there is barely a window for a hold to protect. If the
 * call fails after the charge lands, this route refunds it before answering —
 * the creator is never left having paid for a picture they did not get.
 *
 * The response is plain JSON rather than a stream, unlike the character route.
 * There is one image, so there is nothing to report progress *between*; a stream
 * would be ceremony around a single value.
 *
 * **The pathname is minted here and is a server value.** The browser cuts the
 * background out, trims, and PUTs to exactly this pathname; `/api/blob/upload`
 * re-derives and re-checks it before signing, and `commit` checks it a third
 * time before it becomes a stored key. A client supplied string never becomes
 * one.
 *
 * The image bytes come back through this Function once, which is the same trade
 * the character generate route makes and for the same reason: the vendor will
 * not PUT to our store, so the only alternative is the browser calling Gemini
 * with our key.
 */
export async function POST(
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

    if (!isObjectGenerationConfigured()) {
      return NextResponse.json(
        { error: "Illustration generation isn't configured on this server." },
        { status: 503 }
      );
    }
    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: "Storage isn't configured on this server." },
        { status: 503 }
      );
    }

    // Fails **closed**: this spends money at a vendor, so "cannot prove this is
    // within the limit" has to mean refuse.
    const limit = await objectImageRateLimit(user.id);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many illustrations at once. Try again shortly." },
        { status: 429 }
      );
    }

    // Owner scoped, and it answers every question this route has in one round
    // trip. A scene that is not this user's is indistinguishable from one that
    // does not exist.
    const scene = await getObjectSceneContext(user.id, sceneId);
    if (!scene || scene.projectId !== id) {
      return NextResponse.json({ error: "Scene not found." }, { status: 404 });
    }

    if (!scene.subject) {
      // The subject is a claim traced to the transcript, so there is nothing to
      // supply here — a scene without one genuinely has nothing to draw.
      return NextResponse.json(
        { error: "This scene doesn't name anything to illustrate." },
        { status: 422 }
      );
    }
    if (!isObjectTemplate(scene.layoutTemplate)) {
      return NextResponse.json(
        { error: "This scene isn't on a template that draws an object." },
        { status: 422 }
      );
    }
    if (scene.attempt >= MAX_OBJECT_ATTEMPTS) {
      return NextResponse.json(
        { error: `This scene has already had ${MAX_OBJECT_ATTEMPTS} illustrations drawn.` },
        { status: 409 }
      );
    }
    // The caller's key, so a double-click charges once. Absent is allowed and
    // simply means no idempotency, matching the plan route.
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;

    const charge = await chargeBrollObjectImage(user.id, id, idempotencyKey);
    if (charge.status === "insufficient") {
      return NextResponse.json(
        { error: "Not enough credit to draw this illustration.", code: "insufficient" },
        { status: 402 }
      );
    }
    if (charge.status === "not_found") {
      return NextResponse.json({ error: "Scene not found." }, { status: 404 });
    }

    let png: string;
    try {
      // No style is passed: every object is drawn in one flat 2D look,
      // whatever the project's character style is (see `object-prompt.ts`).
      const generated = await generateObjectImage({ subject: scene.subject });
      png = generated.png;
    } catch (error) {
      // Charged and undelivered. Refund before answering, so the failure the
      // creator sees is never one they also paid for.
      await refundBrollObjectImage(user.id, id, idempotencyKey).catch((cause: unknown) => {
        reportError("Failed to refund an undelivered object illustration", cause, {
          projectId: id,
          sceneId,
        });
      });

      if (error instanceof ObjectError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.code === "model_unavailable" ? 503 : 502 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      // Minted server side from the counter the row actually holds, so two
      // requests racing cannot agree on a pathname.
      pathname: objectAssetPathname(sceneId, scene.attempt + 1),
      subject: scene.subject,
      png,
    });
  } catch (error) {
    reportError("Failed to generate a b-roll object illustration", error, {
      projectId: id,
      sceneId,
    });
    return NextResponse.json({ error: "Couldn't draw that illustration." }, { status: 500 });
  }
}
