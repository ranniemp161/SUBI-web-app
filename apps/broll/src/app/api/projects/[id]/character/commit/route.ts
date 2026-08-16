import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import { settleBrollHold } from "@repo/billing";
import { BROLL_CHARACTER_SET_COST_MICROS } from "@repo/billing/pricing";
import { getBrollProject, getBrollGenerationState } from "@/lib/projects";
import {
  attachCharacterToProject,
  getBrollCharacter,
  releaseCharacterClaimQuietly,
} from "@/lib/characters";
import { isCharacterAssetPathname } from "@/lib/asset-path";
import { assetByteSize, deleteAssetQuietly, sweepOrphanedAssets } from "@/lib/storage";
import { CHARACTER_EMOTIONS, isCharacterEmotion } from "@/lib/emotions";
import {
  countCharacterAssets,
  listCharacterAssets,
  storeCharacterAssets,
  type StoredAssetInput,
} from "@/lib/assets";

/**
 * `POST /api/projects/:id/character/commit` — make a generated set, or one
 * regenerated variant, durable (spec `broll/0004`).
 *
 * **One route for both cases because they differ only in money.** `set`
 * requires all six emotions and settles the hold; `variant` requires exactly one
 * and moves nothing. A second route would duplicate the pathname validation, the
 * server side sizing and the row write for no gain.
 *
 * **This is where a client supplied string would otherwise become a stored
 * key.** Every pathname is re-validated against `broll/characters/{characterId}/`
 * for a character this caller was proven to own, even though the generate route
 * minted it and the upload route already checked it. Two checks for one property
 * is deliberate (AC-70): a stored `r2_key` pointing at another user's object is a
 * cross user read that no amount of query scoping would catch afterwards.
 *
 * **Pointing the project at its character is its own idempotent statement, and
 * it runs on the repeat branch too** (spec `broll/0007` AC-146). The Neon HTTP
 * driver gives every statement its own transaction, so there is no wider one to
 * wrap the store, the settle and the attach in. A commit that stored the assets
 * and settled the hold and then died would otherwise leave a paid for character
 * with no project pointing at it, and every retry would take the early return
 * and never fix it.
 */

type CommitBody = {
  mode?: unknown;
  characterId?: unknown;
  assets?: unknown;
  costMicros?: unknown;
};

type IncomingAsset = { emotion: string; pathname: string; width: number; height: number };

function parseAssets(raw: unknown): IncomingAsset[] | null {
  if (!Array.isArray(raw)) return null;
  const parsed: IncomingAsset[] = [];

  for (const item of raw) {
    const asset = item as Partial<IncomingAsset>;
    if (
      typeof asset?.emotion !== "string" ||
      typeof asset?.pathname !== "string" ||
      !Number.isInteger(asset?.width) ||
      !Number.isInteger(asset?.height) ||
      (asset.width as number) <= 0 ||
      (asset.height as number) <= 0
    ) {
      return null;
    }
    parsed.push(asset as IncomingAsset);
  }

  return parsed;
}

/**
 * What the run cost us, bounded (AC-16).
 *
 * The figure is computed server side during the run and reported in the stream's
 * terminal line, then handed back here, because `settleBrollHold` runs in this
 * request and the run finished in the previous one. It is **margin reporting
 * only**: it carries no balance effect and is not part of the SUM the cached
 * balance reconciles against, so the worst a lying client can do is distort our
 * own cost data. The clamp bounds even that, and a missing figure falls back to
 * the estimate the reserve row already carries rather than to zero.
 */
function clampCost(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  return Math.min(Math.round(raw), 4 * BROLL_CHARACTER_SET_COST_MICROS);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const user = await getAuthorizedDbUser(clerkId);
    if (!user) {
      return NextResponse.json(
        { error: "Your account is not set up yet." },
        { status: 403 }
      );
    }

    const project = await getBrollProject(user.id, id);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as CommitBody;
    const mode = body.mode === "set" || body.mode === "variant" ? body.mode : null;
    if (!mode) {
      return NextResponse.json(
        { error: "Commit needs a mode of 'set' or 'variant'." },
        { status: 422 }
      );
    }

    const incoming = parseAssets(body.assets);
    if (!incoming) {
      return NextResponse.json({ error: "Malformed asset list." }, { status: 422 });
    }

    // The character these assets belong to, re-validated rather than trusted.
    // Owner scoped, so somebody else's character id is indistinguishable from a
    // missing one, and every pathname below is then checked against this id —
    // which is what makes a mismatched commit impossible.
    const characterId =
      typeof body.characterId === "string" ? body.characterId : null;
    if (!characterId) {
      return NextResponse.json(
        { error: "Commit needs the character it is storing against." },
        { status: 422 }
      );
    }

    const character = await getBrollCharacter(user.id, characterId);
    if (!character) {
      return NextResponse.json({ error: "Character not found." }, { status: 404 });
    }

    // A set is six or it is none (invariant 3). A scene naming a variant that was
    // never generated cannot be composited, so a five of six commit is refused
    // rather than stored.
    const expected = mode === "set" ? CHARACTER_EMOTIONS.length : 1;
    const emotions = new Set(incoming.map((asset) => asset.emotion));
    if (
      incoming.length !== expected ||
      emotions.size !== expected ||
      !incoming.every((asset) => isCharacterEmotion(asset.emotion))
    ) {
      return NextResponse.json(
        {
          error:
            mode === "set"
              ? "A set commit needs exactly one asset per emotion."
              : "A variant commit needs exactly one asset.",
        },
        { status: 422 }
      );
    }

    for (const asset of incoming) {
      if (!isCharacterAssetPathname(asset.pathname, characterId)) {
        return NextResponse.json(
          { error: "That storage path does not belong to this character." },
          { status: 403 }
        );
      }
    }

    const stored = await listCharacterAssets(user.id, characterId);

    // **Idempotent** (AC-71). A retry after a lost response names pathnames that
    // are already stored, and answering 409 there would make a completed
    // purchase look like a failed one. Checked before the hold, because the
    // first call already released it.
    const alreadyStored = incoming.every((asset) =>
      stored.some(
        (row) => row.emotion === asset.emotion && row.pathname === asset.pathname
      )
    );
    if (alreadyStored) {
      // **The attach runs here too, and that is the whole of AC-146.** A first
      // call that stored the assets and settled the hold and then died before
      // attaching leaves the project pointing at nothing; without this line
      // every retry would return early and never repair it, leaving a paid for
      // character no project uses. Idempotent, so a retry that has nothing to
      // fix changes no row.
      await attachCharacterToProject(user.id, id, characterId);
      return NextResponse.json({ assets: stored, settled: false, repeat: true });
    }

    // A `set` commit fills a character that holds nothing yet. Anything else is
    // a second set being written over a character other projects may already be
    // drawing with, which is what the paid re-run's fork exists to avoid.
    if (mode === "set" && (await countCharacterAssets(characterId)) > 0) {
      return NextResponse.json(
        {
          error: "That character already has a set. Generate a new one instead.",
          code: "NOT_FRESH",
        },
        { status: 409 }
      );
    }

    // A `set` commit with no hold left is a run whose claim aged out and was
    // reclaimed, which means the user has already had their money back (AC-63).
    // Storing the images anyway would hand over a refunded set. The idempotent
    // repeat above is the only no-hold case that legitimately succeeds, and it
    // has already returned.
    if (mode === "set") {
      const state = await getBrollGenerationState(user.id, id);
      if (!state || state.holdMicros === null) {
        return NextResponse.json(
          {
            error:
              "This run took too long and was refunded, so nothing was stored. Generate again.",
            code: "NO_HOLD",
          },
          { status: 409 }
        );
      }
    }

    // The browser reports width and height because only it knows the trimmed
    // canvas, but the byte size is checkable, so it is checked rather than
    // believed. A missing object is the difference between "uploaded" and
    // "claimed to have uploaded".
    const sizes = await Promise.all(
      incoming.map((asset) => assetByteSize(asset.pathname))
    );
    const missing = incoming.filter((_, index) => sizes[index] === null);
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Some images never finished uploading (${missing
            .map((asset) => asset.emotion)
            .join(", ")}). Nothing was stored.`,
        },
        { status: 422 }
      );
    }

    const rows: StoredAssetInput[] = incoming.map((asset, index) => ({
      emotion: asset.emotion as StoredAssetInput["emotion"],
      pathname: asset.pathname,
      width: asset.width,
      height: asset.height,
      byteSize: sizes[index] as number,
    }));

    // The row is written **first**, then the superseded object is deleted
    // (invariant 6). The other order leaves an emotion with no image at all if
    // the write fails.
    const { superseded } = await storeCharacterAssets(characterId, rows, mode);

    if (mode === "set") {
      // Point the project at the character it just filled, in the same request
      // that settles the hold (AC-128). Its own statement, and the repeat branch
      // above runs it too, so no ordering here can strand a paid for character
      // with no project pointing at it (AC-146).
      await attachCharacterToProject(user.id, id, characterId);

      // Only the call that flips `hold_micros` to NULL moves money, so a racing
      // second settle is a no-op rather than a second charge. A `set` commit
      // that finds no hold has already been settled — which the idempotency
      // check above will have answered, so reaching here with none is harmless.
      await settleBrollHold(id, {
        status: "generated",
        costMicros: clampCost(body.costMicros),
      });
    } else {
      // A regeneration held the claim on the **character** from the moment it
      // started, so that no other writer could take the same row while it ran
      // (AC-72, AC-132). This is where it lets go. No money moves: a redraw is
      // free, and the claim never touched a balance.
      await releaseCharacterClaimQuietly(user.id, characterId);
    }

    for (const pathname of superseded) await deleteAssetQuietly(pathname);

    const assets = await listCharacterAssets(user.id, characterId);

    // No object outlives its run unreferenced (AC-73, invariant 9). A run that
    // uploaded some images and was abandoned leaves objects no row points at, and
    // on a plan whose failure mode is a thirty day lockout that is not a
    // tidiness problem. Best effort: a sweep that fails must not fail a commit
    // whose assets are already stored, and the scheduled sweep catches the rest.
    //
    // Scoped to the character, because that is what the prefix names now
    // (AC-144). Sweeping the project prefix would list nothing at all and
    // quietly collect nothing.
    try {
      await sweepOrphanedAssets(
        characterId,
        assets.map((asset) => asset.pathname)
      );
    } catch (error) {
      reportError("Orphan sweep failed after commit", error, {
        projectId: id,
        characterId,
      });
    }

    return NextResponse.json({ assets, settled: mode === "set" });
  } catch (error) {
    reportError("Character commit failed", error, { projectId: id });
    return NextResponse.json(
      { error: "Could not store the character set." },
      { status: 500 }
    );
  }
}
