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
  chargeImpl: (async () => ({ id: "pi_1", status: "succeeded" })) as () => Promise<{
    id: string;
    status: string;
  }>,
  deposited: [] as string[],
  failed: [] as string[],
  notices: [] as unknown[],
  reported: [] as string[],
}));

vi.mock("@/lib/stripe", () => ({
  chargeAutoRechargeOffSession: vi.fn(async () => state.chargeImpl()),
}));
vi.mock("@/lib/autorecharge", () => ({
  selectAutoRechargeCandidates: vi.fn(async () => state.candidates),
  checkNeedsAutoRecharge: vi.fn(async () => true),
  countRecentAutoRecharges: vi.fn(async () => state.successesToday),
  autoRechargeIdempotencyKey: vi.fn(() => "idem-key"),
  depositAutoRecharge: vi.fn(async (userId: string) => {
    state.deposited.push(userId);
    return true;
  }),
  recordAutoRechargeFailure: vi.fn(async (userId: string) => {
    state.failed.push(userId);
    return { failures: 1, disabled: false };
  }),
  AUTORECHARGE_MAX_PER_DAY: 3,
}));
vi.mock("@/lib/notifications", () => ({
  notifyAutoRecharge: vi.fn(async (_id: string, notice: unknown) => {
    state.notices.push(notice);
  }),
}));
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
  state.chargeImpl = async () => ({ id: "pi_1", status: "succeeded" });
  state.deposited = [];
  state.failed = [];
  state.notices = [];
  state.reported = [];
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
    expect(await res.json()).toEqual({ swept: 0, charged: 0, declined: 0, capped: 0, errored: 0 });
  });

  it("charges an eligible user and credits on success (AC-6)", async () => {
    state.candidates = [candidate()];
    const body = await (await GET(req())).json();
    expect(chargeAutoRechargeOffSession).toHaveBeenCalledTimes(1);
    expect(state.deposited).toEqual(["u1"]);
    expect(state.notices).toContainEqual({ kind: "recharged", amountMicros: 19_000_000 });
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
