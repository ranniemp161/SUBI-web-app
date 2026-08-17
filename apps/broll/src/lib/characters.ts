import "server-only";
import { db } from "@repo/db";
import { brollAssets, brollCharacters, brollProjects } from "@repo/db/schema";
import { and, asc, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { BROLL_STALE_HOLD_MS } from "@repo/billing/pricing";
import { reportError } from "@repo/server-shared/observability";
import { MAX_CHARACTERS_PER_USER } from "./character-prompt";
import { CHARACTER_EMOTIONS, type CharacterEmotion } from "./emotions";
import { countCharacterAssets } from "./assets";

/**
 * Every query that reaches `broll_characters`, the sibling of `projects.ts`
 * (spec `broll/0007`).
 *
 * **A character is owned by a user, and every path here proves that before it
 * does anything**, the same way every path resolves a project today.
 * `getBrollCharacter` is the single owner scoped read, and a character belonging
 * to somebody else is indistinguishable from one that does not exist (AC-143).
 * That matters more here than it did when images hung off a project, because the
 * character id now appears inside a storage pathname that a client can send us.
 */

/** A character as its owner sees it. */
export type CharacterRow = {
  id: string;
  name: string;
  style: string;
  genClaimAt: Date | null;
  createdAt: Date;
};

/**
 * Create an empty character owned by `userId`, refusing at the cap.
 *
 * **The cap is counted inside the insert, not before it** (AC-139). Reading the
 * count and then inserting on the answer is check-then-act: two generate runs
 * starting together would both read nineteen and both write, and the twenty-first
 * character would exist with nothing to blame. `INSERT … SELECT … WHERE (count)`
 * makes the check and the write one statement, so the loser inserts no row and
 * gets `cap_reached` back.
 *
 * The row is created **before** the money is reserved, so a user at the cap is
 * refused before any charge and before any Gemini call. The cost of that order
 * is an empty character row left behind when the reserve then fails, which is
 * exactly what the sweep collects after a day (AC-130).
 */
export async function createBrollCharacter(input: {
  userId: string;
  name: string;
  style: string;
}): Promise<{ status: "created"; id: string } | { status: "cap_reached" }> {
  const rows = await db.execute(sql`
    INSERT INTO broll_characters (user_id, name, style)
    SELECT ${input.userId}::uuid, ${input.name}::text, ${input.style}::text
    WHERE (
      SELECT count(*) FROM broll_characters WHERE user_id = ${input.userId}::uuid
    ) < ${MAX_CHARACTERS_PER_USER}
    RETURNING id
  `);

  const id = (rows as unknown as { rows: { id?: string }[] }).rows?.[0]?.id;
  return id ? { status: "created", id } : { status: "cap_reached" };
}

/**
 * Owner scoped by construction, like `getBrollProject`. The `user_id` predicate
 * is part of the query rather than a check on the result, so no code path reads
 * somebody else's character and then decides what to do about it (AC-143).
 */
export async function getBrollCharacter(
  userId: string,
  characterId: string
): Promise<CharacterRow | null> {
  const rows = await db
    .select({
      id: brollCharacters.id,
      name: brollCharacters.name,
      style: brollCharacters.style,
      genClaimAt: brollCharacters.genClaimAt,
      createdAt: brollCharacters.createdAt,
    })
    .from(brollCharacters)
    .where(
      and(
        eq(brollCharacters.id, characterId),
        eq(brollCharacters.userId, userId)
      )
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * The character a project draws with, resolved in one owner scoped statement.
 *
 * This is what every page and route that used to read assets "for a project"
 * goes through now. Doing it as one join rather than as a project read followed
 * by a character read keeps the ownership predicate in a single place, and
 * answers null identically for a project that is not yours, a project that does
 * not exist, and a project with no character yet — three cases the caller
 * genuinely should treat the same.
 */
export async function getProjectCharacter(
  userId: string,
  projectId: string
): Promise<CharacterRow | null> {
  const rows = await db
    .select({
      id: brollCharacters.id,
      name: brollCharacters.name,
      style: brollCharacters.style,
      genClaimAt: brollCharacters.genClaimAt,
      createdAt: brollCharacters.createdAt,
    })
    .from(brollProjects)
    .innerJoin(
      brollCharacters,
      eq(brollProjects.brollCharacterId, brollCharacters.id)
    )
    .where(
      and(eq(brollProjects.id, projectId), eq(brollProjects.userId, userId))
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * A character resolved for reuse: owned by this caller, and finished.
 *
 * **One definition of "usable", shared by every path that reuses one** — the
 * attach route and both project creation actions. Splitting it would let the two
 * drift, and the drift that matters is a path accepting a five of six character,
 * which plans scenes around emotions that will never draw.
 *
 * `not_found` covers a character that does not exist and one belonging to
 * somebody else, deliberately: a caller must not be able to tell those apart
 * (AC-143).
 */
export type CharacterResolution =
  | { status: "ok"; character: CharacterRow }
  | { status: "not_found" }
  | { status: "incomplete" };

export async function resolveCompleteCharacter(
  userId: string,
  characterId: string
): Promise<CharacterResolution> {
  const character = await getBrollCharacter(userId, characterId);
  if (!character) return { status: "not_found" };

  // Counted from the rows, never read from a status column, and compared
  // against the emotion list's length rather than against six (AC-125).
  const stored = await countCharacterAssets(characterId);
  if (stored !== CHARACTER_EMOTIONS.length) return { status: "incomplete" };

  return { status: "ok", character };
}

/** One entry of the reuse picker: a finished character, with its face. */
export type PickableCharacter = {
  id: string;
  name: string;
  style: string;
  createdAt: Date;
  /** The `neutral` variant's stored pathname, which the caller signs. */
  neutralPathname: string;
};

/**
 * The characters this user may reuse: the complete ones, newest first (AC-125,
 * AC-126).
 *
 * **Complete is counted from the rows, in the same statement that reads them.**
 * There is no completeness column and there is deliberately not going to be
 * one, so the `HAVING` clause is the definition: a character qualifies when it
 * holds one asset per member of `CHARACTER_EMOTIONS`. Comparing against the
 * array's length rather than against six means growing the emotion set moves
 * this with it, which is the behaviour the spec's follow up asks for.
 *
 * The `neutral` pathname comes out of the same grouped read rather than from a
 * second query per character, because a picker with twenty entries would
 * otherwise be twenty round trips over the Neon HTTP driver before the page
 * paints.
 *
 * This reaches `broll_assets`, whose queries otherwise live in `assets.ts`. It
 * sits here because what it returns is characters: the assets are joined to
 * count them and to pick one key, exactly as `getProjectCharacter` joins
 * `broll_projects` to answer with a character.
 */
export async function listPickableCharacters(
  userId: string
): Promise<PickableCharacter[]> {
  const neutral: CharacterEmotion = "neutral";

  const rows = await db
    .select({
      id: brollCharacters.id,
      name: brollCharacters.name,
      style: brollCharacters.style,
      createdAt: brollCharacters.createdAt,
      neutralPathname: sql<
        string | null
      >`max(case when ${brollAssets.emotion} = ${neutral} then ${brollAssets.r2Key} end)`,
    })
    .from(brollCharacters)
    .innerJoin(brollAssets, eq(brollAssets.brollCharacterId, brollCharacters.id))
    .where(eq(brollCharacters.userId, userId))
    .groupBy(brollCharacters.id)
    .having(sql`count(*) = ${CHARACTER_EMOTIONS.length}`)
    .orderBy(desc(brollCharacters.createdAt));

  // A complete character has a neutral row by definition, so the null branch is
  // unreachable rather than a case to design for. It is filtered instead of
  // asserted because the type says it can be null and a thumbnail-less entry is
  // not worth offering either way.
  return rows.flatMap((row) =>
    row.neutralPathname ? [{ ...row, neutralPathname: row.neutralPathname }] : []
  );
}

/**
 * Point a project at a character, idempotently.
 *
 * **Its own statement, and safe to run twice** (AC-146). The commit route runs
 * this on the repeat branch as well as on the first pass, because the Neon HTTP
 * driver gives each statement its own transaction: there is no wider one to wrap
 * the store, the settle and this attach in. A commit that stored the assets and
 * settled the hold and then died would otherwise leave a paid for character with
 * no project pointing at it, and every retry would return early without fixing
 * it. An idempotent attach reachable from that early return is what closes the
 * gap.
 *
 * The `style` copy is part of the same statement, so the invariant that a
 * project with a character has that character's style cannot be half applied
 * (AC-121).
 *
 * Returns whether a row actually changed, which is only ever used for logging:
 * false means the project already pointed there, which is a success.
 */
export async function attachCharacterToProject(
  userId: string,
  projectId: string,
  characterId: string
): Promise<boolean> {
  return attach(
    userId,
    projectId,
    characterId,
    sql`(p.broll_character_id IS DISTINCT FROM c.id OR p.style IS DISTINCT FROM c.style)`
  );
}

/**
 * Attach, but only to a project that has no character (AC-123).
 *
 * **The same statement with one more predicate, and that predicate is the whole
 * point.** There is no swap in this feature: a project keeps the character it
 * was given until it is detached. Reading the project first and then attaching
 * on the answer is check then act, and the thing it would let through is
 * precisely the swap — two attaches arriving together would both read "no
 * character" and the second would quietly replace the first. Here the second
 * one matches no row and answers false, which the route reports as a refusal.
 *
 * False therefore means "the project already has a character", for a caller
 * that has already proven the project exists and the character is theirs.
 */
export async function attachCharacterIfUnattached(
  userId: string,
  projectId: string,
  characterId: string
): Promise<boolean> {
  return attach(userId, projectId, characterId, sql`p.broll_character_id IS NULL`);
}

/**
 * How long a regeneration claim on a character stays believable.
 *
 * The same ten minutes as the money path's hold, and deliberately the same
 * constant rather than a second literal: both windows exist to answer the one
 * question "did the browser that started this die?", and a character claim that
 * expired sooner than the hold would let a redraw start against a set run that
 * is still legitimately running.
 */
export const CHARACTER_CLAIM_STALE_MS = BROLL_STALE_HOLD_MS;

/**
 * Is this claim from a run that could still be going?
 *
 * Pure, so the paid re-run's refusal (AC-149) can be decided from the row the
 * caller already read rather than by asking the database a second question.
 */
export function isCharacterClaimLive(
  genClaimAt: Date | null,
  now: number = Date.now()
): boolean {
  if (!genClaimAt) return false;
  return now - genClaimAt.getTime() < CHARACTER_CLAIM_STALE_MS;
}

export type CharacterClaimResult = "claimed" | "already_held";

/**
 * Take the write claim on a **character** (spec `broll/0007` AC-132).
 *
 * **The claim is on the thing being written, and that is the whole point of
 * moving it here.** It used to sit on `broll_projects.gen_claim_at`, which
 * serializes writers correctly only while a character belongs to exactly one
 * project. The moment two projects share one, two redraws of the same emotion
 * race through two different projects, both pass a project scoped claim, and the
 * loser's image vanishes with no error — which is precisely the failure spec
 * `0004` AC-72 was written to prevent.
 *
 * **It moves no money, so it does not belong in `@repo/billing`.** The project
 * claim lived there because `gen_claim_at` on `broll_projects` is set and
 * cleared with `hold_micros`, and one writer per money column is that package's
 * reason to exist. Nothing on `broll_characters` touches a balance: this is a
 * mutual exclusion lock over six image rows, so it lives beside the rows.
 *
 * **A stale claim is reclaimed by the claim itself**, not by a sweep. The
 * project claim needed a separate reclaim because it had a hold to refund; here
 * there is nothing to give back, so "older than the window" simply means the
 * row is free. Without that, a browser that died mid redraw would lock the
 * character forever.
 *
 * `already_held` also covers a character that is not this caller's, which no
 * caller can reach: every one of them resolves the character first.
 */
export async function claimCharacterGeneration(
  userId: string,
  characterId: string
): Promise<CharacterClaimResult> {
  const result = await db.execute(sql`
    UPDATE broll_characters
    SET gen_claim_at = now(), updated_at = now()
    WHERE id = ${characterId}::uuid
      AND user_id = ${userId}::uuid
      AND (
        gen_claim_at IS NULL
        OR gen_claim_at < now() - (interval '1 millisecond' * ${CHARACTER_CLAIM_STALE_MS})
      )
    RETURNING id
  `);

  return ((result as unknown as { rows: unknown[] }).rows?.length ?? 0) > 0
    ? "claimed"
    : "already_held";
}

/**
 * Give the claim back. Owner scoped for the same reason every write here is: a
 * caller passing the wrong id can then only ever clear its own lock.
 */
export async function releaseCharacterClaim(
  userId: string,
  characterId: string
): Promise<void> {
  await db.execute(sql`
    UPDATE broll_characters
    SET gen_claim_at = NULL, updated_at = now()
    WHERE id = ${characterId}::uuid
      AND user_id = ${userId}::uuid
      AND gen_claim_at IS NOT NULL
  `);
}

/**
 * Best effort release: a claim that will not clear must never mask a good image
 * or fail a commit whose row is already written. The stale window is the
 * backstop if this is the call that fails.
 */
export async function releaseCharacterClaimQuietly(
  userId: string,
  characterId: string
): Promise<void> {
  try {
    await releaseCharacterClaim(userId, characterId);
  } catch (error) {
    reportError("Failed to release a b-roll character claim", error, {
      characterId,
    });
  }
}

/** A project that draws with a character, as the warning names it. */
export type CharacterUsage = { id: string; name: string };

/**
 * Every project of this caller's that draws with this character (AC-133,
 * AC-136).
 *
 * **This is what makes a redraw's blast radius visible before it happens.** A
 * regeneration changes the face in every project using the character, including
 * ones the creator considers finished, and a warning naming them is the only
 * thing standing between that and a surprise.
 *
 * Scoped to the caller in the statement, so it can never name a project
 * belonging to somebody else who happens to share nothing but a character id
 * they could not have.
 */
export async function listProjectsUsingCharacter(
  userId: string,
  characterId: string
): Promise<CharacterUsage[]> {
  return db
    .select({ id: brollProjects.id, name: brollProjects.name })
    .from(brollProjects)
    .where(
      and(
        eq(brollProjects.brollCharacterId, characterId),
        eq(brollProjects.userId, userId)
      )
    )
    .orderBy(asc(brollProjects.createdAt));
}

/**
 * `listProjectsUsingCharacter` for every character a user owns, grouped, so a
 * library page runs one statement rather than one per character. See
 * `listAssetsByCharacter` in `assets.ts` for why that mattered.
 *
 * Scoped to the caller in the statement, exactly like the single character
 * version, so it can never name somebody else's project. Projects with no
 * character are excluded in SQL rather than skipped afterwards: a creator's
 * unattached projects are most of the table and none of the answer.
 */
export async function listProjectsByCharacter(
  userId: string
): Promise<Map<string, CharacterUsage[]>> {
  const rows = await db
    .select({
      characterId: brollProjects.brollCharacterId,
      id: brollProjects.id,
      name: brollProjects.name,
    })
    .from(brollProjects)
    .where(
      and(
        eq(brollProjects.userId, userId),
        isNotNull(brollProjects.brollCharacterId)
      )
    )
    .orderBy(asc(brollProjects.createdAt));

  const byCharacter = new Map<string, CharacterUsage[]>();
  for (const { characterId, ...project } of rows) {
    if (!characterId) continue;
    const list = byCharacter.get(characterId) ?? [];
    list.push(project);
    byCharacter.set(characterId, list);
  }
  return byCharacter;
}

/**
 * The one attach statement. The `guard` is what the two callers differ by, and
 * nothing else: the join, the two ownership predicates and the style copy are
 * shared so neither caller can lose one of them on its own.
 */
async function attach(
  userId: string,
  projectId: string,
  characterId: string,
  guard: SQL
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE broll_projects p
    SET broll_character_id = c.id,
        style = c.style,
        updated_at = now()
    FROM broll_characters c
    WHERE p.id = ${projectId}::uuid
      AND p.user_id = ${userId}::uuid
      AND c.id = ${characterId}::uuid
      AND c.user_id = ${userId}::uuid
      AND ${guard}
    RETURNING p.id
  `);

  return ((result as unknown as { rows: unknown[] }).rows?.length ?? 0) > 0;
}

/**
 * Rename a character (spec `broll/0007` AC-135).
 *
 * Owner scoped inside the `UPDATE`, like every other write here, so another
 * user's character id matches no row and answers false rather than 403 — which
 * would confirm the character exists. The name is free text and not unique: two
 * characters called "Demo" is a thing a creator is allowed to have.
 *
 * Trimming and the length cap belong to the caller, because the route is where
 * a rejection can be given a message.
 */
export async function renameCharacter(
  userId: string,
  characterId: string,
  name: string
): Promise<boolean> {
  const rows = await db
    .update(brollCharacters)
    .set({ name })
    .where(and(eq(brollCharacters.id, characterId), eq(brollCharacters.userId, userId)))
    .returning({ id: brollCharacters.id });

  return rows.length > 0;
}

/**
 * Delete a character nothing is using, and report the stored objects that are
 * now unreferenced (AC-136).
 *
 * **The in-use refusal is inside the statement, not a read before it.** A
 * `DELETE` guarded by `NOT EXISTS (a project pointing here)` cannot be raced by
 * an attach landing between the check and the delete; reading first and then
 * deleting can, and losing that race deletes the face out from under a project
 * that just claimed it. So a caller that gets `in_use` re-reads to find out
 * which projects, and pays that second query only on the refusal path.
 *
 * **The pathnames come back from the `RETURNING` of the asset delete, before
 * the character row goes.** They are what the route hands to storage afterwards,
 * best effort: an object whose row is already gone is referenced by nothing,
 * which is exactly what the sweep cron collects, so a failed object delete is
 * picked up on the next run rather than stranded forever.
 */
export async function deleteUnusedCharacter(
  userId: string,
  characterId: string
): Promise<{ status: "deleted"; pathnames: string[] } | "in_use" | "not_found"> {
  // Scoped by the join to `broll_characters`, so this cannot reach the assets of
  // a character the caller does not own even though `broll_assets` carries no
  // `user_id` of its own.
  const assets = await db.execute(sql`
    DELETE FROM broll_assets a
    USING broll_characters c
    WHERE a.broll_character_id = c.id
      AND c.id = ${characterId}
      AND c.user_id = ${userId}
      AND NOT EXISTS (
        SELECT 1 FROM broll_projects p WHERE p.broll_character_id = c.id
      )
    RETURNING a.r2_key AS "r2Key"
  `);

  const deleted = await db.execute(sql`
    DELETE FROM broll_characters c
    WHERE c.id = ${characterId}
      AND c.user_id = ${userId}
      AND NOT EXISTS (
        SELECT 1 FROM broll_projects p WHERE p.broll_character_id = c.id
      )
    RETURNING c.id
  `);

  const rows = (deleted as unknown as { rows: { id?: string }[] }).rows ?? [];
  if (rows.length > 0 && rows[0]?.id) {
    const assetRows =
      (assets as unknown as { rows: { r2Key?: string }[] }).rows ?? [];
    return {
      status: "deleted",
      pathnames: assetRows
        .map((row) => row.r2Key)
        .filter((key): key is string => typeof key === "string"),
    };
  }

  // Nothing was deleted: either it is not the caller's character, or a project
  // holds it. The owner scoped read tells the two apart, and a caller that owns
  // it gets to be told which projects.
  const existing = await getBrollCharacter(userId, characterId);
  return existing ? "in_use" : "not_found";
}

/**
 * Detach a project from its character, leaving the character alone (AC-137).
 *
 * **Moves no money and deletes nothing.** The project keeps its character scenes
 * and they say what they need; attaching another character makes them renderable
 * again with no re-plan. The style column is deliberately left as it was: it
 * records the style the existing scenes were planned against, and blanking it
 * would lose that with nothing to replace it.
 *
 * False means the project has no character or is not this caller's — the route
 * has already proven which.
 */
export async function detachCharacterFromProject(
  userId: string,
  projectId: string
): Promise<boolean> {
  const rows = await db
    .update(brollProjects)
    .set({ brollCharacterId: null })
    .where(
      and(
        eq(brollProjects.id, projectId),
        eq(brollProjects.userId, userId),
        isNotNull(brollProjects.brollCharacterId)
      )
    )
    .returning({ id: brollProjects.id });

  return rows.length > 0;
}
