import { describe, it, expect, vi, beforeEach } from "vitest";

type Candidate = {
  id: string;
  stripeCustomerId: string;
  defaultPaymentMethodId: string;
  amountMicros: number;
  failures: number;
};

const state = vi.hoisted(() => ({
  candidates: [] as Candidate[],
  successesToday: 0,
  needsRecharge: true,
  chargeImpl: (async () => ({ id: "pi_1", status: "succeeded" })) as (
    userId: string
  ) => Promise<{ id: string; status: string }>,
  recordFailureImpl: (async (userId: string) => {
    state.failed.push(userId);
    return { failures: 1, disabled: false };
  }) as (userId: string) => Promise<{ failures: number; disabled: boolean }>,
  deposited: [] as string[],
  failed: [] as string[],
  reported: [] as string[],
  chargeCalls: [] as string[],
  /** Charges in flight right now, and the high-water mark across the run. */
  inFlight: 0,
  maxInFlight: 0,
}));

vi.mock("@/lib/stripe", () => ({
  chargeAutoRechargeOffSession: vi.fn(
    async (params: { idempotencyKey: string; userId: string }) => {
      state.chargeCalls.push(params.idempotencyKey);
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        return await state.chargeImpl(params.userId);
      } finally {
        state.inFlight--;
      }
    }
  ),
}));
// autoRechargeIdempotencyKey is left UNMOCKED (the real implementation, via
// importOriginal) — it's the single most important double-charge guard, and
// a test that stubs it to a constant can't catch a regression that breaks
// its derivation. Everything else here still needs a DB-free mock.
vi.mock("@/lib/autorecharge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/autorecharge")>();
  return {
    selectAutoRechargeCandidates: vi.fn(async () => state.candidates),
    checkNeedsAutoRecharge: vi.fn(async () => state.needsRecharge),
    countRecentAutoRecharges: vi.fn(async () => state.successesToday),
    autoRechargeIdempotencyKey: actual.autoRechargeIdempotencyKey,
    depositAutoRecharge: vi.fn(async (userId: string) => {
      state.deposited.push(userId);
      return true;
    }),
    recordAutoRechargeFailure: vi.fn(async (userId: string) =>
      state.recordFailureImpl(userId)
    ),
    AUTORECHARGE_MAX_PER_DAY: actual.AUTORECHARGE_MAX_PER_DAY,
  };
});
vi.mock("@/lib/observability", () => ({
  reportError: vi.fn((msg: string) => state.reported.push(msg)),
}));

import { GET } from "./route";
import { chargeAutoRechargeOffSession } from "@/lib/stripe";

const SECRET = "s3cr3t";
function req(auth: string | null = `Bearer ${SECRET}`) {
  return new Request("http://localhost/api/cron/autorecharge", {
    headers: auth ? { Authorization: auth } : {},
  });
}
const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  id: "u1",
  stripeCustomerId: "cus_1",
  defaultPaymentMethodId: "pm_1",
  amountMicros: 19_000_000,
  failures: 0,
  ...over,
});

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  state.candidates = [];
  state.successesToday = 0;
  state.needsRecharge = true;
  state.chargeImpl = async () => ({ id: "pi_1", status: "succeeded" });
  state.recordFailureImpl = async (userId: string) => {
    state.failed.push(userId);
    return { failures: 1, disabled: false };
  };
  state.deposited = [];
  state.failed = [];
  state.reported = [];
  state.chargeCalls = [];
  state.inFlight = 0;
  state.maxInFlight = 0;
  vi.clearAllMocks();
});

describe("GET /api/cron/autorecharge", () => {
  it("401 without the CRON_SECRET bearer", async () => {
    expect((await GET(req(null))).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
  });

  it("sweeps nothing when there are no eligible users", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      swept: 0,
      processed: 0,
      remaining: 0,
      charged: 0,
      declined: 0,
      capped: 0,
      skipped: 0,
      errored: 0,
    });
  });

  it("counts a user who topped up between selection and charge as skipped", async () => {
    state.candidates = [candidate()];
    state.needsRecharge = false;
    const body = await (await GET(req())).json();
    expect(chargeAutoRechargeOffSession).not.toHaveBeenCalled();
    expect(body.skipped).toBe(1);
    expect(body.charged).toBe(0);
  });

  it("charges an eligible user and credits on success (AC-6)", async () => {
    state.candidates = [candidate()];
    const body = await (await GET(req())).json();
    expect(chargeAutoRechargeOffSession).toHaveBeenCalledTimes(1);
    expect(state.deposited).toEqual(["u1"]);
    expect(body.charged).toBe(1);
  });

  it("skips a user already at the daily cap without charging (AC-7)", async () => {
    state.candidates = [candidate()];
    state.successesToday = 3; // == AUTORECHARGE_MAX_PER_DAY
    const body = await (await GET(req())).json();
    expect(chargeAutoRechargeOffSession).not.toHaveBeenCalled();
    expect(body.capped).toBe(1);
    expect(body.charged).toBe(0);
  });

  it("counts a card decline as a failure, not a charge (AC-7)", async () => {
    state.candidates = [candidate()];
    state.chargeImpl = async () => {
      throw Object.assign(new Error("declined"), { code: "card_declined" });
    };
    const body = await (await GET(req())).json();
    expect(state.deposited).toEqual([]);
    expect(state.failed).toEqual(["u1"]);
    expect(body.declined).toBe(1);
  });

  it("treats a non-succeeded status (e.g. requires_action) as a decline", async () => {
    state.candidates = [candidate()];
    state.chargeImpl = async () => ({ id: "pi_1", status: "requires_action" });
    const body = await (await GET(req())).json();
    expect(state.deposited).toEqual([]);
    expect(state.failed).toEqual(["u1"]);
    expect(body.declined).toBe(1);
  });

  it("does not count a network/config error against the user's card", async () => {
    state.candidates = [candidate()];
    state.chargeImpl = async () => {
      throw new Error("network down");
    };
    const body = await (await GET(req())).json();
    expect(state.failed).toEqual([]); // not counted as a decline
    expect(state.reported.length).toBeGreaterThan(0);
    expect(body.errored).toBe(1);
  });
});

// The sweep used to slice candidates into batches of ten and then await each
// member of the slice in sequence, so the slicing bought no parallelism at all
// (flagged in docs/hardening/2026-07-08-main.md). These pin the real thing:
// charges overlap, the cap is respected, and one bad candidate can't take its
// batch down with it.
describe("GET /api/cron/autorecharge — batch concurrency", () => {
  /** Forces overlap to be observable: without a real wait, calls can serialize. */
  const slowCharge = (userId: string) =>
    new Promise<{ id: string; status: string }>((resolve) =>
      setTimeout(() => resolve({ id: `pi_${userId}`, status: "succeeded" }), 10)
    );

  it("charges a batch concurrently rather than one user at a time", async () => {
    state.candidates = Array.from({ length: 10 }, (_, i) =>
      candidate({ id: `u${i}` })
    );
    state.chargeImpl = slowCharge;

    const body = await (await GET(req())).json();

    // Sequential would peak at 1. Ten in flight at once is the whole point.
    expect(state.maxInFlight).toBe(10);
    expect(body.charged).toBe(10);
  });

  it("never runs more than the concurrency cap at once", async () => {
    state.candidates = Array.from({ length: 25 }, (_, i) =>
      candidate({ id: `u${i}` })
    );
    state.chargeImpl = slowCharge;

    const body = await (await GET(req())).json();

    expect(state.maxInFlight).toBeLessThanOrEqual(10);
    expect(state.chargeCalls).toHaveLength(25);
    expect(body.charged).toBe(25);
    expect(body.processed).toBe(25);
    expect(body.remaining).toBe(0);
  });

  it("keeps sweeping the rest of a batch when one candidate throws", async () => {
    state.candidates = [
      candidate({ id: "u1" }),
      candidate({ id: "u2" }),
      candidate({ id: "u3" }),
    ];
    state.chargeImpl = async (userId: string) => {
      if (userId === "u2") throw new Error("network down");
      return { id: `pi_${userId}`, status: "succeeded" };
    };

    const body = await (await GET(req())).json();

    expect(body.charged).toBe(2);
    expect(body.errored).toBe(1);
    expect([...state.deposited].sort()).toEqual(["u1", "u3"]);
  });

  it("does not fail the sweep when recording a decline throws", async () => {
    state.candidates = [candidate({ id: "u1" })];
    state.chargeImpl = async () => {
      throw Object.assign(new Error("declined"), { code: "card_declined" });
    };
    state.recordFailureImpl = async () => {
      throw new Error("db down");
    };

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.declined).toBe(1);
    expect(state.reported).toContain(
      "Auto-recharge sweep: failed to record a decline"
    );
  });

  it("stops starting batches at the time budget and reports the remainder", async () => {
    state.candidates = Array.from({ length: 25 }, (_, i) =>
      candidate({ id: `u${i}` })
    );
    // startedAt, then the i=0 check (inside budget), then the i=10 check (over).
    const times = [0, 1, 300_001];
    let call = 0;
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockImplementation(() => times[Math.min(call++, times.length - 1)]);

    const body = await (await GET(req())).json();
    nowSpy.mockRestore();

    expect(body.swept).toBe(25);
    expect(body.processed).toBe(10);
    expect(body.remaining).toBe(15);
    // A remainder must page someone: on Hobby the next run is ~24h away.
    expect(state.reported).toContain(
      "Auto-recharge sweep hit its time budget with candidates left"
    );
  });
});

// autoRechargeIdempotencyKey runs unmocked in these — see the vi.mock note
// above. A regression that flattened its derivation to a constant (or
// dropped a factor) would pass every other test in this file but fail here.
describe("GET /api/cron/autorecharge — idempotency key derivation (real, unmocked)", () => {
  it("derives a key from the user, successesToday, and failures — not a constant", async () => {
    state.candidates = [candidate({ id: "u1", failures: 2 })];
    state.successesToday = 1;
    await GET(req());
    expect(state.chargeCalls).toEqual(["autorecharge:v1:u1:s1:f2"]);
  });

  it("reuses the same key on a same-state re-run of the sweep (Stripe-side dedup)", async () => {
    state.candidates = [candidate({ id: "u1", failures: 0 })];
    state.successesToday = 0;
    await GET(req());
    await GET(req());
    expect(state.chargeCalls).toEqual([
      "autorecharge:v1:u1:s0:f0",
      "autorecharge:v1:u1:s0:f0",
    ]);
  });

  it("advances the key once a success changes successesToday, freeing the next attempt", async () => {
    state.candidates = [candidate({ id: "u1", failures: 0 })];
    state.successesToday = 0;
    await GET(req()); // this run's charge succeeds
    state.successesToday = 1; // reflects the deposit the sweep above just made
    await GET(req());
    expect(state.chargeCalls).toEqual([
      "autorecharge:v1:u1:s0:f0",
      "autorecharge:v1:u1:s1:f0",
    ]);
  });
});
