import { execFile } from "child_process";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedProject } from "@/lib/projects";
import { hasValidAccessCode } from "@/lib/access-code";

/**
 * POST /api/transcribe/whisper
 *
 * Temporary local stand-in for the Deepgram pipeline (src/app/api/transcribe/init
 * + callback routes) while Deepgram project access is being sorted out with the
 * client. The browser uploads the video here instead of straight to Deepgram.
 *
 * Responds as soon as the upload is saved to disk, then runs faster-whisper in
 * the background and writes the transcript when it finishes — the dashboard's
 * existing polling picks up the status change. Whisper on CPU can take minutes
 * for a real video, far longer than the dev cloudflared tunnel's ~100s edge
 * timeout would tolerate on a synchronous request/response.
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

  const formData = await request.formData();
  const projectId = formData.get("projectId");
  const file = formData.get("file");

  if (typeof projectId !== "string" || !(file instanceof File)) {
    return NextResponse.json(
      { error: "projectId and file are required." },
      { status: 400 }
    );
  }

  const project = await getOwnedProject(projectId, clerkId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  await db
    .update(projects)
    .set({ transcriptStatus: "processing", updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  // Everything from here through the upload landing on disk is synchronous
  // (still part of this request). If any of it throws, the project must not
  // be left stuck at "processing" forever — mark it failed before responding.
  let workDir: string;
  let mediaPath: string;

  try {
    workDir = await mkdtemp(join(tmpdir(), "whisper-"));
    mediaPath = join(workDir, file.name || "input.mp4");
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(mediaPath, bytes);
  } catch (error) {
    console.error("Error saving upload for whisper transcription:", error);

    await db
      .update(projects)
      .set({ transcriptStatus: "failed", updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    return NextResponse.json(
      { error: "Failed to save upload." },
      { status: 500 }
    );
  }

  // Not awaited — the response below returns immediately after the upload is
  // saved, and this keeps running on the Node process in the background.
  runWhisper(mediaPath)
    .then((transcript) =>
      db
        .update(projects)
        .set({ transcript, transcriptStatus: "ready", updatedAt: new Date() })
        .where(eq(projects.id, projectId))
    )
    .catch((error) => {
      console.error("Error running local whisper transcription:", error);
      return db
        .update(projects)
        .set({ transcriptStatus: "failed", updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    })
    .finally(() => rm(workDir, { recursive: true, force: true }));

  return NextResponse.json({ received: true });
}

function runWhisper(mediaPath: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const scriptPath = join(process.cwd(), "scripts", "transcribe_whisper.py");

    execFile(
      "python",
      [scriptPath, mediaPath],
      { maxBuffer: 1024 * 1024 * 64 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Could not parse whisper output: ${stdout}`));
        }
      }
    );
  });
}
