import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { renderJourneyLab } from '../../testing/renderJourneyLab';
import type { RunSnapshot } from '../communication/types';
import type { LabRuntimeProps } from '../runtime';
import type { HuffmanPacket } from './codec';
import HuffmanMessageLab from './HuffmanMessageLab';

const definition = {
  kind: 'huffman-message',
  title: { vi: 'Nén', en: 'Compress' },
  instruction: { vi: 'Tính cả gói', en: 'Count the whole packet' },
  config: { maxVisibleNodes: 24 },
} as unknown as LabRuntimeProps['definition'];

function JourneyControls(props: LabRuntimeProps) {
  const journey = useRequiredMessageJourney();
  const [open, setOpen] = useState(true);
  if (!open) return <button type="button" onClick={() => setOpen(true)}>Reopen Huffman lab</button>;
  return <>
    <button type="button" onClick={() => setOpen(false)}>Close Huffman lab</button>
    <button type="button" onClick={() => journey.dispatch({ type: 'commit', text: 'BBBB' })}>
      Change the committed message
    </button>
    <HuffmanMessageLab {...props} />
  </>;
}

function CorruptPacketControl(props: LabRuntimeProps) {
  const journey = useRequiredMessageJourney();
  const corrupt = () => {
    const current = journey.state.experimentStateByScene['scene-08'] as {
      step: number;
      page: number;
      snapshot: RunSnapshot<Record<string, never>, HuffmanPacket>;
    };
    const container = [...current.snapshot.result.container];
    container[container.length - 1] = 128;
    journey.dispatch({
      type: 'lab',
      sceneId: 'scene-08',
      value: {
        ...current,
        snapshot: {
          ...current.snapshot,
          result: { ...current.snapshot.result, container },
        },
      },
    });
  };
  return <>
    <button type="button" onClick={corrupt}>Corrupt saved packet</button>
    <HuffmanMessageLab {...props} />
  </>;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('HuffmanMessageLab', () => {
  it.each(['en', 'vi'] as const)('distinguishes unrevealed merges from a single-symbol packet in %s', lang => {
    const runName = lang === 'en' ? 'Run experiment' : 'Chạy thử';
    const historyName = lang === 'en' ? 'Visible merge history' : 'Các lần ghép đang hiện';
    const view = renderJourneyLab(HuffmanMessageLab, definition, { lang, example: 'AB', sceneId: 'scene-08' });
    fireEvent.click(screen.getByRole('button', { name: runName }));
    const history = screen.getByRole('region', { name: historyName });
    expect(history).toHaveTextContent(lang === 'en' ? 'No merges revealed yet.' : 'Chưa hiện lần ghép nào.');
    expect(history).not.toHaveTextContent(lang === 'en' ? /one byte value/i : /một giá trị byte/i);
    view.unmount();
    renderJourneyLab(HuffmanMessageLab, definition, { lang, example: 'AAAA', sceneId: 'scene-08' });
    fireEvent.click(screen.getByRole('button', { name: runName }));
    expect(screen.getByRole('region', { name: historyName })).toHaveTextContent(lang === 'en' ? /one byte value.*code is still 0/i : /một giá trị byte.*mã vẫn là 0/i);
  });

  it.each([
    {
      lang: 'en' as const,
      stages: ['Predict', 'Try', 'Observe', 'Explain and limits'],
      prompt: /will the whole teaching packet be smaller/i,
      run: 'Run experiment',
    },
    {
      lang: 'vi' as const,
      stages: ['Dự đoán', 'Thử', 'Quan sát', 'Giải thích và giới hạn'],
      prompt: /toàn bộ gói minh họa có nhỏ hơn/i,
      run: 'Chạy thử',
    },
  ])('shows a localized non-gating Predict → Try → Observe → Explain flow in $lang', ({
    lang, stages, prompt, run,
  }) => {
    renderJourneyLab(HuffmanMessageLab, definition, { lang, example: 'AAAA', sceneId: 'scene-08' });

    for (const stage of stages) expect(screen.getByRole('heading', { level: 4, name: stage })).toBeVisible();
    const prediction = screen.getByRole('region', { name: stages[0] });
    expect(within(prediction).getByText(prompt)).toBeVisible();
    expect(prediction.querySelector('input, button, select, textarea')).toBeNull();
    expect(screen.getByRole('button', { name: run })).toBeEnabled();
  });

  it('runs only on explicit Run and reports honest exact packet accounting', () => {
    renderJourneyLab(HuffmanMessageLab, definition, { lang: 'en', example: 'AAAA', sceneId: 'scene-08' });

    expect(screen.queryByRole('table', { name: 'Size accounting' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));

    const table = screen.getByRole('table', { name: 'Size accounting' });
    expect(within(table).getByRole('row', { name: 'Raw UTF-8 32' })).toBeVisible();
    expect(within(table).getByRole('row', { name: 'Coded payload 4' })).toBeVisible();
    expect(within(table).getByRole('row', { name: 'Header and frequencies 88' })).toBeVisible();
    expect(within(table).getByRole('row', { name: 'Padding 4' })).toBeVisible();
    expect(within(table).getByRole('row', { name: 'Total packet 96' })).toBeVisible();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('The payload is shorter, but the full packet is larger because of its codebook.');
    expect(within(status).getByText('↑')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/teaching format, not ZIP, gzip, or a standard interchange format/i)).toBeVisible();
  });

  it('constructs the alphabet from UTF-8 bytes rather than graphemes', () => {
    renderJourneyLab(HuffmanMessageLab, definition, { lang: 'en', example: 'é', sceneId: 'scene-08' });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));

    const codeTable = screen.getByRole('table', { name: 'Huffman codes' });
    expect(within(codeTable).getByRole('row', { name: /0xA9 1 0 1/ })).toBeVisible();
    expect(within(codeTable).getByRole('row', { name: /0xC3 1 1 1/ })).toBeVisible();
    expect(within(codeTable).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('2 UTF-8 bytes · 2 byte values')).toBeVisible();
  });

  it('localizes size rows and internal merge-node labels in Vietnamese', () => {
    renderJourneyLab(HuffmanMessageLab, definition, { lang: 'vi', example: 'ABCD', sceneId: 'scene-08' });
    fireEvent.click(screen.getByRole('button', { name: 'Chạy thử' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tất' }));

    expect(within(screen.getByRole('table', { name: 'Phép tính dung lượng' }))
      .getByRole('row', { name: 'Toàn bộ gói 168' })).toBeVisible();
    expect(screen.getByText('nút 4 + nút 5 → nút 6')).toBeVisible();
  });

  it('steps through immutable construction history and Complete changes presentation only', () => {
    renderJourneyLab(HuffmanMessageLab, definition, { lang: 'en', example: 'ABCD', sceneId: 'scene-08' });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    const total = within(screen.getByRole('table', { name: 'Size accounting' }))
      .getByRole('row', { name: 'Total packet 168' }).textContent;

    expect(screen.getByText('Merge 0 of 3')).toBeVisible();
    expect(screen.queryByText(/0x41 \+ 0x42 → node 4/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Step' }));
    expect(screen.getByText('Merge 1 of 3')).toBeVisible();
    expect(screen.getByText(/0x41 \+ 0x42 → node 4/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    expect(screen.getByText('Merge 3 of 3')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Step' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Complete' })).toBeDisabled();
    expect(within(screen.getByRole('table', { name: 'Size accounting' }))
      .getByRole('row', { name: 'Total packet 168' })).toHaveTextContent(total ?? '');
  });

  it('bounds the selected tree window and paginates every code', () => {
    const bounded = {
      ...definition,
      config: { maxVisibleNodes: 4 },
    } as LabRuntimeProps['definition'];
    const message = '!"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGH';
    renderJourneyLab(HuffmanMessageLab, bounded, { lang: 'en', example: message, sceneId: 'scene-08' });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));

    const tree = screen.getByRole('img', { name: 'Huffman construction tree window' });
    expect(tree.querySelectorAll('[data-huffman-node]')).toHaveLength(4);
    expect(screen.getByText('Showing 4 of 79 construction nodes around the selected subtree.')).toBeVisible();
    const nodeItems = within(screen.getByRole('list', { name: 'Visible tree nodes' })).getAllByRole('listitem');
    expect(nodeItems).toHaveLength(4);
    expect(nodeItems[0]).toHaveTextContent(
      'Node 78, frequency 40. 0 → node 76, frequency 16. 1 → node 77, frequency 24.',
    );
    expect(nodeItems[1]).toHaveTextContent(
      'Node 76, frequency 16. 0 → node 72, frequency 8. 1 → node 73, frequency 8 (outside this window).',
    );
    expect(nodeItems[2]).toHaveTextContent(
      'Node 77, frequency 24. 0 → node 74, frequency 8 (outside this window). 1 → node 75, frequency 16 (outside this window).',
    );
    expect(nodeItems[3]).toHaveTextContent(
      'Node 72, frequency 8. 0 → node 64, frequency 4 (outside this window). 1 → node 65, frequency 4 (outside this window).',
    );

    const codeTable = screen.getByRole('table', { name: 'Huffman codes' });
    expect(within(codeTable).getAllByRole('row')).toHaveLength(17);
    expect(screen.getByText('Codes 1–16 of 40')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next codes' }));
    expect(screen.getByText('Codes 17–32 of 40')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next codes' }));
    expect(screen.getByText('Codes 33–40 of 40')).toBeVisible();
    expect(within(codeTable).getAllByRole('row')).toHaveLength(9);
  });

  it('uses the independent packet decoder for equality status', () => {
    renderJourneyLab(CorruptPacketControl, definition, { lang: 'en', example: 'AAAA', sceneId: 'scene-08' });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    expect(screen.getByText('Decoded bytes exactly match the source bytes.')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Corrupt saved packet' }));
    expect(screen.getByRole('status')).toHaveTextContent('The saved packet could not be decoded independently.');
    expect(screen.getByRole('alert')).toHaveTextContent('Independent decoder rejected the packet.');
  });

  it('keeps an immutable stale run across Back/reopen, then Reset clears it', () => {
    renderJourneyLab(JourneyControls, definition, { lang: 'en', example: 'AAAA', sceneId: 'scene-08' });
    fireEvent.click(screen.getByRole('button', { name: 'Run experiment' }));
    expect(screen.getByRole('table', { name: 'Size accounting' })).toHaveTextContent('96');

    fireEvent.click(screen.getByRole('button', { name: 'Change the committed message' }));
    expect(screen.getByRole('status')).toHaveTextContent('Result for the previous message');
    expect(screen.getByText('This tree and accounting belong to the previous message.')).toBeVisible();
    expect(screen.getByRole('table', { name: 'Size accounting' })).toHaveTextContent('96');
    fireEvent.click(screen.getByRole('button', { name: 'Close Huffman lab' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Huffman lab' }));
    expect(screen.getByRole('status')).toHaveTextContent('Result for the previous message');
    expect(screen.getByRole('table', { name: 'Size accounting' })).toHaveTextContent('96');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.queryByRole('table', { name: 'Size accounting' })).not.toBeInTheDocument();
    expect(screen.getByText('Run the experiment to build a byte code and count the whole packet.')).toBeVisible();
  });
});
