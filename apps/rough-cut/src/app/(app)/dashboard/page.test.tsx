// @vitest-environment jsdom
//
// Scope: this page's biggest new surface is the removal of the upload confirm
// panel (ADR 0004 child 1, AC-1..AC-3) — file selection now goes straight into
// project creation and transcription with no intermediate confirm panel and
// no click required after selection. AI polish is mandatory (server-decided),
// so the client sends no `aiPolish` field. On insufficient funds an inline,
// non-modal message appears near the file picker instead of a toast/modal.
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chargeMicrosForSeconds } from "@repo/ui";

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
  // These tests never need transcription to actually complete — "no-audio"
  // makes kickOffTranscription resolve (with a toast) instead of reaching the
  // Vercel Blob upload / Deepgram call.
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
import { loadMoreProjects } from "@/app/actions";
import { type Mock } from "vitest";

vi.mock("@/app/actions", () => ({
  loadMoreProjects: vi.fn(),
}));

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
  
  (loadMoreProjects as Mock).mockResolvedValue({
    data: projects,
  });
  
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

function postCallsFrom(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([url, init]) => url === "/api/projects" && (init as RequestInit | undefined)?.method === "POST"
  );
}

describe("DashboardPage — no-click upload (ADR 0004 child 1, AC-1, AC-2)", () => {
  it("selecting a file with sufficient funds creates the project immediately, with no confirm panel", async () => {
    const fetchMock = stubFetch();
    render(<DashboardPage />);
    await userEvent.click(await screen.findByRole("button", { name: "pick-file" }));

    // No dialog/modal of any kind appears.
    expect(screen.queryByRole("dialog")).toBeNull();

    await waitFor(() => expect(postCallsFrom(fetchMock)).toHaveLength(1));
    const body = JSON.parse((postCallsFrom(fetchMock)[0][1] as RequestInit).body as string);
    // No aiPolish field is ever sent — the server decides it unconditionally.
    expect(body).toEqual({
      fileName: CURRENT_METADATA.fileName,
      durationMs: CURRENT_METADATA.durationMs,
      fileSize: CURRENT_METADATA.fileSize,
      fileType: CURRENT_METADATA.fileType,
    });

    expect(await screen.findByText(CURRENT_METADATA.fileName)).toBeVisible();
  });
});

describe("DashboardPage — inline insufficient-funds message (ADR 0004 child 1, AC-3)", () => {
  it("shows an inline message and creates no project when the combined pre-flight check fails", async () => {
    // Balance well below the combined transcription + AI polish cost of a 2-minute video.
    const fetchMock = stubFetch({ credits: { balanceMicros: 1, isMember: false } });
    render(<DashboardPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/credits"));

    await userEvent.click(await screen.findByRole("button", { name: "pick-file" }));

    expect(await screen.findByText(/not enough funds/i)).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(postCallsFrom(fetchMock)).toHaveLength(0);
  });

  it("blocks when balance exactly equals the combined transcription + AI polish cost", async () => {
    const seconds = Math.ceil(CURRENT_METADATA.durationMs / 1000);
    const combined = chargeMicrosForSeconds(seconds) * 2;
    const fetchMock = stubFetch({ credits: { balanceMicros: combined, isMember: false } });
    render(<DashboardPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/credits"));

    await userEvent.click(await screen.findByRole("button", { name: "pick-file" }));

    expect(await screen.findByText(/not enough funds/i)).toBeVisible();
    expect(postCallsFrom(fetchMock)).toHaveLength(0);
  });
});

describe("DashboardPage — dashboard label (ADR 0004 child 1, AC-5)", () => {
  it("shows 'Ready for step 2' for a ready project with no saved edit list", async () => {
    stubFetch({
      projects: [
        {
          id: "p1",
          fileName: "fresh.mp4",
          durationMs: 30_000,
          transcriptStatus: "ready",
          hasEdl: false,
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });
    render(<DashboardPage />);
    expect(await screen.findByText("Ready for step 2")).toBeVisible();
  });

  it("shows plain 'Ready' for a ready project that already has a saved edit list", async () => {
    stubFetch({
      projects: [
        {
          id: "p2",
          fileName: "done.mp4",
          durationMs: 30_000,
          transcriptStatus: "ready",
          hasEdl: true,
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });
    render(<DashboardPage />);
    expect(await screen.findByText("Ready")).toBeVisible();
    expect(screen.queryByText("Ready for step 2")).toBeNull();
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
          hasEdl: true,
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
