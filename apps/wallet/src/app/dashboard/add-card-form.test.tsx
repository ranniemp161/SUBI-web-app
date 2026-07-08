// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, beforeEach, afterEach, describe } from "vitest";
import { AddCardForm } from "./add-card-form";

const mockConfirmSetup = vi.fn();
const mockGetStripeClient = vi.fn();

vi.mock("@/lib/stripe-client", () => ({
  getStripeClient: () => mockGetStripeClient(),
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useElements: () => ({}),
  useStripe: () => ({ confirmSetup: mockConfirmSetup }),
}));

describe("AddCardForm", () => {
  const onSuccess = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    mockGetStripeClient.mockReturnValue(Promise.resolve(null));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("shows a clear error instead of crashing when the Stripe client fails to init", () => {
    mockGetStripeClient.mockImplementation(() => {
      throw new Error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set");
    });

    render(
      <AddCardForm clientSecret="secret" onSuccess={onSuccess} onCancel={onCancel} />
    );

    expect(
      screen.getByText(/Billing is misconfigured/i)
    ).toBeInTheDocument();
  });

  test("re-enables the submit button and shows an error if confirmSetup rejects", async () => {
    mockConfirmSetup.mockRejectedValueOnce(new Error("network drop"));
    const user = userEvent.setup();

    render(
      <AddCardForm clientSecret="secret" onSuccess={onSuccess} onCancel={onCancel} />
    );

    const submitButton = screen.getByRole("button", { name: /Save card/i });
    await user.click(submitButton);

    await screen.findByText(/Something went wrong saving the card/i);
    expect(submitButton).not.toBeDisabled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test("calls onSuccess when the SetupIntent confirms", async () => {
    mockConfirmSetup.mockResolvedValueOnce({
      setupIntent: { status: "succeeded" },
    });
    const user = userEvent.setup();

    render(
      <AddCardForm clientSecret="secret" onSuccess={onSuccess} onCancel={onCancel} />
    );

    await user.click(screen.getByRole("button", { name: /Save card/i }));

    expect(onSuccess).toHaveBeenCalled();
  });
});
