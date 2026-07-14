// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import RootLayout from "./layout";

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  UserButton: () => <button data-testid="user-button">User</button>,
}));

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist" }),
  Geist_Mono: () => ({ variable: "font-geist-mono" }),
}));

vi.mock("@/lib/env", () => ({
  ROUGH_CUT_URL: "http://localhost:3000",
}));

describe("RootLayout", () => {
  it("renders children, header, and accessibility links", () => {
    render(
      <RootLayout>
        <div data-testid="child">Content</div>
      </RootLayout>
    );
    
    expect(screen.getByTestId("child")).toBeDefined();
    expect(screen.getByText("Founder's Frame Wallet")).toBeDefined();
    
    const backLink = screen.getByRole("link", { name: /back to rough cut/i });
    expect(backLink.getAttribute("href")).toBe("http://localhost:3000");
    expect(screen.getByTestId("user-button")).toBeDefined();
  });
});
