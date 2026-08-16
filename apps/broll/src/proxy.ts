import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Routes that skip Clerk session auth. Everything else in this app requires a
 * signed-in user, because every b-roll row is scoped by `user_id` and there is
 * no anonymous surface beyond the landing page.
 *
 * The cron path is public here and **self-gates on `CRON_SECRET`** instead.
 * Vercel calls it with a Bearer token and no Clerk session, so leaving it behind
 * this gate would 401 it before its own secret check ever ran — the same shape
 * Ruff Cut's `blob-sweep` already has.
 *
 * Next.js 16 renamed this file from `middleware.ts` to `proxy.ts`. That is not
 * a mistake — see the root AGENTS.md.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/cron/character-sweep",
];

const isPublicRoute = createRouteMatcher(PUBLIC_ROUTES);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    const session = await auth();
    if (!session.userId) {
      // An API route gets JSON rather than a redirect to a sign-in page: the
      // caller is code, and a 302 to HTML is a confusing failure for it.
      if (request.nextUrl.pathname.startsWith("/api/")) {
        // **Logged, because a response from here leaves no other trace.** Next
        // prints a request line for anything a route handler answers, but a
        // rejection at this layer is silent: sixty of them in a row produced
        // sixty 401s at the caller and not one line in the dev log. That gap
        // cost a long investigation. A character upload got one of these
        // mid run, and from the outside it looked like the request had
        // vanished rather than been refused.
        console.warn(
          `[proxy] refused an unauthenticated API request: ${request.method} ${request.nextUrl.pathname}`
        );
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      await auth.protect();
    }
  }
});

export const config = {
  matcher: [
    // Skip Next internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
