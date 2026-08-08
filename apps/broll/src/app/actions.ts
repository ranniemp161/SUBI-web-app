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
