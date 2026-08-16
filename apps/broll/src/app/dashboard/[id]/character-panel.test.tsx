/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const probeSegmentation = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
const getToken = vi.hoisted(() =>
  vi.fn<(options: { skipCache: boolean }) => Promise<string>>(
    async () => "fresh-session-token"
  )
);
// Typed by signature rather than by an implementation with unused parameters,
// so the assertions below can read `calls[0][0]` and the lint rule about unused
// mock arguments stays satisfied.
const uploadPresigned = vi.hoisted(() =>
  vi.fn<(pathname: string, blob: Blob, options: unknown) => Promise<void>>(
    async () => undefined
  )
);

vi.mock("@/lib/segmentation", () => ({
  probeSegmentation,
  removeCharacterBackground: vi.fn(),
}));
vi.mock("@/lib/trim", () => ({ trimTransparent: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ uploadPresigned }));
// The panel asks Clerk for a fresh session token before it retries an upload,
// so it needs the hook. Rendering inside a real `<ClerkProvider>` would put a
// network dependency in a unit test for the sake of one function.
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken }) }));
// The panel re-reads the server after a paid re-run, because that run repoints
// the project at a different character (spec `broll/0007` AC-129).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CharacterPanel, putPresignedWithRetry } from "./character-panel";
import { CHARACTER_EMOTIONS } from "@/lib/emotions";

/**
 * When the capability probe is allowed to run (spec `broll/0004` AC-61).
 *
 * The probe is a real inference, and starting one is not cheap: it pulls the
 * `@imgly/background-removal` model and the onnxruntime WASM from a third party
 * CDN, 84 MB and 11 MB at the default model, then runs single threaded on the
 * **main thread**. It used to run from a mount effect, so every visitor who
 * merely opened a project paid that. It starved the main thread long enough for
 * Clerk's `UserButton` to miss its own ten second mount budget and log
 * "Component renderer did not mount within 10s".
 *
 * AC-61 still holds, and is enforced somewhere stricter than a disabled
 * attribute: `generate` and `regenerate` each await the probe themselves, so no
 * request that reserves money is sent until it has passed.
 */

function renderPanel() {
  return render(
    <CharacterPanel
      projectId="11111111-1111-1111-1111-111111111111"
      characterName={null}
      initialAssets={[]}
      initialRegenerationsUsed={0}
      setPrice="$2.00"
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("the capability probe", () => {
  it("does not run just because the page rendered", async () => {
    renderPanel();

    // The whole point. A visitor who opens a project and reads it downloads
    // nothing and blocks nothing.
    expect(probeSegmentation).not.toHaveBeenCalled();

    // Not merely "not yet": give the mount effects a turn to settle first.
    await waitFor(() => {
      expect(screen.getByText(/Generate character set/)).toBeTruthy();
    });
    expect(probeSegmentation).not.toHaveBeenCalled();
  });

  it("runs once the user picks a photo, before they can press Generate", async () => {
    const { container } = renderPanel();

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();

    const file = new File([new Uint8Array(10)], "me.png", { type: "image/png" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => {
      expect(probeSegmentation).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Naming the other projects a redraw would change (spec `broll/0007` AC-133).
 *
 * A regeneration changes this face everywhere the character is used, including
 * projects the creator considers finished. The warning is the only thing
 * standing between that and a surprise, so what it says and when it appears are
 * both worth pinning.
 */
describe("the shared character warning (AC-133)", () => {
  const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
  const OTHER_PROJECT = "22222222-2222-2222-2222-222222222222";

  function fullSet() {
    return CHARACTER_EMOTIONS.map((emotion) => ({
      emotion,
      width: 700,
      height: 900,
      attempt: 1,
      url: null,
    }));
  }

  function answerUsage(usedBy: { id: string; name: string }[]) {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ usedBy, character: null, regenerations: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the other projects and never this one", async () => {
    const fetchMock = answerUsage([
      { id: PROJECT_ID, name: "Fuel imports" },
      { id: OTHER_PROJECT, name: "Q3 recap" },
    ]);

    render(
      <CharacterPanel
        projectId={PROJECT_ID}
        characterName="Fuel imports"
        initialAssets={fullSet()}
        initialRegenerationsUsed={0}
        setPrice="$2.00"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/also used by/)).toBeTruthy();
    });
    expect(screen.getByText("Q3 recap")).toBeTruthy();
    // Read from this project's own character endpoint, not from the whole
    // characters collection filtered in the browser.
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${PROJECT_ID}/character`);
  });

  it("says nothing when this project is the only one using the character", async () => {
    answerUsage([{ id: PROJECT_ID, name: "Fuel imports" }]);

    render(
      <CharacterPanel
        projectId={PROJECT_ID}
        characterName="Fuel imports"
        initialAssets={fullSet()}
        initialRegenerationsUsed={0}
        setPrice="$2.00"
      />
    );

    // The allowance line is the marker that the panel finished rendering its
    // set, so this is "nothing appeared", not "not yet".
    await waitFor(() => {
      expect(screen.getByText(/redraws left for this character/)).toBeTruthy();
    });
    expect(screen.queryByText(/also used by/)).toBeNull();
  });

  it("does not ask at all on a project with no character", async () => {
    const fetchMock = answerUsage([]);
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/Generate character set/)).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * The regression this locks in: a character upload got a `401` from `proxy.ts`
 * partway through a run, on 2026-08-14, and it cost the whole six image set.
 *
 * The cause is that cutting out six images blocks the main thread long enough
 * for a Clerk session token to lapse, so the next presigned upload is refused
 * before it reaches the route. It recovered on its own within seconds both
 * times it was observed, which is why one retry against a fresh session is the
 * right size of fix rather than a longer backoff.
 */
describe("a presigned upload that is refused mid run", () => {
  const BLOB = new Blob(["png"], { type: "image/png" });
  const PATH = "broll/characters/abc/happy-1-0123456789abcdef.png";

  it("uploads once and never refreshes the session when the first try works", async () => {
    await putPresignedWithRetry(PATH, BLOB, getToken);

    expect(uploadPresigned).toHaveBeenCalledTimes(1);
    // A healthy run must not mint a token per image.
    expect(getToken).not.toHaveBeenCalled();
  });

  it("refreshes the session and retries once, so a lapsed token costs no images", async () => {
    uploadPresigned.mockRejectedValueOnce(
      new Error("Vercel Blob: Failed to retrieve the presigned URL")
    );

    await expect(putPresignedWithRetry(PATH, BLOB, getToken)).resolves.toBeUndefined();

    expect(getToken).toHaveBeenCalledTimes(1);
    // **The assertion this bug is really about.** A plain `getToken()` returns
    // the cached session token, which during this failure is the stale one, so
    // the retry repeats the identical refused request. That was measured: two
    // `[proxy] refused` lines back to back for one turn.
    expect(getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(uploadPresigned).toHaveBeenCalledTimes(2);
    // The same pathname both times. A retry that uploaded elsewhere would
    // leave the committed row pointing at an object that is not there.
    expect(uploadPresigned.mock.calls[0][0]).toBe(PATH);
    expect(uploadPresigned.mock.calls[1][0]).toBe(PATH);
  });

  it("gives up after the retry, reporting the failure that started it", async () => {
    uploadPresigned
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"));

    await expect(putPresignedWithRetry(PATH, BLOB, getToken)).rejects.toThrow(
      "first failure"
    );
    expect(uploadPresigned).toHaveBeenCalledTimes(2);
  });

  it("still retries when refreshing the session itself fails", async () => {
    uploadPresigned.mockRejectedValueOnce(new Error("refused"));
    getToken.mockRejectedValueOnce(new Error("clerk is unreachable"));

    await expect(putPresignedWithRetry(PATH, BLOB, getToken)).resolves.toBeUndefined();
    expect(uploadPresigned).toHaveBeenCalledTimes(2);
  });
});
