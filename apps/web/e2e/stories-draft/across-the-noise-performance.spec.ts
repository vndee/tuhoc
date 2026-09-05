import { expect, test } from '@playwright/test';
import { backToPlate, commitNoiseMessage, enterNoiseLab, LAB_CHUNK, prepareNoise, saveNoiseEvidence } from './noise-helpers';

test('landing and collection keep narrative and lab code lazy', async ({ page }, info) => {
  const scripts: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('.bd-story-feature-copy')).toBeVisible();
  await page.goto('/stories');
  await expect(page.locator('.story-index')).toBeVisible();
  expect(scripts.filter(url => LAB_CHUNK.test(url))).toEqual([]);
  expect(scripts.filter(url => /\/(?:story|copy|StoryRenderer|StoryIssueSessionProvider)-/.test(url))).toEqual([]);
  await saveNoiseEvidence(info, 'landing-collection-scripts', scripts);
});

for (const width of [320, 390, 1024, 1440]) test(`draft loads nearby decoded artwork at ${width}, Huffman only on request, and CLS stays within .1`, async ({ page }, info) => {
  const scripts: string[] = [], images: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'script') scripts.push(request.url());
    if (request.resourceType() === 'image') images.push(request.url());
  });
  await page.addInitScript(() => {
    const shifts: number[] = [];
    Object.assign(window, { noiseLayoutShifts: shifts });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) shifts.push(shift.value);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await prepareNoise(page, width);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.story-cover img')).toBeVisible();
  await page.locator('.story-cover img').evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('cover-decode-failed');
  });
  expect(scripts.filter(url => LAB_CHUNK.test(url))).toEqual([]);
  const initialScenes = [...new Set(images.filter(url => /\/scene-\d\d/.test(url)))];
  expect(initialScenes.length).toBeLessThanOrEqual(3);
  expect(initialScenes.some(url => /scene-(?:0[4-9]|1[0-2])/.test(url))).toBe(false);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('.story-cover-plate').screenshot({ path: info.outputPath('cover-light.png') });
  await page.locator('.story-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.story-cover-plate').screenshot({ path: info.outputPath('cover-dark.png') });
  await enterNoiseLab(page, 6);
  expect(scripts.some(url => /BinaryNoiseLab-/.test(url))).toBe(true);
  expect(scripts.some(url => /HuffmanMessageLab-|SecdedInspectorLab-/.test(url))).toBe(false);
  await backToPlate(page);
  const huffman = page.waitForRequest(request => /HuffmanMessageLab-/.test(request.url()));
  await enterNoiseLab(page, 8);
  await huffman;
  await page.getByRole('button', { name: 'Run experiment', exact: true }).click();
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await page.screenshot({ path: info.outputPath('lab-dark.png') });
  await page.locator('.story-theme-toggle').click();
  await page.screenshot({ path: info.outputPath('lab-light.png') });
  await backToPlate(page);
  for (let n = 1; n <= 12; n++) {
    await page.locator(`#scene-${String(n).padStart(2, '0')}`).scrollIntoViewIfNeeded();
    await expect(page.locator(`#scene-${String(n).padStart(2, '0')}`)).toHaveClass(/is-active/);
    const currentImage = page.locator(width > 900 ? '.story-stage img:visible' : `#scene-${String(n).padStart(2, '0')} .story-inline-illustration img`);
    await expect(currentImage).toHaveCount(1);
    await currentImage.evaluateAll(async images => {
      await Promise.all(images.map(async image => {
        await (image as HTMLImageElement).decode();
        if (!(image as HTMLImageElement).naturalWidth) throw new Error('scene-decode-failed');
      }));
    });
  }
  await enterNoiseLab(page, 12);
  await expect(page.locator('.story-lab-result')).toHaveText(/No current delivery evidence/);
  await page.screenshot({ path: info.outputPath('final-light.png') });
  await page.locator('.story-theme-toggle').click();
  await page.screenshot({ path: info.outputPath('final-dark.png') });
  const shifts = await page.evaluate(() => (window as unknown as { noiseLayoutShifts: number[] }).noiseLayoutShifts);
  const cls = shifts.reduce((sum, shift) => sum + shift, 0);
  expect(cls).toBeLessThanOrEqual(.1);
  await saveNoiseEvidence(info, 'loading-and-cls', { width, scripts, initialScenes, images, shifts, cls });
});

for (const [phase, minimum] of [['raw', 0], ['repeat3', 200], ['secded', 400]] as const) test(`maximum valid 1024-byte comparison yields to native Cancel during ${phase} and retains the final receipt`, async ({ page }, info) => {
  test.setTimeout(120_000);
  await prepareNoise(page);
  await enterNoiseLab(page, 11);
  const message = 'é' + '\u0301'.repeat(511);
  await commitNoiseMessage(page, message);
  await expect(page.locator('.communication-message-editor')).toContainText('1 / 120 grapheme clusters');
  await expect(page.locator('.communication-message-editor')).toContainText('1,024 / 1,024 UTF-8 bytes');
  await page.getByRole('spinbutton', { name: 'Transmission budget in channel uses', exact: true }).fill('32768');
  await page.getByRole('spinbutton', { name: 'Configured flip probability p', exact: true }).fill('0');
  await page.getByRole('button', { name: 'Run transmission', exact: true }).click();
  const receipt = await page.getByRole('region', { name: 'Captured transmission receipt', exact: true }).textContent();
  await backToPlate(page);
  for (const n of [1, 6, 12, 11]) await page.locator(`#scene-${String(n).padStart(2, '0')}`).scrollIntoViewIfNeeded();
  await enterNoiseLab(page, 11);
  await expect(page.getByRole('status', { name: 'Comparison progress', exact: true })).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Completed 200-trial comparison', exact: true })).toHaveCount(0);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const started = Date.now();
  await page.getByRole('button', { name: 'Compare 200 trials', exact: true }).click();
  const progress = page.getByRole('status', { name: 'Comparison progress', exact: true });
  await expect(progress).toHaveText(/\d+ \/ 600/);
  await expect.poll(async () => Number((await progress.textContent())?.match(/(\d+) \/ 600/)?.[1] ?? 0), { timeout: 90_000, intervals: [30] }).toBeGreaterThan(minimum);
  await page.getByRole('button', { name: 'Cancel comparison', exact: true }).click();
  await expect(progress).toHaveText(/Incomplete: \d+ \/ 600/);
  const text = (await progress.textContent())!;
  const completed = Number(text.match(/(\d+) \/ 600/)![1]);
  expect(completed).toBeGreaterThan(minimum);
  expect(completed).toBeLessThan(minimum + 200);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  expect(await page.getByRole('region', { name: 'Captured transmission receipt', exact: true }).textContent()).toBe(receipt);
  await backToPlate(page);
  await enterNoiseLab(page, 12);
  await expect(page.locator('.story-lab-result')).toHaveText(/Exact delivery/);
  await expect(page.getByText(`Received text: ${message}`, { exact: true })).toBeVisible();
  await backToPlate(page);
  await enterNoiseLab(page, 11);
  await expect(page.getByRole('table', { name: 'Completed 200-trial comparison', exact: true })).toHaveCount(0);
  expect(await page.getByRole('region', { name: 'Captured transmission receipt', exact: true }).textContent()).toBe(receipt);
  await saveNoiseEvidence(info, 'maximum-payload-cancel', { phase, bytes: 1024, graphemes: 1, cpuSlowdown: 6, completed, total: 600, elapsedMs: Date.now() - started, receiptRetained: true });
});
