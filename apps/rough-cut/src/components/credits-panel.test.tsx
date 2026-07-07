// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import CreditsPanel from "./credits-panel";

afterEach(() => {
  cleanup();
});

// Mock the environment variables used by the component
vi.mock("@/lib/env", () => ({
  WALLET_URL: "https://wallet.test",
  WALLET_DASHBOARD_URL: "https://wallet.test/dashboard",
}));

// Mock formatDuration
vi.mock("@/lib/utils", () => ({
  formatDuration: (ms: number) => `Formatted: ${ms}ms`,
}));

describe("CreditsPanel", () => {
  it("renders with a dash when credits is null", () => {
    render(<CreditsPanel credits={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    
    const link = screen.getByRole("link", { name: /buy credits/i });
    expect(link).toHaveAttribute("href", "https://wallet.test/dashboard");
  });

  it("renders formatted duration when credits are provided", () => {
    render(<CreditsPanel credits={{ tokens: 600, isMember: false }} />);
    // 600 * 1000 = 600000
    expect(screen.getByText("Formatted: 600000ms")).toBeInTheDocument();
  });

  it("is accessible via keyboard and ARIA", () => {
    render(<CreditsPanel credits={{ tokens: 100, isMember: false }} />);
    const link = screen.getByRole("link", { name: /buy credits/i });
    expect(link).toBeInTheDocument();
    expect(screen.getByTitle("Transcription credits remaining")).toBeInTheDocument();
  });
});
