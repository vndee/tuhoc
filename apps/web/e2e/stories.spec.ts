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
  await expect(page).toHaveURL(/\/stories\/a-history-of-ai$/);
  await expect(page.getByRole('heading', { name: 'Một lịch sử của trí tuệ nhân tạo' })).toBeVisible();
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

test('public recovery, collection, sources, and a local image failure keep the narrative readable', async ({ page }) => {
  await page.goto('/stories/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Không tìm thấy số đặc san' })).toBeVisible();
  await page.goto('/stories');
  await expect(page.getByRole('heading', { name: 'Các số đặc san' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mở đặc san' })).toBeVisible();

  await page.route(/scene-01-clay-memory.*\.webp/, (route) => route.abort());
  await page.goto(ISSUE_PATH);
  await page.getByRole('button', { name: 'Tự tay thử' }).first().click();
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
