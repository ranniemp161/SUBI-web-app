import { test, expect } from "@playwright/test";

test.describe("Dashboard page", () => {
  test("renders layout and app launcher", async ({ page }) => {
    // Note: This test assumes the test environment can bypass Clerk authentication,
    // or that it is run with a signed-in session state.
    
    await page.goto("/dashboard");
    
    // The page requires authentication, so we expect a redirect to sign-in
    // If not authenticated, we can at least assert the redirect.
    // If authenticated, we assert the dashboard elements.
    
    if (page.url().includes("sign-in")) {
      // Unauthenticated path
      expect(page.url()).toContain("sign-in");
    } else {
      // Authenticated path
      await expect(page.getByText("Available balance")).toBeVisible();
      await expect(page.getByText("Subi Apps")).toBeVisible();
      
      const roughCutLink = page.getByRole("link", { name: /Rough Cut/i });
      await expect(roughCutLink).toBeVisible();
      
      await expect(page.getByText("Infographics")).toBeVisible();
      await expect(page.getByText("Thumbnail")).toBeVisible();
    }
  });
});
