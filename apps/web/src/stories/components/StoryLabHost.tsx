import { Suspense, createElement, lazy, useCallback, useMemo, useState } from 'react';
import type { Lang } from '../../i18n';
import { loadLab } from '../labs/registry';
import { makeInitialLabState } from '../labs/runtime';
import type { StoryScene } from '../types';
import { StoryLabBoundary } from './StoryLabBoundary';
import { StaticLabFallback } from './StaticLabFallback';

export interface StoryLabHostProps {
  scene: StoryScene;
  lang: Lang;
  value: unknown;
  onChange: (next: unknown) => void;
  onReset: () => void;
  onBack: () => void;
}

/**
 * Loads a scene's interactive lab only after it is opened. A retry creates a
 * fresh lazy importer and resets the local boundary without leaving the scene.
 */
export function StoryLabHost({ scene, lang, value, onChange, onReset, onBack }: StoryLabHostProps) {
  const [attempt, setAttempt] = useState(0);
  const [resetVersion, setResetVersion] = useState(0);
  const kind = scene.lab.kind;
  // `attempt` deliberately invalidates React.lazy's cached rejected promise.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const LazyLab = useMemo(() => lazy(() => loadLab(kind)), [attempt, kind]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const reset = useCallback(() => {
    setResetVersion((version) => version + 1);
    onReset();
  }, [onReset]);
  const initialValue = value === undefined ? makeInitialLabState(scene.lab) : value;
  const fallbackContent = <StaticLabFallback
    fallback={scene.labFallback}
    lang={lang}
    title={scene.lab.title[lang]}
    instruction={scene.lab.instruction[lang]}
    onRetry={retry}
    onBack={onBack}
  />;

  return <StoryLabBoundary fallback={scene.labFallback} fallbackContent={fallbackContent} lang={lang} resetKey={`${scene.id}:${attempt}`}>
    <Suspense fallback={fallbackContent}>
      {createElement(LazyLab, {
        key: `${scene.id}:${attempt}:${resetVersion}`,
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
