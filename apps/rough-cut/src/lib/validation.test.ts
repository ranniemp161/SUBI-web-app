import { describe, it, expect } from "vitest";
import { createProjectSchema } from "./validation";

describe("createProjectSchema — mandatory AI polish (ADR 0004 child 1, AC-2)", () => {
  it("no longer accepts an aiPolish field", () => {
    const result = createProjectSchema.safeParse({
      fileName: "clip.mp4",
      aiPolish: true,
    });
    expect(result.success).toBe(false);
  });

  it("parses without an aiPolish field (the client never sends one)", () => {
    const parsed = createProjectSchema.parse({ fileName: "clip.mp4", durationMs: 5000 });
    expect(parsed).not.toHaveProperty("aiPolish");
  });

  it("still rejects unexpected top-level keys (strictObject)", () => {
    const result = createProjectSchema.safeParse({ fileName: "clip.mp4", bogus: 1 });
    expect(result.success).toBe(false);
  });
});
