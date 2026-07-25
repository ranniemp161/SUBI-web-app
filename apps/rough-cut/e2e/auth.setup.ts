import { test as setup } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import path from "node:path";
import fs from "node:fs";
import { STORAGE_STATE } from "../playwright.config";

/**
 * Signs in once as the dedicated Clerk E2E user and saves the session so the
 * *.auth.spec.ts files start authenticated. Runs as a Playwright "setup"
 * project dependency, so it happens exactly once per run.
 *
 * Requires (see playwright.config.ts's hasClerkCredentials):
 *   CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
 *   E2E_CLERK_USER_IDENTIFIER, E2E_CLERK_USER_PASSWORD
 *
 * The user must exist in the Clerk instance the target deployment points at,
 * and its password must not be one Clerk flags as compromised.
 */
setup("authenticate", async ({ page }) => {
  // Obtains a Clerk testing token so the sign-in below is not blocked by bot
  // protection. Must run before any navigation.
  await clerkSetup();

  await page.goto("/sign-in");

  await clerk.signIn({
    page,
    signInParams: {
      strategy: "password",
      identifier: process.env.E2E_CLERK_USER_IDENTIFIER!,
      password: process.env.E2E_CLERK_USER_PASSWORD!,
    },
  });

  // Prove the session is real before persisting it — otherwise a broken login
  // silently produces an empty storage state and every auth spec fails with a
  // confusing redirect instead of a clear "could not sign in".
  await page.goto("/dashboard");
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
    timeout: 20_000,
  });

  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE });
});
