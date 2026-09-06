import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import type { StoryRegistryEntry } from '../types';
import { StoryIndex } from './StoryIndex';
import { storyRegistry } from '../content/registry';

function makeEntry(overrides: Partial<StoryRegistryEntry> = {}): StoryRegistryEntry {
  return {
    slug: 'one',
    issueNumber: 1,
    published: true,
    featured: true,
    title: { vi: 'Số một', en: 'Issue one' },
    deck: { vi: 'Một câu chuyện để thử', en: 'A story to try' },
    cover: {
      src: '/one.webp',
      srcSet: '/one.webp 1200w',
      sizes: '100vw',
      width: 1200,
      height: 800,
      bytes: 120_000,
      alt: { vi: 'Bìa số một', en: 'Issue one cover' },
      caption: { vi: 'Chú thích số một', en: 'Issue one caption' },
      provenanceId: 'one-cover',
    },
    sceneCount: 4,
    labCount: 4,
    load: vi.fn(),
    ...overrides,
  };
}

function renderIndex(entries: readonly StoryRegistryEntry[]) {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <StoryIndex entries={entries} />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('StoryIndex', () => {
  it('renders the published production metadata without loading the edition', () => {
    const load = vi.spyOn(storyRegistry[0], 'load');
    renderIndex(storyRegistry);
    expect(screen.getByRole('link', { name: 'Một lịch sử của trí tuệ nhân tạo' })).toHaveAttribute('href', '/stories/a-history-of-ai');
    expect(within(screen.getAllByRole('article')[0]).getByRole('link', { name: 'Một lời nói đi qua đại dương' })).toHaveAttribute('href', '/stories/across-the-noise');
    expect(load).not.toHaveBeenCalled();
    load.mockRestore();
  });

  it('shows only published edition metadata and never loads story content', () => {
    const published = makeEntry();
    const draft = makeEntry({ slug: 'draft', published: false, title: { vi: 'Bản nháp', en: 'Draft' } });

    renderIndex([draft, published]);

    expect(screen.getByRole('heading', { level: 1, name: 'Các số đặc san' })).toBeInTheDocument();
    const edition = screen.getByRole('article');
    expect(within(edition).getByRole('img', { name: 'Bìa số một' })).toBeInTheDocument();
    expect(within(edition).getByRole('link', { name: 'Số một' })).toHaveAttribute('href', '/stories/one');
    expect(within(edition).getByText('Một câu chuyện để thử')).toBeInTheDocument();
    expect(within(edition).getByText('Số 01 · Bài kể tương tác')).toBeInTheDocument();
    expect(within(edition).getByText('4 cảnh')).toBeInTheDocument();
    expect(within(edition).getByRole('link', { name: 'Mở đặc san' })).toHaveAttribute('href', '/stories/one');
    expect(screen.queryByText('Bản nháp')).not.toBeInTheDocument();
    expect(published.load).not.toHaveBeenCalled();
    expect(draft.load).not.toHaveBeenCalled();
  });

  it('renders no fake edition before any issue is published', () => {
    renderIndex([]);

    expect(screen.getByRole('heading', { level: 1, name: 'Các số đặc san' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it('uses the shelf layout when at least three editions are published', () => {
    renderIndex([
      makeEntry({ slug: 'one', issueNumber: 1 }),
      makeEntry({ slug: 'two', issueNumber: 2 }),
      makeEntry({ slug: 'three', issueNumber: 3 }),
    ]);

    expect(screen.getByRole('main')).toHaveClass('story-index-many');
  });

  it('orders a future published issue two before issue one with exactly one featured edition', () => {
    const issueOne = makeEntry({ slug: 'a-history-of-ai', issueNumber: 1, featured: false, title: { vi: 'Số một', en: 'Issue one' } });
    const issueTwo = makeEntry({ slug: 'across-the-noise', issueNumber: 2, featured: true, title: { vi: 'Số hai', en: 'Issue two' } });

    renderIndex([issueOne, issueTwo]);

    const editions = screen.getAllByRole('article');
    expect(within(editions[0]).getByRole('link', { name: 'Số hai' })).toHaveAttribute('href', '/stories/across-the-noise');
    expect(within(editions[1]).getByRole('link', { name: 'Số một' })).toHaveAttribute('href', '/stories/a-history-of-ai');
    expect([issueOne, issueTwo].filter((entry) => entry.featured)).toHaveLength(1);
  });
});
