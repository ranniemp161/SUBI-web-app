import { describe, it, expect, beforeEach } from "vitest";

import {
  FALLBACK_HOLD_SECONDS,
  costSecondsForDurationMs,
  secondsFromDeepgramDuration,
  currentMonthKey,
  memberGrantSeconds,
} from "./pricing";

beforeEach(() => {
  delete process.env.MEMBER_MONTHLY_GRANT_SECONDS;
});

describe("costSecondsForDurationMs", () => {
  it("falls back when duration is missing or nonsense", () => {
    expect(costSecondsForDurationMs(null)).toBe(FALLBACK_HOLD_SECONDS);
    expect(costSecondsForDurationMs(undefined)).toBe(FALLBACK_HOLD_SECONDS);
    expect(costSecondsForDurationMs(0)).toBe(FALLBACK_HOLD_SECONDS);
    expect(costSecondsForDurationMs(-5)).toBe(FALLBACK_HOLD_SECONDS);
    expect(costSecondsForDurationMs(NaN)).toBe(FALLBACK_HOLD_SECONDS);
  });

  it("rounds milliseconds up to whole seconds with a floor of 1", () => {
    expect(costSecondsForDurationMs(1)).toBe(1);
    expect(costSecondsForDurationMs(999)).toBe(1);
    expect(costSecondsForDurationMs(1001)).toBe(2);
    expect(costSecondsForDurationMs(60_000)).toBe(60);
  });
});

describe("secondsFromDeepgramDuration", () => {
  it("returns null when the payload has no usable duration", () => {
    expect(secondsFromDeepgramDuration(null)).toBeNull();
    expect(secondsFromDeepgramDuration(undefined)).toBeNull();
    expect(secondsFromDeepgramDuration(0)).toBeNull();
    expect(secondsFromDeepgramDuration(-1)).toBeNull();
  });

  it("rounds seconds up with a floor of 1", () => {
    expect(secondsFromDeepgramDuration(0.4)).toBe(1);
    expect(secondsFromDeepgramDuration(59.01)).toBe(60);
    expect(secondsFromDeepgramDuration(60)).toBe(60);
  });
});

describe("currentMonthKey", () => {
  it("uses the UTC calendar month", () => {
    expect(currentMonthKey(new Date("2026-07-05T23:59:59Z"))).toBe("2026-07");
    expect(currentMonthKey(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });
});

describe("memberGrantSeconds", () => {
  it("defaults to 3600 and reads the env override", () => {
    expect(memberGrantSeconds()).toBe(3600);
    process.env.MEMBER_MONTHLY_GRANT_SECONDS = "7200";
    expect(memberGrantSeconds()).toBe(7200);
    process.env.MEMBER_MONTHLY_GRANT_SECONDS = "banana";
    expect(memberGrantSeconds()).toBe(3600);
  });
});
