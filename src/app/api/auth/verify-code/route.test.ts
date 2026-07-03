import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({ rateAllowed: true }));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 9 : 0,
    limit: 10,
  })),
}));

import { POST } from "./route";
import { rateLimit } from "@/lib/rate-limit";

const ORIGINAL_ACCESS_CODE = process.env.ACCESS_CODE;

function req(body: unknown, ip = "203.0.113.5") {
  return new Request("http://localhost/api/auth/verify-code", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.rateAllowed = true;
  vi.clearAllMocks();
  process.env.ACCESS_CODE = "SKOOL2026";
});

afterEach(() => {
  if (ORIGINAL_ACCESS_CODE === undefined) delete process.env.ACCESS_CODE;
  else process.env.ACCESS_CODE = ORIGINAL_ACCESS_CODE;
});

describe("POST /api/auth/verify-code", () => {
  it("400 when accessCode is missing (never touches the rate limiter)", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("429 once the per-IP limit is exceeded, before the code is ever compared", async () => {
    state.rateAllowed = false;
    const res = await POST(req({ accessCode: "SKOOL2026" }, "198.51.100.42"));
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("verify-code:198.51.100.42", 10, 300);
    expect(body.valid).toBe(false);
  });

  it("500 when ACCESS_CODE isn't configured", async () => {
    delete process.env.ACCESS_CODE;
    const res = await POST(req({ accessCode: "anything" }));
    expect(res.status).toBe(500);
  });

  it("200 valid:true on a matching code, tolerating surrounding whitespace", async () => {
    const res = await POST(req({ accessCode: "  SKOOL2026  " }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.valid).toBe(true);
  });

  it("401 valid:false on a mismatched code of the same length", async () => {
    const res = await POST(req({ accessCode: "SKOOL2025" }));
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.valid).toBe(false);
  });

  it("401 valid:false on a mismatched code of a different length (no timing-safe crash)", async () => {
    const res = await POST(req({ accessCode: "way-too-long-to-match" }));
    expect(res.status).toBe(401);
  });
});
