// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import CreditsPanel from "./credits-panel";

// Mock the environment variables used by the component
vi.mock("@/lib/env", () => ({
  WALLET_URL: "https://wallet.test",
  WALLET_DASHBOARD_URL: "https://wallet.test/dashboard",
}));

describe("CreditsPanel", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders with a dash when fetch fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
    });
    render(<CreditsPanel />);
    await waitFor(() => {
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    const link = screen.getByRole("link", { name: /add funds/i });
    expect(link).toHaveAttribute("href", "https://wallet.test/dashboard");
  });

  it("renders the balance as US dollars when fetch succeeds", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ balanceMicros: 19_000_000, isMember: false }),
    });
    render(<CreditsPanel />);
    await waitFor(() => {
      expect(screen.getByText("$19.00")).toBeInTheDocument();
    });
  });

  it("is accessible via keyboard and ARIA", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ balanceMicros: 5_000_000, isMember: false }),
    });
    render(<CreditsPanel />);
    const link = screen.getByRole("link", { name: /add funds/i });
    expect(link).toBeInTheDocument();
    expect(screen.getByTitle("Wallet balance remaining")).toBeInTheDocument();
  });
});
