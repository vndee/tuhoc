import { useId } from 'react';
import { t, type Lang } from '../../i18n';
import type { LabFallback } from '../types';

export interface StaticLabFallbackProps {
  fallback: LabFallback;
  lang: Lang;
  title: string;
  instruction: string;
  onRetry: () => void;
  onBack: () => void;
}

export function StaticLabFallback({ fallback, lang, title, instruction, onRetry, onBack }: StaticLabFallbackProps) {
  const table = fallback.table?.[lang];
  const diagram = fallback.diagram;
  const diagramId = useId();

  return <section className="story-lab-fallback" aria-label={title}>
    <h3>{title}</h3>
    <p>{instruction}</p>
    {diagram && <svg className="story-lab-fallback-diagram" role="img"
      aria-labelledby={`${diagramId}-title`} aria-describedby={`${diagramId}-description`}
      viewBox={`0 0 ${diagram.width} ${diagram.height}`} width="100%">
      <title id={`${diagramId}-title`}>{diagram.title[lang]}</title>
      <desc id={`${diagramId}-description`}>{diagram.description[lang]}</desc>
      {diagram.lines.map((line, index) => <polyline key={index}
        points={line.points.map(point => point.join(',')).join(' ')}
        fill="none" stroke="currentColor" strokeWidth={2}
        strokeDasharray={line.style === 'dashed' ? '6 4' : undefined}>
        <title>{line.label[lang]}</title>
      </polyline>)}
      {diagram.labels.map((label, index) => <text key={index} x={label.x} y={label.y}
        fill="currentColor" fontSize={12}>{label.text[lang]}</text>)}
    </svg>}
    {table ? <table>
      <caption>{fallback.diagramLabel[lang]}</caption>
      <thead><tr>{table.headers.map((header, index) => <th scope="col" key={`${index}:${header}`}>{header}</th>)}</tr></thead>
      <tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>
        {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
      </tr>)}</tbody>
    </table> : <p className="story-lab-fallback-label">{fallback.diagramLabel[lang]}</p>}
    <p>{fallback.explanation[lang]}</p>
    <div className="story-lab-fallback-actions">
      <button type="button" onClick={onRetry}>{t(lang, 'landing.catalog.retry')}</button>
      <button type="button" onClick={onBack}>{t(lang, 'stories.backToIllustration')}</button>
    </div>
  </section>;
}
