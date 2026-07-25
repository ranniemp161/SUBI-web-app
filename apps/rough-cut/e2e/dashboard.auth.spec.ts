import { test, expect } from "@playwright/test";

/**
 * Authenticated dashboard checks against a real deployment. Replaces the old
 * dashboard-flow.spec.ts, which navigated to /dashboard with no session and so
 * only ever passed against a dev server with auth effectively absent.
 */

test.describe("Dashboard", () => {
  test("renders the project list for a signed-in user", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: /your projects/i })
    ).toBeVisible();
  });

  test("buy credits links at the Wallet app, not localhost", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    const buyCredits = page.getByRole("link", { name: /buy credits/i });
    await expect(buyCredits).toBeVisible();

    // src/lib/env.ts throws at build time on a missing WALLET_URL, but a value
    // that is merely *wrong* (still pointing at a dev origin) builds fine and
    // ships a dead cross-app link. Only a deployed run can catch that.
    const href = await buyCredits.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).not.toContain("localhost");
  });

  test("file input is present for upload", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator('input[type="file"]')).toBeAttached();
  });
});

test.describe("Editor", () => {
  test("unknown project id surfaces a not-found state", async ({ page }) => {
    await page.goto("/dashboard/test-id-123");

    await expect(
      page
        .getByText(/project not found/i)
        .or(page.getByText(/failed to load project/i))
    ).toBeVisible({ timeout: 20_000 });
  });
});
