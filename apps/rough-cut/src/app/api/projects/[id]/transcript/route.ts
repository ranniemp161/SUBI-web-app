/**
 * `GET /api/projects/:id/transcript` — the project's timed transcript as the
 * document b-roll consumes (spec _root/0001, AC-9, AC-10, AC-15).
 *
 * Output is identical to the export modal's download in every field but
 * `generatedAt`, because both call `buildProjectTranscriptDocument`. That is
 * the point: one builder, so a creator's downloaded file and the file b-roll
 * fetches can never describe the same cut differently.
 */
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { serializeTranscriptDocument, TRANSCRIPT_MEDIA_TYPE } from "@repo/transcript";
import { getOwnedProject } from "@/lib/projects";
import { readRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";
import { buildProjectTranscriptDocument } from "@/lib/export/transcript-document";
import { BROLL_URL } from "@/lib/env";
import type { EDL, Transcript } from "@/lib/edl";

/**
 * Cross origin headers for the b-roll browser call, or nothing at all.
 *
 * The allowed origin is named explicitly and compared exactly — never a
 * wildcard, and never reflected back from whatever the caller sent. A
 * transcript is the user's own content, and `credentials: include` (which this
 * needs, so the Clerk session travels) is not even legal alongside `*`.
 *
 * `BROLL_URL` is null until b-roll has a domain, and a null simply means no
 * cross origin caller is authorized yet.
 */
function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!BROLL_URL || !origin || origin !== BROLL_URL) return {};
  return {
    "Access-Control-Allow-Origin": BROLL_URL,
    "Access-Control-Allow-Credentials": "true",
    // Varying on Origin keeps a cached same origin response from being handed
    // to a cross origin caller, and the other way round.
    Vary: "Origin",
  };
}

export async function OPTIONS(request: Request) {
  const cors = corsHeaders(request);
  if (Object.keys(cors).length === 0) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...cors,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const cors = corsHeaders(request);
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: cors });
  }

  // Same bucket as the other cheap authenticated reads.
  const limit = await readRateLimit(clerkId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a bit and try again." },
      { status: 429, headers: cors }
    );
  }

  try {
    const { id } = await params;
    // The users row plus projects.user_id IS the authorization. A signed in
    // non owner gets the same 404 as a missing project — the existence of
    // someone else's project is not this caller's business.
    const project = await getOwnedProject(id, clerkId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404, headers: cors });
    }

    // AC-10: no stored rate means no timebase, and a transcript without a
    // timebase is a set of timecodes nobody can trust. Refuse, and name the
    // fix — every project that predates the columns is in this state until it
    // is opened and reselected once.
    if (project.sourceFpsNum === null || project.sourceFpsDen === null) {
      return NextResponse.json(
        {
          error:
            "This project has no stored frame rate yet. Open it in Rough Cut and reselect your source video once, then try again.",
        },
        { status: 409, headers: cors }
      );
    }

    if (!project.transcript) {
      return NextResponse.json(
        { error: "This project has no transcript yet." },
        { status: 409, headers: cors }
      );
    }

    // Without an EDL there are no kept ranges, and reporting a duration of
    // zero for an uncut video would be a fabricated number. The EDL is built
    // the first time the project is opened, so refusing and saying so is
    // accurate rather than obstructive.
    if (!project.edl) {
      return NextResponse.json(
        { error: "This project has no edit yet. Open it in Rough Cut once, then try again." },
        { status: 409, headers: cors }
      );
    }

    const document = buildProjectTranscriptDocument({
      projectId: project.id,
      edl: project.edl as EDL,
      transcript: project.transcript as Transcript,
      fps: { numerator: project.sourceFpsNum, denominator: project.sourceFpsDen },
      wordsAligned: project.wordsAligned,
    });

    // Explicit no-store: this is per-user content and must never be served
    // stale or shared across users by an intermediary.
    return new NextResponse(serializeTranscriptDocument(document), {
      headers: {
        ...cors,
        "Content-Type": TRANSCRIPT_MEDIA_TYPE,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    reportError("Error building project transcript", error);
    return NextResponse.json(
      { error: "Failed to build the transcript." },
      { status: 500, headers: cors }
    );
  }
}
