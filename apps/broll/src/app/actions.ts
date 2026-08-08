"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  importSrt,
  importVtt,
  parseTranscriptDocument,
  TranscriptParseError,
} from "@repo/transcript";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { createBrollProject } from "@/lib/projects";
import { isCharacterStyle } from "@/lib/styles";
import { ROUGH_CUT_URL } from "@/lib/env";

/**
 * This module may export NOTHING but async functions. Not even a type.
 * Turbopack's server actions transform reads an exported type name as one more
 * runtime export and emits a reference to an identifier that exists only in the
 * type system, so the module throws the moment it is evaluated and every action
 * in it answers 500. It cost Rough Cut a live production outage; no gate
 * catches it. Shared types live in `src/lib/projects.ts`.
 */

const uploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  style: z.string().refine(isCharacterStyle, "Unknown character style"),
  format: z.enum(["srt", "vtt", "json"]),
  text: z.string().min(1),
});

export async function createProjectFromUpload(input: {
  name: string;
  style: string;
  format: string;
  text: string;
}): Promise<{ error: string }> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return { error: "You are not signed in." };

  const user = await getAuthorizedDbUser(clerkId);
  if (!user) return { error: "Your account is not set up yet." };

  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "That input is not valid." };
  }

  let id: string;
  try {
    // The importers validate and throw rather than coerce. A subtitle file
    // carries no frame rate, so the document's `fps` stays null rather than
    // being guessed — nothing in a document is ever fabricated.
    const document =
      parsed.data.format === "srt"
        ? importSrt(parsed.data.text)
        : parsed.data.format === "vtt"
          ? importVtt(parsed.data.text)
          : parseTranscriptDocument(parsed.data.text);

    id = await createBrollProject({
      userId: user.id,
      name: parsed.data.name,
      style: parsed.data.style,
      document,
      // A subtitle upload has no Rough Cut project behind it, which is exactly
      // why `source_project_id` is nullable. A JSON handoff carries its origin
      // inside the document itself.
      sourceProjectId:
        parsed.data.format === "json" ? document.source.projectId : null,
    });
  } catch (error) {
    if (error instanceof TranscriptParseError) return { error: error.message };
    throw error;
  }

  revalidatePath("/dashboard");
  // Outside the try: redirect() signals by throwing, so catching it here would
  // swallow the navigation and report it as a parse failure.
  redirect(`/dashboard/${id}`);
}

/** Accepts a full studio URL or a bare id, because people paste the URL. */
function projectIdFrom(input: string): string | null {
  const trimmed = input.trim();
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  return trimmed.match(uuid)?.[0] ?? null;
}

/**
 * Pulls a transcript straight from Rough Cut, rather than asking the user to
 * export a file and upload it.
 *
 * **Server to server, deliberately.** The browser variant would need a
 * credentialed cross origin fetch, which depends on the `SameSite` setting
 * Clerk puts on its session cookie, and b-roll is getting its own domain rather
 * than a subdomain, so it will be genuinely cross site in production. This path
 * is immune to that: a server fetch has no CORS and no cookie, so it also does
 * not care that the preflight currently 404s under `next dev`.
 *
 * Authorization is a forwarded Clerk session token. All three apps share ONE
 * Clerk instance, so a token minted here verifies over there, and Rough Cut
 * still runs its own owner check on the project. No new trust relationship is
 * introduced: b-roll cannot ask for a project the signed-in user does not own.
 */
export async function importFromRoughCut(input: {
  reference: string;
  name: string;
  style: string;
}): Promise<{ error: string }> {
  const { userId: clerkId, getToken } = await auth();
  if (!clerkId) return { error: "You are not signed in." };

  const user = await getAuthorizedDbUser(clerkId);
  if (!user) return { error: "Your account is not set up yet." };

  const projectId = projectIdFrom(input.reference);
  if (!projectId) {
    return { error: "Paste a Ruff Cut project link, or its project id." };
  }
  if (!isCharacterStyle(input.style)) return { error: "Unknown character style." };
  const name = input.name.trim();
  if (!name || name.length > 200) return { error: "Give the project a name." };

  const token = await getToken();
  if (!token) return { error: "Could not read your session. Sign in again." };

  let id: string;
  try {
    const response = await fetch(
      `${ROUGH_CUT_URL}/api/projects/${projectId}/transcript`,
      {
        headers: { Authorization: `Bearer ${token}` },
        // The transcript is a snapshot of a finished cut; a cached copy would
        // silently serve stale timings after the creator edits again.
        cache: "no-store",
      }
    );

    if (response.status === 401 || response.status === 403) {
      return { error: "Ruff Cut did not recognise that project as yours." };
    }
    if (response.status === 404) {
      return { error: "No such project in Ruff Cut." };
    }
    if (response.status === 409) {
      // The route refuses rather than guessing when the project has no stored
      // frame rate, no transcript, or no edit list. Say which, because the fix
      // is on the Rough Cut side and the user can act on it.
      return {
        error:
          "That project is not ready to hand over yet. Open it in Ruff Cut, reselect the source video, and make at least one cut.",
      };
    }
    if (!response.ok) {
      return { error: `Ruff Cut answered ${response.status}.` };
    }

    const document = parseTranscriptDocument(await response.text());

    id = await createBrollProject({
      userId: user.id,
      name,
      style: input.style,
      document,
      // The real link, and the reason `source_project_id` exists at all.
      sourceProjectId: projectId,
    });
  } catch (error) {
    if (error instanceof TranscriptParseError) return { error: error.message };
    throw error;
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard/${id}`);
}
