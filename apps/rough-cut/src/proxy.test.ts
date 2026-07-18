import { describe, it, expect, vi, beforeEach } from 'vitest';
import proxyMiddleware, { config } from './proxy';
import { NextResponse } from 'next/server';
import { createRequire } from 'node:module';

// The matcher strings are path-to-regexp patterns, not plain RegExp — compile
// them with the exact library Next.js uses so these tests exercise the real
// routing behavior (no .d.ts ships with the compiled copy, hence the cast).
const nodeRequire = createRequire(import.meta.url);
const { pathToRegexp } = nodeRequire('next/dist/compiled/path-to-regexp') as {
  pathToRegexp: (path: string) => RegExp;
};

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

  it('redirects signed-in users from the landing page to /dashboard', async () => {
    const auth = vi.fn().mockResolvedValue({ userId: 'user_123' });
    const request = { nextUrl: { pathname: '/' }, url: 'http://localhost:3000/' };

    const response = await getMiddlewareHandler()(auth, request);

    expect(response).toBeInstanceOf(NextResponse);
    expect((response as NextResponse).status).toBe(307);
    expect((response as NextResponse).headers.get('location')).toBe(
      'http://localhost:3000/dashboard'
    );
  });

  it('serves the landing page to anonymous visitors without redirecting', async () => {
    const auth = vi.fn().mockResolvedValue({});
    const request = { nextUrl: { pathname: '/' }, url: 'http://localhost:3000/' };

    const response = await getMiddlewareHandler()(auth, request);

    expect(response).toBeUndefined();
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

describe('config.matcher (Edge Middleware routing)', () => {
  const matchers = (config.matcher as string[]).map((p) => pathToRegexp(p));
  const middlewareRuns = (pathname: string) => matchers.some((r) => r.test(pathname));

  // These routes self-gate (svix signature, CRON_SECRET, per-project callback
  // token) — the matcher must exclude them so the Edge Middleware never bills
  // an invocation for them.
  it.each([
    '/api/webhooks/clerk',
    '/api/cron/blob-sweep',
    '/api/transcribe/callback',
  ])('never invokes middleware for the self-gated route %s', (pathname) => {
    expect(middlewareRuns(pathname)).toBe(false);
  });

  // Prefix cousins of the excluded routes must NOT inherit the exclusion —
  // a future route like /api/cron-admin has no self-gate and needs Clerk.
  it.each([
    '/api/webhooks/clerk2',
    '/api/cron-admin',
    '/api/transcribe/callback-x',
  ])('still invokes middleware for the prefix cousin %s', (pathname) => {
    expect(middlewareRuns(pathname)).toBe(true);
  });

  it.each([
    '/',
    '/sign-in',
    '/dashboard',
    '/api/projects/123',
    '/api/credits',
    '/api/pusher/auth',
    '/api/transcribe/deepgram',
  ])('invokes middleware for %s', (pathname) => {
    expect(middlewareRuns(pathname)).toBe(true);
  });

  it.each(['/_next/static/chunk.js', '/favicon.ico', '/logo.png'])(
    'skips middleware for the static path %s',
    (pathname) => {
      expect(middlewareRuns(pathname)).toBe(false);
    }
  );

  // The second matcher entry exists solely for this: an API route whose path
  // ends in a static-looking extension must still get middleware.
  it('keeps middleware on for API paths ending in a static-looking extension', () => {
    expect(middlewareRuns('/api/export/report.csv')).toBe(true);
  });
});
