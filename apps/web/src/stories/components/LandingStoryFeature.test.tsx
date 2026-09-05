import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import type { StoryRegistryEntry } from '../types';
import { LandingStoryFeature } from './LandingStoryFeature';

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

function renderFeature(entries: readonly StoryRegistryEntry[]) {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <LandingStoryFeature entries={entries} />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('LandingStoryFeature', () => {
  it('shows exactly the featured published edition without loading its module', () => {
    const featured = makeEntry();
    const other = makeEntry({ slug: 'two', issueNumber: 2, featured: false, title: { vi: 'Số hai', en: 'Issue two' } });

    renderFeature([other, featured]);

    const section = screen.getByRole('region', { name: 'Đặc san' });
    expect(within(section).getByRole('link', { name: 'Xem tất cả các số' })).toHaveAttribute('href', '/stories');
    expect(within(section).getByRole('link', { name: 'Số một' })).toHaveAttribute('href', '/stories/one');
    expect(within(section).getByRole('link', { name: 'Mở đặc san' })).toHaveAttribute('href', '/stories/one');
    expect(within(section).getByText('Số 01 · Bài kể tương tác')).toBeInTheDocument();
    expect(within(section).getByText('4 cảnh')).toBeInTheDocument();
    expect(within(section).queryByText('Số hai')).not.toBeInTheDocument();
    expect(featured.load).not.toHaveBeenCalled();
    expect(other.load).not.toHaveBeenCalled();
  });

  it('renders neither a card nor a placeholder without a featured edition', () => {
    renderFeature([]);

    expect(screen.queryByRole('region', { name: 'Đặc san' })).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it('features issue two after future publication without changing today’s registry flags', () => {
    const issueOne = makeEntry({ slug: 'a-history-of-ai', issueNumber: 1, featured: false });
    const issueTwo = makeEntry({ slug: 'across-the-noise', issueNumber: 2, featured: true, title: { vi: 'Số hai', en: 'Issue two' } });

    renderFeature([issueOne, issueTwo]);

    expect(screen.getByRole('link', { name: 'Số hai' })).toHaveAttribute('href', '/stories/across-the-noise');
    expect(screen.queryByText('Số một')).not.toBeInTheDocument();
    expect(screen.getByText('Số 02 · Bài kể tương tác')).toBeInTheDocument();
  });
});
