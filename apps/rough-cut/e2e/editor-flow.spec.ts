import { test, expect } from '@playwright/test';

test.describe('Editor Flow', () => {
  test('loads editor for a project ID', async ({ page }) => {
    await page.goto('/dashboard/test-id-123');
    await expect(page.getByText('Project not found').or(page.getByText('Failed to load project'))).toBeVisible();
  });
});
