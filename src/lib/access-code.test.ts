import { describe, it, expect, afterEach } from "vitest";
import { hasValidAccessCode } from "./access-code";

const ORIGINAL_ACCESS_CODE = process.env.ACCESS_CODE;

afterEach(() => {
  if (ORIGINAL_ACCESS_CODE === undefined) delete process.env.ACCESS_CODE;
  else process.env.ACCESS_CODE = ORIGINAL_ACCESS_CODE;
});

describe("hasValidAccessCode", () => {
  it("true on a matching code, tolerating surrounding whitespace", () => {
    process.env.ACCESS_CODE = "SKOOL2026";
    expect(hasValidAccessCode({ accessCode: "  SKOOL2026  " })).toBe(true);
  });

  it("false on a mismatched code of the same length", () => {
    process.env.ACCESS_CODE = "SKOOL2026";
    expect(hasValidAccessCode({ accessCode: "SKOOL2025" })).toBe(false);
  });

  it("false on a mismatched code of a different length (no timing-safe crash)", () => {
    process.env.ACCESS_CODE = "SKOOL2026";
    expect(hasValidAccessCode({ accessCode: "way-too-long-to-match" })).toBe(false);
  });

  it("false when accessCode is missing or not a string", () => {
    process.env.ACCESS_CODE = "SKOOL2026";
    expect(hasValidAccessCode(undefined)).toBe(false);
    expect(hasValidAccessCode({})).toBe(false);
    expect(hasValidAccessCode({ accessCode: 123 })).toBe(false);
  });

  it("false when ACCESS_CODE isn't configured", () => {
    delete process.env.ACCESS_CODE;
    expect(hasValidAccessCode({ accessCode: "anything" })).toBe(false);
  });
});
