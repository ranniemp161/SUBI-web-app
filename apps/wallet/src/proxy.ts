import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Routes that skip Clerk session auth. Machine-called routes (Stripe webhooks,
 * the cron sweeps) are public HERE because they carry their own gate — a Stripe
 * signature or the `CRON_SECRET` Bearer token — and arrive with no Clerk session,
 * so Clerk's middleware would 401 them before their own check ever runs.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/billing/bundles(.*)",
  "/api/cron(.*)",
];

const isPublicRoute = createRouteMatcher(PUBLIC_ROUTES);

import { NextResponse } from "next/server";

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    const session = await auth();
    if (!session.userId) {
      if (request.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      await auth.protect();
    }
  }
});

// The machine-to-machine and fully-public routes (Stripe webhook, cron
// sweeps, the CDN-cached bundles listing) are excluded at the MATCHER level
// so the Edge Middleware never invokes for them — each carries its own gate
// (Stripe signature, CRON_SECRET, IP rate limit inside the handlers), so
// Clerk adds nothing but a billed invocation. They stay listed in
// `PUBLIC_ROUTES` above as a second layer: if a matcher edit ever
// re-includes them, they must still not be 401'd by Clerk. Each exclusion
// ends in `(?:/|$)` so prefix cousins (e.g. /api/billing/bundles-x) are NOT
// excluded.
export const config = {
  matcher: [
    // Skip Next.js internals, static files, and the machine/public routes
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)|api/webhooks(?:/|$)|api/cron(?:/|$)|api/billing/bundles(?:/|$)).*)",
    // Safety net: an API route whose path ends in a static-looking extension
    // (e.g. a future /api/export/foo.csv) would be skipped by the entry above;
    // this forces middleware back on for it — with the same exclusions.
    "/(api|trpc)((?!/webhooks(?:/|$)|/cron(?:/|$)|/billing/bundles(?:/|$)).*)",
  ],
};
