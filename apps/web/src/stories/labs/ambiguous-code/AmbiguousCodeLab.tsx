import type { Codebook, SymbolId } from '../communication/types';
import { CommunicationLabFrame } from '../communication/CommunicationLabFrame';
import type { LabRuntimeProps } from '../runtime';
import { ambiguousCodeCopy } from './copy';
import { decodePaths, encodeSymbols, isValidCodebook, isValidSourceSymbols, SYMBOL_IDS, type DecodeSummary } from './model';

interface DecodeRun {
  book: Codebook;
  symbols: string;
  bits: string;
  decoding: DecodeSummary;
}

interface AmbiguousCodeState {
  book: Codebook;
  symbols: string;
  result: DecodeRun | null;
}

const PREFIX_FREE_BOOK: Codebook = { A: '00', B: '01', C: '10', D: '11' };

export default function AmbiguousCodeLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'ambiguous-code') {
    throw new Error(`AmbiguousCodeLab expected definition kind "ambiguous-code", received "${definition.kind}".`);
  }

  const copy = ambiguousCodeCopy[lang];
  const state = readState(value, definition.config.initialBook, definition.config.initialSymbols);
  const validBook = isValidCodebook(state.book);
  const validSymbols = isValidSourceSymbols(state.symbols);
  const invalidMessage = !validBook ? copy.invalidCodebook : !validSymbols ? copy.invalidSymbols : '';
  const prefixFree = isPrefixFree(state.book);

  const updateBook = (symbol: SymbolId, code: string) => onChange({
    ...state,
    book: { ...state.book, [symbol]: code },
  });
  const updateSymbols = (symbols: string) => onChange({ ...state, symbols });
  const send = () => {
    const encoded = encodeSymbols(state.symbols, state.book);
    if (!encoded.ok) return;
    const decoded = decodePaths(encoded.value, state.book);
    if (!decoded.ok) return;
    onChange({
      ...state,
      result: {
        book: { ...state.book },
        symbols: state.symbols,
        bits: encoded.value,
        decoding: decoded.value,
      },
    });
  };

  return <CommunicationLabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    observation={state.result
      ? <DecodeObservation run={state.result} labels={copy} />
      : <p>{copy.awaitingSend}</p>}
    explanation={<p>{copy.explanation}</p>}
    result={state.result ? copy.result(state.result.decoding.count) : ''}
    onReset={onReset}
    onBack={onBack}
  >
    <fieldset className="ambiguous-code-book">
      <legend>{copy.currentBook}</legend>
      {SYMBOL_IDS.map((symbol) => <label key={symbol}>
        {copy.codeFor(symbol)}
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={state.book[symbol]}
          aria-invalid={!/^[01]{1,6}$/.test(state.book[symbol]) || undefined}
          onChange={(event) => updateBook(symbol, event.currentTarget.value)}
        />
      </label>)}
    </fieldset>
    {validBook ? <p>{prefixFree ? copy.prefixFree : copy.prefixCollision}</p> : null}
    <div className="ambiguous-code-symbol-picker" aria-label={copy.addSymbol}>
      {SYMBOL_IDS.map((symbol) => <button
        key={symbol}
        type="button"
        disabled={state.symbols.length >= 6}
        onClick={() => updateSymbols(`${state.symbols}${symbol}`)}
      >{symbol}</button>)}
    </div>
    <div className="ambiguous-code-source" aria-label={copy.sourceSymbols}>{state.symbols}</div>
    <div className="ambiguous-code-actions">
      <button type="button" disabled={state.symbols.length === 0} onClick={() => updateSymbols(state.symbols.slice(0, -1))}>{copy.deleteLast}</button>
      <button type="button" disabled={state.symbols.length === 0} onClick={() => updateSymbols('')}>{copy.clear}</button>
      <button type="button" onClick={() => onChange({ ...state, book: { ...PREFIX_FREE_BOOK } })}>{copy.preset}</button>
      <button type="button" disabled={Boolean(invalidMessage)} onClick={send}>{copy.send}</button>
    </div>
    {invalidMessage ? <p role="alert">{invalidMessage}</p> : null}
  </CommunicationLabFrame>;
}

function readState(value: unknown, fallbackBook: Codebook, fallbackSymbols: string): AmbiguousCodeState {
  if (typeof value !== 'object' || value === null) {
    return { book: { ...fallbackBook }, symbols: fallbackSymbols, result: null };
  }
  const candidate = value as Partial<AmbiguousCodeState>;
  const book = candidate.book;
  const hasBook = typeof book === 'object' && book !== null && SYMBOL_IDS.every((symbol) => typeof book[symbol] === 'string');
  return {
    book: hasBook ? { A: book.A, B: book.B, C: book.C, D: book.D } : { ...fallbackBook },
    symbols: typeof candidate.symbols === 'string' ? candidate.symbols : fallbackSymbols,
    result: isDecodeRun(candidate.result) ? candidate.result : null,
  };
}

function isDecodeRun(value: unknown): value is DecodeRun {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Partial<DecodeRun>;
  return typeof run.bits === 'string' && typeof run.symbols === 'string' && typeof run.book === 'object' && run.book !== null &&
    typeof run.decoding === 'object' && run.decoding !== null && typeof run.decoding.count === 'string' &&
    Array.isArray(run.decoding.readings) && typeof run.decoding.truncated === 'boolean';
}

function isPrefixFree(book: Codebook): boolean {
  if (!isValidCodebook(book)) return false;
  return SYMBOL_IDS.every((symbol, index) => SYMBOL_IDS.every((other, otherIndex) =>
    index === otherIndex || !book[other].startsWith(book[symbol]),
  ));
}

function DecodeObservation({ run, labels }: { run: DecodeRun; labels: typeof ambiguousCodeCopy.en }) {
  return <div className="ambiguous-code-observation">
    <p aria-label={labels.sentSymbols}><strong>{labels.sentSymbols}:</strong> {run.symbols}</p>
    <p><strong>{labels.signal}:</strong> <code>{run.bits}</code></p>
    <DecodeGraph bits={run.bits} book={run.book} label={labels.treeLabel} />
    <section aria-label={labels.readings}>
      <h5>{labels.readings}</h5>
      {run.decoding.readings.length === 0
        ? <p>{labels.noReadings}</p>
        : <ol>{run.decoding.readings.map((reading, index) => <li key={`${reading}-${index}`}>{reading}</li>)}</ol>}
      <p>{labels.exactTotal(run.decoding.count)}</p>
      {run.decoding.truncated ? <p>{labels.hiddenReadings}</p> : null}
    </section>
    <table aria-label={labels.sentBook}>
      <thead><tr><th>{labels.symbol}</th><th>{labels.code}</th></tr></thead>
      <tbody>{SYMBOL_IDS.map((symbol) => <tr key={symbol}><th scope="row">{symbol}</th><td><code>{run.book[symbol]}</code></td></tr>)}</tbody>
    </table>
  </div>;
}

interface GraphEdge {
  from: number;
  to: number;
  symbol: SymbolId;
  lane: number;
}

function DecodeGraph({ bits, book, label }: { bits: string; book: Codebook; label: string }) {
  const reachable = new Set<number>([0]);
  const candidates: Omit<GraphEdge, 'lane'>[] = [];
  for (let offset = 0; offset < bits.length; offset += 1) {
    if (!reachable.has(offset)) continue;
    for (const symbol of SYMBOL_IDS) {
      const code = book[symbol];
      if (bits.startsWith(code, offset)) {
        const to = offset + code.length;
        reachable.add(to);
        candidates.push({ from: offset, to, symbol });
      }
    }
  }
  const canFinish = new Set<number>([bits.length]);
  for (let offset = bits.length - 1; offset >= 0; offset -= 1) {
    if (candidates.some((edge) => edge.from === offset && canFinish.has(edge.to))) canFinish.add(offset);
  }
  const edges = candidates.filter((edge) => canFinish.has(edge.to)).map((edge, lane) => ({ ...edge, lane }));
  const graphWidth = 720;
  const baseline = 150;
  const x = (offset: number) => 32 + (bits.length === 0 ? 0 : offset / bits.length) * 656;

  return <div className="communication-diagram-viewport" tabIndex={0} role="region" aria-label={label}>
    <svg role="img" aria-label={label} viewBox={`0 0 ${graphWidth} 190`} width={graphWidth} className="ambiguous-code-tree">
    {edges.map((edge) => {
      const rise = 24 + ((edge.lane % 5) * 18);
      const middle = (x(edge.from) + x(edge.to)) / 2;
      return <g key={`${edge.from}-${edge.to}-${edge.symbol}-${edge.lane}`} data-symbol-path={`${edge.from}-${edge.symbol}-${edge.to}`}>
        <path d={`M ${x(edge.from)} ${baseline} Q ${middle} ${baseline - rise} ${x(edge.to)} ${baseline}`} fill="none" stroke="currentColor" />
        <text x={middle} y={baseline - rise - 3} textAnchor="middle">{edge.symbol}={book[edge.symbol]}</text>
      </g>;
    })}
    {[...reachable].filter((offset) => canFinish.has(offset)).map((offset) => <g key={offset}>
      <circle cx={x(offset)} cy={baseline} r="6" fill="currentColor" />
      <text x={x(offset)} y={baseline + 22} textAnchor="middle">{offset}</text>
    </g>)}
  </svg></div>;
}
