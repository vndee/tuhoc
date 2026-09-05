import { expect, test } from '@playwright/test';

test('normal production build excludes the unpublished edition even with preview requested', async ({ page }) => {
  await page.goto('/stories/across-the-noise?preview=1');
  await expect(page.getByRole('heading', { name: 'Không tìm thấy số đặc san' })).toBeVisible();
  await expect(page.locator('.story-theme-across-noise')).toHaveCount(0);
  await page.goto('/stories');
  await expect(page.locator('a[href*="across-the-noise"]')).toHaveCount(0);
  await page.goto('/');
  await expect(page.locator('a[href*="across-the-noise"]')).toHaveCount(0);
});
