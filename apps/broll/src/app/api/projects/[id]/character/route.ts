import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import {
  reserveBrollHold,
  reclaimStaleBrollHold,
  settleBrollHoldQuietly,
} from "@repo/billing";
import { getBrollProject, getProjectCharacterRef } from "@/lib/projects";
import {
  attachCharacterIfUnattached,
  createBrollCharacter,
  getProjectCharacter,
  isCharacterClaimLive,
  listProjectsUsingCharacter,
  resolveCompleteCharacter,
} from "@/lib/characters";
import { regenerationsUsed } from "@/lib/assets";
import { isUuid } from "@/lib/ids";
import { characterAssetPathname } from "@/lib/asset-path";
import { isStorageConfigured } from "@/lib/storage";
import { isCharacterStyle } from "@/lib/styles";
import {
  CharacterError,
  isCharacterConfigured,
  runCharacterChain,
  toBase64,
} from "@/lib/character";
import {
  IMAGE_OUTPUT_COST_MICROS,
  MAX_CHARACTERS_PER_USER,
  MAX_PHOTO_BYTES,
  MAX_REGENERATIONS,
  isAcceptedPhotoType,
} from "@/lib/character-prompt";
import { characterSetRateLimit, writeRateLimit } from "@/lib/rate-limit";

/**
 * `POST /api/projects/:id/character` — turn one photograph into six character
 * variants, streamed as they land (spec `broll/0004`).
 *
 * **The same transport as the planner, for the same two reasons** (AC-21): the
 * Edge runtime with a 300 second ceiling, and a phase line every five seconds
 * that is both the heartbeat and the progress signal. A set takes around 110
 * seconds, which is well past the proxy's idle timeout and past the default
 * function duration.
 *
 * **The photograph has exactly one lifetime: this request** (AC-22). It is read
 * out of the form body, base64'd, handed to turn 1, and dropped. Nothing here
 * writes it, logs it, or puts it in an error. Any logging added to this file
 * later must be checked against that.
 *
 * **Money is reserved before the first Gemini call and settled by `commit`,**
 * not here. The hold spans the gap while the browser segments, trims and uploads
 * six images, which is why the claim's stale window is ten minutes: a run
 * abandoned in that gap refunds itself rather than charging for a set that does
 * not exist (AC-63).
 *
 * **Every run creates a new character, including a paid re-run** (spec
 * `broll/0007` AC-129). That is what makes a re-run safe now that a character
 * can be shared: the images are never written over a character another project
 * may be drawing with. The commit repoints **this** project at the new one and
 * leaves the old character with its assets, its name and its other projects.
 * The cost is an orphan when nobody else was using it, which the characters page
 * exists to let the creator clear.
 */
export const runtime = "edge";
export const maxDuration = 300;

/** The one place the browser is told what the run cost us (AC-16). */
function costOf(images: number): number {
  return images * IMAGE_OUTPUT_COST_MICROS;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Before any charge, and fails closed: this route spends real money at the
  // vendor before it produces anything (AC-68).
  const limit = await characterSetRateLimit(clerkId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many character runs — try again in a bit." },
      { status: 429 }
    );
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

    // Owner scoped in the query, so someone else's project is indistinguishable
    // from a missing one (AC-38).
    const project = await getBrollProject(user.id, id);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    // Two separate credentials, two separate messages. One combined message sent
    // whoever read it to the wrong variable: a server with `GEMINI_API_KEY` set
    // and `BLOB_READ_WRITE_TOKEN` missing said "character generation isn't
    // configured", which points at the key that is fine.
    if (!isCharacterConfigured()) {
      return NextResponse.json(
        { error: "Character generation isn't configured on this server." },
        { status: 503 }
      );
    }
    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: "Storage isn't configured on this server." },
        { status: 503 }
      );
    }

    const style = project.style;
    if (!isCharacterStyle(style)) {
      // The column is free text, so a row written before the style list settled
      // can hold something we have no prompt for. Refusing names the problem;
      // silently picking a style would generate a character in the wrong one.
      return NextResponse.json(
        { error: `This project's style (${style}) is no longer offered.` },
        { status: 409 }
      );
    }

    // **Refused while this project's current character is being redrawn**
    // (AC-149). The two claims sit on different rows by design — a set run
    // claims the project, a redraw claims the character — and this is the one
    // place they have to see each other. Nothing is corrupted without it: the
    // redraw writes the old character and the re-run fills a new one. What is
    // lost is the redraw itself, a picture the creator watched and paid
    // attention for, on a character this request is seconds from detaching them
    // from. Checked before the photo is read, so it costs a query and no bytes.
    const current = await getProjectCharacter(user.id, id);
    if (current && isCharacterClaimLive(current.genClaimAt)) {
      return NextResponse.json(
        {
          error:
            "A redraw of this project's character is still running. Wait for it to finish, then generate a new set.",
          code: "CHARACTER_BUSY",
        },
        { status: 409 }
      );
    }

    const form = await request.formData().catch(() => null);
    const photo = form?.get("photo");
    if (!(photo instanceof File)) {
      return NextResponse.json({ error: "No photo was uploaded." }, { status: 400 });
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      return NextResponse.json(
        { error: "That photo is over 10 MB. Try a smaller one." },
        { status: 413 }
      );
    }
    if (!isAcceptedPhotoType(photo.type)) {
      return NextResponse.json(
        { error: "That file type isn't supported. Use a PNG, JPEG, WebP or HEIC photo." },
        { status: 415 }
      );
    }

    const photoPart = {
      mimeType: photo.type,
      data: toBase64(await photo.arrayBuffer()),
    };

    // The character row exists before turn 1, because every pathname this run
    // mints names it (spec `broll/0007` AC-127). Created **before** the money is
    // reserved so a user at the cap is refused before any charge and before any
    // Gemini call (AC-139); the cost of that order is an empty character row if
    // the reserve then fails, which the sweep collects after a day (AC-130).
    //
    // The name is snapshotted from the project as plain text and the style is
    // the project's setup choice. Neither is a reference: the character is
    // independent of this project from here on.
    const created = await createBrollCharacter({
      userId: user.id,
      name: project.name,
      style,
    });
    if (created.status === "cap_reached") {
      return NextResponse.json(
        {
          error: `You already have ${MAX_CHARACTERS_PER_USER} characters. Delete one you're done with to make room.`,
          code: "CHARACTER_CAP",
        },
        { status: 409 }
      );
    }
    const characterId = created.id;

    // Reserve, then generate, then settle — never check then act (AC-14). An
    // overdraft is rejected by the `users_balance_micros_nonneg` CHECK inside
    // one statement, before a single vendor call is made.
    let reserved = await reserveBrollHold(user.id, id);

    if (reserved.status === "already_held") {
      // A hold that has aged past ten minutes belonged to a run that died. Only
      // then is it ours to reclaim; a live run's hold is left alone, because
      // stealing it would charge the user a second time (AC-15).
      const reclaimed = await reclaimStaleBrollHold(id);
      if (reclaimed) reserved = await reserveBrollHold(user.id, id);
    }

    if (reserved.status === "already_held") {
      return NextResponse.json(
        {
          error: "A character run is already going for this project.",
          code: "ALREADY_RUNNING",
        },
        { status: 409 }
      );
    }
    if (reserved.status === "insufficient") {
      return NextResponse.json(
        { error: "Not enough credits to generate a character set.", code: "INSUFFICIENT_CREDITS" },
        { status: 402 }
      );
    }

    // From here the HTTP 200 is committed, so every later failure arrives inside
    // the terminal line rather than as a status. Callers must read the stream
    // incrementally — `res.json()` will not do.
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let closed = false;

        const send = (value: unknown) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        };

        // The opening line, before any turn: the browser needs the character id
        // to hand back to `commit`, and it must have it even if the run dies
        // partway (spec `broll/0007`, the Value sourcing table). It is the row
        // this route just inserted, never a client value.
        send({ characterId });

        let done = 0;
        const sendPhase = () => send({ phase: "generating", done });
        const heartbeat = setInterval(sendPhase, 5_000);
        sendPhase();

        const finish = (terminal: unknown) => {
          clearInterval(heartbeat);
          send(terminal);
          closed = true;
          controller.close();
        };

        try {
          const { images } = await runCharacterChain({
            style,
            photo: photoPart,
            onTurn: (turn) => {
              done += 1;
              // The pathname is minted here and travels outward only. The
              // browser uploads to exactly this path and cannot choose its own;
              // both the upload route and the commit route re-check it anyway
              // (AC-70). It names the character, not the project (AC-141).
              // `attempt` is 1 because a full set always resets the
              // regeneration count (AC-65).
              send({
                emotion: turn.emotion,
                pathname: characterAssetPathname(characterId, turn.emotion, 1),
                png: turn.png,
                index: done,
              });
            },
          });

          // The browser stores the six images and calls `commit`, which is what
          // settles the hold. Nothing is charged for a set that never lands.
          finish({ done: true, costMicros: costOf(images) });
        } catch (error) {
          // A set is six or it is none (invariant 3). Nothing was stored, so the
          // whole hold comes back and the user can retry for free.
          await settleBrollHoldQuietly(id, { status: "failed" });

          if (error instanceof CharacterError) {
            finish({ error: error.message, code: error.code, refunded: true });
            return;
          }

          reportError("Character set run failed", error, { projectId: id });
          finish({
            error: "The character run failed — you have not been charged. Try again.",
            refunded: true,
          });
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/json",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    reportError("Error starting character run", error, { projectId: id });
    return NextResponse.json(
      { error: "The character run failed — try again." },
      { status: 502 }
    );
  }
}

/**
 * `GET /api/projects/:id/character` — what this project draws with, who else
 * draws with it, and how many free redraws are left (spec `broll/0007`
 * AC-133).
 *
 * **It exists so the redraw control can name the blast radius before it runs.**
 * A regeneration changes the face in every project using that character,
 * including ones the creator considers finished, and the only thing standing
 * between that and a surprise is a warning that names them. The alternative the
 * spec rules out is the browser fetching the whole characters collection and
 * filtering it: that hands a page a list of every character the user owns to
 * answer a question about one, and it would go stale the moment the characters
 * page grows a filter of its own.
 *
 * **The allowance travels with the character, not with the project** (AC-131),
 * which is why it is answered here rather than recomputed per project: the same
 * face reused on a second project has the same redraws left, not a fresh twelve.
 *
 * A project with no character answers 200 with `character: null`, not 404. The
 * 404 is reserved for a project that is not the caller's, so a project id is
 * never confirmed to a stranger.
 */
export async function GET(
  _request: Request,
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

    const project = await getProjectCharacterRef(user.id, id);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const character = await getProjectCharacter(user.id, id);
    if (!character) {
      return NextResponse.json({ character: null, usedBy: [], regenerations: null });
    }

    const [usedBy, used] = await Promise.all([
      listProjectsUsingCharacter(user.id, character.id),
      regenerationsUsed(user.id, character.id),
    ]);

    return NextResponse.json({
      character: {
        id: character.id,
        name: character.name,
        style: character.style,
        busy: isCharacterClaimLive(character.genClaimAt),
      },
      // Every project drawing with it, this one included. The control names the
      // others; the count is what makes "also used by two projects" sayable
      // without a second request.
      usedBy,
      regenerations: {
        used,
        left: Math.max(0, MAX_REGENERATIONS - used),
        max: MAX_REGENERATIONS,
      },
    });
  } catch (error) {
    reportError("Failed to read a project's character", error, { projectId: id });
    return NextResponse.json(
      { error: "Couldn't read this project's character." },
      { status: 500 }
    );
  }
}

/**
 * `PATCH /api/projects/:id/character` — attach a character the creator already
 * owns to this project (spec `broll/0007` AC-122, AC-123, AC-124).
 *
 * **Free, and that is the feature.** The $2.00 bought a reusable character, so
 * attaching one writes no ledger row, takes no hold and touches no balance. The
 * only writes are the project's `broll_character_id` and its `style`.
 *
 * **The server re-checks everything the picker was shown** (AC-147). The picker
 * only offers complete characters, and this route counts the rows again anyway,
 * because "the client was only shown valid options" is not an authorization
 * argument. Ownership is proven the same way: `getBrollCharacter` is owner
 * scoped, so another user's character id is indistinguishable from one that does
 * not exist.
 *
 * **Attaching overwrites the project's style** (AC-148), because a project with
 * a character has that character's style and the six images exist in exactly one
 * of them. The control says so before it sends this.
 *
 * Detaching (`characterId: null`) is not accepted yet: it arrives with the
 * characters page, where the scenes that lose their face are handled too.
 */
export async function PATCH(
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

    // Fails **open**, unlike the generate route above it (AC-140). This spends
    // nothing at any vendor and writes two columns, so a Redis blip must not
    // stand between a creator and the character they already paid for.
    const limit = await writeRateLimit(user.id);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many changes at once. Try again shortly." },
        { status: 429 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      characterId?: unknown;
    };
    // Validated as a uuid before it reaches a query: the column is `uuid`, so a
    // malformed string would come back as a database error rather than as the
    // 422 it is.
    if (typeof body.characterId !== "string" || !isUuid(body.characterId)) {
      return NextResponse.json(
        { error: "Pick a character to use." },
        { status: 422 }
      );
    }
    const characterId = body.characterId;

    // Two columns rather than the whole project: this route has no use for a
    // 5 MB transcript.
    const project = await getProjectCharacterRef(user.id, id);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    if (project.characterId) {
      return NextResponse.json(
        {
          error:
            project.characterId === characterId
              ? "This project already uses that character."
              : "This project already has a character.",
          code: "ALREADY_ATTACHED",
        },
        { status: 409 }
      );
    }

    const resolved = await resolveCompleteCharacter(user.id, characterId);
    if (resolved.status === "not_found") {
      return NextResponse.json(
        { error: "Character not found." },
        { status: 404 }
      );
    }
    if (resolved.status === "incomplete") {
      return NextResponse.json(
        {
          error: "That character isn't finished, so it can't be used yet.",
          code: "INCOMPLETE",
        },
        { status: 409 }
      );
    }
    const character = resolved.character;

    // The refusal above races; this one cannot. A second attach arriving while
    // the first was in flight matches no row here, which is the swap this
    // feature does not do.
    const attached = await attachCharacterIfUnattached(user.id, id, characterId);
    if (!attached) {
      return NextResponse.json(
        { error: "This project already has a character.", code: "ALREADY_ATTACHED" },
        { status: 409 }
      );
    }

    return NextResponse.json({
      character: {
        id: character.id,
        name: character.name,
        style: character.style,
      },
    });
  } catch (error) {
    reportError("Failed to attach a character", error, { projectId: id });
    return NextResponse.json(
      { error: "Couldn't use that character." },
      { status: 500 }
    );
  }
}
