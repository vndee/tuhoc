import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLanguage } from '../../i18n/LanguageProvider';
import { getStoryBySlug } from '../content/registry';
import type { StoryDefinition, StoryRegistryEntry } from '../types';
import { StoryRenderer } from './StoryRenderer';
import { StoryShell } from './StoryShell';
import { useStoryDocumentMeta } from './useStoryDocumentMeta';

type StoryPageState =
  | { status: 'loading'; slug: string; entry: StoryRegistryEntry | undefined; attempt: number }
  | { status: 'not-found'; slug: string; entry: StoryRegistryEntry | undefined; attempt: number }
  | { status: 'error'; slug: string; entry: StoryRegistryEntry; attempt: number }
  | { status: 'ready'; slug: string; entry: StoryRegistryEntry; attempt: number; story: StoryDefinition };

function ReadyStoryPage({ story }: { story: StoryDefinition }) {
  const { lang, t } = useLanguage();
  useStoryDocumentMeta({
    title: `${story.meta.title[lang]} · ${t('stories.masthead')} · ${t('app.name')}`,
    description: story.meta.deck[lang],
    canonicalPath: `/stories/${story.meta.slug}`,
    lang,
  });
  return <StoryRenderer story={story} />;
}

export default function StoryPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { t } = useLanguage();
  const [attempt, setAttempt] = useState(0);
  const entry = getStoryBySlug(slug);
  const [state, setState] = useState<StoryPageState>(() => entry
    ? { status: 'loading', slug, entry, attempt: 0 }
    : { status: 'not-found', slug, entry, attempt: 0 });

  const stateMatchesRoute = state.slug === slug && state.entry === entry && state.attempt === attempt;
  const visibleState: StoryPageState = stateMatchesRoute
    ? state
    : entry
      ? { status: 'loading', slug, entry, attempt }
      : { status: 'not-found', slug, entry, attempt };

  useEffect(() => {
    if (!entry) {
      setState({ status: 'not-found', slug, entry, attempt });
      return undefined;
    }
    let current = true;
    setState({ status: 'loading', slug, entry, attempt });
    entry.load().then(
      ({ default: story }) => { if (current) setState({ status: 'ready', slug, entry, attempt, story }); },
      () => { if (current) setState({ status: 'error', slug, entry, attempt }); },
    );
    return () => { current = false; };
  }, [entry, slug, attempt]);

  if (visibleState.status === 'ready') return <ReadyStoryPage story={visibleState.story} />;

  return <StoryShell variant="issue">
    {visibleState.status === 'loading' ? <p className="story-route-status" role="status">{t('stories.loading')}</p> : null}
    {visibleState.status === 'not-found' ? <section className="story-route-not-found">
      <h1>{t('stories.notFoundTitle')}</h1>
      <p>{t('stories.notFoundBody')}</p>
    </section> : null}
    {visibleState.status === 'error' ? <section className="story-route-error">
      <p role="alert">{t('stories.loadError')}</p>
      <button type="button" onClick={() => setAttempt((value) => value + 1)}>{t('landing.catalog.retry')}</button>
      <Link to="/stories">{t('stories.backToCollection')}</Link>
    </section> : null}
  </StoryShell>;
}
