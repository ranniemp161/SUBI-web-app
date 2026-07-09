// @vitest-environment jsdom
//
// Scope note: this page is a huge, stateful editor (WebCodecs export, rAF
// clock, undo stack, etc.) that is far beyond what this change touches. Per
// the test brief, only the NEW behavior added by ADR children 1 and 2 is
// covered here:
//   - child 1 (0001-exit-navigation-toast.md): the exit-toast onClick
//     handlers on the StatusScreen and TopBar dashboard links.
//   - child 2 (0002-ai-cut-rerun-guard.md): the client's handling of the
//     AI_CUT_ALREADY_RUN 409 and the Clear AI Cuts confirm-toast flow.
// VideoPlayer, TranscriptPanel, TimelineBar and FilePicker are mocked as
// boundary stubs — each already has (or, for FilePicker, now has) its own
// dedicated test file, so re-verifying their internals here would duplicate
// coverage rather than add it.
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { forwardRef } from "react";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "proj-1" }),
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
  default: forwardRef((_props: unknown, _ref: unknown) => <div data-testid="video-player-stub" />),
}));

vi.mock("@/components/transcript-panel", () => ({
  default: () => <div data-testid="transcript-panel-stub" />,
}));

vi.mock("@/components/timeline-bar", () => ({
  __esModule: true,
  default: forwardRef((_props: unknown, _ref: unknown) => <div data-testid="timeline-bar-stub" />),
}));

vi.mock("@/components/progress-ring", () => ({
  default: () => <div data-testid="progress-ring-stub" />,
}));

vi.mock("@/lib/env", () => ({
  WALLET_URL: "https://wallet.test",
  WALLET_DASHBOARD_URL: "https://wallet.test/dashboard",
}));

import EditorPage from "./page";
import type { AiCuts } from "@/lib/ai-cuts";

const READY_PROJECT = {
  id: "proj-1",
  fileName: "clip.mp4",
  durationMs: 5000,
  transcript: {
    words: [{ word: "hello", start: 0, end: 0.5, confidence: 0.9 }],
    text: "hello",
    duration: 5,
  },
  transcriptStatus: "ready" as const,
  edl: null,
  aiCuts: null as AiCuts | null,
};

function jsonResponse(body: unknown, init?: { ok?: boolean }) {
  return {
    ok: init?.ok ?? true,
    headers: { get: () => "application/json" },
    json: async () => body,
  };
}

function notFoundResponse() {
  return { ok: false, headers: { get: () => "application/json" }, json: async () => ({}) };
}

beforeEach(() => {
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.loading.mockClear();
  toastMock.dismiss.mockClear();
});

// covers AC-1 (child 1): the StatusScreen dashboard link fires the exit
// reassurance toast and does not block navigation.
describe("EditorPage — exit reassurance toast on StatusScreen (project not found)", () => {
  it("shows the toast with the exact copy and never prevents the navigation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notFoundResponse()));

    render(<EditorPage />);

    const link = await screen.findByRole("link", { name: /back to dashboard/i });
    expect(link).toHaveAttribute("href", "/dashboard");

    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(link, clickEvent);

    // covers AC-3 (child 1): copy states both facts.
    expect(toastMock).toHaveBeenCalledWith(
      "Project saved",
      expect.objectContaining({
        description:
          "Your edits are stored automatically. To reopen this project, just reselect the same source video.",
      })
    );
    // covers AC-4 (child 1): the click is never prevented/cancelled.
    expect(clickEvent.defaultPrevented).toBe(false);
  });
});

// covers AC-2 (child 1): the TopBar dashboard link fires the same toast.
describe("EditorPage — exit reassurance toast on TopBar (editor loaded, no source file)", () => {
  it("shows the toast and does not block navigation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(READY_PROJECT)));

    render(<EditorPage />);

    const link = await screen.findByRole("link", { name: /^dashboard$/i });
    expect(link).toHaveAttribute("href", "/dashboard");

    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(link, clickEvent);

    expect(toastMock).toHaveBeenCalledWith(
      "Project saved",
      expect.objectContaining({
        description:
          "Your edits are stored automatically. To reopen this project, just reselect the same source video.",
      })
    );
    expect(clickEvent.defaultPrevented).toBe(false);
  });
});

// The full rail/AI-cut UI only renders once a source file is selected
// (sourceUrl truthy). The FilePicker stub above renders a "pick-file" button
// that calls onFileSelected immediately, so clicking it reaches that state
// without needing a real <video> element/duration probe (file-picker.test.tsx
// already covers that machinery in isolation).
async function renderEditorWithSourceSelected(project: typeof READY_PROJECT) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (typeof url === "string" && url === "/api/projects/proj-1") {
      return jsonResponse(project);
    }
    return jsonResponse({});
  }));

  render(<EditorPage />);
  const pickButton = await screen.findByRole("button", { name: "pick-file" });
  await userEvent.click(pickButton);
  // Now the full editor (with the rail + AI Cut button) should be mounted.
  return screen.findByRole("button", { name: /^ai cut$/i });
}

describe("EditorPage — AI Cut client handling of AI_CUT_ALREADY_RUN (409)", () => {
  // covers AC-6 (child 2): the client shows the already-run state, not a
  // generic failure, when the server returns code: AI_CUT_ALREADY_RUN.
  it("shows the already-run toast (not a generic failure) on a 409 AI_CUT_ALREADY_RUN", async () => {
    const aiCutButton = await renderEditorWithSourceSelected(READY_PROJECT);

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/projects/proj-1/ai-cut" && init?.method === "POST") {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: "AI Cut has already run for this project. Clear it first to run again.",
            code: "AI_CUT_ALREADY_RUN",
          }),
        };
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await userEvent.click(aiCutButton);

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        "AI Cut has already run",
        expect.objectContaining({
          id: "ai-cut",
          description: expect.stringContaining("Clear them first to run a fresh paid pass"),
        })
      )
    );
    // Not the generic failure path.
    expect(toastMock.error).not.toHaveBeenCalledWith(
      "AI cut failed",
      expect.anything()
    );
  });
});

describe("EditorPage — Clear AI Cuts confirm flow", () => {
  // covers AC-5 (child 2): the Clear control shows a confirm action-toast,
  // and only the explicit Clear action fires the DELETE.
  it("shows a confirm toast before clearing, and clicking Clear calls DELETE", async () => {
    const withAiCuts = {
      ...READY_PROJECT,
      aiCuts: {
        ranges: [{ startWordIndex: 0, endWordIndex: 1, category: "retake" as const }],
        model: "gemini-2.5-flash",
        createdAt: "now",
      },
    };
    await renderEditorWithSourceSelected(withAiCuts);

    const clearButton = await screen.findByRole("button", { name: /clear ai cuts/i });

    const deleteFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/projects/proj-1/ai-cut" && init?.method === "DELETE") {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", deleteFetch);

    await userEvent.click(clearButton);

    // The confirm toast is shown with an explicit Clear action — nothing is
    // deleted yet just from clicking the secondary control.
    expect(toastMock).toHaveBeenCalledWith(
      "Clear AI Cut suggestions?",
      expect.objectContaining({
        description: expect.stringContaining("Running AI Cut again will use credits"),
        action: expect.objectContaining({ label: "Clear" }),
        cancel: expect.objectContaining({ label: "Cancel" }),
      })
    );
    expect(deleteFetch).not.toHaveBeenCalledWith(
      "/api/projects/proj-1/ai-cut",
      expect.objectContaining({ method: "DELETE" })
    );

    // Fire the toast's own Clear action, exactly as pressing it would.
    const confirmCall = toastMock.mock.calls.find(([title]) => title === "Clear AI Cut suggestions?");
    const onClear = confirmCall?.[1]?.action?.onClick as () => void;
    onClear();

    await waitFor(() =>
      expect(deleteFetch).toHaveBeenCalledWith(
        "/api/projects/proj-1/ai-cut",
        expect.objectContaining({ method: "DELETE" })
      )
    );
  });

  it("does nothing when Cancel is pressed instead of Clear", async () => {
    const withAiCuts = {
      ...READY_PROJECT,
      aiCuts: {
        ranges: [{ startWordIndex: 0, endWordIndex: 1, category: "retake" as const }],
        model: "gemini-2.5-flash",
        createdAt: "now",
      },
    };
    await renderEditorWithSourceSelected(withAiCuts);

    const clearButton = await screen.findByRole("button", { name: /clear ai cuts/i });
    const deleteFetch = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", deleteFetch);

    await userEvent.click(clearButton);

    const confirmCall = toastMock.mock.calls.find(([title]) => title === "Clear AI Cut suggestions?");
    const onCancel = confirmCall?.[1]?.cancel?.onClick as () => void;
    onCancel();

    expect(deleteFetch).not.toHaveBeenCalledWith(
      "/api/projects/proj-1/ai-cut",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
