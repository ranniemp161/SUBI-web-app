import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against either a local dev server (default) or a deployed Vercel
 * preview (`PLAYWRIGHT_BASE_URL`, set by .github/workflows/e2e.yml).
 *
 * Two tiers of coverage, because they have very different setup costs:
 *
 *   smoke         — no auth, no secrets. Asserts the public surface renders and,
 *                   more importantly, that the Clerk gate in src/proxy.ts is
 *                   actually live on a real deployment. Always runs.
 *   authenticated — signs in as a real Clerk test user via @clerk/testing.
 *                   Only runs when the credentials below are present, so the
 *                   suite stays green before that test user exists.
 */

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Vercel preview deployments sit behind Deployment Protection. This header is
// how an automated client gets through; locally it is simply absent.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export const hasClerkCredentials = Boolean(
  process.env.CLERK_SECRET_KEY &&
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.E2E_CLERK_USER_IDENTIFIER &&
    process.env.E2E_CLERK_USER_PASSWORD
);

export const STORAGE_STATE = "e2e/.auth/user.json";

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
    ...(hasClerkCredentials
      ? [
          {
            name: "setup",
            testMatch: /auth\.setup\.ts/,
            use: { ...devices["Desktop Chrome"] },
          },
          {
            name: "authenticated",
            testMatch: /.*\.auth\.spec\.ts/,
            dependencies: ["setup"],
            use: {
              ...devices["Desktop Chrome"],
              storageState: STORAGE_STATE,
            },
          },
        ]
      : []),
  ],
});
