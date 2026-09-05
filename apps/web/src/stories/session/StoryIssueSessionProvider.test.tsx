import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider, useLanguage } from '../../i18n/LanguageProvider';
import { ThemeProvider, useThemeContext } from '../../theme/ThemeContext';
import { makeStoryFixture } from '../testing/storyFixture';
import type { StoryDefinition } from '../types';
import {
  StoryIssueSessionProvider,
  useMessageJourney,
  useRequiredMessageJourney,
} from './StoryIssueSessionProvider';

function journeyStory(): StoryDefinition {
  return {
    ...makeStoryFixture(),
    interaction: {
      kind: 'message-journey',
      examples: { vi: 'Ví dụ tiếng Việt', en: 'English example' },
    },
  };
}

function Probe() {
  const journey = useRequiredMessageJourney();
  const { setLang } = useLanguage();
  const { toggle } = useThemeContext();
  return <>
    <output aria-label="message">{journey.state.messageText}</output>
    <output aria-label="lab value">{String(journey.state.experimentStateByScene['scene-02'] ?? 'fresh')}</output>
    <button type="button" onClick={() => journey.dispatch({ type: 'commit', text: 'Tin nhắn riêng' })}>Commit</button>
    <button type="button" onClick={() => journey.dispatch({ type: 'lab', sceneId: 'scene-02', value: 'saved' })}>Save lab</button>
    <button type="button" onClick={() => setLang('en')}>English</button>
    <button type="button" onClick={toggle}>Theme</button>
  </>;
}

function Providers({ children, story }: { children: ReactNode; story: StoryDefinition }) {
  return <LanguageProvider><ThemeProvider>
    <StoryIssueSessionProvider story={story}>{children}</StoryIssueSessionProvider>
  </ThemeProvider></LanguageProvider>;
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/stories/fixture-story');
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('StoryIssueSessionProvider', () => {
  it('chooses the initial language once and preserves the VI payload after switching to EN', () => {
    render(<Providers story={journeyStory()}><Probe /></Providers>);
    expect(screen.getByLabelText('message')).toHaveTextContent('Ví dụ tiếng Việt');

    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(document.documentElement).toHaveAttribute('lang', 'en');
    expect(screen.getByLabelText('message')).toHaveTextContent('Tin nhắn riêng');
  });

  it('does not reset the payload or lab state for hash and theme changes', () => {
    const story = journeyStory();
    const view = render(<Providers story={story}><Probe /></Providers>);
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save lab' }));

    history.replaceState(null, '', '/stories/fixture-story#scene-02');
    view.rerender(<Providers story={story}><Probe /></Providers>);
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));

    expect(screen.getByLabelText('message')).toHaveTextContent('Tin nhắn riêng');
    expect(screen.getByLabelText('lab value')).toHaveTextContent('saved');
  });

  it('starts from the language example again after unmount and remount', () => {
    const first = render(<Providers story={journeyStory()}><Probe /></Providers>);
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    first.unmount();

    render(<Providers story={journeyStory()}><Probe /></Providers>);
    expect(screen.getByLabelText('message')).toHaveTextContent('Ví dụ tiếng Việt');
    expect(screen.getByLabelText('lab value')).toHaveTextContent('fresh');
  });

  it('exposes null without interaction and safely mounts a keyed journey later', () => {
    function NullableProbe() {
      return <output>{useMessageJourney() === null ? 'no journey' : 'has journey'}</output>;
    }
    const plain = makeStoryFixture();
    const view = render(<Providers story={plain}><NullableProbe /></Providers>);
    expect(screen.getByText('no journey')).toBeInTheDocument();

    view.rerender(<Providers story={journeyStory()}><NullableProbe /></Providers>);
    expect(screen.getByText('has journey')).toBeInTheDocument();
  });

  it('throws a content-free error when a required journey is absent', () => {
    const plain = makeStoryFixture();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Providers story={plain}>{children}</Providers>
    );

    expect(() => renderHook(() => useRequiredMessageJourney(), { wrapper }))
      .toThrowError('Message journey is unavailable');
  });
});
