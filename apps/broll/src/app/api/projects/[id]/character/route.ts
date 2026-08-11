import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import {
  reserveBrollHold,
  reclaimStaleBrollHold,
  settleBrollHoldQuietly,
} from "@repo/billing";
import { getBrollProject } from "@/lib/projects";
import { characterAssetPathname } from "@/lib/asset-path";
import { isStorageConfigured } from "@/lib/storage";
import { isCharacterStyle } from "@/lib/styles";
import {
  CharacterError,
  isCharacterConfigured,
  runCharacterChain,
  toBase64,
} from "@/lib/character";
import {
  IMAGE_OUTPUT_COST_MICROS,
  MAX_PHOTO_BYTES,
  isAcceptedPhotoType,
} from "@/lib/character-prompt";
import { characterSetRateLimit } from "@/lib/rate-limit";

/**
 * `POST /api/projects/:id/character` — turn one photograph into six character
 * variants, streamed as they land (spec `broll/0004`).
 *
 * **The same transport as the planner, for the same two reasons** (AC-21): the
 * Edge runtime with a 300 second ceiling, and a phase line every five seconds
 * that is both the heartbeat and the progress signal. A set takes around 110
 * seconds, which is well past the proxy's idle timeout and past the default
 * function duration.
 *
 * **The photograph has exactly one lifetime: this request** (AC-22). It is read
 * out of the form body, base64'd, handed to turn 1, and dropped. Nothing here
 * writes it, logs it, or puts it in an error. Any logging added to this file
 * later must be checked against that.
 *
 * **Money is reserved before the first Gemini call and settled by `commit`,**
 * not here. The hold spans the gap while the browser segments, trims and uploads
 * six images, which is why the claim's stale window is ten minutes: a run
 * abandoned in that gap refunds itself rather than charging for a set that does
 * not exist (AC-63).
 */
export const runtime = "edge";
export const maxDuration = 300;

/** The one place the browser is told what the run cost us (AC-16). */
function costOf(images: number): number {
  return images * IMAGE_OUTPUT_COST_MICROS;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Before any charge, and fails closed: this route spends real money at the
  // vendor before it produces anything (AC-68).
  const limit = await characterSetRateLimit(clerkId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many character runs — try again in a bit." },
      { status: 429 }
    );
  }

  const { id } = await params;

  try {
    const user = await getAuthorizedDbUser(clerkId);
    if (!user) {
      return NextResponse.json(
        { error: "Your account is not set up yet." },
        { status: 403 }
      );
    }

    // Owner scoped in the query, so someone else's project is indistinguishable
    // from a missing one (AC-38).
    const project = await getBrollProject(user.id, id);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    // Two separate credentials, two separate messages. One combined message sent
    // whoever read it to the wrong variable: a server with `GEMINI_API_KEY` set
    // and `BLOB_READ_WRITE_TOKEN` missing said "character generation isn't
    // configured", which points at the key that is fine.
    if (!isCharacterConfigured()) {
      return NextResponse.json(
        { error: "Character generation isn't configured on this server." },
        { status: 503 }
      );
    }
    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: "Storage isn't configured on this server." },
        { status: 503 }
      );
    }

    const style = project.style;
    if (!isCharacterStyle(style)) {
      // The column is free text, so a row written before the style list settled
      // can hold something we have no prompt for. Refusing names the problem;
      // silently picking a style would generate a character in the wrong one.
      return NextResponse.json(
        { error: `This project's style (${style}) is no longer offered.` },
        { status: 409 }
      );
    }

    const form = await request.formData().catch(() => null);
    const photo = form?.get("photo");
    if (!(photo instanceof File)) {
      return NextResponse.json({ error: "No photo was uploaded." }, { status: 400 });
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      return NextResponse.json(
        { error: "That photo is over 10 MB. Try a smaller one." },
        { status: 413 }
      );
    }
    if (!isAcceptedPhotoType(photo.type)) {
      return NextResponse.json(
        { error: "That file type isn't supported. Use a PNG, JPEG, WebP or HEIC photo." },
        { status: 415 }
      );
    }

    const photoPart = {
      mimeType: photo.type,
      data: toBase64(await photo.arrayBuffer()),
    };

    // Reserve, then generate, then settle — never check then act (AC-14). An
    // overdraft is rejected by the `users_balance_micros_nonneg` CHECK inside
    // one statement, before a single vendor call is made.
    let reserved = await reserveBrollHold(user.id, id);

    if (reserved.status === "already_held") {
      // A hold that has aged past ten minutes belonged to a run that died. Only
      // then is it ours to reclaim; a live run's hold is left alone, because
      // stealing it would charge the user a second time (AC-15).
      const reclaimed = await reclaimStaleBrollHold(id);
      if (reclaimed) reserved = await reserveBrollHold(user.id, id);
    }

    if (reserved.status === "already_held") {
      return NextResponse.json(
        {
          error: "A character run is already going for this project.",
          code: "ALREADY_RUNNING",
        },
        { status: 409 }
      );
    }
    if (reserved.status === "insufficient") {
      return NextResponse.json(
        { error: "Not enough credits to generate a character set.", code: "INSUFFICIENT_CREDITS" },
        { status: 402 }
      );
    }

    // From here the HTTP 200 is committed, so every later failure arrives inside
    // the terminal line rather than as a status. Callers must read the stream
    // incrementally — `res.json()` will not do.
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let closed = false;

        const send = (value: unknown) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        };

        let done = 0;
        const sendPhase = () => send({ phase: "generating", done });
        const heartbeat = setInterval(sendPhase, 5_000);
        sendPhase();

        const finish = (terminal: unknown) => {
          clearInterval(heartbeat);
          send(terminal);
          closed = true;
          controller.close();
        };

        try {
          const { images } = await runCharacterChain({
            style,
            photo: photoPart,
            onTurn: (turn) => {
              done += 1;
              // The pathname is minted here and travels outward only. The
              // browser uploads to exactly this path and cannot choose its own;
              // both the upload route and the commit route re-check it anyway
              // (AC-70). `attempt` is 1 because a full set always resets the
              // regeneration count (AC-65).
              send({
                emotion: turn.emotion,
                pathname: characterAssetPathname(id, turn.emotion, 1),
                png: turn.png,
                index: done,
              });
            },
          });

          // The browser stores the six images and calls `commit`, which is what
          // settles the hold. Nothing is charged for a set that never lands.
          finish({ done: true, costMicros: costOf(images) });
        } catch (error) {
          // A set is six or it is none (invariant 3). Nothing was stored, so the
          // whole hold comes back and the user can retry for free.
          await settleBrollHoldQuietly(id, { status: "failed" });

          if (error instanceof CharacterError) {
            finish({ error: error.message, code: error.code, refunded: true });
            return;
          }

          reportError("Character set run failed", error, { projectId: id });
          finish({
            error: "The character run failed — you have not been charged. Try again.",
            refunded: true,
          });
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/json",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    reportError("Error starting character run", error, { projectId: id });
    return NextResponse.json(
      { error: "The character run failed — try again." },
      { status: 502 }
    );
  }
}
