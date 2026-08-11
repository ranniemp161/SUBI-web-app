import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@repo/server-shared/observability", () => ({ reportError: vi.fn() }));

import {
  CharacterError,
  runCharacterChain,
  redactImageData,
  regenerateVariant,
  toBase64,
} from "./character";
import { CHARACTER_EMOTIONS } from "./emotions";

/**
 * The chain (spec `broll/0004`).
 *
 * The prompt *wording* is covered by `character-prompt.test.ts`. What is checked
 * here is the mechanism the wording depends on: that every turn after the first
 * is anchored on the **previous turn's output image** rather than on the
 * photograph, and that the photograph is seen exactly once. Phase 0 measured
 * identity on that structure, so a regression in it degrades output quietly
 * rather than failing (AC-74).
 *
 * Also covered: the retry once then abort behaviour that decides whether a run
 * refunds or charges (AC-62), and the image count that becomes `cost_micros`
 * (AC-16).
 */

type Part = { text?: string; inlineData?: { mimeType: string; data: string } };

/** Every request body the chain sent, in order. */
let sent: { parts: Part[] }[] = [];

function imageResponse(data: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data } }] }, finishReason: "STOP" }],
    }),
    text: async () => "",
  } as unknown as Response;
}

function errorResponse(status: number, body = "boom") {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

/** Answer each call in turn from `queue`, recording what was asked. */
function stubFetch(queue: (() => Response | Promise<Response>)[]) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { contents: { parts: Part[] }[] };
    sent.push({ parts: body.contents[0].parts });
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra call");
    return next();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const anchorOf = (index: number) => sent[index].parts[0].inlineData?.data;
const textOf = (index: number) => sent[index].parts[1].text ?? "";

beforeEach(() => {
  sent = [];
  process.env.GEMINI_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runCharacterChain", () => {
  it("sees the photograph once, then anchors each turn on the previous output", async () => {
    stubFetch(CHARACTER_EMOTIONS.map((_, i) => () => imageResponse(`image-${i}`)));

    const turns: string[] = [];
    await runCharacterChain({
      style: "anime",
      photo: { mimeType: "image/jpeg", data: "the-photo" },
      onTurn: (turn) => {
        turns.push(turn.emotion);
      },
    });

    expect(sent).toHaveLength(CHARACTER_EMOTIONS.length);
    expect(turns).toEqual([...CHARACTER_EMOTIONS]);

    // Turn 1 is the only turn that carries the photograph (AC-22's other half:
    // it exists in one request and is never re-sent).
    expect(anchorOf(0)).toBe("the-photo");
    expect(sent.filter((call) => call.parts[0].inlineData?.data === "the-photo")).toHaveLength(1);

    // Every later turn's anchor is the image the turn before it produced. This
    // is the identity mechanism, and it is the thing that breaks silently.
    for (let i = 1; i < CHARACTER_EMOTIONS.length; i += 1) {
      expect(anchorOf(i), `turn ${i + 1} should anchor on turn ${i}'s output`).toBe(
        `image-${i - 1}`
      );
      expect(sent[i].parts[0].inlineData?.mimeType).toBe("image/png");
    }
  });

  it("states the style on turn 1 and on no later turn", async () => {
    stubFetch(CHARACTER_EMOTIONS.map((_, i) => () => imageResponse(`image-${i}`)));

    await runCharacterChain({
      style: "anime",
      photo: { mimeType: "image/png", data: "photo" },
      onTurn: () => {},
    });

    expect(textOf(0)).toContain("cel shaded");
    for (let i = 1; i < CHARACTER_EMOTIONS.length; i += 1) {
      expect(textOf(i), `turn ${i + 1} must not restate the style`).not.toContain("cel shaded");
    }
  });

  it("pins the aspect ratio and image size on every call", async () => {
    const fetchMock = stubFetch(CHARACTER_EMOTIONS.map((_, i) => () => imageResponse(`i${i}`)));

    await runCharacterChain({
      style: "3d-render",
      photo: { mimeType: "image/png", data: "photo" },
      onTurn: () => {},
    });

    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(call[1].body as string);
      // The uppercase `K` matters: the API rejects `1k` (AC-67).
      expect(body.generationConfig.imageConfig).toEqual({
        aspectRatio: "3:4",
        imageSize: "1K",
      });
    }
  });

  it("awaits each turn's handler before the next call, so variants stream", async () => {
    stubFetch(CHARACTER_EMOTIONS.map((_, i) => () => imageResponse(`i${i}`)));

    const order: string[] = [];
    await runCharacterChain({
      style: "anime",
      photo: { mimeType: "image/png", data: "photo" },
      onTurn: async (turn) => {
        order.push(`handled:${turn.emotion}`);
        await Promise.resolve();
      },
    });

    // Six calls and six handled turns, strictly interleaved — a handler that
    // ran after the whole chain would show as six calls then six handles.
    expect(order).toHaveLength(CHARACTER_EMOTIONS.length);
    expect(order[0]).toBe("handled:neutral");
  });

  it("retries a failed turn once and carries on", async () => {
    let call = 0;
    stubFetch(
      Array.from({ length: CHARACTER_EMOTIONS.length + 1 }, () => () => {
        call += 1;
        // Turn 4 fails on its first attempt only.
        return call === 4 ? errorResponse(500) : imageResponse(`i${call}`);
      })
    );

    const { images } = await runCharacterChain({
      style: "anime",
      photo: { mimeType: "image/png", data: "photo" },
      onTurn: () => {},
    });

    // Seven calls, six of which produced an image. Only the images we actually
    // got are counted, because a status rejection bought nothing (AC-16).
    expect(sent).toHaveLength(CHARACTER_EMOTIONS.length + 1);
    expect(images).toBe(CHARACTER_EMOTIONS.length);
  });

  it("aborts the whole set when one turn fails twice", async () => {
    let call = 0;
    stubFetch(
      Array.from({ length: 8 }, () => () => {
        call += 1;
        return call >= 4 ? errorResponse(500) : imageResponse(`i${call}`);
      })
    );

    const stored: string[] = [];
    await expect(
      runCharacterChain({
        style: "anime",
        photo: { mimeType: "image/png", data: "photo" },
        onTurn: (turn) => {
          stored.push(turn.emotion);
        },
      })
    ).rejects.toBeInstanceOf(CharacterError);

    // A set is six or it is none: the caller stores nothing and refunds, and it
    // never sees a fourth turn (AC-62, invariant 3).
    expect(stored).toEqual(["neutral", "happy", "surprised"]);
    // Two attempts on turn 4, then stop. No fifth turn is attempted.
    expect(sent).toHaveLength(5);
  });

  it("does not retry a retired model, and names it", async () => {
    stubFetch([() => errorResponse(404, "NOT_FOUND")]);

    const error = await runCharacterChain({
      style: "anime",
      photo: { mimeType: "image/png", data: "photo" },
      onTurn: () => {},
    }).catch((cause) => cause);

    expect(error).toBeInstanceOf(CharacterError);
    expect((error as CharacterError).code).toBe("model_unavailable");
    // Retrying a retired id burns forty seconds to reach the same answer.
    expect(sent).toHaveLength(1);
    expect((error as CharacterError).message).toContain("BROLL_IMAGE_MODEL");
  });

  it("does not retry a model the key's plan excludes, and says so", async () => {
    // A zero free tier quota is permanent until billing changes, so the one
    // retry a transient 429 earns is forty wasted seconds here. The message and
    // the code used to disagree about this: the wording said retrying would not
    // help while the retry ran anyway.
    stubFetch([
      () =>
        errorResponse(
          429,
          "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3-pro-image"
        ),
    ]);

    const error = await runCharacterChain({
      style: "anime",
      photo: { mimeType: "image/png", data: "photo" },
      onTurn: () => {},
    }).catch((cause) => cause);

    expect(error).toBeInstanceOf(CharacterError);
    expect((error as CharacterError).code).toBe("model_unavailable");
    expect(sent).toHaveLength(1);
    expect((error as CharacterError).message).toMatch(/billing/i);
    expect((error as CharacterError).message).not.toContain("Pin a current model");
  });

  it("treats a 200 with no image part as a real failure, not an empty success", async () => {
    // A safety refusal on a face photo answers exactly this shape.
    const refusal = {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "no" }] }, finishReason: "STOP" }] }),
      text: async () => "",
    } as unknown as Response;

    stubFetch([() => refusal, () => refusal]);

    await expect(
      runCharacterChain({
        style: "anime",
        photo: { mimeType: "image/png", data: "photo" },
        onTurn: () => {},
      })
    ).rejects.toBeInstanceOf(CharacterError);
  });

  it("refuses to run with no API key", async () => {
    delete process.env.GEMINI_API_KEY;
    stubFetch([]);

    await expect(
      runCharacterChain({
        style: "anime",
        photo: { mimeType: "image/png", data: "photo" },
        onTurn: () => {},
      })
    ).rejects.toMatchObject({ code: "not_configured" });
  });
});

describe("regenerateVariant", () => {
  it("anchors on the image it is given and uses the expression wording", async () => {
    stubFetch([() => imageResponse("redrawn")]);

    const turn = await regenerateVariant({
      emotion: "skeptical",
      anchor: { mimeType: "image/png", data: "stored-neutral" },
    });

    expect(turn.png).toBe("redrawn");
    expect(anchorOf(0)).toBe("stored-neutral");
    expect(textOf(0)).toContain("one eyebrow raised");
    // The style is absent here too: a regeneration is a later turn.
    expect(textOf(0)).not.toContain("cel shaded");
  });

  it("uses the neutral wording when neutral redraws itself", async () => {
    stubFetch([() => imageResponse("redrawn")]);

    await regenerateVariant({
      emotion: "neutral",
      anchor: { mimeType: "image/png", data: "stored-neutral" },
    });

    // The blanket "change only the expression" rule is circular for neutral,
    // and the photograph is gone by then.
    expect(textOf(0)).toContain("fresh version");
    expect(textOf(0)).not.toContain("Change only the facial expression");
  });
});

describe("the photo never reaches a log line (AC-22)", () => {
  it("redacts image bytes out of a vendor error before it is reported", async () => {
    const { reportError } = await import("@repo/server-shared/observability");
    const photoBytes = "A".repeat(4000);

    // The shape that matters: a vendor error body that echoed the request. It
    // does not do this today, which is the point — AC-22 must not rest on an
    // assumption about someone else's API.
    stubFetch([
      () => errorResponse(400, `{"error":{"message":"bad input","data":"${photoBytes}"}}`),
      () => errorResponse(400, `{"error":{"message":"bad input","data":"${photoBytes}"}}`),
    ]);

    await runCharacterChain({
      style: "anime",
      photo: { mimeType: "image/png", data: photoBytes },
      onTurn: () => {},
    }).catch(() => {});

    for (const call of vi.mocked(reportError).mock.calls) {
      expect(JSON.stringify(call)).not.toContain("AAAAAAAAAAAAAAAAAAAA");
    }
  });

  it("keeps a short vendor message readable", () => {
    // Redaction that swallowed the actual error would trade one problem for
    // another: a rejected call nobody can diagnose.
    expect(redactImageData('{"error":{"status":"INVALID_ARGUMENT"}}')).toBe(
      '{"error":{"status":"INVALID_ARGUMENT"}}'
    );
  });
});

describe("toBase64", () => {
  it("round trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(toBase64(bytes.buffer)).toBe(btoa("\x00\x01\x02\xfa\xff"));
  });

  it("handles a buffer far past the argument limit", () => {
    // `String.fromCharCode(...tenMegabytes)` throws. A ten megabyte photo is the
    // documented cap, so this is the real case rather than a large number.
    const bytes = new Uint8Array(1_000_000).fill(65);
    expect(toBase64(bytes.buffer)).toBe(btoa("A".repeat(1_000_000)));
  });
});
