import { randomBytes } from "crypto";
import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { DeepgramClient } from "@deepgram/sdk";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedProject } from "@/lib/projects";
import { hasValidAccessCode } from "@/lib/access-code";

/**
 * POST /api/transcribe/init
 *
 * Kicks off transcription for a project. The browser extracts audio
 * locally and uploads it directly to Deepgram — our server never sees
 * the file. This route just mints a short-lived, narrowly-scoped Deepgram
 * key so the browser never holds our permanent key, and a random callback
 * token so we can verify the result really came from the request we
 * started (Deepgram's callback isn't signed).
 */
export async function POST(request: Request) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clerkUser = await currentUser();

  if (!hasValidAccessCode(clerkUser?.unsafeMetadata)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const deepgramProjectId = process.env.DEEPGRAM_PROJECT_ID;
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

  if (!deepgramProjectId || !deepgramApiKey) {
    console.error("DEEPGRAM_PROJECT_ID or DEEPGRAM_API_KEY is not set.");
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { projectId } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    const project = await getOwnedProject(projectId, clerkId);

    if (!project) {
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404 }
      );
    }

    const deepgram = new DeepgramClient({ apiKey: deepgramApiKey });

    // Narrowest scope + short TTL — this key only needs to make one
    // transcription request before it expires.
    const tempKey = await deepgram.manage.v1.projects.keys.create(
      deepgramProjectId,
      {
        comment: `rough-cut transcribe init for project ${projectId}`,
        scopes: ["usage:write"],
        time_to_live_in_seconds: 300,
      }
    );

    if (!tempKey.key) {
      console.error("Deepgram did not return a key.", tempKey);
      return NextResponse.json(
        { error: "Failed to start transcription." },
        { status: 502 }
      );
    }

    const callbackToken = randomBytes(32).toString("hex");

    await db
      .update(projects)
      .set({
        transcriptStatus: "processing",
        transcriptCallbackToken: callbackToken,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    const origin = new URL(request.url).origin;
    const callbackUrl = `${origin}/api/transcribe/callback?projectId=${projectId}&token=${callbackToken}`;

    return NextResponse.json({
      temporaryApiKey: tempKey.key,
      callbackUrl,
    });
  } catch (error) {
    console.error("Error initializing transcription:", error);
    return NextResponse.json(
      { error: "Failed to start transcription." },
      { status: 500 }
    );
  }
}
