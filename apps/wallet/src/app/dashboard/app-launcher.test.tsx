import "@testing-library/jest-dom/vitest";
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AppLauncher } from "./app-launcher";

vi.mock("@/lib/env", () => ({
  ROUGH_CUT_URL: "http://localhost:3000",
}));

test("renders the ecosystem apps section with correct links and badges", () => {
  render(<AppLauncher />);
  
  expect(screen.getByText("Subi Apps")).toBeInTheDocument();
  
  const roughCutLink = screen.getByRole("link", { name: /Rough Cut/i });
  expect(roughCutLink).toHaveAttribute("href", "http://localhost:3000/dashboard");
  
  expect(screen.getByText("Infographics")).toBeInTheDocument();
  expect(screen.getByText("Thumbnail")).toBeInTheDocument();
  
  const comingSoonBadges = screen.getAllByText("Coming Soon");
  expect(comingSoonBadges).toHaveLength(2);
});
