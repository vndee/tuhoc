import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommunicationLabFrame } from './CommunicationLabFrame';

describe('CommunicationLabFrame', () => {
  it('keeps optional prediction, try/observe content, and explanation in reading order', () => {
    render(<CommunicationLabFrame
      lang="en"
      title="Channel"
      instruction="Try one transmission."
      prediction={<p>Predict whether it arrives.</p>}
      observation={<table><tbody><tr><td>01</td></tr></tbody></table>}
      explanation={<p>The model omits retransmission.</p>}
      result="One bit changed."
      onReset={() => undefined}
      onBack={() => undefined}
    >
      <button type="button">Run transmission</button>
    </CommunicationLabFrame>);

    const prediction = screen.getByRole('region', { name: 'Predict' });
    const tryRegion = screen.getByRole('region', { name: 'Try' });
    const observeRegion = screen.getByRole('region', { name: 'Observe' });
    const table = screen.getByRole('table');
    const explanation = screen.getByRole('region', { name: 'Explain and limits' });
    expect(prediction.compareDocumentPosition(tryRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tryRegion).toContainElement(screen.getByRole('button', { name: 'Run transmission' }));
    expect(tryRegion).not.toContainElement(table);
    expect(observeRegion).toContainElement(table);
    expect(tryRegion.compareDocumentPosition(observeRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(table.compareDocumentPosition(explanation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('status')).not.toContainElement(table);
  });

  it('omits an empty prediction step', () => {
    render(<CommunicationLabFrame
      lang="vi"
      title="Kênh"
      instruction="Thử truyền."
      observation={<p>Kết quả</p>}
      explanation="Giới hạn của mô hình."
      result=""
      onReset={() => undefined}
      onBack={() => undefined}
    >
      <p>Điều khiển</p>
    </CommunicationLabFrame>);

    expect(screen.queryByRole('region', { name: 'Dự đoán' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Quan sát' })).toHaveTextContent('Kết quả');
  });
});
