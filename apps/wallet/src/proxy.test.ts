/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockProtect = vi.fn();

vi.mock("@clerk/nextjs/server", () => {
  return {
    clerkMiddleware: vi.fn((handler) => handler),
    createRouteMatcher: vi.fn((patterns) => {
      return (req: any) => {
        const url = req.nextUrl;
        return patterns.some((p: string) => {
          const regex = new RegExp(`^${p.replace("(.*)", ".*")}$`);
          return regex.test(url.pathname);
        });
      };
    }),
  };
});

import middleware, { config } from "./proxy";
import { createRequire } from "node:module";

// The matcher strings are path-to-regexp patterns, not plain RegExp — compile
// them with the exact library Next.js uses so these tests exercise the real
// routing behavior (no .d.ts ships with the compiled copy, hence the cast).
const nodeRequire = createRequire(import.meta.url);
const { pathToRegexp } = nodeRequire("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (path: string) => RegExp;
};

describe("proxy middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows public routes without checking session", async () => {
    const auth = vi.fn();
    const req = { nextUrl: { pathname: "/sign-in" } };
    await (middleware as any)(auth, req as any);
    expect(auth).not.toHaveBeenCalled();
  });

  // Regression: the cron sweeps are called by Vercel with no Clerk session but a
  // CRON_SECRET Bearer token. They must skip Clerk auth or the middleware 401s
  // them before their own secret check runs, and the sweep never fires.
  it.each([
    "/api/cron/autorecharge",
    "/api/cron/cleanup",
  ])("treats %s as public (self-gates on CRON_SECRET)", async (pathname) => {
    const auth = vi.fn();
    const req = { nextUrl: { pathname } };
    const res = await (middleware as any)(auth, req as any);
    expect(auth).not.toHaveBeenCalled();
    expect(res).toBeUndefined();
  });

  it("calls auth.protect() for private non-API routes when unauthorized", async () => {
    const auth = vi.fn(async () => ({ userId: null }));
    (auth as any).protect = mockProtect;
    const req = { nextUrl: { pathname: "/dashboard" } };
    
    await (middleware as any)(auth, req as any);
    expect(auth).toHaveBeenCalled();
    expect(mockProtect).toHaveBeenCalled();
  });

  it("returns 401 for private API routes when unauthorized", async () => {
    const auth = vi.fn(async () => ({ userId: null }));
    (auth as any).protect = mockProtect;
    const req = { nextUrl: { pathname: "/api/private-data" } };
    
    const res = await (middleware as any)(auth, req as any);
    expect(auth).toHaveBeenCalled();
    expect(mockProtect).not.toHaveBeenCalled();
    expect(res?.status).toBe(401);
  });

  it("does nothing (allows access) for private routes when authorized", async () => {
    const auth = vi.fn(async () => ({ userId: "user_1" }));
    (auth as any).protect = mockProtect;
    const req = { nextUrl: { pathname: "/dashboard" } };

    const res = await (middleware as any)(auth, req as any);
    expect(auth).toHaveBeenCalled();
    expect(mockProtect).not.toHaveBeenCalled();
    expect(res).toBeUndefined();
  });
});

describe("config.matcher (Edge Middleware routing)", () => {
  const matchers = (config.matcher as string[]).map((p) => pathToRegexp(p));
  const middlewareRuns = (pathname: string) => matchers.some((r) => r.test(pathname));

  // These routes self-gate (Stripe signature, CRON_SECRET, IP rate limit) —
  // the matcher must exclude them so the Edge Middleware never bills an
  // invocation for them.
  it.each([
    "/api/webhooks/stripe",
    "/api/cron/autorecharge",
    "/api/cron/cleanup",
    "/api/billing/bundles",
  ])("never invokes middleware for the self-gated route %s", (pathname) => {
    expect(middlewareRuns(pathname)).toBe(false);
  });

  // Prefix cousins of the excluded routes must NOT inherit the exclusion —
  // a future route like /api/cron-admin has no self-gate and needs Clerk.
  it.each([
    "/api/webhooksx",
    "/api/cron-admin",
    "/api/billing/bundles-fake",
  ])("still invokes middleware for the prefix cousin %s", (pathname) => {
    expect(middlewareRuns(pathname)).toBe(true);
  });

  // Every authenticated billing route must keep going through Clerk.
  it.each([
    "/",
    "/sign-in",
    "/dashboard",
    "/api/billing/checkout",
    "/api/billing/autorecharge",
    "/api/billing/setup-intent",
  ])("invokes middleware for %s", (pathname) => {
    expect(middlewareRuns(pathname)).toBe(true);
  });

  it.each(["/_next/static/chunk.js", "/favicon.ico", "/logo.png"])(
    "skips middleware for the static path %s",
    (pathname) => {
      expect(middlewareRuns(pathname)).toBe(false);
    }
  );

  // The second matcher entry exists solely for this: an API route whose path
  // ends in a static-looking extension must still get middleware.
  it("keeps middleware on for API paths ending in a static-looking extension", () => {
    expect(middlewareRuns("/api/export/report.csv")).toBe(true);
  });
});
