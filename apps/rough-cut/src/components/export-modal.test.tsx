// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ExportModal } from "./export-modal";

afterEach(cleanup);

function makeProps(overrides: Partial<React.ComponentProps<typeof ExportModal>> = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    onExportMp4: vi.fn(),
    onExportFcpxml: vi.fn(),
    onExportCmx3600: vi.fn(),
    onExportXmeml: vi.fn(),
    busy: false,
    ...overrides,
  };
}

/** The format cards have no aria-label; find each by its visible label text. */
function selectFormat(label: string) {
  fireEvent.click(screen.getByText(label));
}

const exportNow = () => screen.getByRole("button", { name: /export now/i });

describe("ExportModal — visibility", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<ExportModal {...makeProps({ isOpen: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the dialog and all four format choices when open", () => {
    render(<ExportModal {...makeProps()} />);
    expect(screen.getByText("Export Project")).toBeInTheDocument();
    expect(screen.getByText("Video (MP4)")).toBeInTheDocument();
    expect(screen.getByText("DaVinci Resolve")).toBeInTheDocument();
    expect(screen.getByText("Premiere Pro")).toBeInTheDocument();
    expect(screen.getByText("Final Cut Pro")).toBeInTheDocument();
  });
});

describe("ExportModal — export dispatch", () => {
  it("exports MP4 at source resolution by default (null max height)", () => {
    const props = makeProps();
    render(<ExportModal {...props} />);
    fireEvent.click(exportNow());
    expect(props.onExportMp4).toHaveBeenCalledWith(null);
  });

  it("passes the chosen MP4 resolution as a max height", () => {
    const props = makeProps();
    render(<ExportModal {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "1080p" }));
    fireEvent.click(exportNow());
    expect(props.onExportMp4).toHaveBeenCalledWith(1080);
  });

  it("dispatches the matching handler for each interchange format and closes", () => {
    for (const [label, key] of [
      ["DaVinci Resolve", "onExportCmx3600"],
      ["Premiere Pro", "onExportXmeml"],
      ["Final Cut Pro", "onExportFcpxml"],
    ] as const) {
      const props = makeProps();
      render(<ExportModal {...props} />);
      selectFormat(label);
      fireEvent.click(exportNow());
      expect(props[key]).toHaveBeenCalledTimes(1);
      // Synchronous interchange exports dismiss the dialog immediately.
      expect(props.onClose).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("does not close after an MP4 export (it runs asynchronously in the page)", () => {
    const props = makeProps();
    render(<ExportModal {...props} />);
    fireEvent.click(exportNow());
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

// The reselect-gated pipeline (spec 0004) can leave a format unavailable: MP4 is
// blocked when export can't run at all, and the NLE-interchange formats are
// blocked until the source's real frame rate is known. The modal must explain
// why and refuse the export, per the selected format.
describe("ExportModal — blocked-format reason (spec 0004, AC-5/AC-6)", () => {
  it("shows the MP4 reason and disables Export Now when MP4 is blocked", () => {
    const props = makeProps({ exportBlockedReason: "Re-select your source video first." });
    render(<ExportModal {...props} />); // MP4 is the default selected format
    expect(screen.getByRole("status")).toHaveTextContent("Re-select your source video first.");
    expect(exportNow()).toBeDisabled();

    fireEvent.click(exportNow());
    expect(props.onExportMp4).not.toHaveBeenCalled();
  });

  it("blocks the interchange formats on an unknown frame rate but leaves MP4 exportable", () => {
    const props = makeProps({ exportFormatBlockedReason: "Frame rate unknown until you re-select the source." });
    render(<ExportModal {...props} />);

    // MP4 (the default) is unaffected by the interchange-only reason.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(exportNow()).toBeEnabled();

    // Switching to an interchange format surfaces the reason and disables export.
    selectFormat("DaVinci Resolve");
    expect(screen.getByRole("status")).toHaveTextContent("Frame rate unknown until you re-select the source.");
    expect(exportNow()).toBeDisabled();
    fireEvent.click(exportNow());
    expect(props.onExportCmx3600).not.toHaveBeenCalled();
  });
});

describe("ExportModal — busy state", () => {
  it("shows Exporting… and disables the button while busy", () => {
    const props = makeProps({ busy: true });
    render(<ExportModal {...props} />);
    const btn = screen.getByRole("button", { name: /exporting/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(props.onExportMp4).not.toHaveBeenCalled();
  });
});

describe("ExportModal — dismissal", () => {
  it("closes on the X button", () => {
    const props = makeProps();
    render(<ExportModal {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const props = makeProps();
    render(<ExportModal {...props} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop click but not on a click inside the panel", () => {
    const props = makeProps();
    render(<ExportModal {...props} />);
    // Clicking the heading is inside the panel: stopPropagation keeps it open.
    fireEvent.click(screen.getByText("Export Project"));
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
