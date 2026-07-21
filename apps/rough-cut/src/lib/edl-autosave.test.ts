import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  useEdlAutosave,
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_MAX_WAIT_MS,
  AUTOSAVE_RETRY_DELAYS_MS,
  type SaveState,
} from "@/lib/edl-autosave";
import type { EDL } from "@/lib/edl";

/** An EDL whose single segment ends at `end` — a cheap way to make edits distinct. */
function edlEndingAt(end: number): EDL {
  return { segments: [{ start: 0, end, status: "keep", reason: null }] };
}

const LOADED_AT = "2026-07-20T10:00:00.000Z";

/** Resolved PATCH response, matching the route's `{ success, updatedAt }` body. */
function okResponse(updatedAt = "2026-07-20T10:00:01.000Z") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, updatedAt }),
  };
}

/** The route's version-guard rejection, carrying the current server state. */
function conflictResponse(edl: EDL | null, updatedAt: string) {
  return {
    ok: false,
    status: 409,
    json: async () => ({
      error: "Project changed since your last save.",
      edl,
      updatedAt,
    }),
  };
}

interface Harness {
  edl: EDL;
  serverEdl?: EDL | null;
  serverUpdatedAt?: string | null;
  enabled?: boolean;
}

function setup(initial: Harness) {
  const onSaveStateChange = vi.fn<(s: SaveState) => void>();
  const onError = vi.fn();
  const view = renderHook(
    (props: Harness) =>
      useEdlAutosave({
        projectId: "proj-1",
        edl: props.edl,
        sensitivity: "balanced",
        serverEdl: props.serverEdl ?? null,
        serverUpdatedAt:
          props.serverUpdatedAt === undefined ? LOADED_AT : props.serverUpdatedAt,
        isEnabled: () => props.enabled ?? true,
        onSaveStateChange,
        onError,
      }),
    { initialProps: initial }
  );
  return { ...view, onSaveStateChange, onError };
}

/** PATCH calls recorded on the fetch mock, with parsed bodies. */
function patchBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === "PATCH")
    .map(([, init]) => JSON.parse(init.body as string));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // This repo has no global auto-cleanup, and a hook left mounted keeps its
  // pagehide/visibilitychange listeners — a later test's dispatched event would
  // flush every previous test's hook too.
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useEdlAutosave — debounce", () => {
  it("coalesces a burst of edits into a single save", async () => {
    const { rerender } = setup({ edl: edlEndingAt(1) });

    for (let i = 2; i <= 6; i++) {
      rerender({ edl: edlEndingAt(i) });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    expect(patchBodies(fetchMock)).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });

    const bodies = patchBodies(fetchMock);
    expect(bodies).toHaveLength(1);
    // No baseline yet, so the first save sends the whole EDL — the latest one.
    expect(bodies[0].edl.segments[0].end).toBe(6);
  });

  it("does not save at all while the user has never edited", async () => {
    setup({ edl: edlEndingAt(1), enabled: false });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS * 2);
    });

    expect(patchBodies(fetchMock)).toHaveLength(0);
  });

  it("spends no request when the net change is empty", async () => {
    // Carries the sensitivity the hook stamps onto every save, so an unchanged
    // EDL really does diff to nothing.
    const server: EDL = { ...edlEndingAt(1), sensitivity: "balanced" };
    const { rerender, onSaveStateChange } = setup({
      edl: server,
      serverEdl: server,
    });

    // Edit away and back again inside the debounce window.
    rerender({ edl: edlEndingAt(9), serverEdl: server });
    rerender({ edl: edlEndingAt(1), serverEdl: server });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });

    expect(patchBodies(fetchMock)).toHaveLength(0);
    expect(onSaveStateChange).toHaveBeenLastCalledWith("saved");
  });
});

describe("useEdlAutosave — max-wait ceiling", () => {
  it("saves during continuous editing that never leaves a quiet window", async () => {
    const { rerender } = setup({ edl: edlEndingAt(1) });

    // An edit every 400ms — shorter than the debounce, so the timer resets
    // before it ever fires. This is a timeline drag.
    const editInterval = 400;
    const edits = Math.ceil((AUTOSAVE_MAX_WAIT_MS / editInterval) * 2);
    for (let i = 2; i <= edits + 1; i++) {
      rerender({ edl: edlEndingAt(i) });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(editInterval);
      });
    }

    // Without the ceiling this would still be 0: nothing has been saved after
    // ~10s of unbroken editing.
    expect(patchBodies(fetchMock).length).toBeGreaterThanOrEqual(1);
  });

  it("flushes exactly at the ceiling, not one debounce later", async () => {
    const startedAt = Date.now();
    let firedAt: number | null = null;
    fetchMock.mockImplementation(async () => {
      firedAt ??= Date.now();
      return okResponse();
    });

    const { rerender } = setup({ edl: edlEndingAt(1) });

    for (let i = 2; firedAt === null && i < 40; i++) {
      rerender({ edl: edlEndingAt(i) });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
    }

    expect(firedAt).not.toBeNull();
    expect(firedAt! - startedAt).toBe(AUTOSAVE_MAX_WAIT_MS);
  });
});

describe("useEdlAutosave — flush on leave", () => {
  it("saves an edit made inside the debounce window when the tab closes", async () => {
    const server = edlEndingAt(1);
    const { rerender } = setup({ edl: server, serverEdl: server });

    rerender({ edl: edlEndingAt(2), serverEdl: server });
    // Well short of the debounce — nothing has been sent yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(patchBodies(fetchMock)).toHaveLength(0);

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });

    const [body] = patchBodies(fetchMock);
    expect(body.edlPatch).toContainEqual({
      op: "replace",
      path: "/segments/0/end",
      value: 2,
    });
    // Must outlive the document, or the browser cancels it on unload.
    const init = fetchMock.mock.calls.at(-1)![1];
    expect(init.keepalive).toBe(true);
  });

  it("saves a pending edit when the page is backgrounded", async () => {
    const server = edlEndingAt(1);
    const { rerender } = setup({ edl: server, serverEdl: server });

    rerender({ edl: edlEndingAt(3), serverEdl: server });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockRestore();

    expect(patchBodies(fetchMock)).toHaveLength(1);
  });

  it("saves a pending edit when the editor unmounts (client-side navigation)", async () => {
    const server = edlEndingAt(1);
    const { rerender, unmount } = setup({ edl: server, serverEdl: server });

    rerender({ edl: edlEndingAt(4), serverEdl: server });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(patchBodies(fetchMock)).toHaveLength(0);

    await act(async () => {
      unmount();
    });

    expect(patchBodies(fetchMock)).toHaveLength(1);
  });

  it("sends nothing on leave when there is nothing unsaved", async () => {
    const server: EDL = { ...edlEndingAt(1), sensitivity: "balanced" };
    const { unmount } = setup({ edl: server, serverEdl: server });

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      unmount();
    });

    expect(patchBodies(fetchMock)).toHaveLength(0);
  });
});

describe("useEdlAutosave — retry", () => {
  /** Drain the whole backoff schedule plus slack. */
  async function runOutBackoff() {
    for (const delay of AUTOSAVE_RETRY_DELAYS_MS) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
    }
  }

  it("retries a failed save without waiting for another edit", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });

    const server = edlEndingAt(1);
    const { rerender, onError } = setup({ edl: server, serverEdl: server });
    rerender({ edl: edlEndingAt(2), serverEdl: server });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });
    expect(patchBodies(fetchMock)).toHaveLength(1);
    // Not surfaced yet — the user shouldn't see a scary toast for a blip we're
    // about to recover from.
    expect(onError).not.toHaveBeenCalled();

    // No further edits at all: the retry has to come from the hook itself.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_DELAYS_MS[0]);
    });

    expect(patchBodies(fetchMock)).toHaveLength(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it("gives up and reports after the backoff schedule is exhausted", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });

    const server = edlEndingAt(1);
    const { rerender, onError, onSaveStateChange } = setup({
      edl: server,
      serverEdl: server,
    });
    rerender({ edl: edlEndingAt(2), serverEdl: server });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });
    await runOutBackoff();

    // The first attempt plus one per backoff step, and no more.
    expect(patchBodies(fetchMock)).toHaveLength(
      AUTOSAVE_RETRY_DELAYS_MS.length + 1
    );
    expect(onError).toHaveBeenCalledTimes(1);
    // Still "saving" — it truly is not saved, and the toast carries the news.
    expect(onSaveStateChange).toHaveBeenLastCalledWith("saving");
  });

  it("does not retry a rejection another attempt can't fix", async () => {
    // 400 — the server judged this exact patch invalid.
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "Invalid EDL patch." }),
    }));

    const server = edlEndingAt(1);
    const { rerender, onError } = setup({ edl: server, serverEdl: server });
    rerender({ edl: edlEndingAt(2), serverEdl: server });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });
    await runOutBackoff();

    expect(patchBodies(fetchMock)).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("recovers silently when a retry succeeds", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));

    const server = edlEndingAt(1);
    const { rerender, onError, onSaveStateChange } = setup({
      edl: server,
      serverEdl: server,
    });
    rerender({ edl: edlEndingAt(2), serverEdl: server });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_DELAYS_MS[0]);
    });

    expect(onError).not.toHaveBeenCalled();
    expect(onSaveStateChange).toHaveBeenLastCalledWith("saved");
  });
});

describe("useEdlAutosave — optimistic concurrency", () => {
  it("guards every save on the version its patch was diffed from", async () => {
    const server = edlEndingAt(1);
    const { rerender } = setup({ edl: server, serverEdl: server });

    rerender({ edl: edlEndingAt(2), serverEdl: server });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });
    expect(patchBodies(fetchMock)[0].baseUpdatedAt).toBe(LOADED_AT);

    // The version the server just handed back becomes the next save's guard.
    rerender({ edl: edlEndingAt(3), serverEdl: server });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });
    expect(patchBodies(fetchMock)[1].baseUpdatedAt).toBe(
      "2026-07-20T10:00:01.000Z"
    );
  });

  it("re-diffs against the state a rejected save handed back, and keeps the local cut", async () => {
    const server = edlEndingAt(1);
    // Another writer moved the row to end=50 while this tab was editing.
    const theirEdl: EDL = { ...edlEndingAt(50), sensitivity: "balanced" };
    fetchMock.mockImplementationOnce(async () =>
      conflictResponse(theirEdl, "2026-07-20T10:00:05.000Z")
    );

    const { rerender } = setup({ edl: server, serverEdl: server });
    rerender({ edl: edlEndingAt(2), serverEdl: server });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });
    const [rejected] = patchBodies(fetchMock);
    expect(rejected.baseUpdatedAt).toBe(LOADED_AT);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_DELAYS_MS[0]);
    });

    const retried = patchBodies(fetchMock)[1];
    // Guarded on their version now, and diffed from their EDL — so it moves
    // the server from 50 to this tab's 2 rather than replaying a stale diff.
    expect(retried.baseUpdatedAt).toBe("2026-07-20T10:00:05.000Z");
    expect(retried.edlPatch).toContainEqual({
      op: "replace",
      path: "/segments/0/end",
      value: 2,
    });
  });

  it("reports a conflict it cannot resolve rather than looping forever", async () => {
    // A server that always says the row moved — the retry budget must bound it.
    fetchMock.mockImplementation(async () =>
      conflictResponse(edlEndingAt(50), "2026-07-20T10:00:05.000Z")
    );

    const server = edlEndingAt(1);
    const { rerender, onError } = setup({ edl: server, serverEdl: server });
    rerender({ edl: edlEndingAt(2), serverEdl: server });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });
    for (const delay of AUTOSAVE_RETRY_DELAYS_MS) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
    }

    expect(patchBodies(fetchMock)).toHaveLength(
      AUTOSAVE_RETRY_DELAYS_MS.length + 1
    );
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("useEdlAutosave — one save in flight", () => {
  it("coalesces edits made mid-save into a single follow-up save", async () => {
    // A save that stays pending until we release it.
    let release: (() => void) | null = null;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(okResponse());
        })
    );

    const server = edlEndingAt(1);
    const { rerender } = setup({ edl: server, serverEdl: server });

    rerender({ edl: edlEndingAt(2), serverEdl: server });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });
    expect(patchBodies(fetchMock)).toHaveLength(1);

    // Three more edits while the first save is still open.
    for (const end of [3, 4, 5]) {
      rerender({ edl: edlEndingAt(end), serverEdl: server });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
      });
    }
    // Still exactly one — nothing overlapped the in-flight request.
    expect(patchBodies(fetchMock)).toHaveLength(1);

    await act(async () => {
      release?.();
      await vi.advanceTimersByTimeAsync(0);
    });

    // Exactly one follow-up, carrying the newest state and diffed against the
    // baseline the first save established.
    const bodies = patchBodies(fetchMock);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].edlPatch).toBeDefined();
    expect(bodies[1].edlPatch).toContainEqual({
      op: "replace",
      path: "/segments/0/end",
      value: 5,
    });
  });
});
