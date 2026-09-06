// @vitest-environment node
import { expect, it } from 'vitest';
import { checkNativeTools } from './export-story-plates.mjs';

it.each(['/usr/bin/sips', '/opt/homebrew/bin/cwebp'])('fails clearly when the required native tool %s is unavailable', async missing => {
  await expect(checkNativeTools(async (file: string) => {
    if (file === missing) throw new Error('ENOENT');
  })).rejects.toThrow(`Required native artwork tool is unavailable or not executable: ${missing}`);
});
