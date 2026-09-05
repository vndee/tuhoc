import { expect, test, type Page, type Locator } from '@playwright/test';

const ISSUE = '/stories/across-the-noise?preview=1';
test.use({ actionTimeout: 15_000 });
test('Huffman branches descend without crossing a row of unrelated nodes', async ({ page }, info) => {
  await prepare(page, 1440, 'en', 'light', 'reduce');
  const open = page.locator('#scene-08 .story-lab-entry > button');
  await open.scrollIntoViewIfNeeded();
  await expect(page.locator('#scene-08')).toHaveClass(/is-active/);
  await open.click();
  await page.getByRole('button', { name: 'Run experiment', exact: true }).click();
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  const svg = page.locator('svg').filter({ has: page.locator('[data-huffman-node]') });
  await svg.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('huffman-geometry.png') });
  const edges = await svg.locator('line').evaluateAll(lines => lines.map(line => ({
    parentY: Number(line.getAttribute('y1')), childY: Number(line.getAttribute('y2')),
  })));
  expect(edges.length).toBeGreaterThan(0);
  for (const edge of edges) expect(edge.childY - edge.parentY).toBeGreaterThanOrEqual(70);
});
const CHUNKS = /\/(?:MessageBudget|AmbiguousCode|MorseSpacing|CableRoute|PulseChannel|BinaryNoise|SourceEntropy|HuffmanMessage|RepetitionChannel|SecdedInspector|ChannelBudget|MessageMeaning)Lab-[^/]+\.js/;
const backName = /^(Trở lại tranh|Back to illustration)$/;
const runName = /^(Gửi|Send|Đọc tín hiệu|Read signal|Chạy thử|Run experiment|Rút ký hiệu|Draw symbol|Truyền một lần|Run transmission)$/;

test('draft reader consumes the real seeded catalog and offers the honest course collection', async ({ page }) => {
  const catalog = page.waitForResponse(response => response.url() === `${process.env.VITE_API_URL ?? 'http://localhost:8089'}/courses`);
  await page.goto(ISSUE);
  await expect(page.locator('.story-cover h1')).toBeVisible();
  await expect(page.locator('.story-cover h1, .story-act > header h2, .story-scene > h2')).toHaveCount(17);
  for (const title of await page.locator('.story-cover h1, .story-act > header h2, .story-scene > h2').all()) {
    await expect(title).toHaveCSS('font-family', /Charis SIL/);
    await expect(title).toHaveCSS('font-weight', '400');
  }
  const response = await catalog;
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual(expect.arrayContaining([expect.objectContaining({ slug: 'mau-hop-le' })]));
  await expect(page.locator('.story-coda a')).toHaveAttribute('href', '/courses');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByText('Bản nháp để duyệt, chưa xuất bản.')).toBeVisible();
});

test('lab resets preserve the original and clear only their owned receipt or interpretation', async ({ page }) => {
  await prepare(page, 1440, 'en', 'light', 'reduce');
  const enter = async (n: number) => {
    const article = page.locator(`#scene-${String(n).padStart(2, '0')}`);
    const open = article.locator('.story-lab-entry > button');
    await open.scrollIntoViewIfNeeded();
    await expect(article).toHaveClass(/is-active/);
    await open.click();
    await expect(page.locator('.story-stage .story-lab-frame')).toBeVisible();
  };
  const back = () => page.getByRole('button', { name: 'Back to illustration', exact: true }).click();
  await enter(1);
  await page.getByRole('textbox', { name: 'Your message', exact: true }).fill('A');
  await page.getByRole('button', { name: 'Use this message', exact: true }).click();
  await page.getByRole('textbox', { name: 'Shortened draft', exact: true }).fill('B');
  await page.locator('.story-lab-frame-controls button').first().click();
  await expect(page.getByRole('textbox', { name: 'Your message', exact: true })).toHaveValue('A');
  await expect(page.getByRole('textbox', { name: 'Shortened draft', exact: true })).toHaveValue('');
  await back();
  await enter(11);
  await page.getByRole('button', { name: 'Run transmission', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Captured transmission receipt', exact: true })).toBeVisible();
  await back();
  await enter(12);
  await expect(page.getByText('Original text: A', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Changed', exact: true }).check();
  await page.locator('.story-lab-frame-controls button').first().click();
  await expect(page.getByRole('radio', { name: 'Changed', exact: true })).not.toBeChecked();
  await expect(page.getByText('Original text: A', { exact: true })).toBeVisible();
  await back();
  await enter(11);
  await page.getByRole('button', { name: 'Compare 200 trials', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Completed 200-trial comparison', exact: true })).toBeVisible();
  await page.locator('.story-lab-frame-controls button').first().click();
  await expect(page.getByRole('region', { name: 'Captured transmission receipt', exact: true })).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Completed 200-trial comparison', exact: true })).toHaveCount(0);
  await back();
  await enter(12);
  await expect(page.getByText('Original text: A', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No current delivery evidence', { exact: true }).first()).toBeVisible();
});

async function prepare(page: Page, width: number, lang: string, theme: string, motion: 'reduce' | 'no-preference') {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: motion });
  await page.goto(ISSUE);
  if (lang === 'en') {
    await page.getByRole('button', { name: 'Ngôn ngữ giao diện' }).click();
    await page.getByRole('menuitemradio', { name: /English/ }).click();
  }
  if (theme === 'dark') await page.locator('.story-theme-toggle').click();
}

async function checkSurface(page: Page, surface: Locator, width: number) {
  await expect(surface).toBeVisible();
  await expect(surface.locator('img, figcaption')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await surface.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  if (width > 900) {
    await expect(page.locator('.story-stage .story-plate-layer:visible')).toHaveCount(0);
    await expect(page.locator('.story-stage-lab')).toHaveCSS('background-color', await page.locator('.story-renderer').evaluate(el => getComputedStyle(el).backgroundColor));
  } else await expect(page.locator('.story-stage')).toHaveCount(0);
  for (const svg of await surface.locator('svg').all()) {
    const sizes = await svg.locator('text').evaluateAll(elements => elements.map(el => {
      const matrix = (el as SVGGraphicsElement).getScreenCTM()!;
      return parseFloat(getComputedStyle(el).fontSize) * Math.hypot(matrix.a, matrix.b);
    }));
    for (const size of sizes) expect(size, 'diagram text remains readable after scaling').toBeGreaterThanOrEqual(12);
  }
  for (const viewport of await surface.locator('.communication-diagram-viewport').all()) {
    await expect(viewport).toHaveAccessibleName(/.+/);
    await viewport.focus();
    await expect(viewport).toBeFocused();
    if (await viewport.evaluate(el => el.scrollWidth > el.clientWidth)) {
      await viewport.press('ArrowRight');
      await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    }
  }
  const targets = await surface.locator('button, select, textarea, input:not([type="radio"]):not([type="checkbox"])').evaluateAll(elements => elements.filter(el => (el as HTMLElement).offsetParent !== null).map(el => ({ tag: el.tagName, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
  targets.push(...await surface.locator('label:has(input[type="radio"]), label:has(input[type="checkbox"])').evaluateAll(elements => elements.map(el => ({ tag: 'label', width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }))));
  for (const target of targets) {
    expect(target.width, `${target.tag} target width`).toBeGreaterThanOrEqual(44);
    expect(target.height, `${target.tag} target height`).toBeGreaterThanOrEqual(44);
  }
  const contrast = await surface.evaluate(root => {
    const context = document.createElement('canvas').getContext('2d')!;
    const rgb = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(v => {
      const x = v / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    return [...root.querySelectorAll('h3,h4,h5,p,label,button,th,td,svg text')].filter(el => el.textContent?.trim()).map(el => {
      let background: Element | null = el;
      while (background && rgb(getComputedStyle(background).backgroundColor)[3] === 0) background = background.parentElement;
      const css = getComputedStyle(el);
      const ink = rgb(el.tagName === 'text' ? css.fill : css.color);
      const paper = rgb(background ? getComputedStyle(background).backgroundColor : 'white');
      const a = luminance(ink), b = luminance(paper);
      return { tag: el.tagName, foreground: ink.slice(0, 3), background: paper.slice(0, 3), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
  for (const measure of contrast) expect(measure.ratio, JSON.stringify(measure)).toBeGreaterThanOrEqual(4.5);
}

for (const width of [320, 390, 1024, 1440]) for (const lang of ['vi', 'en']) for (const theme of ['light', 'dark']) for (const motion of ['no-preference', 'reduce'] as const) {
  test(`loaded labs ${width} ${lang} ${theme} ${motion}`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await prepare(page, width, lang, theme, motion);
    for (let n = 1; n <= 12; n++) {
      const id = `scene-${String(n).padStart(2, '0')}`;
      const open = page.locator(`#${id} .story-lab-entry > button`);
      await open.scrollIntoViewIfNeeded();
      await expect(page.locator(`#${id}`)).toHaveClass(/is-active/);
      await open.click();
      const surface = page.locator(width > 900 ? '.story-stage-lab' : `#${id} .story-inline-lab`);
      await expect(surface.locator('.story-lab-frame')).toBeVisible();
      const run = surface.getByRole('button', { name: runName });
      if (await run.count()) await run.click();
      if (n === 8) await surface.getByRole('button', { name: /^(Hoàn tất|Complete)$/ }).click();
      await checkSurface(page, surface, width);
      if ([3, 5, 8, 10].includes(n) && lang === 'en' && motion === 'reduce') {
        await surface.locator('.communication-lab-observation').scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`scene-${n}-${width}-${theme}.png`) });
      }
      const back = surface.getByRole('button', { name: backName });
      await back.scrollIntoViewIfNeeded();
      await expect(back).toBeInViewport();
      await back.click();
      await expect(open).toBeFocused();
    }
  });

  // Hold the actual lazy JS response to exercise Suspense, then abort it to
  // exercise the error boundary. Neither the story nor the fallback is mocked.
  test(`fallbacks ${width} ${lang} ${theme} ${motion}`, async ({ page }, info) => {
    test.setTimeout(180_000);
    const releases: Array<() => void> = [];
    let failures = 0;
    page.on('requestfailed', request => { if (CHUNKS.test(request.url())) failures++; });
    await page.route(CHUNKS, async route => {
      await new Promise<void>(resolve => releases.push(resolve));
      await route.abort();
    });
    await prepare(page, width, lang, theme, motion);
    for (let n = 1; n <= 12; n++) {
      const id = `scene-${String(n).padStart(2, '0')}`;
      const open = page.locator(`#${id} .story-lab-entry > button`);
      await open.scrollIntoViewIfNeeded();
      await expect(page.locator(`#${id}`)).toHaveClass(/is-active/);
      await open.click();
      const surface = page.locator(width > 900 ? '.story-stage-lab' : `#${id} .story-inline-lab`);
      await expect(surface.locator('.story-lab-fallback')).toBeVisible();
      await expect(surface.locator('.story-lab-fallback')).toHaveAttribute('aria-busy', 'true');
      await expect.poll(() => releases.length).toBeGreaterThan(0);
      await checkSurface(page, surface, width);
      const previous = failures;
      releases.splice(0).forEach(release => release());
      await expect.poll(() => failures).toBeGreaterThan(previous);
      await expect(surface.locator('.story-lab-fallback')).toHaveAttribute('aria-busy', 'false');
      await checkSurface(page, surface, width);
      await surface.getByRole('button', { name: /^(Thử lại|Try again)$/ }).click();
      await expect(surface.locator('.story-lab-fallback')).toBeVisible();
      await expect.poll(() => releases.length).toBeGreaterThan(0);
      releases.splice(0).forEach(release => release());
      await expect(surface.locator('.story-lab-fallback')).toHaveAttribute('aria-busy', 'false');
      if ([4, 5].includes(n) && lang === 'en' && motion === 'reduce') {
        await surface.locator('svg').scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`fallback-${n}-${width}-${theme}.png`) });
      }
      await surface.getByRole('button', { name: backName }).click();
      await expect(open).toBeFocused();
    }
    releases.splice(0).forEach(release => release());
  });
}

test('baseline: dark mobile notebook has readable controls and returns focus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${ISSUE}#scene-01`);
  await page.locator('.story-theme-toggle').click();
  const open = page.locator('#scene-01 .story-lab-entry > button');
  await open.click();
  const lab = page.locator('#scene-01 .story-inline-lab .story-lab-frame');
  await expect(lab).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(lab).toHaveCSS('background-color', 'rgb(21, 37, 44)');
  await lab.getByRole('button', { name: 'Trở lại tranh', exact: true }).click();
  await expect(open).toBeFocused();
});

for (const width of [320, 1440]) for (const lang of ['vi', 'en']) for (const theme of ['light', 'dark']) {
  test(`native reset dialog ${width} ${lang} ${theme}`, async ({ page }, info) => {
    await prepare(page, width, lang, theme, 'reduce');
    const open = page.locator('#scene-01 .story-lab-entry > button');
    await open.scrollIntoViewIfNeeded();
    await expect(page.locator('#scene-01')).toHaveClass(/is-active/);
    await open.click();
    const editor = page.locator('.communication-message-editor');
    await editor.locator('textarea').fill('A private browser experiment');
    await editor.getByRole('button', { name: /^(Dùng câu này|Use this message)$/ }).click();
    const trigger = editor.getByRole('button', { name: /^(Bắt đầu lại lượt đọc|Start a new experiment)$/ });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(el => el.matches(':modal'))).toBe(true);
    const cancel = dialog.getByRole('button', { name: /^(Huỷ|Cancel)$/ });
    const confirm = dialog.getByRole('button', { name: /^(Bắt đầu lại|Start again)$/ });
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirm).toBeFocused();
    await page.locator('.story-theme-toggle').evaluate((el: HTMLElement) => el.focus());
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    const outside = await page.locator('.story-theme-toggle').boundingBox();
    await page.mouse.click(outside!.x + outside!.width / 2, outside!.y + outside!.height / 2);
    expect(await dialog.evaluate(el => el.matches(':modal'))).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: info.outputPath('native-reset.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(editor.locator('textarea')).toHaveValue('A private browser experiment');
    await trigger.click();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(editor.locator('textarea')).toHaveValue(lang === 'vi' ? 'Mình đã đến nơi. Mọi chuyện vẫn ổn.' : 'I have arrived. Everything is all right.');
    await page.locator('.story-theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'light' ? 'dark' : 'light');
    await trigger.click();
    await page.evaluate(() => { history.pushState(null, '', '/stories'); dispatchEvent(new PopStateEvent('popstate')); });
    await expect(page.locator('.story-index')).toBeVisible();
    expect(await page.locator('dialog:modal').count()).toBe(0);
    await page.locator('.story-theme-toggle').focus();
    await expect(page.locator('.story-theme-toggle')).toBeFocused();
  });
}

for (const width of [320, 390, 1024, 1440]) {
  test(`cover title avoids a one-word orphan at ${width}`, async ({ page }, info) => {
    await prepare(page, width, 'vi', 'light', 'reduce');
    const title = page.locator('.story-cover h1');
    await expect(title).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(title).toHaveCSS('font-family', /Charis SIL/);
    const lines = await title.evaluate(el => {
      const node = el.firstChild!;
      const lines = new Map<number, string[]>();
      for (const match of node.textContent!.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index!);
        range.setEnd(node, match.index! + match[0].length);
        const top = range.getBoundingClientRect().top;
        lines.set(top, [...(lines.get(top) ?? []), match[0]]);
      }
      return [...lines.values()];
    });
    expect(lines.at(-1)!.length).toBeGreaterThanOrEqual(2);
    await title.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('cover-title.png') });
  });
  test(`issue title inherits the landing hand at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const title = page.locator('.bd-story-feature-copy h3');
    for (const text of ['Một lời nói đi qua đại dương', 'Across the Noise']) {
      await title.locator('a').evaluate((el, text) => { el.textContent = text; }, text);
      await page.evaluate(() => document.fonts.ready);
      const style = await title.evaluate(el => {
        const css = getComputedStyle(el);
        return { font: css.fontFamily, size: parseFloat(css.fontSize), wrap: css.textWrap, max: css.maxInlineSize, width: el.clientWidth, scroll: el.scrollWidth };
      });
      expect(style.font).toContain('Shantell');
      expect(style.size).toBeGreaterThanOrEqual(22);
      expect(style.size).toBeLessThanOrEqual(28);
      expect(style.wrap).toBe('wrap');
      expect(style.max).toBe('none');
      expect(style.scroll).toBeLessThanOrEqual(style.width);
    }
  });
}
