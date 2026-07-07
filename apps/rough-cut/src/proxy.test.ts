import { describe, it, expect, vi, beforeEach } from 'vitest';
import proxyMiddleware, { config } from './proxy';
import { NextResponse } from 'next/server';

const { getMiddlewareHandler, setMiddlewareHandler } = vi.hoisted(() => {
  let handler: any;
  return {
    getMiddlewareHandler: () => handler,
    setMiddlewareHandler: (h: any) => { handler = h; },
  };
});

vi.mock('@clerk/nextjs/server', () => {
  return {
    clerkMiddleware: vi.fn((handler) => {
      setMiddlewareHandler(handler);
      return handler;
    }),
    createRouteMatcher: vi.fn((routes) => {
      return vi.fn((req) => {
        const path = req.nextUrl.pathname;
        if (path === '/' || path.startsWith('/sign-in') || path.startsWith('/sign-up') || path === '/api/auth/verify-code' || path === '/api/webhooks/clerk' || path === '/api/transcribe/callback') {
          return true;
        }
        return false;
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

  it('protects non-public non-api routes by redirecting', async () => {
    const protect = vi.fn();
    const auth = vi.fn().mockResolvedValue({});
    auth.protect = protect;

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
    expect(response.status).toBe(401);
  });

  it('allows protected routes when authenticated', async () => {
    const protect = vi.fn();
    const auth = vi.fn().mockResolvedValue({ userId: 'user_123' });
    auth.protect = protect;

    const request = { nextUrl: { pathname: '/api/protected' } };

    const response = await getMiddlewareHandler()(auth, request);

    expect(auth).toHaveBeenCalled();
    expect(protect).not.toHaveBeenCalled();
    expect(response).toBeUndefined();
  });
});
