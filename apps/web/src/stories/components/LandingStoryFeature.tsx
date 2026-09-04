import { Link } from 'react-router-dom';
import { useLanguage } from '../../i18n/LanguageProvider';
import { getFeaturedStory, storyRegistry } from '../content/registry';
import type { StoryRegistryEntry } from '../types';

interface LandingStoryFeatureProps {
  entries?: readonly StoryRegistryEntry[];
}

export function LandingStoryFeature({ entries = storyRegistry }: LandingStoryFeatureProps) {
  const { lang, t } = useLanguage();
  const featured = getFeaturedStory(entries);

  if (!featured) return null;

  return (
    <section className="bd-scene bd-scene-last bd-stories" aria-labelledby="bd-stories-heading">
      <div className="bd-stories-heading">
        <h2 id="bd-stories-heading" className="bd-h">
          {t('stories.masthead')}
        </h2>
        <p className="bd-stories-collection">{t('stories.collectionTitle')}</p>
        <Link className="bd-stories-all" to="/stories">
          {t('stories.viewAll')}
        </Link>
      </div>
      <article className="bd-story-feature">
        <Link className="bd-story-feature-cover" to={`/stories/${featured.slug}`}>
          <picture>
            <source srcSet={featured.cover.srcSet} sizes={featured.cover.sizes} />
            <img
              src={featured.cover.src}
              width={featured.cover.width}
              height={featured.cover.height}
              alt={featured.cover.alt[lang]}
              loading="lazy"
              decoding="async"
            />
          </picture>
        </Link>
        <div className="bd-story-feature-copy">
          <p className="bd-story-feature-meta">
            <span>{t('stories.issueLabel', featured.issueNumber)}</span>
            <span>{t('stories.sceneCount', featured.sceneCount)}</span>
          </p>
          <h3>
            <Link to={`/stories/${featured.slug}`}>{featured.title[lang]}</Link>
          </h3>
          <p className="bd-story-feature-deck">{featured.deck[lang]}</p>
          <Link className="bd-story-feature-cta" to={`/stories/${featured.slug}`}>
            {t('stories.openEdition')}
          </Link>
        </div>
      </article>
    </section>
  );
}
