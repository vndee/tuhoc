import { expect, test } from '@playwright/test';

test('normal production build publishes issue two without preview and preserves issue one', async ({ page }) => {
  await page.goto('/stories/across-the-noise');
  await expect(page.getByRole('heading', { name: 'Một lời nói đi qua đại dương', exact: true })).toBeVisible();
  await expect(page.locator('.story-theme-across-noise')).toBeVisible();
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  await expect(page.getByText('Bản nháp để duyệt, chưa xuất bản.')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/stories\/across-the-noise$/);
  await page.goto('/stories');
  await expect(page.getByRole('link', { name: 'Một lời nói đi qua đại dương', exact: true })).toHaveAttribute('href', '/stories/across-the-noise');
  await page.getByRole('link', { name: 'Một lịch sử của trí tuệ nhân tạo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Một lịch sử của trí tuệ nhân tạo', exact: true })).toBeVisible();
  await page.goto('/');
  await page.getByRole('link', { name: 'Mở đặc san', exact: true }).click();
  await expect(page).toHaveURL(/\/stories\/across-the-noise$/);
  await expect(page.locator('#scene-01 .story-lab-entry > button')).toBeVisible();
});

test('normal production does not expose unknown editions through preview', async ({ page }) => {
  await page.goto('/stories/not-published?preview=1');
  await expect(page.getByRole('heading', { name: 'Không tìm thấy số đặc san' })).toBeVisible();
});
