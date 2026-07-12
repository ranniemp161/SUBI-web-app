import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "./filename";

describe("sanitizeFilename", () => {
  it("returns an already-safe name unchanged", () => {
    expect(sanitizeFilename("My Project")).toBe("My Project");
  });

  it("strips characters unsafe for a filename", () => {
    expect(sanitizeFilename('My/Project:Name?"<>|')).toBe("MyProjectName");
  });

  it("strips a backslash", () => {
    expect(sanitizeFilename("path\\to\\file")).toBe("pathtofile");
  });

  it("collapses internal whitespace and trims", () => {
    expect(sanitizeFilename("  My   Project  ")).toBe("My Project");
  });

  it("falls back to a default name when sanitizing leaves nothing", () => {
    expect(sanitizeFilename("///:::")).toBe("export");
  });

  it("falls back to a default name for an empty string", () => {
    expect(sanitizeFilename("")).toBe("export");
  });

  it("falls back to a default name for a whitespace-only string", () => {
    expect(sanitizeFilename("   ")).toBe("export");
  });

  it("preserves unicode characters that are not filesystem-unsafe", () => {
    expect(sanitizeFilename("Café Project 日本語")).toBe("Café Project 日本語");
  });
});
