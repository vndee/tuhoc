import { expect, test } from '@playwright/test';
import { backToPlate, commitNoiseMessage, enterNoiseLab, prepareNoise, saveNoiseEvidence } from './noise-helpers';

for (const width of [320, 1440]) for (const theme of ['light', 'dark']) for (const lang of ['en', 'vi']) {
  test(`receipt preserves literal whitespace ${width} ${theme} ${lang}`, async ({ page }, info) => {
    await prepareNoise(page, width);
    await enterNoiseLab(page, 11);
    const message = '  A  B\nC  ';
    await commitNoiseMessage(page, message);
    await page.getByRole('spinbutton', { name: 'Configured flip probability p', exact: true }).fill('0');
    await page.getByRole('button', { name: 'Run transmission', exact: true }).click();
    await backToPlate(page);
    await enterNoiseLab(page, 12);
    if (theme === 'dark') await page.locator('.story-theme-toggle').click();
    if (lang === 'vi') {
      await page.getByRole('button', { name: 'Interface language' }).click();
      await page.getByRole('menuitemradio', { name: /Tiếng Việt/ }).click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const prefixes = lang === 'en' ? ['Original text:', 'Received text:'] : ['Văn bản gốc:', 'Văn bản nhận:'];
    const evidence = [];
    for (const prefix of prefixes) {
      const pane = page.locator('.story-lab-frame p').filter({ hasText: prefix });
      await expect(pane).toHaveCount(1);
      const literal = await pane.evaluate((element, label) => {
        const value = element.querySelector('[data-literal-text]') ?? element;
        return {
          text: value.textContent,
          rendered: (value as HTMLElement).innerText,
          whiteSpace: getComputedStyle(value).whiteSpace,
          label,
        };
      }, prefix);
      // innerText is deliberately used: textContent alone hid the browser defect.
      expect(literal.rendered).toBe(message);
      expect(literal.text).toBe(message);
      expect(literal.whiteSpace).toBe('pre-wrap');
      evidence.push(literal);
      await pane.screenshot({ path: info.outputPath(prefix === prefixes[0] ? 'original-text.png' : 'received-text.png') });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await saveNoiseEvidence(info, 'literal-receipt', { width, theme, lang, evidence });
  });
}

for (const lang of ['en', 'vi']) test(`zero-memory trace and explanation follow captured run ${lang}`, async ({ page }, info) => {
  await prepareNoise(page);
  await enterNoiseLab(page, 5);
  if (lang === 'vi') {
    await page.getByRole('button', { name: 'Interface language' }).click();
    await page.getByRole('menuitemradio', { name: /Tiếng Việt/ }).click();
  }
  const tau = page.getByRole('combobox', { name: lang === 'en' ? 'Channel memory tau' : 'Bộ nhớ kênh tau' });
  const run = page.getByRole('button', { name: lang === 'en' ? 'Run experiment' : 'Chạy thử', exact: true });
  const bypass = lang === 'en' ? /output without memory/i : /đầu ra không có bộ nhớ/i;
  const memory = lang === 'en' ? /output with memory/i : /đầu ra có bộ nhớ/i;
  const previous = lang === 'en' ? /still carries a trace of the previous pulse/i : /còn giữ dấu vết của xung trước/i;
  await tau.selectOption('0');
  await run.click();
  const output = page.locator('[data-trace="output"]');
  const path = (await output.getAttribute('d'))!;
  const points = [...path.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
  expect(points[0]).toEqual([48, 202]);
  expect(points.some((point, i) => i > 0 && point[1] !== points[i - 1]![1])).toBe(true);
  for (let i = 1; i < points.length; i++) if (points[i]![1] !== points[i - 1]![1]) expect(points[i]![0]).toBe(points[i - 1]![0]);
  await expect(page.getByText(bypass)).toBeVisible();
  await expect(page.getByText(previous)).toHaveCount(0);
  await tau.selectOption('1');
  await expect(output).toHaveAttribute('d', path);
  await expect(page.getByText(bypass)).toBeVisible();
  await expect(page.getByText(previous)).toHaveCount(0);
  await page.locator('.pulse-channel-observation').screenshot({ path: info.outputPath('captured-bypass.png') });
  await run.click();
  await expect(page.getByText(memory)).toBeVisible();
  await expect(page.getByText(previous)).toBeVisible();
  await tau.selectOption('0');
  await expect(page.getByText(memory)).toBeVisible();
  await expect(page.getByText(previous)).toBeVisible();
  await saveNoiseEvidence(info, 'bypass-path', { lang, points, path });
});
