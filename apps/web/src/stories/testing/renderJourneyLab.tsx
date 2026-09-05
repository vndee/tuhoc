/* oxlint-disable react/only-export-components */
import { render } from '@testing-library/react';
import { useMemo, type ComponentType } from 'react';
import { LANG_STORAGE_KEY, type Lang } from '../../i18n';
import { LanguageProvider, useLanguage } from '../../i18n/LanguageProvider';
import { writeLocalStorage } from '../../db/localStorage';
import { StoryIssueSessionProvider } from '../session/StoryIssueSessionProvider';
import { useRequiredMessageJourney } from '../session/StoryIssueSessionProvider';
import type { LabDefinition, SceneId, StoryDefinition } from '../types';
import { makeInitialLabState } from '../labs/runtime';
import type { LabRuntimeProps } from '../labs/runtime';
import { makeStoryFixture } from './storyFixture';
import { messageExamples } from '../labs/communication/copy';

// Test-only provider host intentionally shares this helper module with its renderer.
function ControlledLab({ Component, definition, sceneId }: {
  Component: ComponentType<LabRuntimeProps>;
  definition: LabDefinition;
  sceneId: SceneId;
}) {
  const { lang } = useLanguage();
  const journey = useRequiredMessageJourney();
  const initialValue = useMemo(() => makeInitialLabState(definition), [definition]);
  const storedValue = journey.state.experimentStateByScene[sceneId];
  const value = storedValue === undefined ? initialValue : storedValue;
  return <Component
    definition={definition}
    lang={lang}
    value={value}
    onChange={(next) => journey.dispatch({ type: 'lab', sceneId, value: next })}
    onReset={() => journey.dispatch({ type: 'reset-lab', sceneId })}
    onBack={() => undefined}
  />;
}

export function renderJourneyLab(
  Component: ComponentType<LabRuntimeProps>,
  definition: LabDefinition,
  options: { lang?: Lang; example?: string; sceneId?: SceneId } = {},
) {
  const lang = options.lang ?? 'vi';
  const sceneId = options.sceneId ?? 'scene-01';
  writeLocalStorage(LANG_STORAGE_KEY, lang);
  const fixture = makeStoryFixture();
  const story: StoryDefinition = {
    ...fixture,
    interaction: {
      kind: 'message-journey',
      examples: options.example
        ? { vi: options.example, en: options.example }
        : messageExamples,
    },
  };

  return render(<LanguageProvider>
    <StoryIssueSessionProvider story={story}>
      <ControlledLab Component={Component} definition={definition} sceneId={sceneId} />
    </StoryIssueSessionProvider>
  </LanguageProvider>);
}
