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

const receipt = {
  source: [65], received: [65], config: { p: 0, seed: 1, code: 'raw' as const, budget: 8 },
  required: 8, outcome: 'exact' as const, flippedBits: 0, payloadErrors: 0,
  messageRevision: 0, messageText: 'Original',
};

function ResetProbe({ value, onChange, onReset }: LabRuntimeProps) {
  const journey = useRequiredMessageJourney();
  return <>
    <output aria-label="message">{journey.state.messageText}</output>
    <output aria-label="shortened">{journey.state.shortenedDraft || 'empty'}</output>
    <output aria-label="receipt">{journey.state.deliveryReceipt ? 'saved' : 'empty'}</output>
    <output aria-label="scene value">{JSON.stringify(value)}</output>
    <output aria-label="saved scenes">{Object.keys(journey.state.experimentStateByScene).join(',') || 'empty'}</output>
    <button type="button" onClick={() => onChange({ generation: 9 })}>Save scene</button>
    <button type="button" onClick={() => journey.dispatch({ type: 'shorten', text: 'Short' })}>Shorten</button>
    <button type="button" onClick={() => journey.dispatch({ type: 'receipt', receipt })}>Save receipt</button>
    <button type="button" onClick={onReset}>Reset lab</button>
    <button type="button" onClick={() => journey.dispatch({ type: 'reset-session', example: 'Original' })}>Reset journey</button>
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

  it('routes scene-01 value and reset through the session while preserving the original', () => {
    renderJourneyLab(ResetProbe, makeStoryFixture().scenes[0]!.lab, { lang: 'en', example: 'Original' });
    fireEvent.click(screen.getByRole('button', { name: 'Save scene' }));
    fireEvent.click(screen.getByRole('button', { name: 'Shorten' }));
    expect(screen.getByLabelText('saved scenes')).toHaveTextContent('scene-01');

    fireEvent.click(screen.getByRole('button', { name: 'Reset lab' }));
    expect(screen.getByLabelText('message')).toHaveTextContent('Original');
    expect(screen.getByLabelText('shortened')).toHaveTextContent('empty');
    expect(screen.getByLabelText('scene value')).toHaveTextContent('{"generation":0}');
    expect(screen.getByLabelText('saved scenes')).toHaveTextContent('empty');
  });

  it('applies scene-11 receipt reset and scene-12 context-only reset by identity', () => {
    const definition = makeStoryFixture().scenes[0]!.lab;
    const scene11 = renderJourneyLab(ResetProbe, definition, { lang: 'en', example: 'Original', sceneId: 'scene-11' });
    fireEvent.click(screen.getByRole('button', { name: 'Save scene' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save receipt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset lab' }));
    expect(screen.getByLabelText('receipt')).toHaveTextContent('empty');
    expect(screen.getByLabelText('saved scenes')).toHaveTextContent('empty');
    scene11.unmount();

    renderJourneyLab(ResetProbe, definition, { lang: 'en', example: 'Original', sceneId: 'scene-12' });
    fireEvent.click(screen.getByRole('button', { name: 'Save scene' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save receipt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset lab' }));
    expect(screen.getByLabelText('receipt')).toHaveTextContent('saved');
    expect(screen.getByLabelText('saved scenes')).toHaveTextContent('empty');
  });

  it('derives lab value from the journey so whole-session reset clears it', () => {
    renderJourneyLab(ResetProbe, makeStoryFixture().scenes[0]!.lab, {
      lang: 'en', example: 'Original', sceneId: 'scene-12',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save scene' }));
    expect(screen.getByLabelText('scene value')).toHaveTextContent('{"generation":9}');

    fireEvent.click(screen.getByRole('button', { name: 'Reset journey' }));
    expect(screen.getByLabelText('scene value')).toHaveTextContent('{"generation":0}');
    expect(screen.getByLabelText('saved scenes')).toHaveTextContent('empty');
  });
});
