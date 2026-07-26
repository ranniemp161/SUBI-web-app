// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { Tooltip, TooltipProvider } from "./tooltip";

// jsdom has no ResizeObserver; Radix measures the tooltip arrow with it, so an
// open tooltip throws without this polyfill.
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(() => {
  cleanup();
});

// Tooltip is the shared Radix Tooltip wrapper. It replaced the native `title`
// attribute in the rough-cut timeline toolbar, so the contract those callers
// depend on is: the trigger stays their own element (asChild), the hint opens
// on focus as well as hover, and the shortcut renders as a keycap.
//
// jsdom can't produce a faithful pointer hover, so these assert through focus,
// which Radix treats as an equivalent open trigger.

function renderTooltip(props: Partial<React.ComponentProps<typeof Tooltip>> = {}) {
  return render(
    <TooltipProvider>
      <Tooltip label="Pan" keys="H" {...props}>
        <button type="button" aria-pressed={false} onClick={props.children ? undefined : vi.fn()}>
          Hand
        </button>
      </Tooltip>
    </TooltipProvider>
  );
}

describe("Tooltip — closed state", () => {
  it("renders only the trigger until something opens it", () => {
    renderTooltip();
    expect(screen.getByRole("button", { name: "Hand" })).toBeInTheDocument();
    expect(screen.queryByText("Pan")).toBeNull();
  });

  it("leaves the caller's own element as the trigger, keeping its props", () => {
    renderTooltip();
    const trigger = screen.getByRole("button", { name: "Hand" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-pressed", "false");
  });
});

describe("Tooltip — open state", () => {
  it("shows the label and the shortcut keycap when the trigger takes focus", async () => {
    renderTooltip();
    fireEvent.focus(screen.getByRole("button", { name: "Hand" }));

    expect(await screen.findByText("Pan")).toBeInTheDocument();
    const keycap = screen.getByText("H");
    expect(keycap.tagName).toBe("KBD");
  });

  it("omits the keycap when no shortcut is given", async () => {
    renderTooltip({ keys: undefined, label: "Toggle snapping to word edges" });
    fireEvent.focus(screen.getByRole("button", { name: "Hand" }));

    expect(await screen.findByText("Toggle snapping to word edges")).toBeInTheDocument();
    expect(document.querySelector("kbd")).toBeNull();
  });

  it("closes again on blur", async () => {
    renderTooltip();
    const trigger = screen.getByRole("button", { name: "Hand" });

    fireEvent.focus(trigger);
    expect(await screen.findByText("Pan")).toBeInTheDocument();

    fireEvent.blur(trigger);
    expect(screen.queryByText("Pan")).toBeNull();
  });
});
