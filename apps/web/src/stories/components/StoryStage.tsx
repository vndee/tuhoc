import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { t, type Lang } from '../../i18n';
import type { StoryScene } from '../types';

export interface StoryStageProps {
  scene: StoryScene;
  nextScene?: StoryScene;
  storySlug: string;
  lang: Lang;
  reducedMotion: boolean;
  lab: ReactNode;
  labSceneId?: string | null;
  failedSceneIds?: ReadonlySet<string>;
  actId?: string;
}

interface VisiblePlate {
  scene: StoryScene;
  key: string;
  layer: 0 | 1;
  failed: boolean;
}

function plateKey(storySlug: string, scene: StoryScene): string {
  return `${storySlug}:${scene.id}:${scene.illustration.src}`;
}

function ImageFallback({ scene, lang, onReady }: { scene: StoryScene; lang: Lang; onReady?: () => void }) {
  const readyRef = useCallback((node: HTMLDivElement | null) => {
    if (node && onReady) queueMicrotask(onReady);
  }, [onReady]);
  return <div
    className="story-image-fallback"
    ref={readyRef}
    style={{ aspectRatio: `${scene.illustration.width} / ${scene.illustration.height}` }}
  >
    <span>{t(lang, 'stories.imageUnavailable')}</span>
    <small>{scene.illustration.caption[lang]}</small>
  </div>;
}

function PlateImage({
  scene,
  lang,
  failed,
  requestKey,
  onLoad,
  onError,
}: {
  scene: StoryScene;
  lang: Lang;
  failed: boolean;
  requestKey: string;
  onLoad?: () => void;
  onError?: () => void;
}) {
  if (failed) return <ImageFallback scene={scene} lang={lang} onReady={onLoad} />;
  return <img
    data-testid="story-plate-image"
    data-request-key={requestKey}
    src={scene.illustration.src}
    srcSet={scene.illustration.srcSet}
    sizes={scene.illustration.sizes}
    width={scene.illustration.width}
    height={scene.illustration.height}
    alt={scene.illustration.alt[lang]}
    decoding="async"
    onLoad={onLoad}
    onError={onError}
  />;
}

/** Two permanent plate layers own loading, swapping, and old-layer retirement. */
export function StoryStage({
  scene,
  nextScene,
  storySlug,
  lang,
  reducedMotion,
  lab,
  labSceneId = null,
  failedSceneIds = new Set(),
  actId,
}: StoryStageProps) {
  const duration = reducedMotion ? 0 : 360;
  const requestKey = plateKey(storySlug, scene);
  const forcedFailed = failedSceneIds.has(scene.id);
  const [active, setActive] = useState<VisiblePlate>(() => ({
    scene,
    key: requestKey,
    layer: 0,
    failed: forcedFailed,
  }));
  const [retiring, setRetiring] = useState<VisiblePlate | null>(null);
  const timer = useRef<number | null>(null);
  const activeRef = useRef(active);
  const requestKeyRef = useRef(requestKey);

  useLayoutEffect(() => {
    activeRef.current = active;
    requestKeyRef.current = requestKey;
  }, [active, requestKey]);

  const pending = useMemo<VisiblePlate | null>(() => {
    if (active.key === requestKey) return null;
    const nextLayer = active.layer === 0 ? 1 : 0;
    if (retiring?.layer === nextLayer) return null;
    return {
      scene,
      key: requestKey,
      layer: nextLayer,
      failed: forcedFailed,
    };
  }, [active.key, active.layer, forcedFailed, requestKey, retiring?.layer, scene]);

  useEffect(() => {
    if (!nextScene) return;
    const image = new Image();
    image.onload = () => undefined;
    image.onerror = () => undefined;
    image.src = nextScene.illustration.src;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [nextScene]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const acceptPending = (key: string, failed: boolean) => {
    const next = pending;
    if (!next || key !== requestKeyRef.current || key !== next.key) return;
    const previous = activeRef.current;
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (duration === 0) setRetiring(null);
    else setRetiring(previous);
    setActive({ ...next, failed });
    timer.current = duration === 0 ? null : window.setTimeout(() => {
      setRetiring((current) => (current?.key === previous.key ? null : current));
      timer.current = null;
    }, duration);
  };

  const rejectActive = (key: string) => {
    setActive((current) => current.key === key && !current.failed ? { ...current, failed: true } : current);
  };

  const plateForLayer = (layer: 0 | 1): VisiblePlate | null => {
    if (active.layer === layer) return { ...active, failed: active.failed || failedSceneIds.has(active.scene.id) };
    if (retiring?.layer === layer) return retiring;
    if (pending?.layer === layer) return pending;
    return null;
  };

  return <aside
    className="story-stage"
    data-testid="story-stage"
    data-active-scene={active.scene.id}
    data-act={actId}
    data-lab-scene={labSceneId ?? undefined}
    style={{ '--story-crossfade-ms': `${duration}ms` } as CSSProperties}
  >
    {([0, 1] as const).map((layer) => {
      const plate = plateForLayer(layer);
      return <figure
        className={`story-plate-layer${layer === active.layer ? ' is-active' : ''}`}
        aria-hidden={layer === active.layer ? undefined : true}
        data-layer={layer}
        data-scene={plate?.scene.id}
        key={layer}
      >
        {plate ? <PlateImage
          key={plate.key}
          scene={plate.scene}
          lang={lang}
          failed={plate.failed}
          requestKey={plate.key}
          onLoad={pending?.key === plate.key ? () => acceptPending(plate.key, false) : undefined}
          onError={pending?.key === plate.key
            ? () => acceptPending(plate.key, true)
            : active.key === plate.key ? () => rejectActive(plate.key) : undefined}
        /> : null}
        {plate && !plate.failed ? <figcaption className="story-plate-caption">{plate.scene.illustration.caption[lang]}</figcaption> : null}
      </figure>;
    })}
    <div className="story-stage-lab" id={labSceneId ? `story-lab-${labSceneId}` : undefined}>{lab}</div>
  </aside>;
}
