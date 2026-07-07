import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rateLimit } from "./rate-limit";
import { Ratelimit } from "@upstash/ratelimit";

// We mock Ratelimit class from @upstash/ratelimit
const state = vi.hoisted(() => ({
  success: true,
  remaining: 99,
  error: null as Error | null,
}));

vi.mock("@upstash/ratelimit", () => {
  const Ratelimit = vi.fn(function() {
    return {
      limit: vi.fn(async () => {
        if (state.error) throw state.error;
        return {
          success: state.success,
          remaining: state.remaining,
        };
      }),
    };
  });
  (Ratelimit as any).fixedWindow = vi.fn(() => "fixed-window-limiter");
  return { Ratelimit };
});

vi.mock("@upstash/redis", () => {
  const Redis = vi.fn(function() { return {}; });
  return { Redis };
});

describe("rateLimit", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.KV_REST_API_URL = "https://mock.kv";
    process.env.KV_REST_API_TOKEN = "mock_token";
    state.success = true;
    state.remaining = 99;
    state.error = null;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns allowed: true and remaining when request is within limit", async () => {
    const result = await rateLimit("test_key", 100, 60);
    
    expect(result).toEqual({
      allowed: true,
      remaining: 99,
      limit: 100,
    });
    expect(Ratelimit).toHaveBeenCalled();
  });

  it("returns allowed: false when request exceeds limit", async () => {
    state.success = false;
    state.remaining = 0;
    
    const result = await rateLimit("test_key", 100, 60);
    
    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      limit: 100,
    });
  });

  it("allows the request bypassing limits when KV_REST_API_URL is missing", async () => {
    delete process.env.KV_REST_API_URL;
    
    const result = await rateLimit("bypass_key", 100, 60);
    
    expect(result).toEqual({
      allowed: true,
      remaining: 100,
      limit: 100,
    });
  });

  it("allows the request bypassing limits when KV_REST_API_TOKEN is missing", async () => {
    delete process.env.KV_REST_API_TOKEN;
    
    const result = await rateLimit("bypass_key", 100, 60);
    
    expect(result).toEqual({
      allowed: true,
      remaining: 100,
      limit: 100,
    });
  });

  it("throws an error in production if KV_REST_API_URL or KV_REST_API_TOKEN is missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.KV_REST_API_URL;
    
    await expect(rateLimit("prod_key", 100, 60)).rejects.toThrow(
      "KV_REST_API_URL and KV_REST_API_TOKEN must be set in production."
    );
  });

  it("fails open and allows the request if Redis throws an error", async () => {
    state.error = new Error("Redis connection failed");
    
    const result = await rateLimit("error_key", 100, 60);
    
    expect(result).toEqual({
      allowed: true,
      remaining: 100,
      limit: 100,
    });
  });
});
