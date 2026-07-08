import { describe, it, expect, vi, beforeEach } from 'vitest';
import proxyMiddleware, { config } from './proxy';
import { NextResponse } from 'next/server';

const { getMiddlewareHandler, setMiddlewareHandler } = vi.hoisted(() => {
  let handler: (...args: unknown[]) => unknown;
  return {
    getMiddlewareHandler: () => handler,
    setMiddlewareHandler: (h: (...args: unknown[]) => unknown) => { handler = h; },
  };
});

vi.mock('@clerk/nextjs/server', () => {
  return {
    clerkMiddleware: vi.fn((handler) => {
      setMiddlewareHandler(handler);
      return handler;
    }),
    // Use the REAL patterns passed by proxy.ts (not a hardcoded copy), so this
    // test actually validates the public-route list and catches a regression in it.
    createRouteMatcher: vi.fn((patterns: string[]) => {
      return vi.fn((req) => {
        const path = req.nextUrl.pathname;
        return patterns.some((p) =>
          new RegExp(`^${p.replace('(.*)', '.*')}$`).test(path)
        );
      });
    }),
  };
});

describe('proxy middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the middleware handler', () => {
    expect(proxyMiddleware).toBeDefined();
    expect(getMiddlewareHandler()).toBeDefined();
  });

  it('exports the correct config matcher', () => {
    expect(config.matcher).toBeDefined();
    expect(Array.isArray(config.matcher)).toBe(true);
  });

  it('allows public routes without authentication', async () => {
    const auth = vi.fn().mockResolvedValue({});
    const request = { nextUrl: { pathname: '/sign-in' } };

    const response = await getMiddlewareHandler()(auth, request);

    expect(auth).not.toHaveBeenCalled();
    expect(response).toBeUndefined();
  });

  // Regression: the blob-sweep cron is called by Vercel with no Clerk session
  // but a CRON_SECRET Bearer token; it must skip Clerk auth or the middleware
  // 401s it before its own secret check runs.
  it('treats the cron route as public (self-gates on CRON_SECRET)', async () => {
    const auth = vi.fn().mockResolvedValue({});
    const request = { nextUrl: { pathname: '/api/cron/blob-sweep' } };

    const response = await getMiddlewareHandler()(auth, request);

    expect(auth).not.toHaveBeenCalled();
    expect(response).toBeUndefined();
  });

  it('protects non-public non-api routes by redirecting', async () => {
    const protect = vi.fn();
    const auth = Object.assign(vi.fn().mockResolvedValue({}), { protect });

    const request = { nextUrl: { pathname: '/dashboard' } };

    await getMiddlewareHandler()(auth, request);

    expect(auth).toHaveBeenCalled();
    expect(protect).toHaveBeenCalled();
  });

  it('returns 401 Unauthorized for protected API routes when unauthenticated', async () => {
    const auth = vi.fn().mockResolvedValue({});
    const request = { nextUrl: { pathname: '/api/protected' } };

    const response = await getMiddlewareHandler()(auth, request);

    expect(auth).toHaveBeenCalled();
    expect(response).toBeInstanceOf(NextResponse);
    expect((response as NextResponse).status).toBe(401);
  });

  it('allows protected routes when authenticated', async () => {
    const protect = vi.fn();
    const auth = Object.assign(vi.fn().mockResolvedValue({ userId: 'user_123' }), { protect });

    const request = { nextUrl: { pathname: '/api/protected' } };

    const response = await getMiddlewareHandler()(auth, request);

    expect(auth).toHaveBeenCalled();
    expect(protect).not.toHaveBeenCalled();
    expect(response).toBeUndefined();
  });
});
