import { test, expect } from "@playwright/test";

/**
 * Unauthenticated smoke tests. These need no secrets and no Clerk test user,
 * so they run on every preview deployment.
 *
 * Assertions here check for real app content, never just `status < 400`. A
 * status-only assertion passes against Vercel's Deployment Protection login
 * page, which answers 200 for every path — the suite would report green while
 * testing nothing. e2e/global-setup.ts catches that case up front; these
 * assertions are the second line of defense.
 *
 * The auth-gate block is the highest-value part of this file: it proves the
 * Clerk gate in src/proxy.ts is actually live on a real build. A middleware
 * matcher edit that stopped covering /dashboard would pass every unit test in
 * the repo.
 */

test.describe("Public surface", () => {
  test("landing page renders its real content", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /the boring part of/i })
    ).toBeVisible();
    await expect(page.locator("#cta-get-started")).toBeVisible();
  });

  for (const path of ["/privacy", "/terms"]) {
    test(`${path} is publicly reachable and is our page`, async ({
      page,
      baseURL,
    }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(400);

      // Must be served from the app's own origin — a protection redirect would
      // land us on vercel.com with a perfectly healthy 200.
      expect(new URL(page.url()).host).toBe(new URL(baseURL!).host);
      await expect(page.locator("h1, h2").first()).toBeVisible();
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
