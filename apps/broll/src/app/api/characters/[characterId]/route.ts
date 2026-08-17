import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import {
  deleteUnusedCharacter,
  isCharacterClaimLive,
  getBrollCharacter,
  listProjectsUsingCharacter,
  renameCharacter,
} from "@/lib/characters";
import { MAX_CHARACTER_NAME_CHARS } from "@/lib/character-prompt";
import { isUuid } from "@/lib/ids";
import { deleteAssetQuietly } from "@/lib/storage";
import { writeRateLimit } from "@/lib/rate-limit";

/**
 * The character itself, rather than one project's view of it (spec `broll/0007`
 * AC-135, AC-136).
 *
 * **A character belongs to a user, not to a project**, which is why these live
 * here and not under `/api/projects/:id/character`. Renaming and deleting are
 * about the character across every project that draws with it, and routing them
 * through one project would make the other projects invisible to the operation
 * that most needs to see them.
 *
 * Both verbs fail **open** on the rate limiter (AC-140). Neither spends anything
 * at any vendor, so a Redis blip must not stand between a creator and the
 * library they already paid for.
 */

/** Shared preamble: both verbs need the same four checks in the same order. */
async function authorize(characterId: string): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const user = await getAuthorizedDbUser(clerkId);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Your account is not set up yet." },
        { status: 403 }
      ),
    };
  }

  const limit = await writeRateLimit(user.id);
  if (!limit.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Too many changes at once. Try again shortly." },
        { status: 429 }
      ),
    };
  }

  // Validated before it reaches a query: the column is `uuid`, so a malformed
  // string comes back as a database error rather than as the 404 it is.
  if (!isUuid(characterId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Character not found." }, { status: 404 }),
    };
  }

  return { ok: true, userId: user.id };
}

/** `PATCH /api/characters/:characterId` — rename it (AC-135). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ characterId: string }> }
) {
  const { characterId } = await params;
  const gate = await authorize(characterId);
  if (!gate.ok) return gate.response;

  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "Give the character a name." }, { status: 422 });
    }

    const name = body.name.trim();
    if (name.length === 0) {
      return NextResponse.json({ error: "Give the character a name." }, { status: 422 });
    }
    if (name.length > MAX_CHARACTER_NAME_CHARS) {
      return NextResponse.json(
        { error: `Keep the name to ${MAX_CHARACTER_NAME_CHARS} characters or fewer.` },
        { status: 422 }
      );
    }

    // Owner scoped inside the UPDATE, so someone else's character id is
    // indistinguishable from one that does not exist.
    const renamed = await renameCharacter(gate.userId, characterId, name);
    if (!renamed) {
      return NextResponse.json({ error: "Character not found." }, { status: 404 });
    }

    return NextResponse.json({ id: characterId, name });
  } catch (error) {
    reportError("Failed to rename a character", error, { characterId });
    return NextResponse.json({ error: "Couldn't rename that character." }, { status: 500 });
  }
}

/**
 * `DELETE /api/characters/:characterId` — delete one nothing is using (AC-136).
 *
 * **The refusal is the feature.** A character in use is refused with 409
 * `IN_USE` naming the projects that hold it, because the alternative the schema
 * would otherwise give us is worse than an error: `broll_projects` sets its
 * reference to null on delete, so an unguarded delete silently takes the face
 * out of every project drawing with it and there is no undo.
 *
 * **Rows first, objects afterwards, best effort.** Once the rows are gone the
 * stored objects are referenced by nothing, which is exactly what the sweep cron
 * looks for, so an object that fails to delete here is collected on the next run
 * rather than stranded. Doing it the other way round — objects first — is what
 * would strand a row pointing at nothing, and that one is visible to the user as
 * a broken thumbnail.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ characterId: string }> }
) {
  const { characterId } = await params;
  const gate = await authorize(characterId);
  if (!gate.ok) return gate.response;

  try {
    // A redraw writing this character right now would upload into a prefix this
    // request is about to empty, leaving an object no row points at. The sweep
    // would eventually collect it, but refusing costs one read and keeps the
    // creator's own action from racing itself.
    const character = await getBrollCharacter(gate.userId, characterId);
    if (character && isCharacterClaimLive(character.genClaimAt)) {
      return NextResponse.json(
        {
          error: "A redraw of this character is still running. Wait for it to finish.",
          code: "CHARACTER_BUSY",
        },
        { status: 409 }
      );
    }

    const result = await deleteUnusedCharacter(gate.userId, characterId);

    if (result === "not_found") {
      return NextResponse.json({ error: "Character not found." }, { status: 404 });
    }

    if (result === "in_use") {
      // Only read on the refusal path, and only for a caller who has already
      // been proven to own the character.
      const usedBy = await listProjectsUsingCharacter(gate.userId, characterId);
      return NextResponse.json(
        {
          error:
            usedBy.length === 1
              ? `${usedBy[0].name} is still using this character. Detach it there first.`
              : `${usedBy.length} projects are still using this character. Detach it in each one first.`,
          code: "IN_USE",
          usedBy,
        },
        { status: 409 }
      );
    }

    // Best effort, and deliberately not awaited into the failure path: a storage
    // error here must not report a delete that has already happened as failed.
    await Promise.all(result.pathnames.map((pathname) => deleteAssetQuietly(pathname)));

    return NextResponse.json({ id: characterId, deleted: true });
  } catch (error) {
    reportError("Failed to delete a character", error, { characterId });
    return NextResponse.json({ error: "Couldn't delete that character." }, { status: 500 });
  }
}
