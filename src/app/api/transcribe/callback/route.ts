import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/transcribe/callback
 *
 * Deepgram posts the finished transcript here. There's no Clerk session on
 * this request — Deepgram is calling us directly — and Deepgram doesn't
 * sign its callback payloads, so the per-project random token in the query
 * string is the only thing standing between this route and anyone who
 * guesses the URL. Compare it with a timing-safe equality check.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const token = url.searchParams.get("token");

  const isValidUuid =
    !!projectId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      projectId
    );

  if (!isValidUuid || !token) {
    return NextResponse.json(
      { error: "Missing projectId or token." },
      { status: 400 }
    );
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project?.transcriptCallbackToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const expected = Buffer.from(project.transcriptCallbackToken);
  const provided = Buffer.from(token);

  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const transcript = await request.json();

    // Deepgram's callback payload includes an `err_code`/`err_msg` on failure
    // instead of the usual transcription results.
    const failed = typeof transcript?.err_code === "string";

    await db
      .update(projects)
      .set({
        transcript,
        transcriptStatus: failed ? "failed" : "ready",
        // One-time use — clear it so the URL can't be replayed.
        transcriptCallbackToken: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Error processing transcribe callback:", error);
    await db
      .update(projects)
      .set({
        transcriptStatus: "failed",
        transcriptCallbackToken: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    return NextResponse.json(
      { error: "Failed to process callback." },
      { status: 500 }
    );
  }
}
