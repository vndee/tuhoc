import { Link } from 'react-router-dom';
import { useLanguage } from '../../i18n/LanguageProvider';
import { getPublishedStories, storyRegistry } from '../content/registry';
import type { StoryRegistryEntry } from '../types';
import { StoryShell } from './StoryShell';

interface StoryIndexProps {
  entries?: readonly StoryRegistryEntry[];
  landmark?: boolean;
}

export function StoryIndex({ entries = storyRegistry, landmark = true }: StoryIndexProps) {
  const { lang, t } = useLanguage();
  const stories = getPublishedStories(entries);
  const className = `story-index${stories.length >= 3 ? ' story-index-many' : ''}`;

  const content = (
    <section className={className}>
      <header className="story-index-head">
        <p className="story-index-masthead">{t('stories.masthead')}</p>
        <h1>{t('stories.collectionTitle')}</h1>
      </header>
      <div className="story-index-list">
        {stories.map((entry) => (
          <article className="story-index-edition" key={entry.slug}>
            <Link className="story-index-cover" to={`/stories/${entry.slug}`}>
              <picture>
                <source srcSet={entry.cover.srcSet} sizes={entry.cover.sizes} />
                <img
                  src={entry.cover.src}
                  width={entry.cover.width}
                  height={entry.cover.height}
                  alt={entry.cover.alt[lang]}
                  loading="lazy"
                  decoding="async"
                />
              </picture>
            </Link>
            <div className="story-index-copy">
              <p className="story-index-meta">
                <span>{t('stories.issueLabel', entry.issueNumber)}</span>
                <span>{t('stories.sceneCount', entry.sceneCount)}</span>
              </p>
              <h2>
                <Link to={`/stories/${entry.slug}`}>{entry.title[lang]}</Link>
              </h2>
              <p className="story-index-deck">{entry.deck[lang]}</p>
              <Link className="story-index-cta" to={`/stories/${entry.slug}`}>
                {t('stories.openEdition')}
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  return landmark ? <main className={className}>{content}</main> : content;
}

export default function StoryIndexPage() {
  return <StoryShell variant="collection"><StoryIndex landmark={false} /></StoryShell>;
}
