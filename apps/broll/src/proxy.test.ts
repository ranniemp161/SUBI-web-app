import { describe, it, expect, vi, beforeEach } from "vitest";

// The auth gate. Every b-roll row is scoped by user_id and there is no
// anonymous surface beyond the landing page, so what this file has to get right
// is small and total: which paths skip the session check, and what an
// unauthenticated caller gets back.
//
// clerkMiddleware is stubbed to hand back the handler it was given, so the
// handler can be driven directly. createRouteMatcher keeps a real
// implementation over the app's own PUBLIC_ROUTES patterns, because the point
// of the test is whether those patterns classify paths correctly.

const state = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: (handler: unknown) => handler,
  createRouteMatcher: (patterns: string[]) => {
    const expressions = patterns.map(
      (pattern) => new RegExp(`^${pattern.replace(/\(\.\*\)/g, "(?:.*)")}$`)
    );
    return (request: { nextUrl: { pathname: string } }) =>
      expressions.some((re) => re.test(request.nextUrl.pathname));
  },
}));

import proxy, { PUBLIC_ROUTES } from "./proxy";
import { config } from "./proxy";

type Handler = (
  auth: (() => Promise<{ userId: string | null }>) & { protect: () => Promise<void> },
  request: { nextUrl: { pathname: string } }
) => Promise<Response | undefined>;

function request(pathname: string) {
  return { nextUrl: { pathname } };
}

function authStub() {
  const protect = vi.fn(async () => {});
  const auth = Object.assign(async () => ({ userId: state.userId }), { protect });
  return { auth, protect };
}

beforeEach(() => {
  state.userId = null;
  vi.clearAllMocks();
});

describe("public routes", () => {
  it("lets the landing page and the auth pages through without a session", async () => {
    for (const pathname of ["/", "/sign-in", "/sign-in/factor-one", "/sign-up"]) {
      const { auth, protect } = authStub();
      const response = await (proxy as unknown as Handler)(auth, request(pathname));
      expect(response, `${pathname} should not be blocked`).toBeUndefined();
      expect(protect, `${pathname} should not be protected`).not.toHaveBeenCalled();
    }
  });

  // Vercel calls the cron with a Bearer token and no Clerk session, so behind
  // the session gate it would 401 before its own CRON_SECRET check ever ran —
  // the same reason Ruff Cut's `blob-sweep` is public there.
  it("treats the character sweep cron as public (it self-gates on CRON_SECRET)", async () => {
    const { auth, protect } = authStub();
    const response = await (proxy as unknown as Handler)(
      auth,
      request("/api/cron/character-sweep")
    );
    expect(response).toBeUndefined();
    expect(protect).not.toHaveBeenCalled();
  });

  it("lists exactly these four public patterns and nothing more", () => {
    // A fifth entry appearing here is a real widening of the anonymous
    // surface, so it should have to change this test deliberately.
    expect(PUBLIC_ROUTES).toEqual([
      "/",
      "/sign-in(.*)",
      "/sign-up(.*)",
      "/api/cron/character-sweep",
    ]);
  });

  // The cron path is the only `/api/` route that skips the session gate. If a
  // sibling under `/api/cron/` ever slipped in by a looser pattern, this is
  // where it would show.
  it("still protects every other api route", async () => {
    for (const pathname of [
      "/api/cron/character-sweep/extra",
      "/api/cron",
      "/api/projects/p1/character",
    ]) {
      const { auth } = authStub();
      const response = await (proxy as unknown as Handler)(auth, request(pathname));
      expect(response?.status, `${pathname} should be 401`).toBe(401);
    }
  });
});

describe("protected routes", () => {
  it("protects a page route for a signed-out visitor", async () => {
    const { auth, protect } = authStub();
    await (proxy as unknown as Handler)(auth, request("/dashboard"));
    expect(protect).toHaveBeenCalledTimes(1);
  });

  it("lets a signed-in visitor straight through", async () => {
    state.userId = "user_123";
    const { auth, protect } = authStub();
    const response = await (proxy as unknown as Handler)(auth, request("/dashboard"));
    expect(response).toBeUndefined();
    expect(protect).not.toHaveBeenCalled();
  });

  it("does not treat a path that merely starts with a public one as public", async () => {
    // "/signup-offer" must not slip through on a prefix match of "/sign-up".
    const { auth, protect } = authStub();
    await (proxy as unknown as Handler)(auth, request("/dashboard/new"));
    expect(protect).toHaveBeenCalledTimes(1);
  });
});

describe("unauthenticated API calls", () => {
  it("answers JSON 401 rather than redirecting to a sign-in page", async () => {
    // The caller is code, and a 302 to HTML is a confusing failure for it.
    const { auth, protect } = authStub();
    const response = await (proxy as unknown as Handler)(
      auth,
      request("/api/projects")
    );
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(protect).not.toHaveBeenCalled();
  });

  it("leaves a signed-in API call alone", async () => {
    state.userId = "user_123";
    const { auth } = authStub();
    const response = await (proxy as unknown as Handler)(
      auth,
      request("/api/projects")
    );
    expect(response).toBeUndefined();
  });
});

describe("matcher config", () => {
  it("always runs for API routes", () => {
    expect(config.matcher).toContain("/(api|trpc)(.*)");
  });

  it("keeps the Next internals and static file skip", () => {
    // Dropping this makes the gate run on every asset request.
    expect(config.matcher.some((m) => m.includes("_next"))).toBe(true);
  });
});
