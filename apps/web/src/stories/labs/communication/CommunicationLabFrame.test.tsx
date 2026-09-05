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
      explanation={<p>The model omits retransmission.</p>}
      result="One bit changed."
      onReset={() => undefined}
      onBack={() => undefined}
    >
      <button type="button">Run transmission</button>
      <section aria-label="Observe"><table><tbody><tr><td>01</td></tr></tbody></table></section>
    </CommunicationLabFrame>);

    const prediction = screen.getByRole('region', { name: 'Predict' });
    const tryRegion = screen.getByRole('region', { name: 'Try' });
    const table = screen.getByRole('table');
    const explanation = screen.getByRole('region', { name: 'Explain and limits' });
    expect(prediction.compareDocumentPosition(tryRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tryRegion.contains(table)).toBe(true);
    expect(table.compareDocumentPosition(explanation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('status')).not.toContainElement(table);
  });

  it('omits an empty prediction step', () => {
    render(<CommunicationLabFrame
      lang="vi"
      title="Kênh"
      instruction="Thử truyền."
      explanation="Giới hạn của mô hình."
      result=""
      onReset={() => undefined}
      onBack={() => undefined}
    >
      <p>Điều khiển</p>
    </CommunicationLabFrame>);

    expect(screen.queryByRole('region', { name: 'Dự đoán' })).not.toBeInTheDocument();
  });
});
