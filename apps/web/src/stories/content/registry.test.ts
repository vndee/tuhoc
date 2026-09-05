import { describe, expect, it, vi } from 'vitest';
import type { StoryRegistryEntry } from '../types';
import { getFeaturedStory, getPublishedStories, getStoryBySlug, storyRegistry } from './registry';

function makeRegistryEntry(overrides: Partial<StoryRegistryEntry> = {}): StoryRegistryEntry {
  return {
    slug: 'story',
    issueNumber: 1,
    published: true,
    featured: false,
    title: { vi: 'Số thử nghiệm', en: 'Test edition' },
    deck: { vi: 'Bản tóm tắt thử nghiệm', en: 'A test deck' },
    cover: {
      src: '/cover.webp',
      srcSet: '/cover.webp 1200w',
      sizes: '100vw',
      width: 1200,
      height: 800,
      bytes: 120_000,
      alt: { vi: 'Bìa thử nghiệm', en: 'Test cover' },
      caption: { vi: 'Chú thích thử nghiệm', en: 'Test caption' },
      provenanceId: 'cover',
    },
    sceneCount: 3,
    labCount: 3,
    load: vi.fn(),
    ...overrides,
  };
}

describe('story registry selectors', () => {
  it('returns only published metadata without loading story modules', () => {
    const load = vi.fn();
    const published = makeRegistryEntry({ slug: 'one', published: true, featured: true, load });
    const draft = makeRegistryEntry({ slug: 'draft', published: false, featured: false, load: vi.fn() });

    expect(getPublishedStories([draft, published])).toEqual([published]);
    expect(getFeaturedStory([draft, published])).toBe(published);
    expect(getStoryBySlug('draft', [draft, published])).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('sorts published stories by descending issue number', () => {
    const first = makeRegistryEntry({ slug: 'first', issueNumber: 1 });
    const third = makeRegistryEntry({ slug: 'third', issueNumber: 3 });
    const second = makeRegistryEntry({ slug: 'second', issueNumber: 2 });

    expect(getPublishedStories([first, third, second])).toEqual([third, second, first]);
  });

  it('rejects multiple published featured stories', () => {
    const first = makeRegistryEntry({ slug: 'first', featured: true });
    const second = makeRegistryEntry({ slug: 'second', issueNumber: 2, featured: true });

    expect(() => getFeaturedStory([first, second])).toThrow('Expected exactly one featured story, received 2');
  });

  it('supports an empty pre-publication registry', () => {
    expect(getPublishedStories([])).toEqual([]);
    expect(getFeaturedStory([])).toBeUndefined();
    expect(getStoryBySlug('anything', [])).toBeUndefined();
  });

  it('publishes one featured metadata record while keeping its story module cold', () => {
    expect(storyRegistry).toHaveLength(1);
    expect(storyRegistry[0]).toMatchObject({ slug: 'a-history-of-ai', published: true, featured: true, sceneCount: 12, labCount: 12 });
    const load = vi.spyOn(storyRegistry[0], 'load');
    expect(getPublishedStories()).toEqual([storyRegistry[0]]);
    expect(getFeaturedStory()).toBe(storyRegistry[0]);
    expect(load).not.toHaveBeenCalled();
    load.mockRestore();
  });
});
