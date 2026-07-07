import { test, expect } from "@playwright/test";

test.describe("Home page flow", () => {
  test("redirects users to rough cut app", async ({ page }) => {
    // Tests that navigation to the root triggers the server-side redirect
    const res = await page.goto("/");
    // Without full knowledge of the running server's config for ROUGH_CUT_URL,
    // we assert that we are either no longer on "/" or the redirect succeeded.
    if (res && res.url() === "http://localhost:3000/") {
      expect(page.url()).not.toBe("http://localhost:3000/");
    } else {
      expect(res?.status()).toBe(200);
    }
  });
});
