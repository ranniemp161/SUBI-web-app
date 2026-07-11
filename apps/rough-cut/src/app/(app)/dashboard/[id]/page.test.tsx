// @vitest-environment jsdom
//
// Scope note: this page is a huge, stateful editor (WebCodecs export, rAF
// clock, undo stack, etc.) far beyond what this change touches. Per the test
// brief, this file covers only the NEW behavior from ADR 0003 (studio auto-cut
// flow):
//   - child 1: the auto-cut chain — a fresh ready project runs the mechanical
//     cut on open, and chains into the AI pass only when polish was requested.
//   - child 2: the removed surfaces — no always-on "AI Cut" rail button, no
//     run-list (switch/rename/delete).
//   - child 3: the exit confirm dialog — a blocking are-you-sure instead of a
//     fire-and-forget toast, and no beforeunload during ordinary editing.
// VideoPlayer, TranscriptPanel, TimelineBar and FilePicker are mocked as
// boundary stubs (each has its own dedicated test file).
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { forwardRef } from "react";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "proj-1" }),
  useRouter: () => ({ push: pushMock }),
}));

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  })
);

vi.mock("sonner", () => ({
  toast: toastMock,
  Toaster: () => null,
}));

vi.mock("@/components/file-picker", () => ({
  default: ({ onFileSelected }: { onFileSelected: (file: File, meta: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onFileSelected(new File(["x"], "clip.mp4", { type: "video/mp4" }), {
          fileName: "clip.mp4",
          fileSize: 10,
          durationMs: 5000,
        })
      }
    >
      pick-file
    </button>
  ),
}));

vi.mock("@/components/video-player", () => ({
  __esModule: true,
  default: forwardRef(function VideoPlayerStub() {
    return <div data-testid="video-player-stub" />;
  }),
}));

vi.mock("@/components/transcript-panel", () => ({
  default: () => <div data-testid="transcript-panel-stub" />,
}));

vi.mock("@/components/timeline-bar", () => ({
  __esModule: true,
  default: forwardRef(function TimelineBarStub() {
    return <div data-testid="timeline-bar-stub" />;
  }),
}));

vi.mock("@/components/progress-ring", () => ({
  default: () => <div data-testid="progress-ring-stub" />,
}));

vi.mock("@/lib/env", () => ({
  WALLET_URL: "https://wallet.test",
  WALLET_DASHBOARD_URL: "https://wallet.test/dashboard",
}));

import EditorPage from "./page";
import type { AiCutRun } from "@/lib/ai-cuts";

const READY_PROJECT = {
  id: "proj-1",
  fileName: "clip.mp4",
  fileSize: 10,
  fileType: "video/mp4",
  durationMs: 5000,
  transcript: {
    words: [{ word: "hello", start: 0, end: 0.5, confidence: 0.9 }],
    text: "hello",
    duration: 5,
  },
  transcriptStatus: "ready" as const,
  edl: null,
  aiPolishRequested: false,
  activeAiCutRunId: null as string | null,
  aiCutRuns: [] as AiCutRun[],
};

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers: { get: () => "application/json" },
    json: async () => body,
  };
}

function notFoundResponse() {
  return { ok: false, status: 404, headers: { get: () => "application/json" }, json: async () => ({}) };
}

// A fetch mock that always returns the given project for the GET, records every
// call, and answers everything else (autosave PATCH, ai-cut POST) with a benign
// JSON body. Returns the mock so tests can assert on the recorded calls.
function stubFetchForProject(project: typeof READY_PROJECT) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === "string" && url === "/api/projects/proj-1") {
      return jsonResponse(project);
    }
    if (typeof url === "string" && url.endsWith("/ai-cut") && init?.method === "POST") {
      return jsonResponse({
        id: "run-auto",
        runNumber: 1,
        ranges: [],
        model: "gemini-2.5-flash",
        createdAt: "now",
      });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  pushMock.mockClear();
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.loading.mockClear();
  toastMock.dismiss.mockClear();
  // runAiCut generates an idempotency key with crypto.randomUUID.
  if (!globalThis.crypto?.randomUUID) {
    vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" });
  }
});

// ---------------------------------------------------------------------------
// Child 3 — exit confirm dialog (AC-8)
// ---------------------------------------------------------------------------
describe("EditorPage — exit confirm dialog (AC-8)", () => {
  // The not-found StatusScreen exposes the exit control as "Back to dashboard".
  it("opens a blocking dialog on the Dashboard link instead of navigating immediately", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notFoundResponse()));
    render(<EditorPage />);

    const exit = await screen.findByRole("button", { name: /back to dashboard/i });
    expect(pushMock).not.toHaveBeenCalled();

    await userEvent.click(exit);

    // A real alert dialog appears; nothing has navigated yet.
    expect(await screen.findByRole("alertdialog")).toBeVisible();
    expect(screen.getByText(/leave the editor\?/i)).toBeVisible();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("navigates only after the explicit Leave confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notFoundResponse()));
    render(<EditorPage />);

    await userEvent.click(await screen.findByRole("button", { name: /back to dashboard/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^leave$/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
  });

  it("Keep editing dismisses the dialog and does not navigate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notFoundResponse()));
    render(<EditorPage />);

    await userEvent.click(await screen.findByRole("button", { name: /back to dashboard/i }));
    await userEvent.click(await screen.findByRole("button", { name: /keep editing/i }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("attaches no beforeunload handler during ordinary (non-AI) editing", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    // Ready project, polish off: the mechanical auto-chain runs but no AI phase,
    // so no beforeunload is ever attached. The re-select TopBar exposes "Dashboard".
    stubFetchForProject(READY_PROJECT);
    render(<EditorPage />);
    await screen.findByRole("button", { name: /^dashboard$/i });
    await new Promise((r) => setTimeout(r, 50));

    const beforeUnloadAdds = addSpy.mock.calls.filter(([type]) => type === "beforeunload");
    expect(beforeUnloadAdds).toHaveLength(0);
    addSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Child 1 — auto-cut chain (AC-2, AC-3, AC-4)
// ---------------------------------------------------------------------------
describe("EditorPage — auto-cut chain on open", () => {
  it("runs the mechanical cut but never the AI pass when polish was not requested (AC-2)", async () => {
    const fetchMock = stubFetchForProject({ ...READY_PROJECT, aiPolishRequested: false });
    render(<EditorPage />);
    await screen.findByRole("button", { name: /^dashboard$/i });

    // Give the auto-chain effect a tick to run; the AI endpoint is never called.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/projects/proj-1"));
    await new Promise((r) => setTimeout(r, 50));
    const aiPost = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === "string" && url.endsWith("/ai-cut") && (init as RequestInit)?.method === "POST"
    );
    expect(aiPost).toBeUndefined();
  });

  it("chains into the AI pass automatically when polish was requested and no run exists (AC-3)", async () => {
    const fetchMock = stubFetchForProject({ ...READY_PROJECT, aiPolishRequested: true });
    render(<EditorPage />);
    await screen.findByRole("button", { name: /^dashboard$/i });

    await waitFor(() => {
      const aiPost = fetchMock.mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/ai-cut") && (init as RequestInit)?.method === "POST"
      );
      expect(aiPost).toBeDefined();
    });
  });

  it("never auto-fires the AI pass when a run already exists (AC-4)", async () => {
    const existingRun: AiCutRun = {
      id: "run-1",
      runNumber: 1,
      ranges: [],
      model: "gemini-2.5-flash",
      createdAt: "now",
    };
    const fetchMock = stubFetchForProject({
      ...READY_PROJECT,
      aiPolishRequested: true,
      activeAiCutRunId: "run-1",
      aiCutRuns: [existingRun],
    });
    render(<EditorPage />);
    await screen.findByRole("button", { name: /^dashboard$/i });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Give any stray effect a tick, then assert no AI POST ever fired.
    await new Promise((r) => setTimeout(r, 50));
    const aiPost = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === "string" && url.endsWith("/ai-cut") && (init as RequestInit)?.method === "POST"
    );
    expect(aiPost).toBeUndefined();
  });

  // covers AC-5: a 402 on the automatic AI pass lands on the mechanical
  // result — a clear "not enough funds" toast fires, nothing throws, and the
  // busy state resolves (no stuck loader). The manual "Add funds" deep link
  // and the reappearing "Polish with AI" button are UI-only and stay on
  // verify.md's manual checklist (TranscriptPanel is stubbed here).
  it("surfaces a not-enough-funds toast and clears the busy state when the automatic AI pass 402s (AC-5)", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/projects/proj-1") {
        return jsonResponse({ ...READY_PROJECT, aiPolishRequested: true });
      }
      if (url.endsWith("/ai-cut") && init?.method === "POST") {
        return jsonResponse({ error: "insufficient credits" }, { ok: false, status: 402 });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<EditorPage />);
    await screen.findByRole("button", { name: /^dashboard$/i });

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Not enough funds",
        expect.objectContaining({ id: "ai-cut" })
      )
    );

    // Busy state resolved: no beforeunload handler left attached, the way it
    // would be if the AI pass were still (incorrectly) treated as running.
    const addSpy = vi.spyOn(window, "addEventListener");
    await new Promise((r) => setTimeout(r, 20));
    const beforeUnloadAdds = addSpy.mock.calls.filter(([type]) => type === "beforeunload");
    expect(beforeUnloadAdds).toHaveLength(0);
    addSpy.mockRestore();
  });

  // Regression: two overlapping "transcript is ready" detections (the 4s
  // interval and a focus/visibilitychange handler can both fire checkStatus
  // around the same moment) used to each bump reloadNonce and each re-fetch
  // the project, and a second, redundant reload re-seeded `edl` from the
  // server's still-null value (the debounced autosave hadn't landed yet),
  // silently discarding the auto-chain's just-applied mechanical cut. Fixed by
  // deduping the "ready" detection to fire reloadNonce at most once per
  // transition. Uses manually-resolved promises (rather than real timing) to
  // deterministically control exactly when each overlapping check resolves —
  // the second is resolved only after the first has already driven a reload,
  // matching the real race without depending on jsdom microtask ordering.
  it("does not reload the project a second time when two overlapping status checks both detect ready", async () => {
    const projectCalls: string[] = [];
    let statusCallCount = 0;
    const statusResolvers: Array<(v: unknown) => void> = [];

    const fetchMock = vi.fn((url: string) => {
      if (typeof url === "string" && url === "/api/projects/proj-1") {
        projectCalls.push(url);
        // First call: still processing (no transcript/words yet). Every call
        // after: ready, matching what the real server would return once the
        // Deepgram callback lands — a fresh project with nothing saved yet.
        return Promise.resolve(
          jsonResponse(
            projectCalls.length === 1
              ? { ...READY_PROJECT, transcriptStatus: "processing" as const, transcript: null }
              : READY_PROJECT
          )
        );
      }
      if (typeof url === "string" && url === "/api/projects/proj-1/status") {
        statusCallCount++;
        return new Promise((resolve) => statusResolvers.push(resolve));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<EditorPage />);

    // Starts on the "Transcribing your video" screen (transcriptStatus: processing).
    await screen.findByText(/transcribing your video/i);
    expect(projectCalls).toHaveLength(1);

    // Two overlapping triggers for the same "ready" transition, both starting
    // (and both fetching /status) before either resolves — the poll interval
    // ticking right as the tab regains focus.
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(statusCallCount).toBe(2));

    // Resolve the first: this is what drives the (single) reload.
    statusResolvers[0](jsonResponse({ transcriptStatus: "ready" }));
    await screen.findByRole("button", { name: /^dashboard$/i });
    expect(projectCalls).toHaveLength(2);

    // Resolve the second — arriving after the first already reloaded, the
    // real shape of the race. It must not trigger a further reload.
    statusResolvers[1](jsonResponse({ transcriptStatus: "ready" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(projectCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Sensitivity picker in the status bar (AC-9) — the picker's continued
// presence (and the removed floating hero) is exercised at the component
// level here; actually observing the hero's absence in the full page layout
// stays on verify.md's manual checklist.
// ---------------------------------------------------------------------------
describe("EditorPage — sensitivity picker in the status bar (AC-9)", () => {
  it("renders light/balanced/aggressive controls with balanced pressed by default", async () => {
    stubFetchForProject(READY_PROJECT);
    render(<EditorPage />);
    const pickButton = await screen.findByRole("button", { name: "pick-file" });
    await userEvent.click(pickButton);
    await screen.findByTestId("timeline-bar-stub");

    const light = screen.getByRole("button", { name: /^light$/i });
    const balanced = screen.getByRole("button", { name: /^balanced$/i });
    const aggressive = screen.getByRole("button", { name: /^aggressive$/i });
    expect(light).toHaveAttribute("aria-pressed", "false");
    expect(balanced).toHaveAttribute("aria-pressed", "true");
    expect(aggressive).toHaveAttribute("aria-pressed", "false");
  });

  it("switches the pressed control when a different sensitivity is clicked", async () => {
    stubFetchForProject(READY_PROJECT);
    render(<EditorPage />);
    const pickButton = await screen.findByRole("button", { name: "pick-file" });
    await userEvent.click(pickButton);
    await screen.findByTestId("timeline-bar-stub");

    await userEvent.click(screen.getByRole("button", { name: /^aggressive$/i }));
    expect(screen.getByRole("button", { name: /^aggressive$/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: /^balanced$/i })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});

// ---------------------------------------------------------------------------
// Child 2 — removed surfaces (AC-6)
// ---------------------------------------------------------------------------
describe("EditorPage — removed AI-run surfaces (AC-6)", () => {
  // The full editor (rail + status bar) renders once a source file is selected.
  async function renderWithSource(project: typeof READY_PROJECT) {
    stubFetchForProject(project);
    render(<EditorPage />);
    const pickButton = await screen.findByRole("button", { name: "pick-file" });
    await userEvent.click(pickButton);
    return screen.findByTestId("timeline-bar-stub");
  }

  it("renders no always-on 'AI Cut' rail button", async () => {
    await renderWithSource(READY_PROJECT);
    expect(screen.queryByRole("button", { name: /^ai cut$/i })).toBeNull();
  });

  it("renders no run-list (switch/rename/delete) even with stored runs", async () => {
    const withRuns = {
      ...READY_PROJECT,
      activeAiCutRunId: "run-1",
      aiCutRuns: [
        { id: "run-1", runNumber: 1, ranges: [], model: "m", createdAt: "now" },
        { id: "run-2", runNumber: 2, ranges: [], model: "m", createdAt: "now" },
      ] as AiCutRun[],
    };
    await renderWithSource(withRuns);
    expect(screen.queryByRole("button", { name: /^run 2$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete run/i })).toBeNull();
    expect(screen.queryByText(/AI runs \(/i)).toBeNull();
  });
});
