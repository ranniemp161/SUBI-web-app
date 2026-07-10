// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import FilePicker from "./file-picker";

afterEach(() => {
  cleanup();
});

/**
 * jsdom's <video> never actually decodes media, so `duration` is stubbed and
 * `onloadedmetadata` is fired manually (via the `src` setter, the same event
 * FilePicker itself triggers by assigning `video.src`) to simulate the
 * browser having read the file's metadata — this is the boundary the
 * component can't control.
 */
let currentDuration = 0;

// Installed once, not per-test: capturing the *true* native `src` setter here
// (before any wrapping happens) and wrapping it exactly once avoids stacking
// a new microtask-dispatching layer on top of the previous test's wrapper
// (which would fire `loadedmetadata` multiple times per assignment).
const nativeSrcSetter = Object.getOwnPropertyDescriptor(
  window.HTMLMediaElement.prototype,
  "src"
)?.set;
Object.defineProperty(window.HTMLMediaElement.prototype, "src", {
  configurable: true,
  set(this: HTMLMediaElement, value: string) {
    nativeSrcSetter?.call(this, value);
    queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
  },
  get(this: HTMLMediaElement) {
    return this.getAttribute("src") ?? "";
  },
});

beforeEach(() => {
  currentDuration = 0;
  // Force HTMLMediaElement.duration to whatever the test wants. jsdom never
  // decodes media, so nothing sets this on its own.
  Object.defineProperty(window.HTMLMediaElement.prototype, "duration", {
    configurable: true,
    get() {
      return currentDuration;
    },
  });
  window.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  window.URL.revokeObjectURL = vi.fn();
});

function makeVideoFile(name = "clip.mp4", type = "video/mp4") {
  return new File(["fake-bytes"], name, { type });
}

async function selectFile(file: File) {
  const input = document.getElementById("video-file-input") as HTMLInputElement;
  // The input's `accept="video/*"` makes userEvent's default file-type
  // filtering silently drop a non-video File from the FileList (mimicking a
  // real OS picker); disable that here so a wrong-type file can reach
  // `handleFileChange`, exactly like a user dragging-and-dropping one (drag
  // and drop is never filtered by `accept`).
  await userEvent.upload(input, file, { applyAccept: false });
}

describe("FilePicker — basic validation", () => {
  it("rejects a non-video file with an error message", async () => {
    const onFileSelected = vi.fn();
    render(<FilePicker onFileSelected={onFileSelected} />);

    await selectFile(new File(["x"], "doc.pdf", { type: "application/pdf" }));

    expect(await screen.findByText("Please select a video file.")).toBeInTheDocument();
    expect(onFileSelected).not.toHaveBeenCalled();
  });

  it("warns but still proceeds for files over 20 GB", async () => {
    const onFileSelected = vi.fn();
    currentDuration = 10;
    render(<FilePicker onFileSelected={onFileSelected} />);

    const bigFile = new File([""], "huge.mp4", { type: "video/mp4" });
    Object.defineProperty(bigFile, "size", { value: 21 * 1024 * 1024 * 1024 });

    await selectFile(bigFile);

    expect(await screen.findByText(/Files over 20 GB may cause browser memory issues/)).toBeInTheDocument();
    expect(onFileSelected).toHaveBeenCalledTimes(1);
  });
});

describe("FilePicker — initial upload (no expectedDurationMs)", () => {
  // covers AC-4 (child 3): no stored duration, so no comparison is applied.
  it("accepts any duration when expectedDurationMs is absent", async () => {
    const onFileSelected = vi.fn();
    currentDuration = 999; // wildly different from any "expected" value
    render(<FilePicker onFileSelected={onFileSelected} />);

    await selectFile(makeVideoFile());

    await waitFor(() =>
      expect(onFileSelected).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({ fileName: "clip.mp4", durationMs: 999_000 })
      )
    );
  });
});

describe("FilePicker — reselect duration verification (expectedDurationMs)", () => {
  // covers AC-3 (child 3): within tolerance is accepted.
  it("accepts a file within 1500ms of the expected duration", async () => {
    const onFileSelected = vi.fn();
    currentDuration = 10.4; // 10400ms, 400ms off from 10000ms expected
    render(<FilePicker onFileSelected={onFileSelected} expectedDurationMs={10_000} />);

    await selectFile(makeVideoFile());

    await waitFor(() =>
      expect(onFileSelected).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({ durationMs: 10_400 })
      )
    );
  });

  // covers AC-3 (child 3): exactly at the tolerance boundary is still accepted
  // (the check rejects only when the difference is strictly greater than 1500ms).
  it("accepts a file exactly at the 1500ms tolerance boundary", async () => {
    const onFileSelected = vi.fn();
    currentDuration = 11.5; // 11500ms, exactly 1500ms off from 10000ms
    render(<FilePicker onFileSelected={onFileSelected} expectedDurationMs={10_000} />);

    await selectFile(makeVideoFile());

    await waitFor(() => expect(onFileSelected).toHaveBeenCalled());
  });

  // covers AC-1, AC-2 (child 3): over tolerance is blocked with the exact
  // message and onFileSelected is never called.
  it("rejects a file whose duration differs by more than 1500ms, with the exact message", async () => {
    const onFileSelected = vi.fn();
    currentDuration = 20; // 20000ms vs 10000ms expected — way over tolerance
    render(<FilePicker onFileSelected={onFileSelected} expectedDurationMs={10_000} />);

    await selectFile(makeVideoFile());

    expect(
      await screen.findByText(
        "That video does not match this project. The file you picked is a different length than the original. Reopen this project with the same source video you transcribed, then try again."
      )
    ).toBeInTheDocument();
    expect(onFileSelected).not.toHaveBeenCalled();
  });

  // covers AC-2 (child 3): the picker resets so a subsequent selection re-runs the check.
  it("clears the file input value on rejection so re-picking re-fires the check", async () => {
    const onFileSelected = vi.fn();
    currentDuration = 20;
    render(<FilePicker onFileSelected={onFileSelected} expectedDurationMs={10_000} />);

    await selectFile(makeVideoFile());
    await screen.findByText(/does not match this project/);

    const input = document.getElementById("video-file-input") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  // covers AC-5 (child 3): MIME validation and the 20GB warning are unaffected
  // by the presence of expectedDurationMs.
  it("still rejects a non-video file even when expectedDurationMs is set", async () => {
    const onFileSelected = vi.fn();
    render(<FilePicker onFileSelected={onFileSelected} expectedDurationMs={10_000} />);

    await selectFile(new File(["x"], "doc.pdf", { type: "application/pdf" }));

    expect(await screen.findByText("Please select a video file.")).toBeInTheDocument();
    expect(onFileSelected).not.toHaveBeenCalled();
  });
});

describe("FilePicker — reselect metadata warnings", () => {
  function makeVideoFileWithSize(name = "clip.mp4", size = 1024, type = "video/mp4") {
    const file = new File(["fake-bytes"], name, { type });
    Object.defineProperty(file, "size", { value: size });
    return file;
  }

  it("warns about filename mismatch and lets user proceed", async () => {
    const onFileSelected = vi.fn();
    currentDuration = 10;
    render(
      <FilePicker
        onFileSelected={onFileSelected}
        expectedDurationMs={10_000}
        expectedFileName="original.mp4"
        expectedFileSize={1024}
        expectedFileType="video/mp4"
      />
    );

    const mismatchedFile = makeVideoFileWithSize("different.mp4", 1024, "video/mp4");
    await selectFile(mismatchedFile);

    expect(
      await screen.findByText(/The selected file does not exactly match this project/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/different filename/i)).toBeInTheDocument();
    expect(onFileSelected).not.toHaveBeenCalled();

    // Confirm warning
    const confirmBtn = screen.getByRole("button", { name: /use this file anyway/i });
    await userEvent.click(confirmBtn);

    expect(onFileSelected).toHaveBeenCalledWith(
      mismatchedFile,
      expect.objectContaining({ fileName: "different.mp4" })
    );
  });

  it("warns about multiple mismatches (size and type) and allows canceling", async () => {
    const onFileSelected = vi.fn();
    currentDuration = 10;
    render(
      <FilePicker
        onFileSelected={onFileSelected}
        expectedDurationMs={10_000}
        expectedFileName="clip.mp4"
        expectedFileSize={1024}
        expectedFileType="video/mp4"
      />
    );

    const mismatchedFile = makeVideoFileWithSize("clip.mp4", 2048, "video/quicktime");
    await selectFile(mismatchedFile);

    expect(
      await screen.findByText(/The selected file does not exactly match this project/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/different size/i)).toBeInTheDocument();
    expect(screen.getByText(/type/i)).toBeInTheDocument();
    expect(onFileSelected).not.toHaveBeenCalled();

    // Cancel warning
    const cancelBtn = screen.getByRole("button", { name: /choose different file/i });
    await userEvent.click(cancelBtn);

    expect(screen.queryByText(/Warning: File Mismatch/i)).not.toBeInTheDocument();
    const input = document.getElementById("video-file-input") as HTMLInputElement;
    expect(input.value).toBe("");
  });
});

describe("FilePicker — loading and accessibility", () => {
  it("disables the picker button while isLoading", () => {
    render(<FilePicker onFileSelected={vi.fn()} isLoading />);
    expect(screen.getByRole("button", { name: /creating project/i })).toBeDisabled();
  });

  it("exposes the picker as a reachable, named button", () => {
    render(<FilePicker onFileSelected={vi.fn()} />);
    const button = screen.getByRole("button", { name: /select a video file/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });
});

describe("FilePicker — timeout safeguard", () => {
  let originalSetTimeout: typeof window.setTimeout;
  let timeoutCallback: (() => void) | undefined;

  beforeEach(() => {
    timeoutCallback = undefined;
    originalSetTimeout = window.setTimeout;
    window.setTimeout = vi.fn((cb: Parameters<typeof window.setTimeout>[0], ms?: number) => {
      if (ms === 8000) {
        timeoutCallback = cb as () => void;
        return 9999 as unknown as ReturnType<typeof window.setTimeout>;
      }
      return originalSetTimeout(cb, ms);
    }) as unknown as typeof window.setTimeout;

    // Overwrite standard src setter to prevent automatic load
    Object.defineProperty(window.HTMLMediaElement.prototype, "src", {
      configurable: true,
      set(this: HTMLMediaElement, value: string) {
        nativeSrcSetter?.call(this, value);
      },
      get(this: HTMLMediaElement) {
        return this.getAttribute("src") ?? "";
      },
    });
  });

  afterEach(() => {
    window.setTimeout = originalSetTimeout;
    Object.defineProperty(window.HTMLMediaElement.prototype, "src", {
      configurable: true,
      set(this: HTMLMediaElement, value: string) {
        nativeSrcSetter?.call(this, value);
        queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
      },
      get(this: HTMLMediaElement) {
        return this.getAttribute("src") ?? "";
      },
    });
  });

  it("shows timeout error when metadata load takes too long", async () => {
    const onFileSelected = vi.fn();
    render(<FilePicker onFileSelected={onFileSelected} />);

    await selectFile(makeVideoFile());

    expect(timeoutCallback).toBeDefined();

    // Trigger the timeout callback manually!
    timeoutCallback!();

    expect(
      await screen.findByText(
        "Could not read this video file (metadata load timed out). Try a different format."
      )
    ).toBeInTheDocument();
    expect(onFileSelected).not.toHaveBeenCalled();
  });
});
