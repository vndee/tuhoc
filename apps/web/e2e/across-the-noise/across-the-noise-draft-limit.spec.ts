import { expect, test } from '@playwright/test';
import { enterNoiseLab, prepareNoise } from './noise-helpers';

for (const [width, lang, theme] of [
  [320, 'vi', 'light'], [320, 'en', 'dark'],
  [1440, 'en', 'light'], [1440, 'vi', 'dark'],
] as const) test(`oversized drafts stay bounded and recover ${width} ${lang} ${theme}`, async ({ page }, info) => {
  await prepareNoise(page, width);
  if (lang === 'vi') {
    await page.getByRole('button', { name: 'Interface language' }).click();
    await page.getByRole('menuitemradio', { name: /Tiếng Việt/ }).click();
  }
  if (theme === 'dark') await page.locator('.story-theme-toggle').click();
  await enterNoiseLab(page, 1);
  const original = page.getByRole('textbox', { name: lang === 'vi' ? 'Câu của bạn' : 'Your message', exact: true });
  const shortened = page.getByRole('textbox', { name: lang === 'vi' ? 'Bản rút lời' : 'Shortened draft', exact: true });
  const oversized = 'x'.repeat(100_000);
  for (const editor of [original, shortened]) {
    const before = await editor.inputValue();
    const inserted = await editor.evaluate((input, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      return input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }, oversized);
    expect(inserted).toBe(false);
    await expect(editor).toHaveValue(before);
    // Also cover input/autofill that reaches onChange without a paste event.
    await editor.fill(oversized);
    await expect(editor).toHaveValue(before);
    await expect(editor).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').first()).toContainText(lang === 'vi' ? 'vẫn được giữ nguyên' : 'previous draft is unchanged');
    expect(await page.locator('[data-edit]').count()).toBeLessThan(250);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await editor.fill('Repaired');
    await expect(editor).toHaveValue('Repaired');
    await expect(editor).not.toHaveAttribute('aria-invalid', 'true');
  }
  const maximumValid = `😀${'\u0301'.repeat(510)}`;
  await original.fill(maximumValid);
  await page.getByRole('button', { name: lang === 'vi' ? 'Dùng câu này' : 'Use this message', exact: true }).click();
  await expect(page.locator('.communication-message-comparison section').first().locator('pre')).toHaveText(maximumValid);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.locator('.communication-message-editor').screenshot({ path: info.outputPath('recovered-editor.png') });
});
