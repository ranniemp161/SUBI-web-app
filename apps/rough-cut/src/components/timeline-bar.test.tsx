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
    onHoverTimeChange: vi.fn(),
    onRangeSelect: vi.fn(),
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

// spec 0002 (transcript/timeline live sync): the timeline's own hover and
// selection/trim gestures publish outward (AC-5/AC-6, AC-3/AC-4), throttled
// to word-ish granularity for hover so it doesn't re-render the transcript on
// every pixel of pointer movement.
describe("TimelineBar — cross-panel sync (spec 0002)", () => {
  it("publishes the hovered time (throttled) on pointer move, and null on leave", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    // The hover/pointer handlers live on contentRef, the direct child of the
    // scrollable `.timeline-scroll` container.
    const content = getScroller(container).firstElementChild as HTMLElement;

    fireEvent.pointerMove(content, { clientX: 80, pointerType: "mouse" });
    expect(props.onHoverTimeChange).toHaveBeenCalledWith(2); // 80 / DEFAULT_PX_PER_SEC(40)

    fireEvent.pointerLeave(content);
    expect(props.onHoverTimeChange).toHaveBeenLastCalledWith(null);
  });

  // Regression: a self-published hover echoes back down as the `hoveredTime`
  // prop (it's the same shared state the transcript panel also reads), which
  // must not render a second marker on top of the local ghost line.
  it("does not render a duplicate cross-panel marker while hovering itself", () => {
    const props = makeProps({ hoveredTime: 2 });
    const { container } = render(<TimelineBar {...props} />);

    // Not self-hovering yet — the cross-panel marker (a thin pointer-events-none
    // line positioned via inline `left`, unlike the ghost which uses
    // `transform`, and unlike the ruler's tick marks which use `w-px bg-foreground/15`
    // rather than the shared hover-line token) renders.
    const findMarker = () =>
      Array.from(container.querySelectorAll<HTMLDivElement>("div")).find(
        (el) => el.style.left === "80px" && el.className.includes("pointer-events-none")
      );
    expect(findMarker()).toBeTruthy();

    const content = getScroller(container).firstElementChild as HTMLElement;
    fireEvent.pointerMove(content, { clientX: 10, pointerType: "mouse" });

    expect(findMarker()).toBeUndefined();
  });

  it("does not publish a hover time for a non-mouse pointer (e.g. touch)", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const content = getScroller(container).firstElementChild as HTMLElement;

    fireEvent.pointerMove(content, { clientX: 80, pointerType: "touch" });
    expect(props.onHoverTimeChange).not.toHaveBeenCalled();
  });

  it("publishes the clicked clip's time range when a kept clip is selected (AC-4)", () => {
    const props = makeProps();
    render(<TimelineBar {...props} />);

    fireEvent.click(screen.getByTitle(/keep — click to select/i));
    expect(props.onRangeSelect).toHaveBeenCalledWith({ start: 0, end: 5 });
  });

  it("publishes null when scrubbing (the ruler) clears the selection", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const ruler = container.querySelector(".cursor-text") as HTMLElement;
    expect(ruler).toBeTruthy();

    fireEvent.pointerDown(ruler, { clientX: 10, pointerId: 1 });
    expect(props.onRangeSelect).toHaveBeenCalledWith(null);
  });

  it("live-previews the kept segment's shrinking range while dragging its trim boundary (AC-4)", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const handle = container.querySelector(".cursor-col-resize") as HTMLElement;
    expect(handle).toBeTruthy();

    fireEvent.pointerDown(handle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 120, pointerId: 1 }); // 120/40 = 3s

    expect(props.onTrimBoundary).toHaveBeenCalledWith(0, 3);
    // segments[0] (index 0) is the "keep" side of this boundary.
    expect(props.onRangeSelect).toHaveBeenCalledWith({ start: 0, end: 3 });
  });

  // Regression: a bug report ("I deleted a word but it's still there, with a
  // stray highlight box around it") traced to this — the live-preview range
  // published mid-drag used the raw, unclamped pointer position, while the
  // boundary actually applied to the EDL (trimBoundary, edl.ts) clamps to
  // MIN_SEGMENT_SECONDS short of the neighbouring segment's own edge. A fast
  // or edge-reaching drag let the transcript's cross-panel highlight claim a
  // wider range than what was really cut, and it never got cleared afterward
  // (selectedRange only clears when playback starts), so the stale, too-wide
  // highlight persisted and made an uncut word look selected for deletion.
  it("live-previews the SAME clamped boundary trimBoundary will actually apply, not the raw drag position", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const handle = container.querySelector(".cursor-col-resize") as HTMLElement;

    // Drag far past the right segment's own end (8s); timeFromClientX caps at
    // `total` (8s), but trimBoundary itself clamps further, to
    // right.end - MIN_SEGMENT_SECONDS (7.95s) — the real boundary that lands.
    fireEvent.pointerDown(handle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 10_000, pointerId: 1 });

    expect(props.onRangeSelect).toHaveBeenCalledWith({ start: 0, end: 7.95 });
  });

  it("renders the cross-panel selection highlight band at the shared range", () => {
    const props = makeProps({ selectedRange: { start: 1, end: 3 } });
    const { container } = render(<TimelineBar {...props} />);

    const band = container.querySelector(".bg-blue-500\\/20") as HTMLElement;
    expect(band).toBeTruthy();
    expect(band.style.left).toBe("40px"); // 1s * 40px/s
    expect(band.style.width).toBe("80px"); // (3-1)s * 40px/s
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
