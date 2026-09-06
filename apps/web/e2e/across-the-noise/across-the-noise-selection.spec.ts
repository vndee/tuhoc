import { expect, test } from '@playwright/test';
import { backToPlate, enterNoiseLab, prepareNoise } from './noise-helpers';

for (const width of [320, 1440]) for (const theme of ['light', 'dark']) {
  test(`native radio and checkbox label rows ${width} ${theme}`, async ({ page }, info) => {
    await prepareNoise(page, width);
    if (theme === 'dark') await page.locator('.story-theme-toggle').click();
    await enterNoiseLab(page, 12);
    const radio = page.getByRole('radio', { name: 'Changed', exact: true });
    const label = radio.locator('..');
    await label.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('radio-label.png') });
    const geometry = await label.evaluate(el => {
      const input = el.querySelector('input')!.getBoundingClientRect();
      const label = el.getBoundingClientRect();
      const text = [...el.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())!;
      const range = document.createRange(); range.selectNodeContents(text);
      const caption = range.getBoundingClientRect();
      return { width: label.width, height: label.height, glyph: input.width, alignment: Math.abs(input.y + input.height / 2 - caption.y - caption.height / 2) };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.glyph).toBeLessThanOrEqual(24);
    expect(geometry.alignment).toBeLessThanOrEqual(3);
    await label.click({ position: { x: 50, y: 22 } });
    await expect(radio).toBeChecked();
    await radio.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Unchanged', exact: true })).toBeChecked();
    await backToPlate(page);
    await enterNoiseLab(page, 10);
    const checkbox = page.getByRole('checkbox', { name: 'Advanced: allow three or more flips' });
    await checkbox.locator('..').click();
    await expect(checkbox).toBeChecked();
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
    const box = await checkbox.boundingBox();
    const target = await checkbox.locator('..').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(24);
    expect(target!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath('checkbox-label.png') });
  });
}
