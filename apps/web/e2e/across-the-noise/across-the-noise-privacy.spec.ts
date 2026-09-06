import { expect, test } from '@playwright/test';
import { backToPlate, commitNoiseMessage, enterNoiseLab, ISSUE, prepareNoise, saveNoiseEvidence } from './noise-helpers';

const sentinel = 'PRIVATE-NOISE-20260905-ắ-👨‍👩‍👧‍👦';

// Detect text, URL/JSON strings and UTF8 payloads serialized as numeric arrays
// or typed-array objects. Request bodies are also captured as raw bytes.
function assertNoPayload(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const bytes = [...new TextEncoder().encode(sentinel)];
  for (const token of [sentinel, encodeURIComponent(sentinel), JSON.stringify(sentinel).slice(1, -1),
    bytes.join(','), bytes.join(', '), Buffer.from(bytes).toString('base64')]) expect(text).not.toContain(token);
  const inspect = (item: unknown) => {
    if (typeof item === 'string') {
      expect(item).not.toContain(sentinel);
      let decoded = item;
      try { decoded = decodeURIComponent(item); } catch { /* not URL encoded */ }
      expect(decoded).not.toContain(sentinel);
    }
    if (item && typeof item === 'object') {
      const values = Object.values(item);
      if (values.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
        expect(new TextDecoder().decode(Uint8Array.from(values))).not.toContain(sentinel);
      }
      values.forEach(inspect);
    }
  };
  inspect(value);
  if (typeof value === 'string') {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { /* non-JSON observation */ }
    inspect(parsed);
  }
}

test('message remains in route memory across every payload lab, errors, language and theme', async ({ page }, info) => {
  test.setTimeout(90_000);
  const observed: string[] = [];
  const consoleValues: Promise<unknown>[] = [];
  const requests: { url: string; method: string }[] = [];
  page.on('request', request => {
    observed.push(request.url(), request.postData() ?? '', request.postDataBuffer()?.toString('utf8') ?? '');
    requests.push({ url: request.url(), method: request.method() });
  });
  page.on('console', message => {
    observed.push(message.text());
    for (const arg of message.args()) consoleValues.push(arg.jsonValue().catch(() => null));
  });
  await prepareNoise(page);
  await enterNoiseLab(page, 6);
  await commitNoiseMessage(page, sentinel);
  await page.getByRole('spinbutton', { name: 'Configured flip probability p', exact: true }).fill('0');
  await page.getByRole('button', { name: 'Run experiment', exact: true }).click();
  // A retained invalid draft exercises a content-free error path.
  await page.getByRole('spinbutton', { name: 'Configured flip probability p', exact: true }).fill('0.123');
  await expect(page.getByRole('alert')).toBeVisible();
  await backToPlate(page);
  for (const n of [8, 9, 11, 12]) {
    await enterNoiseLab(page, n);
    if (n === 8 || n === 9) await page.getByRole('button', { name: 'Run experiment', exact: true }).click();
    if (n === 8) await page.getByRole('button', { name: 'Complete', exact: true }).click();
    if (n === 11) {
      await page.getByRole('spinbutton', { name: 'Configured flip probability p', exact: true }).fill('0');
      await page.getByRole('button', { name: 'Run transmission', exact: true }).click();
    }
    if (n === 12) {
      await expect(page.getByText(`Received text: ${sentinel}`, { exact: true })).toBeVisible();
      await page.getByRole('radio', { name: 'Changed', exact: true }).check();
    }
    await backToPlate(page);
  }
  await page.locator('.story-theme-toggle').click();
  await page.getByRole('button', { name: 'Interface language' }).click();
  await page.getByRole('menuitemradio', { name: /Tiếng Việt/ }).click();
  await enterNoiseLab(page, 12);
  await expect(page.getByText(`Văn bản nhận: ${sentinel}`, { exact: true })).toBeVisible();
  const persisted = await page.evaluate(async () => {
    const databases: unknown[] = [];
    for (const descriptor of await indexedDB.databases()) {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(descriptor.name!); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      for (const name of database.objectStoreNames) {
        const values = await new Promise<unknown[]>((resolve, reject) => {
          const request = database.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        databases.push({ database: descriptor.name, store: name, values });
      }
      database.close();
    }
    const cached: unknown[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) cached.push({ url: request.url, body: await (await cache.match(request))!.text() });
    }
    return { local: { ...localStorage }, session: { ...sessionStorage }, url: location.href, cookie: document.cookie, databases, cached };
  });
  for (const observation of [...observed, ...await Promise.all(consoleValues), persisted]) assertNoPayload(observation);
  // This is the real catalog request, separate from private experiments.
  expect(requests.some(request => request.url.endsWith('/courses') && request.method === 'GET')).toBe(true);
  expect(requests.filter(request => request.method !== 'GET')).toEqual([]);
  await saveNoiseEvidence(info, 'privacy-observations', { requests, persisted, consoleCount: consoleValues.length });
});

test('receipt follows route lifetime and stays exact, stale, or not-run according to actual actions', async ({ page }) => {
  await prepareNoise(page);
  await enterNoiseLab(page, 11);
  await commitNoiseMessage(page, sentinel);
  await page.getByRole('spinbutton', { name: 'Configured flip probability p', exact: true }).fill('0');
  await page.getByRole('button', { name: 'Run transmission', exact: true }).click();
  await backToPlate(page);
  // Hash-only navigation remains in the same route/session.
  await page.evaluate(() => { location.hash = 'scene-12'; });
  await enterNoiseLab(page, 12);
  await expect(page.getByText(`Received text: ${sentinel}`, { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Changed', exact: true }).check();
  await page.locator('.story-theme-toggle').click();
  await backToPlate(page);
  await page.goBack();
  await enterNoiseLab(page, 12);
  await expect(page.getByRole('radio', { name: 'Changed', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Try another message', exact: true }).click();
  await commitNoiseMessage(page, `${sentinel}!`);
  await expect(page.locator('.story-lab-result')).toHaveText(/Receipt for an earlier message revision/);
  await expect(page.getByText(`Received text: ${sentinel}`, { exact: true })).toBeVisible();
  await backToPlate(page);
  await enterNoiseLab(page, 11);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await backToPlate(page);
  await enterNoiseLab(page, 12);
  await expect(page.locator('.story-lab-result')).toHaveText(/No current delivery evidence/);
  await page.evaluate(() => { history.pushState(null, '', '/stories'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('.story-index')).toBeVisible();
  await page.goBack();
  await enterNoiseLab(page, 11);
  await expect(page.getByRole('textbox', { name: 'Your message', exact: true })).toHaveValue('I have arrived. Everything is all right.');
  await commitNoiseMessage(page, sentinel);
  await page.reload();
  await enterNoiseLab(page, 11);
  await expect(page.getByRole('textbox', { name: 'Your message', exact: true })).toHaveValue('I have arrived. Everything is all right.');
});

test('Retry recovers a failed actual lab chunk in place with the existing session intact', async ({ page }, info) => {
  await prepareNoise(page);
  await enterNoiseLab(page, 11);
  await commitNoiseMessage(page, sentinel);
  await page.getByRole('spinbutton', { name: 'Configured flip probability p', exact: true }).fill('0');
  await page.getByRole('button', { name: 'Run transmission', exact: true }).click();
  await backToPlate(page);
  let failures = 0;
  const chunk = /\/MessageBudgetLab-[^/]+\.js(?:\?|$)/;
  await page.route(chunk, route => { failures++; return route.abort(); });
  await page.locator('#scene-01 .story-lab-entry > button').scrollIntoViewIfNeeded();
  await expect(page.locator('#scene-01')).toHaveClass(/is-active/);
  await page.locator('#scene-01 .story-lab-entry > button').click();
  await expect(page.locator('.story-lab-fallback')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.story-lab-fallback table')).toBeVisible();
  expect(failures).toBeGreaterThan(0);
  await page.unroute(chunk);
  const retried = page.waitForResponse(response => chunk.test(response.url()) && response.ok());
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await retried;
  await expect(page.locator('.story-lab-frame')).toBeVisible();
  expect(await page.locator('.story-lab-frame').evaluate(el => el.parentElement === document.activeElement || el.contains(document.activeElement))).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Your message', exact: true })).toHaveValue(sentinel);
  expect(page.url()).toContain(ISSUE);
  await backToPlate(page);
  await enterNoiseLab(page, 1);
  await expect(page.getByRole('textbox', { name: 'Your message', exact: true })).toHaveValue(sentinel);
  await backToPlate(page);
  await enterNoiseLab(page, 12);
  await expect(page.locator('.story-lab-result')).toHaveText(/Exact delivery/);
  await expect(page.getByText(`Received text: ${sentinel}`, { exact: true })).toBeVisible();
  await saveNoiseEvidence(info, 'retry', { failures, recovered: true, reopened: true, receiptRetained: true });
});

test('a failed scene image does not prevent its independent lab opening', async ({ page }) => {
  let failures = 0;
  await page.route(/\/scene-06(?:-768)?-[^/]+\.webp/, route => { failures++; return route.abort(); });
  await prepareNoise(page);
  await enterNoiseLab(page, 6);
  await expect.poll(() => failures).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Run experiment', exact: true }).click();
  await expect(page.locator('.story-lab-result')).not.toBeEmpty();
});
