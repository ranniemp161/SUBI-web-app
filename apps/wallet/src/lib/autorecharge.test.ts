import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the shared DB: db.execute for the CTE/idempotent statements, and a
// recording db.update().set().where() chain for the simple setters.
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@repo/db", () => ({
  db: {
    execute: vi.fn(async () => ({ rows: state.rows })),
    update: vi.fn(() => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(v);
        },
      }),
    })),
  },
}));

// The schema import is only used to build drizzle expressions the mocked db
// ignores, so plain placeholders are enough.
vi.mock("@repo/db/schema", () => ({
  users: {
    id: "users.id",
    stripeCustomerId: "users.stripe_customer_id",
    defaultPaymentMethodId: "users.default_payment_method_id",
    autorechargeEnabled: "users.autorecharge_enabled",
    autorechargeThresholdMicros: "users.autorecharge_threshold_micros",
    autorechargeAmountMicros: "users.autorecharge_amount_micros",
    autorechargeFailures: "users.autorecharge_failures",
  },
}));

import {
  autoRechargeIdempotencyKey,
  depositAutoRecharge,
  recordAutoRechargeFailure,
  countRecentAutoRecharges,
  selectAutoRechargeCandidates,
  updateAutorechargeSettings,
  AUTORECHARGE_MAX_PER_DAY,
  AUTORECHARGE_MAX_FAILURES,
} from "./autorecharge";

beforeEach(() => {
  state.rows = [];
  state.updates = [];
  vi.clearAllMocks();
});

describe("autoRechargeIdempotencyKey", () => {
  // covers: AC-7 — the key advances only on a real state change, so sweep
  // re-runs dedup while a success or a decline frees a fresh key.
  it("is stable for the same user + success + failure counts", () => {
    expect(autoRechargeIdempotencyKey("u1", 0, 0)).toBe(
      autoRechargeIdempotencyKey("u1", 0, 0)
    );
  });

  it("changes when the success count advances (a recharge landed)", () => {
    expect(autoRechargeIdempotencyKey("u1", 0, 0)).not.toBe(
      autoRechargeIdempotencyKey("u1", 1, 0)
    );
  });

  it("changes when the failure count advances (a decline)", () => {
    expect(autoRechargeIdempotencyKey("u1", 0, 0)).not.toBe(
      autoRechargeIdempotencyKey("u1", 0, 1)
    );
  });

  it("is distinct per user", () => {
    expect(autoRechargeIdempotencyKey("u1", 0, 0)).not.toBe(
      autoRechargeIdempotencyKey("u2", 0, 0)
    );
  });
});

describe("constants", () => {
  it("default daily cap and failure cap are sane positives", () => {
    expect(AUTORECHARGE_MAX_PER_DAY).toBeGreaterThan(0);
    expect(AUTORECHARGE_MAX_FAILURES).toBeGreaterThan(0);
  });
});

describe("depositAutoRecharge", () => {
  // covers: AC-6/AC-7 — idempotent deposit keyed on the PaymentIntent id.
  it("returns true when a ledger row was inserted (fresh delivery)", async () => {
    state.rows = [{ balance_micros: 20_000_000 }];
    expect(await depositAutoRecharge("u1", 19_000_000, "pi_1")).toBe(true);
  });

  it("returns false on a duplicate delivery (no rows -> no double credit)", async () => {
    state.rows = [];
    expect(await depositAutoRecharge("u1", 19_000_000, "pi_1")).toBe(false);
  });
});

describe("recordAutoRechargeFailure", () => {
  // covers: AC-7 — declines climb the counter and disable at the cap.
  it("reports not-disabled below the cap", async () => {
    state.rows = [{ failures: 1 }];
    expect(await recordAutoRechargeFailure("u1", 3)).toEqual({
      failures: 1,
      disabled: false,
    });
  });

  it("reports disabled at the cap", async () => {
    state.rows = [{ failures: 3 }];
    expect(await recordAutoRechargeFailure("u1", 3)).toEqual({
      failures: 3,
      disabled: true,
    });
  });
});

describe("countRecentAutoRecharges", () => {
  it("returns the count from the query", async () => {
    state.rows = [{ n: 2 }];
    expect(await countRecentAutoRecharges("u1")).toBe(2);
  });

  it("returns 0 when there is no row", async () => {
    state.rows = [];
    expect(await countRecentAutoRecharges("u1")).toBe(0);
  });
});

describe("selectAutoRechargeCandidates", () => {
  // covers: AC-6 — the sweep's eligible set, typed for the charge loop.
  it("maps rows to typed candidates", async () => {
    state.rows = [
      {
        id: "u1",
        stripeCustomerId: "cus_1",
        defaultPaymentMethodId: "pm_1",
        amountMicros: 19_000_000,
        failures: 0,
      },
    ];
    const out = await selectAutoRechargeCandidates();
    expect(out).toEqual([
      {
        id: "u1",
        stripeCustomerId: "cus_1",
        defaultPaymentMethodId: "pm_1",
        amountMicros: 19_000_000,
        failures: 0,
      },
    ]);
  });
});

describe("updateAutorechargeSettings", () => {
  // covers: AC-5 — persisting the settings the validated route accepted.
  it("writes enabled + threshold + amount and clears failures when enabling", async () => {
    await updateAutorechargeSettings("u1", {
      enabled: true,
      thresholdMicros: 5_000_000,
      amountMicros: 19_000_000,
    });
    expect(state.updates).toHaveLength(1);
    const s = state.updates[0];
    expect(s.autorechargeEnabled).toBe(true);
    expect(s.autorechargeThresholdMicros).toBe(5_000_000);
    expect(s.autorechargeAmountMicros).toBe(19_000_000);
    // failures reset to a literal 0 when enabling (not a passthrough SQL).
    expect(s.autorechargeFailures).toBe(0);
  });
});
