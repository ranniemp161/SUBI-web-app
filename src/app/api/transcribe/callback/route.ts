import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";

/** The subset of Deepgram's pre-recorded response we read. */
interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  /** Word with capitalization + terminal punctuation (present with smart_format/punctuate). */
  punctuated_word?: string;
}
interface DeepgramResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: {
      detected_language?: string;
      alternatives?: { transcript?: string; words?: DeepgramWord[] }[];
    }[];
  };
}

/** Our stored transcript shape — what the editor (and edl.ts) consume. */
interface NormalizedTranscript {
  words: { word: string; start: number; end: number; confidence: number }[];
  text: string;
  duration: number;
  language?: string;
}

/**
 * Flatten Deepgram's nested response into the flat {words, text, duration}
 * shape the editor expects (identical to what the local whisper script emits).
 * `punctuated_word` is preferred so retake detection's sentence-splitter still
 * sees terminal punctuation.
 */
function normalizeDeepgram(payload: DeepgramResponse): NormalizedTranscript {
  const channel = payload?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const words = (alt?.words ?? []).map((w) => ({
    word: w.punctuated_word ?? w.word,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
  }));
  return {
    words,
    text: alt?.transcript ?? "",
    duration: payload?.metadata?.duration ?? 0,
    language: channel?.detected_language,
  };
}

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
    const payload = await request.json();

    // Deepgram's callback payload includes an `err_code`/`err_msg` on failure
    // instead of the usual transcription results.
    const failed = typeof payload?.err_code === "string";
    // Store the flat, editor-ready shape on success; leave the transcript
    // untouched on failure (only the status changes).
    const transcript = failed ? undefined : normalizeDeepgram(payload);

    await db
      .update(projects)
      .set({
        ...(transcript ? { transcript } : {}),
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
