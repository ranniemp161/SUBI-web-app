import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  executeError: null as unknown,
  executed: [] as unknown[],
  reported: [] as string[],
}));

vi.mock("@repo/db", () => ({
  db: {
    execute: vi.fn(async (query: unknown) => {
      state.executed.push(query);
      if (state.executeError) throw state.executeError;
      return { rows: state.rows };
    }),
  },
}));

vi.mock("@repo/server-shared/observability", () => ({
  reportError: vi.fn((message: string) => {
    state.reported.push(message);
  }),
}));

import {
  reserveCredits,
  reclaimStaleHold,
  settleHold,
  depositPurchase,
  ensureMonthlyGrant,
  chargeAiCut,
  refundAiCut,
} from "./ledger";
import { db } from "@repo/db";

beforeEach(() => {
  state.rows = [];
  state.executeError = null;
  state.executed = [];
  state.reported = [];
  vi.clearAllMocks();
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
    // held (120s) exceeds the 100s actually billed -> a refund, no shortfall.
    // held/delta are USD micros: chargeMicrosForSeconds(120) = 166_666.
    state.rows = [{ held: 166_666, delta: 27_778 }];
    await settleHold("p1", 100);
    expect(state.reported).toEqual([]);
  });

  it("is quiet when the shortfall was fully collected", async () => {
    // actual (100s) exceeds the 60s hold and the whole shortfall was charged.
    // held = chargeMicrosForSeconds(60) = 83_333; delta = -(138_888 - 83_333).
    state.rows = [{ held: 83_333, delta: -55_555 }];
    await settleHold("p1", 100);
    expect(state.reported).toEqual([]);
  });

  it("reports a clamped shortfall to Sentry", async () => {
    // Actual ran 110s over a 10s hold but only part could be collected.
    // held = chargeMicrosForSeconds(10) = 13_889; only a small part was charged.
    state.rows = [{ held: 13_889, delta: -30_000 }];
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
    state.rows = [{ balance_micros: 3900 }];
    await expect(depositPurchase("u1", 300, "cs_123")).resolves.toBe(true);
  });

  it("returns false on a duplicate session id", async () => {
    state.rows = [];
    await expect(depositPurchase("u1", 300, "cs_123")).resolves.toBe(false);
  });
});

describe("chargeAiCut", () => {
  it("returns charged when the deduction matched a user row", async () => {
    state.rows = [{ balance_micros: 3480 }];
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

  it("treats a keyed retry that lost the ON CONFLICT race as already charged", async () => {
    state.rows = [];
    await expect(chargeAiCut("u1", "p1", 120, "idem-1")).resolves.toEqual({
      status: "charged",
    });
  });

  it("throws when an unkeyed charge matches no user row", async () => {
    state.rows = [];
    await expect(chargeAiCut("u1", "p1", 120)).rejects.toThrow(
      "ai_cut charge matched no user row"
    );
  });
});

describe("refundAiCut", () => {
  it("issues the refund statement", async () => {
    state.rows = [{ balance_micros: 3600 }];
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
