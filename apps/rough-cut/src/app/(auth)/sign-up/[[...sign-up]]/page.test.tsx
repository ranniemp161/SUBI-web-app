import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import SignUpPage from "./page";

// Mock the router
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

// Mock Clerk hooks
const createMock = vi.fn();
const prepareEmailAddressVerificationMock = vi.fn();
const attemptEmailAddressVerificationMock = vi.fn();
const setActiveMock = vi.fn();

let mockIsLoaded = true;

vi.mock("@clerk/nextjs/legacy", () => ({
  useSignUp: () => ({
    isLoaded: mockIsLoaded,
    signUp: {
      create: createMock,
      prepareEmailAddressVerification: prepareEmailAddressVerificationMock,
      attemptEmailAddressVerification: attemptEmailAddressVerificationMock,
    },
    setActive: setActiveMock,
  }),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    userId: null,
  }),
}));

describe("SignUpPage Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLoaded = true;
  });

  afterEach(() => {
    cleanup();
  });

  describe("Signup form rendering and accessibility", () => {
    it("renders the sign-up form initially", () => {
      render(<SignUpPage />);
      expect(screen.getByRole("heading", { name: /create your account/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
    });

    it("has accessible inputs", () => {
      render(<SignUpPage />);
      const emailInput = screen.getByLabelText(/email address/i);
      expect(emailInput).toHaveAttribute("type", "email");
      expect(emailInput).toBeRequired();

      const passwordInput = screen.getByLabelText(/password/i);
      expect(passwordInput).toHaveAttribute("type", "password");
      expect(passwordInput).toBeRequired();
    });

    it("does nothing on submit if Clerk is not loaded", async () => {
      mockIsLoaded = false;
      render(<SignUpPage />);
      
      const user = userEvent.setup();
      await user.type(screen.getByLabelText(/email address/i), "test@example.com");
      await user.type(screen.getByLabelText(/password/i), "password123");
      await user.click(screen.getByRole("button", { name: /create account/i }));

      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe("Signup form submission", () => {
    it("successfully creates account and moves to verification step", async () => {
      createMock.mockResolvedValue({});
      prepareEmailAddressVerificationMock.mockResolvedValue({});

      render(<SignUpPage />);
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/email address/i), "test@example.com");
      await user.type(screen.getByLabelText(/password/i), "password123");
      await user.click(screen.getByRole("button", { name: /create account/i }));

      expect(createMock).toHaveBeenCalledWith({
        emailAddress: "test@example.com",
        password: "password123",
      });
      expect(prepareEmailAddressVerificationMock).toHaveBeenCalledWith({
        strategy: "email_code",
      });

      // Should move to verification screen
      expect(await screen.findByRole("heading", { name: /check your email/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /verify email/i })).toBeInTheDocument();
    });

    it("displays error when account creation fails", async () => {
      createMock.mockRejectedValue({
        errors: [{ longMessage: "Email is already taken" }],
      });

      render(<SignUpPage />);
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/email address/i), "test@example.com");
      await user.type(screen.getByLabelText(/password/i), "password123");
      await user.click(screen.getByRole("button", { name: /create account/i }));

      // Wait for error to appear
      expect(await screen.findByText("Email is already taken")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /create account/i })).not.toBeDisabled();
    });

    it("displays generic error when account creation fails without a longMessage", async () => {
      createMock.mockRejectedValue(new Error("Unknown error"));

      render(<SignUpPage />);
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/email address/i), "test@example.com");
      await user.type(screen.getByLabelText(/password/i), "password123");
      await user.click(screen.getByRole("button", { name: /create account/i }));

      expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
    });
  });

  describe("Verification form submission", () => {
    beforeEach(() => {
      createMock.mockResolvedValue({});
      prepareEmailAddressVerificationMock.mockResolvedValue({});
    });

    async function advanceToVerification() {
      render(<SignUpPage />);
      const user = userEvent.setup();
      await user.type(screen.getByLabelText(/email address/i), "test@example.com");
      await user.type(screen.getByLabelText(/password/i), "password123");
      await user.click(screen.getByRole("button", { name: /create account/i }));
      // Wait for transition
      await screen.findByRole("heading", { name: /check your email/i });
      return user;
    }

    it("successfully verifies email and redirects", async () => {
      attemptEmailAddressVerificationMock.mockResolvedValue({
        status: "complete",
        createdSessionId: "sess_123",
      });
      setActiveMock.mockResolvedValue({});

      const user = await advanceToVerification();

      await user.type(screen.getByLabelText(/verification code/i), "123456");
      await user.click(screen.getByRole("button", { name: /verify email/i }));

      expect(attemptEmailAddressVerificationMock).toHaveBeenCalledWith({
        code: "123456",
      });
      expect(setActiveMock).toHaveBeenCalledWith({ session: "sess_123" });
      expect(pushMock).toHaveBeenCalledWith("/dashboard");
    });

    it("shows error when verification status is not complete", async () => {
      attemptEmailAddressVerificationMock.mockResolvedValue({
        status: "abandoned",
      });

      const user = await advanceToVerification();

      await user.type(screen.getByLabelText(/verification code/i), "123456");
      await user.click(screen.getByRole("button", { name: /verify email/i }));

      expect(await screen.findByText("Verification incomplete. Please try again.")).toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
    });

    it("shows specific error message when verification throws an error", async () => {
      attemptEmailAddressVerificationMock.mockRejectedValue({
        errors: [{ longMessage: "Incorrect code" }],
      });

      const user = await advanceToVerification();

      await user.type(screen.getByLabelText(/verification code/i), "123456");
      await user.click(screen.getByRole("button", { name: /verify email/i }));

      expect(await screen.findByText("Incorrect code")).toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
    });

    it("shows generic error message when verification throws an unknown error", async () => {
      attemptEmailAddressVerificationMock.mockRejectedValue(new Error("Unknown"));

      const user = await advanceToVerification();

      await user.type(screen.getByLabelText(/verification code/i), "123456");
      await user.click(screen.getByRole("button", { name: /verify email/i }));

      expect(await screen.findByText("Invalid verification code. Please try again.")).toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
