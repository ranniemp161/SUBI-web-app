import { describe, it, expect } from "vitest";
import { createProjectSchema } from "./validation";

describe("createProjectSchema — aiPolish (ADR 0003 child 1, AC-1)", () => {
  it("accepts an explicit aiPolish choice and preserves it", () => {
    const on = createProjectSchema.parse({ fileName: "clip.mp4", aiPolish: true });
    expect(on.aiPolish).toBe(true);
    const off = createProjectSchema.parse({ fileName: "clip.mp4", aiPolish: false });
    expect(off.aiPolish).toBe(false);
  });

  it("defaults aiPolish to false when omitted (older clients stay inert)", () => {
    const parsed = createProjectSchema.parse({ fileName: "clip.mp4" });
    expect(parsed.aiPolish).toBe(false);
  });

  it("rejects a non-boolean aiPolish", () => {
    const result = createProjectSchema.safeParse({ fileName: "clip.mp4", aiPolish: "yes" });
    expect(result.success).toBe(false);
  });

  it("still rejects unexpected top-level keys (strictObject)", () => {
    const result = createProjectSchema.safeParse({ fileName: "clip.mp4", bogus: 1 });
    expect(result.success).toBe(false);
  });
});
