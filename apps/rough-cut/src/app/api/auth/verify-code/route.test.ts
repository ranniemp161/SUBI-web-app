import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  rateAllowed: true,
  availableCodes: [] as string[],
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 9 : 0,
    limit: 10,
  })),
}));

vi.mock("@/lib/access-codes", () => ({
  isCodeAvailable: vi.fn(async (code: string) =>
    state.availableCodes.includes(code)
  ),
}));

import { POST } from "./route";
import { rateLimit } from "@/lib/rate-limit";
import { isCodeAvailable } from "@/lib/access-codes";

function req(body: unknown, ip = "203.0.113.5") {
  return new Request("http://localhost/api/auth/verify-code", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.rateAllowed = true;
  state.availableCodes = ["SKOOL-AAAA-BBBB"];
  vi.clearAllMocks();
});

describe("POST /api/auth/verify-code", () => {
  it("400 when accessCode is missing (never touches the rate limiter)", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("400 when accessCode is not a string", async () => {
    const res = await POST(req({ accessCode: 42 }));
    expect(res.status).toBe(400);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("429 once the per-IP limit is exceeded, before the code is ever looked up", async () => {
    state.rateAllowed = false;
    const res = await POST(req({ accessCode: "SKOOL-AAAA-BBBB" }, "198.51.100.42"));
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("verify-code:198.51.100.42", 10, 300);
    expect(isCodeAvailable).not.toHaveBeenCalled();
    expect(body.valid).toBe(false);
  });

  it("200 valid:true on an available code, tolerating surrounding whitespace", async () => {
    const res = await POST(req({ accessCode: "  SKOOL-AAAA-BBBB  " }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(isCodeAvailable).toHaveBeenCalledWith("SKOOL-AAAA-BBBB");
  });

  it("401 valid:false on an unknown, redeemed, or revoked code", async () => {
    const res = await POST(req({ accessCode: "SKOOL-XXXX-YYYY" }));
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.valid).toBe(false);
  });
});
