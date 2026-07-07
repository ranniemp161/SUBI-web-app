import { test, expect } from '@playwright/test';

test.describe('Dashboard Flow', () => {
  test('loads dashboard and displays empty state', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /your projects/i })).toBeVisible();
    await expect(page.getByText('Turn raw footage into a rough cut')).toBeVisible();
    
    // File picker should be accessible
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();
  });

  test('displays buy credits link', async ({ page }) => {
    await page.goto('/dashboard');
    const buyCreditsBtn = page.getByRole('link', { name: /buy credits/i });
    await expect(buyCreditsBtn).toBeVisible();
  });
});
