import { expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

export const ISSUE = '/stories/across-the-noise?preview=1';
export const LAB_CHUNK = /\/(?:MessageBudget|AmbiguousCode|MorseSpacing|CableRoute|PulseChannel|BinaryNoise|SourceEntropy|HuffmanMessage|RepetitionChannel|SecdedInspector|ChannelBudget|MessageMeaning)Lab-[^/]+\.js(?:\?|$)/;

export async function prepareNoise(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(ISSUE);
  await page.getByRole('button', { name: 'Ngôn ngữ giao diện' }).click();
  await page.getByRole('menuitemradio', { name: /English/ }).click();
}

export async function enterNoiseLab(page: Page, n: number) {
  const scene = page.locator(`#scene-${String(n).padStart(2, '0')}`);
  const opener = scene.locator('.story-lab-entry > button');
  await opener.scrollIntoViewIfNeeded();
  // The reader intentionally retains a restored deep link through passive
  // layout/scroll restoration. Native scrolling expresses new reader intent.
  await page.mouse.wheel(0, 1);
  await expect(scene).toHaveClass(/is-active/);
  await opener.click();
  await expect(page.locator('.story-lab-frame')).toBeVisible();
}

export async function backToPlate(page: Page) {
  await page.getByRole('button', { name: /^(Back to illustration|Trở lại tranh)$/ }).click();
}

export async function commitNoiseMessage(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Your message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Use this message', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your message', exact: true })).toHaveValue(text);
}

export async function saveNoiseEvidence(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(value, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}
