import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRequiredMessageJourney } from '../session/StoryIssueSessionProvider';
import { makeStoryFixture } from './storyFixture';
import { renderJourneyLab } from './renderJourneyLab';
import type { LabRuntimeProps } from '../labs/runtime';

function Probe({ lang, value, onChange }: LabRuntimeProps) {
  const journey = useRequiredMessageJourney();
  return <>
    <output aria-label="language">{lang}</output>
    <output aria-label="message">{journey.state.messageText}</output>
    <output aria-label="value">{JSON.stringify(value)}</output>
    <button type="button" onClick={() => onChange({ generation: 7 })}>Change</button>
  </>;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('renderJourneyLab', () => {
  it('mounts the actual language and journey providers with controlled lab state', () => {
    renderJourneyLab(Probe, makeStoryFixture().scenes[0]!.lab, { lang: 'en', example: 'Private example' });

    expect(screen.getByLabelText('language')).toHaveTextContent('en');
    expect(screen.getByLabelText('message')).toHaveTextContent('Private example');
    expect(screen.getByLabelText('value')).toHaveTextContent('{"generation":0}');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByLabelText('value')).toHaveTextContent('{"generation":7}');
  });
});
