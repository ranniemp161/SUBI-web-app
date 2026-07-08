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

describe("CreditsPanel", () => {
  it("renders with a dash when credits is null", () => {
    render(<CreditsPanel credits={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /add funds/i });
    expect(link).toHaveAttribute("href", "https://wallet.test/dashboard");
  });

  it("renders the balance as US dollars when credits are provided", () => {
    render(<CreditsPanel credits={{ balanceMicros: 19_000_000, isMember: false }} />);
    expect(screen.getByText("$19.00")).toBeInTheDocument();
  });

  it("is accessible via keyboard and ARIA", () => {
    render(<CreditsPanel credits={{ balanceMicros: 5_000_000, isMember: false }} />);
    const link = screen.getByRole("link", { name: /add funds/i });
    expect(link).toBeInTheDocument();
    expect(screen.getByTitle("Wallet balance remaining")).toBeInTheDocument();
  });
});
