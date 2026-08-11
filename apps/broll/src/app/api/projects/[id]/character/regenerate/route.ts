import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import { claimBrollGeneration, releaseBrollClaimQuietly } from "@repo/billing";
import { getBrollProject } from "@/lib/projects";
import { characterAssetPathname } from "@/lib/asset-path";
import { fetchAssetBytes, isStorageConfigured } from "@/lib/storage";
import { isCharacterEmotion } from "@/lib/emotions";
import { listCharacterAssets, regenerationsUsed } from "@/lib/assets";
import {
  CharacterError,
  isCharacterConfigured,
  regenerateVariant,
  toBase64,
} from "@/lib/character";
import { MAX_REGENERATIONS } from "@/lib/character-prompt";
import { characterRegenRateLimit } from "@/lib/rate-limit";

/**
 * `POST /api/projects/:id/character/regenerate` — redraw one variant, free
 * (spec `broll/0004` AC-64).
 *
 * **The anchor is always the stored `neutral` cutout**, never the original
 * photograph, because the photograph is deliberately never kept (AC-22). That is
 * also why regenerating `neutral` itself drifts and cannot be undone: it anchors
 * on the previous regeneration of itself. `buildNeutralRegenPrompt` and the copy
 * on the control both exist for that.
 *
 * **It takes the claim even though it costs nothing** (AC-72, invariant 7). A
 * regeneration landing while a full set run sits between reserve and commit
 * would have two writers racing for the same emotion row, and the loser's work
 * would vanish with no error. The claim is released by the `variant` commit, or
 * by the ten minute stale reclaim if the browser never gets there.
 *
 * Streams for the same reasons the set route does, minus the chain: one image
 * call can still outlast the proxy's idle timeout.
 */
export const runtime = "edge";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await characterRegenRateLimit(clerkId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many redraws — try again in a bit." },
      { status: 429 }
    );
  }

  const { id } = await params;
  let claimed = false;

  try {
    const user = await getAuthorizedDbUser(clerkId);
    if (!user) {
      return NextResponse.json(
        { error: "Your account is not set up yet." },
        { status: 403 }
      );
    }

    const project = await getBrollProject(user.id, id);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    // Named separately for the same reason as the generate route: the combined
    // message named the wrong missing credential.
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

    const body = (await request.json().catch(() => ({}))) as { emotion?: unknown };
    const emotion = typeof body.emotion === "string" ? body.emotion : "";
    if (!isCharacterEmotion(emotion)) {
      return NextResponse.json({ error: "Unknown emotion." }, { status: 422 });
    }

    // Enforced **before** the Gemini call, so hitting the cap costs nothing
    // (AC-64). Derived from the rows, never stored.
    const used = await regenerationsUsed(user.id, id);
    if (used >= MAX_REGENERATIONS) {
      return NextResponse.json(
        {
          error: `You've used all ${MAX_REGENERATIONS} redraws for this project. Generating the set again gives you a fresh allowance.`,
          code: "REGEN_CAP",
        },
        { status: 409 }
      );
    }

    const assets = await listCharacterAssets(user.id, id);
    const anchorRow = assets.find((asset) => asset.emotion === "neutral");
    const target = assets.find((asset) => asset.emotion === emotion);
    if (!anchorRow) {
      return NextResponse.json(
        { error: "This project has no character set to redraw from yet." },
        { status: 404 }
      );
    }

    // One writer per project at a time. A set run holding the claim wins, and
    // this call is refused rather than queued: the run it would race is about to
    // replace every row anyway.
    if ((await claimBrollGeneration(user.id, id)) === "already_held") {
      return NextResponse.json(
        {
          error: "A character run is already going for this project.",
          code: "ALREADY_RUNNING",
        },
        { status: 409 }
      );
    }
    claimed = true;

    // Read **before** the replacement is stored, which is the whole subtlety of
    // regenerating `neutral`: the anchor is the picture that is about to be
    // superseded.
    const anchorBytes = await fetchAssetBytes(anchorRow.pathname);
    const anchor = { mimeType: "image/png", data: toBase64(anchorBytes) };

    // A new pathname every attempt (AC-69). Vercel's CDN caches blobs for up to
    // a month and an overwrite takes up to sixty seconds to propagate, so
    // writing in place would serve the user back the very cutout they rejected.
    const attempt = (target?.attempt ?? 0) + 1;
    const pathname = characterAssetPathname(id, emotion, attempt);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let closed = false;

        const send = (value: unknown) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        };
        const heartbeat = setInterval(() => send({ phase: "generating" }), 5_000);
        send({ phase: "generating" });

        const finish = (terminal: unknown) => {
          clearInterval(heartbeat);
          send(terminal);
          closed = true;
          controller.close();
        };

        try {
          const turn = await regenerateVariant({ emotion, anchor });
          send({ emotion: turn.emotion, pathname, png: turn.png, index: 1 });
          finish({ done: true });
        } catch (error) {
          // Nothing was stored, so the claim is the only thing to give back.
          await releaseBrollClaimQuietly(id);

          if (error instanceof CharacterError) {
            finish({ error: error.message, code: error.code });
            return;
          }

          reportError("Character regeneration failed", error, { projectId: id, emotion });
          finish({ error: "The redraw failed. Nothing was changed — try again." });
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
    // A failure between taking the claim and opening the stream would otherwise
    // strand the project for ten minutes with no run behind it.
    if (claimed) await releaseBrollClaimQuietly(id);
    reportError("Error starting character regeneration", error, { projectId: id });
    return NextResponse.json({ error: "The redraw failed — try again." }, { status: 502 });
  }
}
