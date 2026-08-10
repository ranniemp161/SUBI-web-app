import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import { chargeBrollPlanRerun, refundBrollPlanRerun } from "@repo/billing";
import { getBrollProject } from "@/lib/projects";
import { listBrollScenes, replacePlannerScenes } from "@/lib/scenes";
import { mergeSegmentsIntoUtterances } from "@/lib/utterances";
import {
  runScenePlan,
  sceneCountTarget,
  estimateTokens,
  isPlannerConfigured,
  buildPlannerPrompt,
  PlannerError,
  MAX_PLAN_INPUT_TOKENS,
  type PlanPhase,
} from "@/lib/planner";
import { planRateLimit } from "@/lib/rate-limit";

/**
 * `POST /api/projects/:id/plan` — turn this project's transcript into a ranked
 * list of proposed cutaway scenes (spec `broll/0003`).
 *
 * **Both halves of the AI Cut precedent, not just the streaming half** (AC-59).
 * Streaming defeats the proxy's idle timeout; it does nothing about the
 * function duration ceiling, which is a separate limit — so this route sets
 * both, exactly as `rough-cut`'s `ai-cut/route.ts` does.
 */
export const runtime = "edge";
export const maxDuration = 300;

/** A credits hiccup must never mask the real planner error. */
async function refundQuietly(
  userId: string,
  projectId: string,
  idempotencyKey: string | undefined,
  charged: boolean
) {
  // A bundled first run moved no money, so there is nothing to give back.
  // Refunding one anyway would credit a user who was never debited.
  if (!charged) return;

  try {
    await refundBrollPlanRerun(userId, projectId, idempotencyKey);
  } catch (error) {
    reportError("Failed to refund b-roll plan run", error, { projectId });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fail closed on a money path (AC-26).
  const limit = await planRateLimit(clerkId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many plan runs — try again in a bit." },
      { status: 429 }
    );
  }

  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;

  try {
    const { id } = await params;

    const user = await getAuthorizedDbUser(clerkId);
    if (!user) {
      return NextResponse.json({ error: "Your account is not set up yet." }, { status: 403 });
    }

    // Owner scoped in the query. Someone else's project is indistinguishable
    // from a missing one, so an id is never confirmed to a stranger.
    const project = await getBrollProject(user.id, id);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    if (!isPlannerConfigured()) {
      return NextResponse.json(
        { error: "The planner isn't configured on this server." },
        { status: 503 }
      );
    }

    // The merge runs before the stream opens because the size gate below is
    // measured on its output, and that gate must answer a real HTTP status
    // rather than an error buried in a 200 (AC-55). It is pure, synchronous and
    // fast; the `merging` phase line still leads the stream so the client can
    // describe what happened.
    const utterances = mergeSegmentsIntoUtterances(project.transcript.segments);
    if (utterances.length === 0) {
      return NextResponse.json(
        { error: "This transcript has no speech in it to plan against." },
        { status: 409 }
      );
    }

    const sceneTarget = sceneCountTarget(project.durationMs);
    const estimatedTokens = estimateTokens(buildPlannerPrompt(utterances, sceneTarget));
    if (estimatedTokens > MAX_PLAN_INPUT_TOKENS) {
      // Checked **before** the charge, so an oversized transcript is never
      // billed (AC-55). The message names the limit rather than saying "too
      // big", because the user cannot act on a limit they cannot see.
      return NextResponse.json(
        {
          error: `This transcript is about ${estimatedTokens.toLocaleString()} tokens, over the planner's limit of ${MAX_PLAN_INPUT_TOKENS.toLocaleString()}. Plan a shorter one.`,
          code: "TRANSCRIPT_TOO_LONG",
        },
        { status: 413 }
      );
    }

    // Eager charge, like `chargeAiCut`: a plan run is one synchronous call, so
    // there is no hold to reconcile. The first run on a project is bundled into
    // the character set price and comes back `bundled` (AC-25).
    const charge = await chargeBrollPlanRerun(user.id, id, idempotencyKey);
    if (charge.status === "insufficient") {
      return NextResponse.json(
        { error: "Not enough credits to re-run the plan.", code: "INSUFFICIENT_CREDITS" },
        { status: 402 }
      );
    }
    if (charge.status === "not_found") {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const charged = charge.status === "charged";

    // From here the HTTP 200 is already committed, so every later failure
    // arrives as `{"error"}` inside the terminal line rather than as a status.
    // Callers must read the stream incrementally — `res.json()` will not do.
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let currentPhase: PlanPhase = "merging";
        let closed = false;

        const send = (value: unknown) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        };
        const sendPhase = () => send({ phase: currentPhase });

        // The heartbeat and the phase signal are the same line: at least one
        // every five seconds keeps the proxy from killing a connection that is
        // simply waiting on a long model call (AC-52).
        const heartbeat = setInterval(sendPhase, 5_000);
        sendPhase();

        const finish = (terminal: unknown) => {
          clearInterval(heartbeat);
          send(terminal);
          closed = true;
          controller.close();
        };

        try {
          const { scenes, rejections } = await runScenePlan({
            utterances,
            sceneTarget,
            onPhase: (phase) => {
              currentPhase = phase;
              sendPhase();
            },
          });

          // The write's own outcome feeds the refund decision, which is the
          // whole point of committing before deciding: a charge that lands
          // against a failed write has bought the user nothing (AC-53).
          const committed = await replacePlannerScenes(id, scenes);

          if (committed === 0) {
            await refundQuietly(user.id, id, idempotencyKey, charged);
            finish({
              scenes: [],
              rejected: rejections,
              refunded: charged,
              error: "The planner did not produce a usable scene. You have not been charged.",
            });
            return;
          }

          // Read back what was actually stored rather than echoing what we
          // meant to store: the list the user sees is then the list in the
          // database, ids and all.
          const stored = await listBrollScenes(user.id, id);
          finish({ scenes: stored, rejected: rejections });
        } catch (error) {
          await refundQuietly(user.id, id, idempotencyKey, charged);

          if (error instanceof PlannerError) {
            finish({ error: error.message, code: error.code, refunded: charged });
            return;
          }

          reportError("Scene plan run failed", error, { projectId: id });
          finish({
            error: "The plan run failed — you have not been charged. Try again.",
            refunded: charged,
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
    reportError("Error starting scene plan", error);
    return NextResponse.json({ error: "The plan run failed — try again." }, { status: 502 });
  }
}
