import { test, expect } from "@playwright/test";

/**
 * Unauthenticated smoke tests. These need no secrets and no Clerk test user,
 * so they run on every preview deployment.
 *
 * The redirect and 401 assertions below are the point of this file: they prove
 * the Clerk gate in src/proxy.ts is actually live on a real build. A middleware
 * matcher edit that accidentally stops covering /dashboard would still pass
 * every unit test in the repo.
 */

test.describe("Public surface", () => {
  test("landing page renders", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("body")).toBeVisible();
  });

  for (const path of ["/privacy", "/terms"]) {
    test(`${path} is publicly reachable`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(400);
    });
  }
});

test.describe("Auth gate", () => {
  test("anonymous visitor to /dashboard is sent to sign-in", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    // Clerk's auth.protect() redirects to the sign-in URL rather than rendering.
    await page.waitForURL(/sign-in/, { timeout: 15_000 });
    expect(page.url()).toContain("sign-in");
  });

  test("anonymous request to a protected API route is 401", async ({
    request,
  }) => {
    const response = await request.get("/api/projects");
    expect(response.status()).toBe(401);
  });

  test("machine-to-machine cron route is not behind Clerk but self-gates", async ({
    request,
  }) => {
    // /api/cron(.*) is excluded from the middleware matcher on purpose — it must
    // NOT 401 from Clerk, but must still reject a caller with no CRON_SECRET.
    const response = await request.get("/api/cron/blob-sweep");
    expect(response.status()).not.toBe(200);
  });
});
