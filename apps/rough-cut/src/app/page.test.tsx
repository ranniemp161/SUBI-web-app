import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/font/google", () => ({
  Bricolage_Grotesque: () => ({ variable: "font-bricolage" }),
  IBM_Plex_Mono: () => ({ variable: "font-plex-mono" }),
  Instrument_Sans: () => ({ variable: "font-instrument" }),
}));

import LandingPage from "./page";

// The signed-in → /dashboard redirect is handled by the Clerk middleware
// (src/proxy.ts, covered in proxy.test.ts); the page itself must stay free
// of auth() so it prerenders as a static page.
describe("LandingPage", () => {
  it("renders the landing page", () => {
    const { getByText } = render(<LandingPage />);
    expect(screen.getAllByText(/MyFirstCut/i).length).toBeGreaterThan(0);
    expect(getByText("Questions, answered honestly")).toBeTruthy();
  });
});
