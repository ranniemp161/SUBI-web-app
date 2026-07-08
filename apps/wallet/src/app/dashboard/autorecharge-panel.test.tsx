// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, beforeEach, afterEach, describe } from "vitest";
import { AutorechargePanel } from "./autorecharge-panel";

describe("AutorechargePanel", () => {
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("renders correctly with saved card", () => {
    render(
      <AutorechargePanel
        enabled={true}
        thresholdMicros={5000000}
        amountMicros={19000000}
        hasCard={true}
        savedCard={{ brand: "visa", last4: "4242" }}
        failures={0}
      />
    );
    
    expect(screen.getByRole("switch", { name: "Toggle auto-recharge" })).toBeChecked();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
    expect(screen.getByDisplayValue("19")).toBeInTheDocument();
    expect(screen.getByText(/Visa •••• 4242/)).toBeInTheDocument();
  });

  test("disables toggle when no card is saved", () => {
    render(
      <AutorechargePanel
        enabled={false}
        thresholdMicros={5000000}
        amountMicros={19000000}
        hasCard={false}
        savedCard={null}
        failures={0}
      />
    );
    
    const toggle = screen.getByRole("switch", { name: "Toggle auto-recharge" });
    expect(toggle).toBeDisabled();
    expect(screen.getByText("Add a card to enable auto-recharge.")).toBeInTheDocument();
  });

  test("saves settings successfully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    const user = userEvent.setup();
    
    render(
      <AutorechargePanel
        enabled={false}
        thresholdMicros={5000000}
        amountMicros={19000000}
        hasCard={true}
        savedCard={{ brand: "visa", last4: "4242" }}
        failures={0}
      />
    );
    
    const toggle = screen.getByRole("switch", { name: "Toggle auto-recharge" });
    await user.click(toggle);
    
    expect(mockFetch).toHaveBeenCalledWith("/api/billing/autorecharge", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({
        enabled: true,
        thresholdMicros: 5000000,
        amountMicros: 19000000,
      }),
    }));
    
    await screen.findByText("Auto-recharge is on.");
  });

  test("shows error when save fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Server error" }),
    });
    const user = userEvent.setup();
    
    render(
      <AutorechargePanel
        enabled={true}
        thresholdMicros={5000000}
        amountMicros={19000000}
        hasCard={true}
        savedCard={{ brand: "visa", last4: "4242" }}
        failures={0}
      />
    );
    
    const saveButton = screen.getByRole("button", { name: /Save settings/i });
    await user.click(saveButton);
    
    await screen.findByText("Server error");
  });
  
  test("starts card setup", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clientSecret: "secret" }),
    });
    const user = userEvent.setup();
    
    render(
      <AutorechargePanel
        enabled={false}
        thresholdMicros={5000000}
        amountMicros={19000000}
        hasCard={false}
        savedCard={null}
        failures={0}
      />
    );
    
    const addCardButton = screen.getByRole("button", { name: "Add card" });
    await user.click(addCardButton);
    
    expect(mockFetch).toHaveBeenCalledWith("/api/billing/setup-intent", expect.objectContaining({
      method: "POST",
    }));
    
    await screen.findByText(/Card setup started/);
  });
});
