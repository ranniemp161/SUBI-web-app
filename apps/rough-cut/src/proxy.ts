import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Public routes that don't require authentication.
 * Everything else is protected by default.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/clerk",
  "/api/transcribe/callback",
  // Cron sweep is called by Vercel with no Clerk session; it self-gates on
  // CRON_SECRET, so it must skip Clerk auth (same reason as the webhook above).
  "/api/cron(.*)",
]);

import { NextResponse } from "next/server";

export default clerkMiddleware(async (auth, request) => {
  // Signed-in users skip the marketing page. This lives here (not in the
  // page via auth()) so the landing page stays fully static and CDN-served;
  // middleware runs before the cache, so the redirect still always fires.
  if (request.nextUrl.pathname === "/") {
    const { userId } = await auth();
    if (userId) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return;
  }

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

// The machine-to-machine routes (Clerk webhook, cron sweeps, the Deepgram
// callback) are excluded at the MATCHER level so the Edge Middleware never
// invokes for them — they carry their own gates (svix signature, CRON_SECRET,
// per-project callback token + IP rate limit inside the handlers), so Clerk
// adds nothing but a billed invocation. They stay listed in `isPublicRoute`
// above as a second layer: if a matcher edit ever re-includes them, they must
// still not be 401'd by Clerk. Each exclusion ends in `(?:/|$)` so prefix
// cousins (e.g. /api/cron-admin) are NOT excluded.
export const config = {
  matcher: [
    // Skip Next.js internals, static files, and the machine-to-machine routes
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)|api/webhooks/clerk(?:/|$)|api/cron(?:/|$)|api/transcribe/callback(?:/|$)).*)",
    // Safety net: an API route whose path ends in a static-looking extension
    // (e.g. a future /api/export/foo.csv) would be skipped by the entry above;
    // this forces middleware back on for it — with the same exclusions.
    "/(api|trpc)((?!/webhooks/clerk(?:/|$)|/cron(?:/|$)|/transcribe/callback(?:/|$)).*)",
  ],
};
