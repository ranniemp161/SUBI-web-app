// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import TimelineBar from "./timeline-bar";
import type { EDL } from "@/lib/edl";
import type { VideoFps } from "@/lib/frame-math";
import { extractWaveform, type Waveform } from "@/lib/waveform";
import { extractFilmstrip } from "@/lib/thumbnails";

// The decode/timeline reconciliation tests below need a decoded waveform with a
// chosen duration; real decoding needs WebCodecs, absent in jsdom. Every other
// test passes sourceFile: null, so these decoders are never called there.
vi.mock("@/lib/waveform", () => ({ extractWaveform: vi.fn() }));
vi.mock("@/lib/thumbnails", () => ({ extractFilmstrip: vi.fn() }));

// jsdom implements neither the pointer-capture trio nor ResizeObserver nor a
// PointerEvent constructor. The Hand tool's pan logic calls the first and third
// unconditionally, and Radix measures the toolbar tooltips' arrows with the
// second — without these polyfills the interactions below throw before any
// assertion runs. Mirrors the polyfill block in dashboard/[id]/page.test.tsx
// (Radix Select tests).
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

afterEach(cleanup);

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
    sourceFps: null,
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

function getToolButtons() {
  return {
    select: screen.getByRole("button", { name: /^select$/i }),
    hand: screen.getByRole("button", { name: /^hand$/i }),
  };
}

describe("TimelineBar — Select / Hand tools", () => {
  it("starts on the Select tool, so a drag scrubs rather than pans", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const scroller = getScroller(container);
    const { select, hand } = getToolButtons();

    expect(select).toHaveAttribute("aria-pressed", "true");
    expect(hand).toHaveAttribute("aria-pressed", "false");

    pointerDrag(scroller, 100, 60);
    expect(scroller.scrollLeft).toBe(0);
  });

  it("pressing H picks the Hand tool and dragging then pans instead of scrubbing or selecting", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const scroller = getScroller(container);

    fireEvent.keyDown(window, { code: "KeyH" });

    const { select, hand } = getToolButtons();
    expect(hand).toHaveAttribute("aria-pressed", "true");
    expect(select).toHaveAttribute("aria-pressed", "false");

    pointerDrag(scroller, 100, 60);
    expect(scroller.scrollLeft).toBe(40); // 0 - (60 - 100)
    expect(props.onSeek).not.toHaveBeenCalled();
    expect(props.onSelectSegment).not.toHaveBeenCalled();
  });

  it("pressing A returns to Select and turns the Hand tool off", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const scroller = getScroller(container);

    fireEvent.keyDown(window, { code: "KeyH" });
    fireEvent.keyDown(window, { code: "KeyA" });

    const { select, hand } = getToolButtons();
    expect(select).toHaveAttribute("aria-pressed", "true");
    expect(hand).toHaveAttribute("aria-pressed", "false");

    pointerDrag(scroller, 100, 60);
    expect(scroller.scrollLeft).toBe(0);

    const keepClip = screen.getByTitle(/keep — click to select/i);
    fireEvent.click(keepClip);
    expect(props.onSelectSegment).toHaveBeenCalledTimes(1);
  });

  it("the tool buttons pick a tool directly, and stay mutually exclusive", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const scroller = getScroller(container);
    const { select, hand } = getToolButtons();

    fireEvent.click(hand);
    expect(hand).toHaveAttribute("aria-pressed", "true");
    expect(select).toHaveAttribute("aria-pressed", "false");
    pointerDrag(scroller, 100, 70);
    expect(scroller.scrollLeft).toBe(30);
    expect(props.onSelectSegment).not.toHaveBeenCalled();

    fireEvent.click(select);
    expect(select).toHaveAttribute("aria-pressed", "true");
    expect(hand).toHaveAttribute("aria-pressed", "false");

    const keepClip = screen.getByTitle(/keep — click to select/i);
    fireEvent.click(keepClip);
    expect(props.onSelectSegment).toHaveBeenCalledTimes(1);
  });

  it("Space no longer arms the pan — it is play/pause only now", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const scroller = getScroller(container);

    fireEvent.keyDown(window, { code: "Space" });
    pointerDrag(scroller, 100, 60);

    expect(scroller.scrollLeft).toBe(0);
    expect(getToolButtons().select).toHaveAttribute("aria-pressed", "true");
  });

  it("ignores H and A while the user is typing in a form field", () => {
    const props = makeProps();
    render(<TimelineBar {...props} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { code: "KeyH" });
    expect(getToolButtons().hand).toHaveAttribute("aria-pressed", "false");

    input.remove();
  });

  it("leaves Cmd/Ctrl+A alone so select-all still reaches the browser", () => {
    const props = makeProps();
    render(<TimelineBar {...props} />);

    fireEvent.keyDown(window, { code: "KeyH" });
    fireEvent.keyDown(window, { code: "KeyA", metaKey: true });
    expect(getToolButtons().hand).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(window, { code: "KeyA", ctrlKey: true });
    expect(getToolButtons().hand).toHaveAttribute("aria-pressed", "true");
  });

  it("a window blur ends an in-flight pan drag but keeps the Hand tool chosen", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const scroller = getScroller(container);

    fireEvent.keyDown(window, { code: "KeyH" });
    fireEvent.pointerDown(scroller, { clientX: 100, pointerId: 1 });
    fireEvent(window, new Event("blur"));
    fireEvent.pointerMove(scroller, { clientX: 40, pointerId: 1 });

    expect(scroller.scrollLeft).toBe(0);
    // The tool is sticky — an alt-tab must not silently drop the user back
    // into Select mid-edit.
    expect(getToolButtons().hand).toHaveAttribute("aria-pressed", "true");
  });

  it("stops panning on pointercancel so a later move doesn't keep scrolling", () => {
    const props = makeProps();
    const { container } = render(<TimelineBar {...props} />);
    const scroller = getScroller(container);

    fireEvent.keyDown(window, { code: "KeyH" });
    fireEvent.pointerDown(scroller, { clientX: 100, pointerId: 1 });
    fireEvent.pointerCancel(scroller, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(scroller, { clientX: 40, pointerId: 1 });

    expect(scroller.scrollLeft).toBe(0);
  });

  it("shows the shortcut hint on a tool button when it takes focus", async () => {
    render(<TimelineBar {...makeProps()} />);

    getToolButtons().hand.focus();

    // Radix opens on focus as well as hover; jsdom can't produce a faithful
    // pointer hover, so focus is what this asserts through.
    expect(await screen.findByText("Pan")).toBeInTheDocument();
    expect(screen.getByText("H")).toBeInTheDocument();
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

// The filmstrip and waveform are sampled across their own decoded duration, but
// clips and the playhead are positioned by the shared timeline duration. When a
// decode's own length drifts from the timeline by more than one frame, spec 0004
// (AC-9) keeps positioning on the shared duration and surfaces the mismatch as a
// dev-only warning so it isn't silent. The default EDL above ends at 8s, so the
// shared timeline duration here is 8s.
describe("TimelineBar — decode/timeline reconciliation (spec 0004, AC-9)", () => {
  const FPS_30: VideoFps = { numerator: 30, denominator: 1 }; // one frame ≈ 0.033s
  const TIMELINE_SECONDS = 8;

  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(extractWaveform).mockResolvedValue(null);
    vi.mocked(extractFilmstrip).mockResolvedValue(null); // isolate the waveform path
  });
  afterEach(() => {
    warnSpy.mockRestore();
    vi.mocked(extractWaveform).mockReset();
    vi.mocked(extractFilmstrip).mockReset();
  });

  function waveformOfDuration(duration: number): Waveform {
    return { peaksMin: new Float32Array(4), peaksMax: new Float32Array(4), duration };
  }

  async function renderDecoded(
    overrides: Partial<React.ComponentProps<typeof TimelineBar>> = {}
  ) {
    render(
      <TimelineBar
        {...makeProps({ sourceFile: new File([], "clip.mov"), sourceFps: FPS_30, ...overrides })}
      />
    );
    // Wait for the async decode to commit (its "Decoding audio…" label clears),
    // then flush the passive reconciliation effect that runs just after that
    // commit, so an assertion sees the settled warn state.
    await waitFor(() =>
      expect(screen.queryByText("Decoding audio…")).not.toBeInTheDocument()
    );
    await act(async () => {});
  }

  it("warns when a decoded duration disagrees with the timeline by more than one frame", async () => {
    // 8.5s decoded against an 8s timeline: 0.5s off, far over one 30fps frame.
    vi.mocked(extractWaveform).mockResolvedValue(waveformOfDuration(TIMELINE_SECONDS + 0.5));
    await renderDecoded();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("disagrees with"));
  });

  it("stays silent when the decoded duration is within one frame of the timeline", async () => {
    vi.mocked(extractWaveform).mockResolvedValue(waveformOfDuration(TIMELINE_SECONDS + 0.01));
    await renderDecoded();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn when the source frame rate is unknown (no tolerance to size the check)", async () => {
    vi.mocked(extractWaveform).mockResolvedValue(waveformOfDuration(TIMELINE_SECONDS + 0.5));
    await renderDecoded({ sourceFps: null });
    expect(warnSpy).not.toHaveBeenCalled();
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
