import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  executeError: null as unknown,
  executed: [] as unknown[],
  reported: [] as string[],
}));

vi.mock("@/db", () => ({
  db: {
    execute: vi.fn(async (query: unknown) => {
      state.executed.push(query);
      if (state.executeError) throw state.executeError;
      return { rows: state.rows };
    }),
  },
}));

vi.mock("@/lib/observability", () => ({
  reportError: vi.fn((message: string) => {
    state.reported.push(message);
  }),
}));

import {
  FALLBACK_HOLD_SECONDS,
  costSecondsForDurationMs,
  secondsFromDeepgramDuration,
  currentMonthKey,
  memberGrantSeconds,
  reserveCredits,
  reclaimStaleHold,
  settleHold,
  depositPurchase,
  ensureMonthlyGrant,
  chargeAiCut,
  refundAiCut,
} from "@/lib/credits";
import { db } from "@/db";

beforeEach(() => {
  state.rows = [];
  state.executeError = null;
  state.executed = [];
  state.reported = [];
  vi.clearAllMocks();
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

describe("reserveCredits", () => {
  it("returns reserved with the new balance", async () => {
    state.rows = [{ held: 1, balance: 3480 }];
    await expect(reserveCredits("u1", "p1", 120)).resolves.toEqual({
      status: "reserved",
      balance: 3480,
    });
  });

  it("returns already_held when the hold row was not claimed", async () => {
    state.rows = [{ held: 0, balance: null }];
    await expect(reserveCredits("u1", "p1", 120)).resolves.toEqual({
      status: "already_held",
    });
  });

  it("maps a CHECK violation to insufficient", async () => {
    state.executeError = Object.assign(new Error("violates check constraint"), {
      code: "23514",
    });
    await expect(reserveCredits("u1", "p1", 120)).resolves.toEqual({
      status: "insufficient",
    });
  });

  it("finds the CHECK violation nested in a cause chain", async () => {
    state.executeError = new Error("query failed", {
      cause: Object.assign(new Error("inner"), { code: "23514" }),
    });
    await expect(reserveCredits("u1", "p1", 120)).resolves.toEqual({
      status: "insufficient",
    });
  });

  it("rethrows non-CHECK errors", async () => {
    state.executeError = Object.assign(new Error("connection lost"), {
      code: "57P01",
    });
    await expect(reserveCredits("u1", "p1", 120)).rejects.toThrow(
      "connection lost"
    );
  });
});

describe("reclaimStaleHold", () => {
  it("returns true and warns when a stale hold was reclaimed", async () => {
    state.rows = [{ reclaimed: 1 }];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(reclaimStaleHold("p1", 10_000)).resolves.toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("returns false without warning when nothing qualified (live or 'processing')", async () => {
    state.rows = [{ reclaimed: 0 }];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(reclaimStaleHold("p1", 10_000)).resolves.toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns false when the query yields no row", async () => {
    state.rows = [];
    await expect(reclaimStaleHold("p1", 10_000)).resolves.toBe(false);
  });
});

describe("settleHold", () => {
  it("is quiet when the hold was already settled", async () => {
    state.rows = [{ held: null, delta: null }];
    await settleHold("p1", 100);
    expect(state.reported).toEqual([]);
  });

  it("is quiet on a normal refund", async () => {
    state.rows = [{ held: 120, delta: 20 }];
    await settleHold("p1", 100);
    expect(state.reported).toEqual([]);
  });

  it("is quiet when the shortfall was fully collected", async () => {
    state.rows = [{ held: 60, delta: -40 }];
    await settleHold("p1", 100);
    expect(state.reported).toEqual([]);
  });

  it("reports a clamped shortfall to Sentry", async () => {
    // Actual ran 100s over a 10s hold but only 30s could be collected.
    state.rows = [{ held: 10, delta: -30 }];
    await settleHold("p1", 110);
    expect(state.reported).toEqual([
      "Credit reconciliation shortfall clamped at zero balance",
    ]);
  });

  it("never reports when keeping the hold as the final charge", async () => {
    state.rows = [{ held: 60, delta: 0 }];
    await settleHold("p1", null);
    expect(state.reported).toEqual([]);
  });
});

describe("depositPurchase", () => {
  it("returns true when the deposit landed", async () => {
    state.rows = [{ credit_seconds: 3900 }];
    await expect(depositPurchase("u1", 300, "cs_123")).resolves.toBe(true);
  });

  it("returns false on a duplicate session id", async () => {
    state.rows = [];
    await expect(depositPurchase("u1", 300, "cs_123")).resolves.toBe(false);
  });
});

describe("chargeAiCut", () => {
  it("returns charged when the deduction matched a user row", async () => {
    state.rows = [{ credit_seconds: 3480 }];
    await expect(chargeAiCut("u1", "p1", 120)).resolves.toEqual({
      status: "charged",
    });
  });

  it("maps a CHECK violation to insufficient", async () => {
    state.executeError = Object.assign(new Error("violates check constraint"), {
      code: "23514",
    });
    await expect(chargeAiCut("u1", "p1", 120)).resolves.toEqual({
      status: "insufficient",
    });
  });

  it("rethrows non-CHECK errors", async () => {
    state.executeError = Object.assign(new Error("connection lost"), {
      code: "57P01",
    });
    await expect(chargeAiCut("u1", "p1", 120)).rejects.toThrow("connection lost");
  });
});

describe("refundAiCut", () => {
  it("issues the refund statement", async () => {
    state.rows = [{ credit_seconds: 3600 }];
    await refundAiCut("u1", "p1", 120);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});

describe("ensureMonthlyGrant", () => {
  it("skips the query entirely for a non-positive grant", async () => {
    await ensureMonthlyGrant("u1", 0);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("runs the grant statement for members", async () => {
    await ensureMonthlyGrant("u1", 3600);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
