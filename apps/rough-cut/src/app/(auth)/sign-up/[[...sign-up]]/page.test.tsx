import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import SignUpPage from "./page";

const pushMock = vi.fn();
const state = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@clerk/nextjs", () => ({
  SignUp: () => <div data-testid="clerk-sign-up" />,
  useAuth: () => ({ userId: state.userId }),
}));

describe("SignUpPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.userId = null;
  });

  afterEach(cleanup);

  it("renders Clerk's complete sign-up flow", () => {
    render(<SignUpPage />);

    expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
  });

  it("redirects an already signed-in user", () => {
    state.userId = "user_123";
    render(<SignUpPage />);

    expect(screen.queryByTestId("clerk-sign-up")).not.toBeInTheDocument();
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });
});
