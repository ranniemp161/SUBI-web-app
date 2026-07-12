import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadTextFile } from "./download-text-file";

describe("downloadTextFile", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => "blob:mock-url");
    revokeObjectURL = vi.fn();
    // jsdom doesn't implement URL.createObjectURL/revokeObjectURL.
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a Blob URL and triggers a click on a temporary anchor", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadTextFile("<xml>content</xml>", "export.fcpxml", "application/xml");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const [blobArg] = createObjectURL.mock.calls[0];
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toBe("application/xml");
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("sets the anchor's download attribute to the given filename", () => {
    let capturedFilename: string | undefined;
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
      capturedFilename = (node as HTMLAnchorElement).download;
      return node;
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadTextFile("event data", "cut-list.edl", "text/plain");

    expect(capturedFilename).toBe("cut-list.edl");
  });

  it("revokes the object URL after triggering the download", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadTextFile("content", "file.txt", "text/plain");

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("removes the temporary anchor from the DOM after the download", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const bodyChildCountBefore = document.body.children.length;

    downloadTextFile("content", "file.txt", "text/plain");

    expect(document.body.children.length).toBe(bodyChildCountBefore);
  });
});
