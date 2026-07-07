// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import Home from "./page";
import { redirect } from "next/navigation";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/env", () => ({ ROUGH_CUT_URL: "http://localhost:3000" }));

describe("Home page", () => {
  it("redirects immediately to ROUGH_CUT_URL", () => {
    Home();
    expect(redirect).toHaveBeenCalledWith("http://localhost:3000");
  });
});
