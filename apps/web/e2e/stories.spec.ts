import { expect, test, type Page } from '@playwright/test';

const ISSUE_PATH = '/stories/a-history-of-ai';
const LAB_CHUNKS = [
  'ExternalMemoryLab', 'EmbodiedCalculationLab', 'ExecutableRulesLab',
  'ComputationLimitsLab', 'JudgmentCriteriaLab', 'LinearSeparatorLab',
  'KnowledgeBottleneckLab', 'GradientDescentLab', 'ConvolutionLab',
  'AttentionLab', 'AgentTraceLab', 'AgiDefinitionsLab',
];

test.use({ viewport: { width: 1440, height: 1000 } });

async function observeWebVitals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { cls: 0, lcp: null as null | { insideCover: boolean } };
    Object.defineProperty(window, '__storyVitals', { value: state, configurable: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntry[]) {
        const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!shift.hadRecentInput) state.cls += shift.value ?? 0;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      const entries = list.getEntries() as Array<PerformanceEntry & { element?: Element }>;
      const latest = entries.at(-1);
      if (latest) state.lcp = { insideCover: Boolean(latest.element?.closest('[data-testid="story-cover"]')) };
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
}

test('landing discovers the published edition after courses and opens it publicly', async ({ page }) => {
  await page.goto('/');
  const followsCatalog = await page.evaluate(() => {
    const catalog = document.getElementById('bd-cat-h');
    const editions = document.getElementById('bd-stories-heading');
    return Boolean(catalog && editions && (catalog.compareDocumentPosition(editions) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(followsCatalog).toBe(true);
  await page.getByRole('link', { name: 'Mở đặc san' }).click();
  await expect(page).toHaveURL(/\/stories\/across-the-noise$/);
  await expect(page.getByRole('heading', { name: 'Một lời nói đi qua đại dương' })).toBeVisible();
});

test('deep link, language, hash, state, and keyboard interaction survive together', async ({ page }) => {
  await page.goto(`${ISSUE_PATH}#scene-06`);
  await expect(page).toHaveURL(/#scene-06$/);
  await page.getByRole('button', { name: 'Tự tay thử' }).nth(5).click();
  await page.getByRole('slider', { name: /góc|angle/i }).press('ArrowRight');
  await page.getByRole('button', { name: 'Ngôn ngữ giao diện' }).click();
  await page.getByRole('menuitemradio', { name: /English/i }).click();
  await expect(page).toHaveURL(/#scene-06$/);
  await expect(page.getByRole('heading', { name: /Dartmouth, symbolic AI/i })).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`editorial theme control follows the header palette at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/stories', ISSUE_PATH]) {
      await page.goto(path);
      await expect(page.locator(path === ISSUE_PATH ? '.story-renderer' : '.story-index')).toBeVisible();
      const toggle = page.locator('.story-theme-toggle');
      const language = page.getByRole('button', { name: 'Ngôn ngữ giao diện' });
      for (const theme of ['light', 'dark']) {
        await page.mouse.move(0, 0);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const ink = await page.locator('.story-shell-header').evaluate((el) => getComputedStyle(el).color);
        await expect(toggle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(toggle).toHaveCSS('border-top-width', '0px');
        await expect(toggle).toHaveCSS('color', ink);
        await expect(language).toHaveCSS('color', ink);
        await expect(toggle.locator('svg')).toHaveCount(1);
        await expect(toggle).toHaveAttribute('aria-pressed', String(theme === 'dark'));
        await language.hover();
        const hoverInk = await language.evaluate((el) => getComputedStyle(el).color);
        await toggle.hover();
        await expect(toggle).toHaveCSS('color', hoverInk);
        await toggle.focus();
        await expect(toggle).toHaveCSS('outline-style', 'solid');
        await toggle.press('Enter');
      }
    }
  });

  test(`featured edition keeps landing typography in both languages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const title = page.locator('.bd-story-feature-copy h3');
    const handFont = await page.locator('#bd-stories-heading').evaluate((el) => getComputedStyle(el).fontFamily);
    for (const language of ['vi', 'en']) {
      for (const theme of ['light', 'dark']) {
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(title).toHaveCSS('font-family', handFont);
        const titleSize = await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(titleSize).toBeGreaterThanOrEqual(22);
        expect(titleSize).toBeLessThanOrEqual(28);
        await title.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
        await page.locator('.bd-chrome-btn').click();
      }
      if (language === 'vi') {
        await page.getByRole('button', { name: 'Ngôn ngữ giao diện' }).click();
        await page.getByRole('menuitemradio', { name: /English/i }).click();
      }
    }
  });

  test(`theme toggle changes the actual reading and lab surfaces at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(ISSUE_PATH);
    const renderer = page.locator('.story-renderer');
    const lightPaper = await renderer.evaluate((el) => getComputedStyle(el).backgroundColor);
    const lightInk = await renderer.evaluate((el) => getComputedStyle(el).color);
    await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click();
    await expect(renderer).not.toHaveCSS('background-color', lightPaper);
    await expect(renderer).not.toHaveCSS('color', lightInk);
    await expect(page.locator('.story-shell-theme-scope')).toHaveCSS('color-scheme', 'dark');
    const darkPaper = await renderer.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.reload();
    await expect(renderer).toHaveCSS('background-color', darkPaper);
    await page.getByRole('button', { name: 'Tự tay thử' }).first().click();
    await expect(page.locator('.story-lab-frame')).toHaveCSS('background-color', darkPaper);
    await page.getByRole('button', { name: 'Chuyển sang giao diện sáng' }).click();
    await expect(renderer).toHaveCSS('background-color', lightPaper);
    await expect(renderer).toHaveCSS('color', lightInk);
  });
}

test('featured title fills the available line before wrapping', async ({ page }) => {
  await page.goto('/');
  const title = page.locator('.bd-story-feature-copy h3');
  await title.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  // Keep the original wrapping regression fixture independent of the featured issue.
  await title.locator('a').evaluate(el => { el.textContent = 'Một lịch sử của trí tuệ nhân tạo'; });
  const lines = await title.locator('a').evaluate((el) => {
    const text = el.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    const firstWordTop = range.getBoundingClientRect().top;
    const nextWord = text.textContent!.indexOf('trí');
    range.setStart(text, nextWord);
    range.setEnd(text, nextWord + 3);
    return { firstWordTop, nextWordTop: range.getBoundingClientRect().top };
  });
  // At this desktop width, “trí” still fits after “Một lịch sử của”.
  // Balanced wrapping used to move it down despite the remaining space.
  expect(lines.nextWordTop).toBeCloseTo(lines.firstWordTop, 0);
});

for (const width of [320, 768, 1024, 1440]) {
  test(`long featured edition titles wrap without clipping at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const title = page.locator('.bd-story-feature-copy h3');
    // Stress the real landing layout with future editorial titles, without
    // changing the published story's content or replacing its components.
    for (const text of [
      'Một lịch sử của trí tuệ nhân tạo: từ những công cụ ghi nhớ đầu tiên đến các cỗ máy biết học và một tương lai chưa được định nghĩa',
      'A history of artificial intelligence: the people, ideas, and machines that changed how we learn, reason, and imagine the future',
      'MachineLearningAndArtificialIntelligenceAcrossGenerationsWithoutASingleSharedDefinition',
    ]) {
      await title.locator('a').evaluate((el, value) => { el.textContent = value; }, text);
      await title.scrollIntoViewIfNeeded();
      const layout = await title.evaluate((el) => {
        const style = getComputedStyle(el);
        const range = document.createRange();
        range.selectNodeContents(el);
        const bounds = el.getBoundingClientRect();
        return {
          size: parseFloat(style.fontSize),
          leading: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
          fits: Array.from(range.getClientRects()).every((rect) => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1),
          clipped: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight + 1,
        };
      });
      expect(layout.size).toBeLessThanOrEqual(28);
      expect(layout.leading).toBeGreaterThanOrEqual(1.2);
      expect(layout.fits).toBe(true);
      expect(layout.clipped).toBe(false);
      const titleBounds = await title.boundingBox();
      const deckBounds = await page.locator('.bd-story-feature-deck').boundingBox();
      expect(deckBounds!.y).toBeGreaterThanOrEqual(titleBounds!.y + titleBounds!.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
    }
  });
}

test('cover and desktop plate captions stay visible and localized as the active scene changes', async ({ page }) => {
  await page.goto(`${ISSUE_PATH}#scene-01`);
  const cover = page.getByTestId('story-cover');
  const stage = page.getByTestId('story-stage');
  await expect(cover.getByText('Minh hoạ: những vật liệu khác nhau giữ và truyền câu hỏi của con người, không dẫn tới một đích tất yếu.')).toBeVisible();
  await expect(stage.getByText('Minh hoạ: dấu ấn vật chất tồn tại khác với ký ức được truyền miệng.')).toBeVisible();

  await page.getByRole('link', { name: /Cảnh 02:/ }).click();
  await expect(stage).toHaveAttribute('data-active-scene', 'scene-02');
  await expect(stage.getByText('Minh hoạ: trạng thái số đi qua cả người vận hành lẫn cơ cấu tính toán.')).toBeVisible();

  await page.getByRole('button', { name: 'Ngôn ngữ giao diện' }).click();
  await page.getByRole('menuitemradio', { name: /English/i }).click();
  await expect(cover.getByText('Illustration: different materials carry human questions without leading to an inevitable destination.')).toBeVisible();
  await expect(stage.getByText('Illustration: numerical state passes through both operator and calculating mechanism.')).toBeVisible();
});

for (const theme of ['light', 'dark']) {
  test(`desktop labs replace the illustration and restore it on return in ${theme} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${ISSUE_PATH}#scene-03`);
    if (theme === 'dark') await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click();
    const stage = page.getByTestId('story-stage');
    const plate = stage.locator('.story-plate-layer.is-active');
    const lab = stage.locator('.story-stage-lab');
    await expect(stage).toHaveAttribute('data-active-scene', 'scene-03');
    await expect(plate).toBeVisible();
    await page.getByRole('button', { name: 'Tự tay thử' }).nth(2).click();
    await expect(lab.getByRole('heading', { name: 'Máy giấy và thẻ lệnh' })).toBeInViewport();
    await expect(plate).toBeHidden();
    await expect(plate).toHaveAttribute('aria-hidden', 'true');
    await expect(stage.locator('.story-plate-caption:visible')).toHaveCount(0);
    await expect(lab).toHaveCSS('background-color', await page.locator('.story-renderer').evaluate((el) => getComputedStyle(el).backgroundColor));
    const bounds = await stage.boundingBox();
    const labBounds = await lab.boundingBox();
    expect(labBounds).toEqual(bounds);

    await lab.getByRole('button', { name: 'Đưa Thẻ quy tắc 1 xuống' }).click();
    await expect(lab.getByRole('status')).toContainText('14');
    await lab.getByRole('button', { name: 'Trở lại tranh' }).click();
    await expect(plate).toBeVisible();
    await expect(plate.locator('figcaption')).toBeVisible();
    await page.getByRole('button', { name: 'Tự tay thử' }).nth(2).click();
    await expect(lab.getByRole('status')).toContainText('14');

    // A longer lab must remain scrollable without moving to another scene.
    await page.getByRole('link', { name: /Cảnh 12:/ }).click();
    await expect(stage).not.toHaveAttribute('data-lab-scene');
    await expect(plate).toBeVisible();
    await page.getByRole('button', { name: 'Tự tay thử' }).nth(11).click();
    await expect(lab.locator('.story-lab-frame')).toBeVisible();
    await expect(lab.locator('h3')).toBeInViewport();
    await expect(plate).toBeHidden();
    expect(await lab.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const back = lab.getByRole('button', { name: 'Trở lại tranh' });
    await back.scrollIntoViewIfNeeded();
    await expect(back).toBeInViewport();
    await expect(stage).toHaveAttribute('data-lab-scene', 'scene-12');
    await back.click();
    await expect(plate).toBeVisible();
    await expect(plate.locator('figcaption')).toBeVisible();
  });
}

test('public recovery, collection, sources, and a local image failure keep the narrative readable', async ({ page }) => {
  await page.goto('/stories/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Không tìm thấy số đặc san' })).toBeVisible();
  await page.goto('/stories');
  await expect(page.getByRole('heading', { name: 'Các số đặc san' })).toBeVisible();
  const aiEdition = page.getByRole('article').filter({
    has: page.getByRole('link', { name: 'Một lịch sử của trí tuệ nhân tạo', exact: true }),
  });
  await expect(aiEdition).toHaveCount(1);
  const openAiEdition = aiEdition.getByRole('link', { name: 'Mở đặc san', exact: true });
  await expect(openAiEdition).toBeVisible();
  await expect(openAiEdition).toHaveAttribute('href', ISSUE_PATH);

  await page.route(/scene-01-clay-memory.*\.webp/, (route) => route.request().resourceType() === 'image' ? route.abort() : route.continue());
  await page.goto(`${ISSUE_PATH}#scene-01`);
  await expect(page.getByText('Minh hoạ không tải được')).toBeVisible();
  await page.getByRole('button', { name: 'Tự tay thử' }).first().click();
  await expect(page.getByText('Minh hoạ không tải được')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Trí nhớ ngoài cơ thể' })).toBeVisible();
  await page.getByRole('button', { name: 'Trở lại tranh' }).click();
  await expect(page.getByText('Minh hoạ không tải được')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dấu vết và trí nhớ chung' })).toBeVisible();
  await page.getByText('Nguồn cho cảnh này').first().click();
  await expect(page.getByRole('link', { name: 'The Origins of Writing' }).first()).toBeVisible();
});

test('initial production requests defer labs and later plates until the reader asks for them', async ({ page }) => {
  const requestedScripts: string[] = [];
  const requestedImages: string[] = [];
  page.on('response', (response) => {
    const type = response.request().resourceType();
    if (type === 'script') requestedScripts.push(response.url());
    if (type === 'image') requestedImages.push(response.url());
  });

  await page.goto(ISSUE_PATH);
  await expect(page.getByRole('heading', { name: 'Một lịch sử của trí tuệ nhân tạo' })).toBeVisible();
  await expect.poll(() => requestedImages.some((url) => /scene-02/.test(url))).toBe(true);
  expect(requestedScripts.some((url) => LAB_CHUNKS.some((name) => url.includes(name)))).toBe(false);
  const storyImages = requestedImages.filter((url) => /(?:cover|scene-\d{2})/.test(url));
  const initialStoryAssets = storyImages.map((url) => {
    if (/cover/.test(url)) return 'cover';
    return url.match(/scene-\d{2}/)?.[0];
  }).sort();
  expect(initialStoryAssets).toEqual(['cover', 'scene-01', 'scene-02']);

  await page.getByRole('button', { name: 'Tự tay thử' }).first().click();
  await expect(page.getByRole('heading', { name: 'Trí nhớ ngoài cơ thể' })).toBeVisible();
  await expect.poll(() => requestedScripts.filter((url) => url.includes('ExternalMemoryLab')).length).toBe(1);
  expect(requestedScripts.some((url) => LAB_CHUNKS.filter((name) => name !== 'ExternalMemoryLab').some((name) => url.includes(name)))).toBe(false);
});

test('cover is stable enough for the public performance budget', async ({ page }) => {
  await observeWebVitals(page);
  let coverBytes: number | null = null;
  page.on('response', (response) => {
    if (/\/assets\/cover-[^/]+\.webp/.test(response.url())) {
      coverBytes = Number(response.headers()['content-length'] ?? 0) || null;
    }
  });
  await page.goto(ISSUE_PATH);
  const cover = page.getByTestId('story-cover');
  await expect(cover).toBeVisible();
  await expect(cover.getByRole('img')).toHaveAttribute('width', '1536');
  await expect(cover.getByRole('img')).toHaveAttribute('height', '1024');
  await expect.poll(() => coverBytes).not.toBeNull();
  expect(coverBytes).toBeLessThanOrEqual(250_000);
  const vitals = await page.evaluate(() => (window as unknown as Window & { __storyVitals: { cls: number; lcp: null | { insideCover: boolean } } }).__storyVitals);
  expect(vitals.cls).toBeLessThanOrEqual(0.1);
  // Headless Chromium sometimes exposes no LCP candidate; intrinsic dimensions
  // and the response-byte budget above remain mandatory in that environment.
  if (vitals.lcp) expect(vitals.lcp.insideCover).toBe(true);
  else expect(vitals.lcp).toBeNull();
});

test('mobile remains inline, ordered, navigable, and free of horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ISSUE_PATH);
  await expect(page.getByRole('heading', { name: 'Một lịch sử của trí tuệ nhân tạo' })).toBeVisible();
  await expect(page.getByTestId('story-stage')).toHaveCount(0);
  await expect(page.locator('.story-scene > h2')).toHaveCount(12);
  const headings = await page.locator('.story-scene > h2').allTextContents();
  expect(headings).toHaveLength(12);
  expect(headings[0]).toBe('Dấu vết và trí nhớ chung');
  expect(headings[11]).toBe('AGI: định nghĩa, quyền lực và chân trời');
  await expect(page.getByTestId('story-inline-illustration')).toHaveCount(12);
  await expect(page.getByRole('button', { name: 'Tự tay thử' })).toHaveCount(12);
  await page.getByRole('button', { name: 'Mục lục' }).click();
  await page.getByRole('region', { name: 'Mục lục' }).getByRole('link', { name: /Cảnh 12:/ }).click();
  await expect(page).toHaveURL(/#scene-12$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
});

test('motion, sticky stage, and controlled visual states remain intentional', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${ISSUE_PATH}#scene-01`);
  const stage = page.getByTestId('story-stage');
  await expect(stage).toHaveAttribute('data-active-scene', 'scene-01');
  await expect(stage).toHaveCSS('--story-crossfade-ms', '0ms');
  await expect(page.getByTestId('story-cover')).toHaveScreenshot('story-cover-light.png', { animations: 'disabled' });
  await expect(stage).toHaveScreenshot('story-scene-01-reduced-motion.png', { animations: 'disabled' });
  await page.getByRole('link', { name: /Cảnh 02:/ }).click();
  await expect(stage).toHaveAttribute('data-active-scene', 'scene-02');
  await expect(stage).toHaveCSS('--story-crossfade-ms', '0ms');
  await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click();
  await page.getByRole('link', { name: /Cảnh 12:/ }).click();
  await expect(stage).toHaveScreenshot('story-scene-12-dark.png', { animations: 'disabled' });

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route(/scene-02-abacus-gears.*\.webp/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'cache-control': 'no-store' } });
  });
  await page.goto(`${ISSUE_PATH}#scene-01`);
  await expect(stage).toHaveAttribute('data-active-scene', 'scene-01');
  await expect(stage).toHaveCSS('--story-crossfade-ms', '360ms');
  await expect(stage).toHaveCSS('position', 'sticky');
  await page.getByRole('link', { name: /Cảnh 02:/ }).click();
  await expect(stage).toHaveAttribute('data-active-scene', 'scene-02');
  await expect(stage).toHaveCSS('--story-crossfade-ms', '360ms');
});

test('the public issue produces no page or console errors', async ({ page }) => {
  const failures: string[] = [];
  // App.tsx mounts `useMe()` on every route. The focused static preview has
  // no API, so answer only that known request with a scoped test session instead
  // of suppressing a browser error that could also hide a failed story asset.
  await page.route('**/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: 'story-gate', email: 'story-gate@example.test', name: 'Story gate' }),
  }));
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    failures.push(message.text());
  });
  await page.goto(ISSUE_PATH);
  await expect(page.getByRole('heading', { name: 'Một lịch sử của trí tuệ nhân tạo' })).toBeVisible();
  await page.getByRole('button', { name: 'Tự tay thử' }).first().click();
  await expect(page.getByRole('heading', { name: 'Trí nhớ ngoài cơ thể' })).toBeVisible();
  expect(failures).toEqual([]);
});
