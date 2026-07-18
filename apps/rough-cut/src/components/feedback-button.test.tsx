import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const state = vi.hoisted(() => ({
  // What Sentry.getFeedback() yields; null simulates Sentry being off (no
  // DSN, or the server build, which has no feedback API at all).
  integration: null as { attachTo: ReturnType<typeof vi.fn> } | null,
  unsubscribe: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  getFeedback: vi.fn(() => state.integration ?? undefined),
}));

import { FeedbackButton } from "./feedback-button";

beforeEach(() => {
  state.integration = null;
  state.unsubscribe = vi.fn();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function liveIntegration() {
  state.integration = { attachTo: vi.fn(() => state.unsubscribe) };
  return state.integration;
}

describe("FeedbackButton", () => {
  it("first render is empty even when the feedback integration is live (hydration parity regression)", () => {
    // The server renders nothing because its SDK build has no feedback API.
    // Hydration therefore requires the first client render to also be empty,
    // EVEN when getFeedback() would already return an integration, so the
    // component must not read Sentry during render. This string is what both
    // the real server and the client's hydration pass must produce.
    liveIntegration();
    expect(renderToString(<FeedbackButton variant="floating" />)).toBe("");
  });

  it("shows the button after mount and attaches the feedback widget to it", async () => {
    const integration = liveIntegration();
    render(<FeedbackButton variant="floating" />);

    const button = await screen.findByRole("button", {
      name: /request a feature/i,
    });
    expect(integration.attachTo).toHaveBeenCalledWith(button);
  });

  it("renders nothing when Sentry has no feedback integration", async () => {
    const { container } = render(<FeedbackButton variant="floating" />);
    // Effects have run and found no integration; the tree must stay empty.
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("detaches the widget on unmount", async () => {
    liveIntegration();
    const { unmount } = render(<FeedbackButton variant="icon" />);
    await screen.findByRole("button", { name: /request a feature/i });

    unmount();
    expect(state.unsubscribe).toHaveBeenCalled();
  });
});
