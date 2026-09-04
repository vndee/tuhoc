import { useState, type ReactNode } from 'react';
import { t, type Lang } from '../../i18n';
import type { StoryDefinition, StoryScene as StorySceneModel } from '../types';
import { RichText } from './RichText';
import { StorySources } from './StorySources';

export interface StorySceneProps {
  scene: StorySceneModel;
  sceneNumber: number;
  lang: Lang;
  mobile: boolean;
  active: boolean;
  story: StoryDefinition;
  labOpen: boolean;
  onToggleLab: () => void;
  lab: ReactNode;
}

function InlineIllustration({ scene, lang }: { scene: StorySceneModel; lang: Lang }) {
  const [failed, setFailed] = useState(false);
  return <figure data-testid="story-inline-illustration" className="story-inline-illustration" style={{ aspectRatio: `${scene.illustration.width} / ${scene.illustration.height}` }}>
    {failed ? <div className="story-image-fallback"><span>{t(lang, 'stories.imageUnavailable')}</span><small>{scene.illustration.caption[lang]}</small></div> : <img
      src={scene.illustration.src}
      srcSet={scene.illustration.srcSet}
      sizes={scene.illustration.sizes}
      width={scene.illustration.width}
      height={scene.illustration.height}
      alt={scene.illustration.alt[lang]}
      onError={() => setFailed(true)}
    />}
    {!failed ? <figcaption>{scene.illustration.caption[lang]}</figcaption> : null}
  </figure>;
}

/** Semantic, always-readable scene prose; desktop merely changes emphasis. */
export function StoryScene({ scene, sceneNumber, lang, mobile, active, story, labOpen, onToggleLab, lab }: StorySceneProps) {
  return <article id={scene.id} className={`story-scene${active ? ' is-active' : ''}`} aria-labelledby={`${scene.id}-title`}>
    <p className="story-scene-label">{t(lang, 'stories.sceneLabel', sceneNumber)}</p>
    <h2 id={`${scene.id}-title`}>{scene.title[lang]}</h2>
    <p className="story-period">{scene.period[lang]}</p>
    {mobile ? <InlineIllustration scene={scene} lang={lang} /> : null}
    <section className="story-human"><RichText blocks={scene.humanStory[lang]} /></section>
    <section className="story-hinge"><h3>{t(lang, 'stories.technicalHinge')}</h3><RichText blocks={scene.technicalHinge[lang]} /></section>
    <section className="story-lab-entry">
      <button type="button" onClick={onToggleLab} aria-expanded={labOpen} aria-controls={`story-lab-${scene.id}`}>{t(lang, 'stories.tryIdea')}</button>
      {mobile && labOpen ? <div className="story-inline-lab" id={`story-lab-${scene.id}`}>{lab}</div> : null}
    </section>
    <section className="story-question"><h3>{t(lang, 'stories.openQuestion')}</h3><p>{scene.openQuestion[lang]}</p></section>
    <StorySources sceneSourceIds={scene.sourceIds} sources={story.sources} provenance={story.provenance} lang={lang} />
  </article>;
}
