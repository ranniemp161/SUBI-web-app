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

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
