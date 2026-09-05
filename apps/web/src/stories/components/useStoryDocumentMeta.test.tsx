import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Lang } from '../../i18n';
import { historyOfAiMeta } from '../content/a-history-of-ai/meta';
import { useStoryDocumentMeta } from './useStoryDocumentMeta';

function MetaHarness({ lang }: { lang: Lang }) {
  useStoryDocumentMeta({
    title: lang === 'vi'
      ? 'Một lịch sử của trí tuệ nhân tạo · Đặc san · Tự học'
      : 'A History of Artificial Intelligence · Special Editions · Tự học',
    description: historyOfAiMeta.deck[lang],
    canonicalPath: '/stories/a-history-of-ai',
    lang,
  });
  return null;
}

describe('useStoryDocumentMeta', () => {
  it('sets and updates title, description, canonical, and html lang without duplicating head nodes', () => {
    const { rerender, unmount } = render(<MetaHarness lang="vi" />);
    expect(document.title).toBe('Một lịch sử của trí tuệ nhân tạo · Đặc san · Tự học');
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', historyOfAiMeta.deck.vi);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', `${location.origin}/stories/a-history-of-ai`);

    rerender(<MetaHarness lang="en" />);
    expect(document.title).toBe('A History of Artificial Intelligence · Special Editions · Tự học');
    expect(document.documentElement).toHaveAttribute('lang', 'en');
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    unmount();
  });

  it('restores an adopted head element instead of removing someone else’s metadata', () => {
    const description = document.createElement('meta');
    description.name = 'description';
    description.content = 'Existing description';
    document.head.append(description);
    const { unmount } = render(<MetaHarness lang="vi" />);
    unmount();
    expect(description).toHaveAttribute('content', 'Existing description');
    description.remove();
  });
});
