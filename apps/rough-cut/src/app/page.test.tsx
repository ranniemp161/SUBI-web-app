import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
}));

vi.mock("next/font/google", () => ({
  Bricolage_Grotesque: () => ({ variable: "font-bricolage" }),
  IBM_Plex_Mono: () => ({ variable: "font-plex-mono" }),
  Instrument_Sans: () => ({ variable: "font-instrument" }),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import LandingPage from "./page";
import { redirect } from "next/navigation";

beforeEach(() => {
  state.clerkId = null;
  vi.clearAllMocks();
});

describe("LandingPage", () => {
  it("redirects to /dashboard if user is authenticated", async () => {
    state.clerkId = "clerk_1";
    await expect(LandingPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders landing page if user is not authenticated", async () => {
    state.clerkId = null;
    const element = await LandingPage();
    const { getByText } = render(element);
    expect(getByText("Ruff Cut")).toBeTruthy();
    expect(getByText("Questions, answered honestly")).toBeTruthy();
  });
});
