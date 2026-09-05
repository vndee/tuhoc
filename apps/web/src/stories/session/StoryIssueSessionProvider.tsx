import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import { useLanguage } from '../../i18n/LanguageProvider';
import type { Lang } from '../../i18n';
import type { StoryDefinition } from '../types';
import { createSession, reduceSession } from './model';
import type { MessageJourney } from './types';

const MessageJourneyContext = createContext<MessageJourney | null>(null);

type JourneyInteraction = NonNullable<StoryDefinition['interaction']>;

function ActiveMessageJourneyProvider({
  children,
  initialLang,
  interaction,
}: {
  children: ReactNode;
  initialLang: Lang;
  interaction: JourneyInteraction;
}) {
  const [state, dispatch] = useReducer(
    reduceSession,
    { examples: interaction.examples, initialLang },
    ({ examples, initialLang: language }) => createSession(examples[language]),
  );
  const value = useMemo<MessageJourney>(
    () => ({ state, dispatch, examples: interaction.examples }),
    [interaction.examples, state],
  );

  return <MessageJourneyContext.Provider value={value}>{children}</MessageJourneyContext.Provider>;
}

export function StoryIssueSessionProvider({
  children,
  story,
}: {
  story: StoryDefinition;
  children: ReactNode;
}) {
  const { lang } = useLanguage();
  if (!story.interaction) {
    return <MessageJourneyContext.Provider value={null}>{children}</MessageJourneyContext.Provider>;
  }

  return <ActiveMessageJourneyProvider
    key={`${story.meta.slug}:${story.interaction.kind}`}
    initialLang={lang}
    interaction={story.interaction}
  >
    {children}
  </ActiveMessageJourneyProvider>;
}

export function useMessageJourney(): MessageJourney | null {
  return useContext(MessageJourneyContext);
}

export function useRequiredMessageJourney(): MessageJourney {
  const journey = useMessageJourney();
  if (journey === null) throw new Error('Message journey is unavailable');
  return journey;
}
