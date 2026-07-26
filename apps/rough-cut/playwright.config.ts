import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against either a local dev server (default) or a deployed Vercel
 * preview (`PLAYWRIGHT_BASE_URL`, set by .github/workflows/e2e.yml).
 *
 * Unauthenticated only, on purpose. Vercel scopes DATABASE_URL, CLERK_SECRET_KEY
 * and STRIPE_SECRET_KEY to "Production and Preview" in both apps, so a preview
 * deployment talks to the *production* database. A signed-in test tier would
 * therefore create real users and real rows in production on every pull request.
 *
 * An authenticated tier was written and then deleted for exactly that reason.
 * Before reinstating it, Preview needs its own Neon branch and Clerk instance —
 * see `apps/rough-cut/AGENTS.md` under "E2E".
 *
 * Every assertion here is a read: GETs on public pages, plus checks that the
 * Clerk gate in src/proxy.ts actually rejects. Nothing writes.
 */

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Vercel preview deployments sit behind Deployment Protection. This header is
// how an automated client gets through; locally it is simply absent.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "./e2e",
  // Refuses to run when the target is Vercel's Deployment Protection login
  // page rather than the app. See the comment in that file.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["line"]],
  // A deployed target is shared infrastructure — tolerate one flake against a
  // cold preview in CI, but never let a green local run depend on a retry.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),

  use: {
    baseURL,
    trace: "on-first-retry",
    ...(bypassSecret
      ? {
          extraHTTPHeaders: {
            "x-vercel-protection-bypass": bypassSecret,
            "x-vercel-set-bypass-cookie": "true",
          },
        }
      : {}),
  },

  projects: [
    {
      name: "smoke",
      testMatch: /.*\.smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
