import { render } from '@testing-library/react';
import { useState, type ComponentType } from 'react';
import { LANG_STORAGE_KEY, type Lang } from '../../i18n';
import { LanguageProvider, useLanguage } from '../../i18n/LanguageProvider';
import { writeLocalStorage } from '../../db/localStorage';
import { StoryIssueSessionProvider } from '../session/StoryIssueSessionProvider';
import type { LabDefinition, StoryDefinition } from '../types';
import { makeInitialLabState } from '../labs/runtime';
import type { LabRuntimeProps } from '../labs/runtime';
import { makeStoryFixture } from './storyFixture';
import { messageExamples } from '../labs/communication/copy';

function ControlledLab({ Component, definition }: {
  Component: ComponentType<LabRuntimeProps>;
  definition: LabDefinition;
}) {
  const { lang } = useLanguage();
  const [value, setValue] = useState(() => makeInitialLabState(definition));
  return <Component
    definition={definition}
    lang={lang}
    value={value}
    onChange={setValue}
    onReset={() => setValue(makeInitialLabState(definition))}
    onBack={() => undefined}
  />;
}

export function renderJourneyLab(
  Component: ComponentType<LabRuntimeProps>,
  definition: LabDefinition,
  options: { lang?: Lang; example?: string } = {},
) {
  const lang = options.lang ?? 'vi';
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
      <ControlledLab Component={Component} definition={definition} />
    </StoryIssueSessionProvider>
  </LanguageProvider>);
}
