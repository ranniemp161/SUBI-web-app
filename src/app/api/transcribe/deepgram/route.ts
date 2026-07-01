import { randomBytes } from "crypto";
import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedProject } from "@/lib/projects";
import { hasValidAccessCode } from "@/lib/access-code";

/**
 * POST /api/transcribe/deepgram?projectId=<id>
 *
 * Kicks off Deepgram transcription by proxying the media through our own
 * server. The browser can't upload straight to api.deepgram.com — the
 * pre-recorded REST endpoint doesn't send CORS headers, so a cross-origin
 * fetch with an Authorization header is blocked at preflight. So the browser
 * POSTs the raw media here (Content-Type = the file's type) and we forward it
 * to Deepgram with our key and a `callback` URL.
 *
 * With a callback set, Deepgram responds immediately with a request_id and
 * posts the finished transcript to /api/transcribe/callback, which the
 * dashboard's polling picks up — so this route returns as soon as Deepgram has
 * accepted the job, without waiting for transcription to finish.
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

  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

  if (!deepgramApiKey) {
    console.error("DEEPGRAM_API_KEY is not set.");
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 }
    );
  }

  const projectId = new URL(request.url).searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required." }, { status: 400 });
  }

  const project = await getOwnedProject(projectId, clerkId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  // Random token so the (unsigned) Deepgram callback can be verified as ours.
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

  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    punctuate: "true",
    callback: callbackUrl,
  });

  if (!request.body) {
    return NextResponse.json({ error: "No media in request body." }, { status: 400 });
  }

  try {
    // Stream the upload straight through to Deepgram instead of buffering the
    // whole file into memory with arrayBuffer() — a multi-GB Buffer + single
    // socket write is what blew up with EPROTO. `duplex: "half"` is required
    // by Node/undici whenever the fetch body is a stream.
    const dgResponse = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${deepgramApiKey}`,
        "Content-Type":
          request.headers.get("content-type") || "application/octet-stream",
      },
      body: request.body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    if (!dgResponse.ok) {
      const detail = await dgResponse.text();
      console.error("Deepgram rejected the transcription request:", detail);
      // Don't leave the project stuck on "processing" — no callback is coming.
      await db
        .update(projects)
        .set({
          transcriptStatus: "failed",
          transcriptCallbackToken: null,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      return NextResponse.json(
        { error: "Deepgram rejected the request." },
        { status: 502 }
      );
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Error starting Deepgram transcription:", error);
    await db
      .update(projects)
      .set({
        transcriptStatus: "failed",
        transcriptCallbackToken: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    return NextResponse.json(
      { error: "Failed to start transcription." },
      { status: 500 }
    );
  }
}
