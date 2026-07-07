// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import GlobalError from "./global-error";

afterEach(() => {
  cleanup();
});

describe("GlobalError", () => {
  it("renders the error message and a try again button", async () => {
    const error = new Error("Test catastrophic failure");
    const reset = vi.fn();
    
    render(<GlobalError error={error} reset={reset} />);
    
    expect(screen.getByText("Something went wrong!")).toBeDefined();
    expect(screen.getByText("Test catastrophic failure")).toBeDefined();
    expect(screen.getByRole("button", { name: /try again/i })).toBeDefined();
  });

  it("calls reset when the try again button is clicked", async () => {
    const error = new Error("Failed");
    const reset = vi.fn();
    
    render(<GlobalError error={error} reset={reset} />);
    
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
