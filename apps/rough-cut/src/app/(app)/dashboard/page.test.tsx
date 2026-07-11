// @vitest-environment jsdom
//
// Scope: this page's biggest new surface is the upload confirm panel (ADR
// 0003 child 1, AC-1) — file selection no longer creates a project
// immediately, it holds the selection and shows a combined price + an
// AI-polish toggle (defaulted on) until the user confirms. These tests focus
// on that panel; the pre-existing project list/retry/delete behavior is only
// touched incidentally (e.g. the new project appearing in the list after
// confirm).
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chargeMicrosForSeconds, formatUsd } from "@repo/ui";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
  })
);

vi.mock("sonner", () => ({
  toast: toastMock,
  Toaster: () => null,
}));

vi.mock("@/lib/env", () => ({
  WALLET_URL: "https://wallet.test",
  WALLET_DASHBOARD_URL: "https://wallet.test/dashboard",
}));

vi.mock("@/lib/audio-extract", () => ({
  // The confirm-panel tests never need transcription to actually complete —
  // "no-audio" makes kickOffTranscription resolve (with a toast) instead of
  // reaching the Vercel Blob upload / Deepgram call.
  extractAudioForTranscription: vi.fn(async () => ({ kind: "no-audio" as const })),
}));

vi.mock("@/components/progress-ring", () => ({
  default: () => <div data-testid="progress-ring-stub" />,
}));

// Selects a fixed video file + metadata on click, matching FilePicker's real
// onFileSelected contract. Individual tests can inspect the metadata via the
// module-level CURRENT_METADATA so a test can pick a different duration.
const CURRENT_METADATA = { fileName: "clip.mp4", fileSize: 2_000_000, fileType: "video/mp4", durationMs: 120_000 };
vi.mock("@/components/file-picker", () => ({
  default: ({
    onFileSelected,
  }: {
    onFileSelected: (file: File, metadata: typeof CURRENT_METADATA) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onFileSelected(new File(["x"], CURRENT_METADATA.fileName, { type: CURRENT_METADATA.fileType }), CURRENT_METADATA)
      }
    >
      pick-file
    </button>
  ),
}));

import DashboardPage from "./page";

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers: { get: () => "application/json" },
    json: async () => body,
  };
}

/** A fetch mock answering GET /api/projects, GET /api/credits, and (by default) POST /api/projects. */
function stubFetch({
  projects = [],
  credits = { balanceMicros: 1_000_000_000, isMember: false },
  createdProject,
}: {
  projects?: unknown[];
  credits?: { balanceMicros: number; isMember: boolean } | null;
  createdProject?: unknown;
} = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/projects" && (!init || init.method === undefined)) {
      return jsonResponse(projects);
    }
    if (url === "/api/projects" && init?.method === "POST") {
      return jsonResponse(
        createdProject ?? {
          id: "new-proj",
          fileName: CURRENT_METADATA.fileName,
          durationMs: CURRENT_METADATA.durationMs,
          transcriptStatus: "idle",
          createdAt: "2026-07-11T00:00:00Z",
          updatedAt: "2026-07-11T00:00:00Z",
        }
      );
    }
    if (url === "/api/credits") {
      return credits ? jsonResponse(credits) : jsonResponse({}, { ok: false, status: 401 });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.loading.mockClear();
  toastMock.message.mockClear();
  CURRENT_METADATA.durationMs = 120_000;
});

async function openConfirmPanel() {
  const pickButton = await screen.findByRole("button", { name: "pick-file" });
  await userEvent.click(pickButton);
  return screen.findByRole("dialog", { name: /start this video\?/i });
}

describe("DashboardPage — upload confirm panel (ADR 0003 child 1, AC-1)", () => {
  it("does not create a project on file selection — only holds it for confirmation", async () => {
    const fetchMock = stubFetch();
    render(<DashboardPage />);
    await openConfirmPanel();

    const postCalls = fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/projects" && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(postCalls).toHaveLength(0);
  });

  it("shows the combined price (transcription + AI polish) and an AI-polish toggle defaulted on", async () => {
    stubFetch();
    render(<DashboardPage />);
    const dialog = await openConfirmPanel();

    const seconds = Math.ceil(CURRENT_METADATA.durationMs / 1000);
    const transcriptionMicros = chargeMicrosForSeconds(seconds);
    const aiPolishMicros = chargeMicrosForSeconds(seconds);
    const totalMicros = transcriptionMicros + aiPolishMicros;

    const toggle = within(dialog).getByRole("button", { name: /add ai polish/i });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    expect(within(dialog).getByText("Transcription").closest("div")).toHaveTextContent(
      formatUsd(transcriptionMicros)
    );
    expect(within(dialog).getByText("AI polish").closest("div")).toHaveTextContent(
      formatUsd(aiPolishMicros)
    );
    // Formatted total appears in the price breakdown's "Estimated total" row.
    expect(within(dialog).getByText("Estimated total").closest("div")).toHaveTextContent(
      formatUsd(totalMicros)
    );
  });

  it("toggling AI polish off removes its price line and reduces the estimated total", async () => {
    stubFetch();
    render(<DashboardPage />);
    const dialog = await openConfirmPanel();

    const seconds = Math.ceil(CURRENT_METADATA.durationMs / 1000);
    const transcriptionMicros = chargeMicrosForSeconds(seconds);

    const toggle = within(dialog).getByRole("button", { name: /add ai polish/i });
    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    // The breakdown's "AI polish" line item disappears (the toggle's own label
    // still says "Add AI polish" regardless of state, so scope to the breakdown).
    const breakdown = within(dialog).getByText("Estimated total").closest("div")!.parentElement!;
    expect(within(breakdown).queryByText("AI polish")).toBeNull();
    // Total is now just the transcription price.
    expect(within(dialog).getByText("Estimated total").closest("div")).toHaveTextContent(
      formatUsd(transcriptionMicros)
    );
  });

  it("cancel closes the panel and creates no project", async () => {
    const fetchMock = stubFetch();
    render(<DashboardPage />);
    const dialog = await openConfirmPanel();

    await userEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const postCalls = fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/projects" && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(postCalls).toHaveLength(0);
  });

  it("Escape closes the panel and creates no project", async () => {
    const fetchMock = stubFetch();
    render(<DashboardPage />);
    await openConfirmPanel();

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const postCalls = fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/projects" && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(postCalls).toHaveLength(0);
  });

  it("confirming sends aiPolish: true by default and creates the project", async () => {
    const fetchMock = stubFetch();
    render(<DashboardPage />);
    const dialog = await openConfirmPanel();

    await userEvent.click(within(dialog).getByRole("button", { name: /start transcription/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/projects" && (init as RequestInit | undefined)?.method === "POST"
      );
      expect(postCall).toBeDefined();
    });
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/projects" && (init as RequestInit | undefined)?.method === "POST"
    )!;
    const body = JSON.parse((postCall[1] as RequestInit).body as string);
    expect(body).toMatchObject({
      fileName: CURRENT_METADATA.fileName,
      durationMs: CURRENT_METADATA.durationMs,
      aiPolish: true,
    });

    // The panel closes and the new project appears in the list.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(CURRENT_METADATA.fileName)).toBeVisible();
  });

  it("confirming after toggling AI polish off sends aiPolish: false", async () => {
    const fetchMock = stubFetch();
    render(<DashboardPage />);
    const dialog = await openConfirmPanel();

    await userEvent.click(within(dialog).getByRole("button", { name: /add ai polish/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: /start transcription/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/projects" && (init as RequestInit | undefined)?.method === "POST"
      );
      expect(postCall).toBeDefined();
    });
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/projects" && (init as RequestInit | undefined)?.method === "POST"
    )!;
    const body = JSON.parse((postCall[1] as RequestInit).body as string);
    expect(body.aiPolish).toBe(false);
  });

  it("blocks confirmation and charges nothing when the pre-flight credit check fails", async () => {
    // Balance well below the cost of a 2-minute video.
    const fetchMock = stubFetch({ credits: { balanceMicros: 1, isMember: false } });
    render(<DashboardPage />);
    // Let the credits fetch on mount resolve before opening the panel.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/credits"));

    const dialog = await openConfirmPanel();
    await userEvent.click(within(dialog).getByRole("button", { name: /start transcription/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    const postCalls = fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/projects" && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(postCalls).toHaveLength(0);
    // The panel stays open so the user can see why (no dialog dismissal on block).
    expect(screen.getByRole("dialog", { name: /start this video\?/i })).toBeVisible();
  });
});

describe("DashboardPage — existing project list (regression coverage)", () => {
  it("renders projects returned from GET /api/projects", async () => {
    stubFetch({
      projects: [
        {
          id: "p1",
          fileName: "existing.mp4",
          durationMs: 30_000,
          transcriptStatus: "ready",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });
    render(<DashboardPage />);
    expect(await screen.findByText("existing.mp4")).toBeVisible();
  });

  it("shows the empty state when there are no projects", async () => {
    stubFetch({ projects: [] });
    render(<DashboardPage />);
    expect(await screen.findByText("No projects yet")).toBeVisible();
  });
});
