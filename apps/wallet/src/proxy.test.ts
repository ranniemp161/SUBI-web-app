import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

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

import middleware from "./proxy";

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
