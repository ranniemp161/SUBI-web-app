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

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
