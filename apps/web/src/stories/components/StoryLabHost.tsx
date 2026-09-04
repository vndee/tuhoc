import { Suspense, createElement, lazy, useCallback, useMemo, useState } from 'react';
import type { Lang } from '../../i18n';
import { loadLab } from '../labs/registry';
import { makeInitialLabState } from '../labs/runtime';
import type { StoryScene } from '../types';
import { StoryLabBoundary } from './StoryLabBoundary';

export interface StoryLabHostProps {
  scene: StoryScene;
  lang: Lang;
  value: unknown;
  onChange: (next: unknown) => void;
  onReset: () => void;
  onBack: () => void;
}

/** A useful, localized explanation shown while a lab chunk is still arriving. */
function StaticLabFallback({ scene, lang }: Pick<StoryLabHostProps, 'scene' | 'lang'>) {
  return <section className="story-lab-fallback" aria-label={scene.lab.title[lang]}>
    <h3>{scene.lab.title[lang]}</h3>
    <p>{scene.lab.instruction[lang]}</p>
    <figure>
      <div className="story-lab-diagram" aria-hidden="true" />
      <figcaption>{scene.labFallback.diagramLabel[lang]}</figcaption>
    </figure>
    <p>{scene.labFallback.explanation[lang]}</p>
  </section>;
}

/**
 * Loads a scene's interactive lab only after it is opened.  The lazy component
 * is retained for the lifetime of an open host while its kind stays selected;
 * unmounting it creates a fresh retry path if the chunk request failed.
 */
export function StoryLabHost({ scene, lang, value, onChange, onReset, onBack }: StoryLabHostProps) {
  const [resetVersion, setResetVersion] = useState(0);
  const kind = scene.lab.kind;
  const LazyLab = useMemo(() => lazy(() => loadLab(kind)), [kind]);
  const reset = useCallback(() => {
    setResetVersion((version) => version + 1);
    onReset();
  }, [onReset]);
  const initialValue = value === undefined ? makeInitialLabState(scene.lab) : value;

  return <StoryLabBoundary fallback={scene.labFallback} lang={lang} resetKey={scene.id}>
    <Suspense fallback={<StaticLabFallback scene={scene} lang={lang} />}>
      {createElement(LazyLab, {
        key: `${scene.id}:${resetVersion}`,
        definition: scene.lab,
        lang,
        value: initialValue,
        onChange,
        onReset: reset,
        onBack,
      })}
    </Suspense>
  </StoryLabBoundary>;
}
