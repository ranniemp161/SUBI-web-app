import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { authMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  // Next's real redirect() never returns — it throws so rendering stops. The
  // mock throws too; otherwise the component would carry on and render the
  // form, and "redirects before rendering anything" would pass without being
  // true.
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

vi.mock("@clerk/nextjs", () => ({
  SignUp: () => <div data-testid="clerk-sign-up" />,
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import SignUpPage from "./page";

describe("SignUpPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("renders Clerk's complete sign-up flow for a signed-out visitor", async () => {
    authMock.mockResolvedValue({ userId: null });

    render(await SignUpPage());

    expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects an already signed-in user before rendering anything", async () => {
    authMock.mockResolvedValue({ userId: "user_123" });

    await expect(SignUpPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });
});
