// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import TimelineBar from "./timeline-bar";
import type { EDL } from "@/lib/edl";

// jsdom implements neither the pointer-capture trio nor ResizeObserver nor a
// PointerEvent constructor, all of which the hand-tool pan logic calls
// unconditionally — without these polyfills the pan interactions below throw
// before any assertion runs. Mirrors the polyfill block in
// dashboard/[id]/page.test.tsx (Radix Select tests).
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (!("PointerEvent" in globalThis)) {
    class MockPointerEvent extends MouseEvent {
      pointerType: string;
      pointerId: number;
      constructor(type: string, props: PointerEventInit = {}) {
        super(type, props);
        this.pointerType = props.pointerType ?? "mouse";
        this.pointerId = props.pointerId ?? 1;
      }
    }
    globalThis.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent;
  }
});

afterEach(() => {
  cleanup();
  // A test that fails mid-drag could otherwise leave Space "held" for the
  // next test (the listener lives on window, outside React's cleanup).
  fireEvent.keyUp(window, { code: "Space" });
});

const EDL: EDL = {
  segments: [
    { start: 0, end: 5, status: "keep", reason: null },
    { start: 5, end: 8, status: "cut", reason: "silence" },
  ],
};

function makeProps(overrides: Partial<React.ComponentProps<typeof TimelineBar>> = {}) {
  return {
    edl: EDL,
    currentTime: 0,
    isPlaying: false,
    sourceFile: null,
    fileName: "clip.mov",
    snapTimes: [],
    onSeek: vi.fn(),
    onRestoreSegment: vi.fn(),
    onTrimStart: vi.fn(),
    onTrimBoundary: vi.fn(),
    onTrimEnd: vi.fn(),
    onCutToPlayhead: vi.fn(),
    onSplit: vi.fn(),
    selectedStart: null,
    onSelectSegment: vi.fn(),
    onDeleteSelected: vi.fn(),
    ...overrides,
  };
}

function getScroller(container: HTMLElement) {
  const el = container.querySelector(".timeline-scroll");
  if (!el) throw new Error("timeline scroll container not found");
  return el as HTMLElement;
}

function pointerDrag(el: HTMLElement, fromX: number, toX: number) {
  fireEvent.pointerDown(el, { clientX: fromX, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: toX, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: toX, pointerId: 1 });
}

describe("TimelineBar — hand-tool pan", () => {
  it("holding Space and dragging pans the scroller instead of scrubbing or selecting", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const scroller = getScroller(container);

    fireEvent.keyDown(window, { code: "Space" });
    pointerDrag(scroller, 100, 60);

    expect(scroller.scrollLeft).toBe(40); // 0 - (60 - 100)
    expect(props.onSeek).not.toHaveBeenCalled();
    expect(props.onSelectSegment).not.toHaveBeenCalled();
  });

  it("releases the pan tool on window blur so a stuck Space can't leave it armed", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const scroller = getScroller(container);

    fireEvent.keyDown(window, { code: "Space" });
    fireEvent(window, new Event("blur"));
    pointerDrag(scroller, 100, 60);

    expect(scroller.scrollLeft).toBe(0);
  });

  it("stops panning on pointercancel so a later move doesn't keep scrolling", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const scroller = getScroller(container);

    fireEvent.keyDown(window, { code: "Space" });
    fireEvent.pointerDown(scroller, { clientX: 100, pointerId: 1 });
    fireEvent.pointerCancel(scroller, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(scroller, { clientX: 40, pointerId: 1 });

    expect(scroller.scrollLeft).toBe(0);
  });

  it("the Hand tool button pans without holding Space, and toggling it off restores normal clicking", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const scroller = getScroller(container);
    const handButton = screen.getByRole("button", { name: /hand/i });

    fireEvent.click(handButton);
    expect(handButton).toHaveAttribute("aria-pressed", "true");
    pointerDrag(scroller, 100, 70);
    expect(scroller.scrollLeft).toBe(30);
    expect(props.onSelectSegment).not.toHaveBeenCalled();

    fireEvent.click(handButton);
    expect(handButton).toHaveAttribute("aria-pressed", "false");

    const keepClip = screen.getByTitle(/keep — click to select/i);
    fireEvent.click(keepClip);
    expect(props.onSelectSegment).toHaveBeenCalledTimes(1);
  });
});

describe("TimelineBar — cut-clip restore confirmation", () => {
  it("clicking a cut clip selects it and shows Restore, without restoring it yet", () => {
    const props = makeProps();
    render(<TimelineBar {...props} />);

    const cutClip = screen.getByTitle(/silence.*click to select, then restore/i);
    fireEvent.click(cutClip);

    expect(props.onRestoreSegment).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /restore cut/i })).toBeVisible();
  });

  it("clicking the Restore button actually restores the cut", () => {
    const props = makeProps();
    render(<TimelineBar {...props} />);

    fireEvent.click(screen.getByTitle(/silence.*click to select, then restore/i));
    fireEvent.click(screen.getByRole("button", { name: /restore cut/i }));

    expect(props.onRestoreSegment).toHaveBeenCalledWith(EDL.segments[1]);
  });

  it("Escape dismisses the Restore button without restoring", () => {
    const props = makeProps();
    render(<TimelineBar {...props} />);

    fireEvent.click(screen.getByTitle(/silence.*click to select, then restore/i));
    expect(screen.getByRole("button", { name: /restore cut/i })).toBeVisible();

    fireEvent.keyDown(window, { code: "Escape" });

    expect(screen.queryByRole("button", { name: /restore cut/i })).not.toBeInTheDocument();
    expect(props.onRestoreSegment).not.toHaveBeenCalled();
  });

  it("cut clips are keyboard-activatable: Enter and Space surface the Restore button", () => {
    const props = makeProps();
    render(<TimelineBar {...props} />);
    const cutClip = screen.getByTitle(/silence.*click to select, then restore/i);
    // Focusable by keyboard tabbing.
    expect(cutClip).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(cutClip, { key: "Enter" });
    expect(screen.getByRole("button", { name: /restore cut/i })).toBeVisible();

    // A second cut clip would also react to Space; here we verify the same
    // clip's Space activation stays selected.
    fireEvent.keyDown(cutClip, { key: " " });
    expect(screen.getByRole("button", { name: /restore cut/i })).toBeVisible();
    expect(props.onRestoreSegment).not.toHaveBeenCalled();
  });
});

describe("TimelineBar — playback auto-follow", () => {
  it("does not recenter the playhead while the Hand tool is active (so pan isn't fought)", () => {
    const props = makeProps({ isPlaying: true, currentTime: 0 });
    const { container, rerender } = render(<TimelineBar {...props} />);
    const scroller = getScroller(container);

    // Pan the scroller manually with the Hand tool on.
    fireEvent.click(screen.getByRole("button", { name: /hand/i }));
    pointerDrag(scroller, 100, 40);
    const pannedTo = scroller.scrollLeft;
    expect(pannedTo).toBeGreaterThan(0);

    // Advance playback — auto-follow must NOT snap scrollLeft back.
    rerender(<TimelineBar {...makeProps({ isPlaying: true, currentTime: 3 })} />);
    expect(scroller.scrollLeft).toBe(pannedTo);
  });
});
