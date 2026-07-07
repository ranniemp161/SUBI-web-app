import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import { reportError } from "@/lib/observability";

vi.mock("@/lib/observability", () => ({
  reportError: vi.fn(),
}));

function req(authHeader?: string) {
  const headers = new Headers();
  if (authHeader !== undefined) {
    headers.set("Authorization", authHeader);
  }
  return new Request("http://localhost/api/cron/cleanup", {
    method: "GET",
    headers,
  });
}

describe("GET /api/cron/cleanup", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 200 success when authorized with correct CRON_SECRET", async () => {
    process.env.CRON_SECRET = "secret_123";
    const response = await GET(req("Bearer secret_123"));
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ success: true, message: "No cleanup required" });
  });

  it("returns 401 unauthorized when Authorization header is missing", async () => {
    process.env.CRON_SECRET = "secret_123";
    const response = await GET(req());
    
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 unauthorized when Authorization header is incorrect", async () => {
    process.env.CRON_SECRET = "secret_123";
    const response = await GET(req("Bearer wrong_secret"));
    
    expect(response.status).toBe(401);
  });

  it("allows access without authorization if CRON_SECRET is not set in environment", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(req());
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ success: true, message: "No cleanup required" });
  });
});
