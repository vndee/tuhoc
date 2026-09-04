import { t } from '@tuhoc/i18n';
import type { KeyboardEvent } from 'react';
import { LabFrame } from '../LabFrame';
import type { LabRuntimeProps } from '../runtime';
import { convolveAt, convolveImage } from './model';

export default function ConvolutionLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'convolution') {
    throw new Error(`ConvolutionLab expected definition kind "convolution", received "${definition.kind}".`);
  }

  const rows = definition.config.pixels.length - definition.config.kernel.length + 1;
  const columns = definition.config.pixels[0].length - definition.config.kernel[0].length + 1;
  const row = readBounded(value, 'row', definition.config.row, rows);
  const column = readBounded(value, 'column', definition.config.column, columns);
  const parallel = readParallel(value);
  const dotProduct = convolveAt(definition.config.pixels, definition.config.kernel, row, column);
  const featureMap = convolveImage(definition.config.pixels, definition.config.kernel);
  const move = (rowDelta: number, columnDelta: number) => onChange({
    row: Math.max(0, Math.min(rows - 1, row + rowDelta)),
    column: Math.max(0, Math.min(columns - 1, column + columnDelta)),
    parallel,
  });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') { event.preventDefault(); move(-1, 0); }
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1, 0); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(0, -1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); move(0, 1); }
  };

  return <LabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    result={`${t(lang, 'stories.lab.convolutionDotProduct', dotProduct)}; ${t(lang, 'stories.lab.convolutionOrigin', row, column)}`}
    onReset={onReset}
    onBack={onBack}
  >
    <div className="story-convolution-lab">
      <div className="story-lab-action-row">
        <button type="button" onClick={() => move(-1, 0)} disabled={row === 0}>{t(lang, 'stories.lab.convolutionMoveUp')}</button>
        <button type="button" onClick={() => move(1, 0)} disabled={row === rows - 1}>{t(lang, 'stories.lab.convolutionMoveDown')}</button>
        <button type="button" onClick={() => move(0, -1)} disabled={column === 0}>{t(lang, 'stories.lab.convolutionMoveLeft')}</button>
        <button type="button" onClick={() => move(0, 1)} disabled={column === columns - 1}>{t(lang, 'stories.lab.convolutionMoveRight')}</button>
      </div>
      <div className="story-convolution-grid" role="grid" aria-label={t(lang, 'stories.lab.convolutionInput')} tabIndex={0} onKeyDown={onKeyDown}>
        {definition.config.pixels.map((pixels, pixelRow) => <div key={pixelRow} role="row" className="story-convolution-grid-row">
          {pixels.map((pixel, pixelColumn) => {
            const inKernel = pixelRow >= row && pixelRow < row + definition.config.kernel.length && pixelColumn >= column && pixelColumn < column + definition.config.kernel[0].length;
            return <span key={`${pixelRow}-${pixelColumn}`} role="gridcell" className={inKernel ? parallel ? 'is-grouped' : 'is-kernel' : undefined} aria-label={`row ${pixelRow}, column ${pixelColumn}: ${pixel}`}>{pixel}</span>;
          })}
        </div>)}
      </div>
      <p>{t(lang, 'stories.lab.convolutionDotProduct', dotProduct)}</p>
      <p>{t(lang, 'stories.lab.convolutionOrigin', row, column)}</p>
      <label><input type="checkbox" checked={parallel} onChange={(event) => onChange({ row, column, parallel: event.currentTarget.checked })} /> {t(lang, 'stories.lab.convolutionParallel')}</label>
      <p>{parallel ? t(lang, 'stories.lab.convolutionGrouped') : t(lang, 'stories.lab.convolutionSequential')}</p>
      <table aria-label={t(lang, 'stories.lab.convolutionFeatureMap')}>
        <tbody>{featureMap.map((featureRow, featureRowIndex) => <tr key={featureRowIndex}>{featureRow.map((cell, featureColumnIndex) => <td key={featureColumnIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </LabFrame>;
}

function readBounded(value: unknown, key: 'row' | 'column', fallback: number, length: number): number {
  const candidate = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
  const number = typeof candidate === 'number' && Number.isFinite(candidate) ? Math.trunc(candidate) : fallback;
  return Math.max(0, Math.min(length - 1, number));
}

function readParallel(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).parallel === true;
}
