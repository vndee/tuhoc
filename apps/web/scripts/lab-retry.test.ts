import { expect, it } from 'vitest';
import { resolveLabRetryUrl } from '../src/stories/labs/retry';

const base = 'https://reader.example/assets/story-labs-build-a.json';
const map = { buildId: 'build-a', entries: { 'message-budget': './MessageBudgetLab-abc.js' } };
it('selects only the requested first-party entry and adds a content-free retry token', () => {
  expect(resolveLabRetryUrl(map, 'message-budget', 'build-a', base, 2)).toBe('https://reader.example/assets/MessageBudgetLab-abc.js?lab-retry=2');
});
it.each([
  null, {}, { ...map, buildId: 'build-b' }, { ...map, entries: null },
  { ...map, entries: {} },
  ...['https://evil.example/lab.js', '//evil.example/lab.js', 'javascript:alert(1)', 'data:text/javascript,export default 1', '../secret.js', './lab.js?payload=1', './lab.js#payload', './lab.css', './%2e%2e/secret.js'].map(url => ({ ...map, entries: { 'message-budget': url } })),
])('rejects missing, mismatched and unsafe compiled maps with a content-free code: %j', value => {
  expect(() => resolveLabRetryUrl(value, 'message-budget', 'build-a', base, 1)).toThrow('lab-retry-unavailable');
});
