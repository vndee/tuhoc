import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useLanguage } from '../../i18n/LanguageProvider';
import { StoryIssueSessionProvider, useMessageJourney } from '../session/StoryIssueSessionProvider';
import type { ResponsiveStoryImage, StoryDefinition, StoryScene as StorySceneModel } from '../types';
import { RichText } from './RichText';
import { StoryCourseLink } from './StoryCourseLink';
import { StoryScene } from './StoryScene';
import { StoryShell } from './StoryShell';
import { StorySources } from './StorySources';
import { StoryStage } from './StoryStage';
import { StoryLabHost } from './StoryLabHost';
import { activeStoryScenePrivateContext, findOwnedElement, storyShellActivationContext } from './StoryRendererInternals';
import { useActiveStoryScene } from './useActiveStoryScene';
import { useStoryLayout } from './useStoryLayout';

export interface StoryRendererProps {
  story: StoryDefinition;
  renderLab?: (
    scene: StorySceneModel,
    value: unknown,
    onChange: (next: unknown) => void,
    onReset: () => void,
  ) => ReactNode;
}

function ImageFallback({ image, lang, label }: { image: ResponsiveStoryImage; lang: 'vi' | 'en'; label: string }) {
  return <div className="story-image-fallback" style={{ aspectRatio: `${image.width} / ${image.height}` }}>
    <span>{label}</span>
    <small>{image.caption[lang]}</small>
  </div>;
}

function routeOwnsStoryHash(story: StoryDefinition): boolean {
  const routeSlug = location.pathname.split('/').filter(Boolean).at(-1);
  return routeSlug === story.meta.slug;
}

function StoryRendererContent({
  failedSceneIds,
  ownerRoot,
  renderLab,
  story,
}: StoryRendererProps & { failedSceneIds: ReadonlySet<string>; ownerRoot: RefObject<HTMLDivElement | null> }) {
  const { lang, t } = useLanguage();
  const journey = useMessageJourney();
  const { mobile, reducedMotion } = useStoryLayout();
  const { activeSceneId, activeIndex, coverPassed, setActiveSceneId } = useActiveStoryScene(story.scenes);
  const [labStateByScene, setLabStateByScene] = useState<Record<string, unknown>>({});
  const [labSceneId, setLabSceneId] = useState<string | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);
  const previousActiveSceneId = useRef(activeSceneId);
  const labActivation = useRef<string | null>(null);
  const activeScene = story.scenes[activeIndex] ?? story.scenes[0]!;
  const labScene = labSceneId ? story.scenes.find((scene) => scene.id === labSceneId) ?? null : null;
  const stageScene = !mobile && labScene ? labScene : activeScene;
  const stageAct = story.acts.find((act) => act.sceneIds.includes(stageScene.id));

  useEffect(() => {
    if (previousActiveSceneId.current === activeSceneId) return;
    previousActiveSceneId.current = activeSceneId;
    if (labActivation.current === activeSceneId) {
      labActivation.current = null;
      return;
    }
    setLabSceneId(null);
  }, [activeSceneId]);

  const sceneLabels = useMemo(() => story.scenes.map((scene, index) => ({
    id: scene.id,
    label: String(index + 1).padStart(2, '0'),
    accessibleLabel: `${t('stories.sceneLabel', index + 1)}: ${scene.title[lang]}`,
  })), [lang, story.scenes, t]);
  const labFor = (scene: StorySceneModel) => {
    const value = journey ? journey.state.experimentStateByScene[scene.id] : labStateByScene[scene.id];
    const onChange = (next: unknown) => journey
      ? journey.dispatch({ type: 'lab', sceneId: scene.id, value: next })
      : setLabStateByScene((current) => ({ ...current, [scene.id]: next }));
    const onReset = () => {
      if (journey) {
        journey.dispatch({ type: 'reset-lab', sceneId: scene.id });
        return;
      }
      setLabStateByScene((current) => {
        const next = { ...current };
        delete next[scene.id];
        return next;
      });
    };
    return renderLab
      ? renderLab(scene, value, onChange, onReset)
      : <StoryLabHost scene={scene} lang={lang} value={value} onChange={onChange} onReset={onReset} onBack={() => setLabSceneId(null)} />;
  };

  const activateScene = useCallback((id: StorySceneModel['id']) => {
    setActiveSceneId(id);
  }, [setActiveSceneId]);

  const shellActivation = useMemo(() => ({ onActivate: activateScene }), [activateScene]);

  const toggleLab = (scene: StorySceneModel) => {
    if (labSceneId === scene.id) {
      setLabSceneId(null);
      return;
    }
    setLabSceneId(scene.id);
    if (!mobile && scene.id !== activeSceneId) {
      labActivation.current = scene.id;
      activateScene(scene.id);
      const target = findOwnedElement(ownerRoot.current, scene.id);
      if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
    }
  };

  const shellStyle = {
    '--story-light-paper': story.theme.paper,
    '--story-light-ink': story.theme.ink,
    '--story-light-muted-ink': story.theme.mutedInk,
    '--story-light-accent': story.theme.accent,
    '--story-light-stage': story.theme.stage,
  } as CSSProperties;

  return <div className={`story-shell-theme-scope ${story.theme.className}`} ref={ownerRoot} style={shellStyle}>
    <storyShellActivationContext.Provider value={shellActivation}>
      <StoryShell
        variant="issue"
        compact={coverPassed}
        progress={{ current: activeIndex + 1, total: story.scenes.length }}
        scenes={sceneLabels}
        activeSceneId={activeSceneId as StorySceneModel['id']}
      >
    <div className="story-renderer">
      {story.intro ? <section className="story-intro"><RichText blocks={story.intro[lang]} /></section> : null}
      <section className="story-cover" data-testid="story-cover" aria-labelledby="story-title">
        <p>{t('stories.issueLabel', story.meta.issueNumber)}</p>
        <p className="story-cover-counts"><span>{t('stories.sceneCount', story.meta.sceneCount)}</span><span>{t('stories.labCount', story.meta.labCount)}</span></p>
        <h1 id="story-title">{story.meta.title[lang]}</h1>
        <p className="story-deck">{story.meta.deck[lang]}</p>
        <figure
          className="story-cover-plate"
          data-testid="story-cover-plate"
          style={{ aspectRatio: `${story.meta.cover.width} / ${story.meta.cover.height}` }}
        >
          {coverFailed ? <ImageFallback image={story.meta.cover} lang={lang} label={t('stories.imageUnavailable')} /> : <img
            src={story.meta.cover.src}
            alt={story.meta.cover.alt[lang]}
            width={story.meta.cover.width}
            height={story.meta.cover.height}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            srcSet={story.meta.cover.srcSet}
            sizes={story.meta.cover.sizes}
            onError={() => setCoverFailed(true)}
          />}
          {!coverFailed ? <figcaption className="story-cover-caption">{story.meta.cover.caption[lang]}</figcaption> : null}
        </figure>
      </section>
      <div id="story-cover-sentinel" aria-hidden="true" />
      <div className="story-issue-grid">
        {!mobile ? <StoryStage
          scene={stageScene}
          nextScene={story.scenes[activeIndex + 1]}
          storySlug={story.meta.slug}
          lang={lang}
          reducedMotion={reducedMotion}
          failedSceneIds={failedSceneIds}
          lab={labScene ? labFor(labScene) : null}
          labSceneId={labSceneId}
          actId={stageAct?.id}
        /> : null}
        <div className="story-narrative">
          {story.acts.map((act) => <section className="story-act" data-act={act.id} key={act.id} aria-labelledby={`${act.id}-title`}>
            <header><p>{t('stories.actLabel', act.number)}</p><h2 id={`${act.id}-title`}>{act.title[lang]}</h2><p>{act.question[lang]}</p><RichText blocks={act.consequence[lang]} /></header>
            {act.sceneIds.map((id) => {
              const scene = story.scenes.find((item) => item.id === id);
              if (!scene) return null;
              const index = story.scenes.indexOf(scene);
              return <StoryScene
                key={scene.id}
                scene={scene}
                sceneNumber={index + 1}
                lang={lang}
                mobile={mobile}
                active={scene.id === activeSceneId}
                story={story}
                labOpen={labSceneId === scene.id}
                onToggleLab={() => toggleLab(scene)}
                lab={mobile && labSceneId === scene.id ? labFor(scene) : null}
              />;
            })}
          </section>)}
          <section className="story-coda">
            <h2>{t('stories.coda')}</h2>
            <RichText blocks={story.coda[lang]} />
            {story.courseAction ? <StoryCourseLink action={story.courseAction} /> : null}
          </section>
          <StorySources sceneSourceIds={[]} sources={story.sources} provenance={story.provenance} lang={lang} all />
        </div>
      </div>
    </div>
      </StoryShell>
    </storyShellActivationContext.Provider>
  </div>;
}

function StoryRendererForRoute({ story, renderLab }: StoryRendererProps) {
  const ownerRoot = useRef<HTMLDivElement>(null);
  const [failedSceneIds, setFailedSceneIds] = useState<ReadonlySet<string>>(() => new Set());
  const activeSceneConfig = useMemo(() => ({
    honorHash: routeOwnsStoryHash(story),
    onDecodeFailure: (id: StorySceneModel['id']) => setFailedSceneIds((current) => new Set(current).add(id)),
    ownerRoot: () => ownerRoot.current,
  }), [story]);

  return <StoryIssueSessionProvider story={story}>
    <activeStoryScenePrivateContext.Provider value={activeSceneConfig}>
      <StoryRendererContent story={story} renderLab={renderLab} failedSceneIds={failedSceneIds} ownerRoot={ownerRoot} />
    </activeStoryScenePrivateContext.Provider>
  </StoryIssueSessionProvider>;
}

export function StoryRenderer({ story, renderLab }: StoryRendererProps) {
  return <StoryRendererForRoute key={`${story.meta.slug}:${location.pathname}`} story={story} renderLab={renderLab} />;
}
