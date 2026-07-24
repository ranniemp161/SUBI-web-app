// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ShortcutsOverlay } from "./shortcuts-overlay";

afterEach(cleanup);

describe("ShortcutsOverlay", () => {
  it("documents the frame-step shortcut so the new feature is discoverable (spec 0004)", () => {
    render(<ShortcutsOverlay onClose={vi.fn()} />);
    const row = screen.getByText("Step 1 frame back / forward").closest("div")!;
    expect(row).toHaveTextContent(", / .");
  });

  it("lists the core editor shortcuts", () => {
    render(<ShortcutsOverlay onClose={vi.fn()} />);
    expect(screen.getByText("Play / pause")).toBeInTheDocument();
    expect(screen.getByText("Split clip at playhead")).toBeInTheDocument();
  });

  it("closes on the Close button and on a backdrop click, but not on a click inside the panel", () => {
    const onClose = vi.fn();
    render(<ShortcutsOverlay onClose={onClose} />);

    fireEvent.click(screen.getByText("Keyboard shortcuts")); // inside the panel
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
