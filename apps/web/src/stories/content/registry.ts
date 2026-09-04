import type { StoryRegistryEntry } from '../types';
import { historyOfAiMeta } from './a-history-of-ai/meta';

export const storyRegistry: readonly StoryRegistryEntry[] = [{
  ...historyOfAiMeta,
  load: () => import('./a-history-of-ai/story'),
}];

export function getPublishedStories(entries = storyRegistry): StoryRegistryEntry[] {
  return entries.filter((entry) => entry.published).sort((a, b) => b.issueNumber - a.issueNumber);
}

export function getFeaturedStory(entries = storyRegistry): StoryRegistryEntry | undefined {
  const featured = getPublishedStories(entries).filter((entry) => entry.featured);
  if (featured.length > 1) throw new Error(`Expected exactly one featured story, received ${featured.length}`);
  return featured[0];
}

export function getStoryBySlug(slug: string, entries = storyRegistry): StoryRegistryEntry | undefined {
  return getPublishedStories(entries).find((entry) => entry.slug === slug);
}
