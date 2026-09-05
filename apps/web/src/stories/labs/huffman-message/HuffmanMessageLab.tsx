import { useRequiredMessageJourney } from '../../session/StoryIssueSessionProvider';
import { CommunicationLabFrame } from '../communication/CommunicationLabFrame';
import { MessageEditor } from '../communication/MessageEditor';
import type { Bytes, RunSnapshot } from '../communication/types';
import { inspectUnicode } from '../communication/unicode';
import type { LabRuntimeProps } from '../runtime';
import { decodeHuffman, encodeHuffman, type HuffmanNode, type HuffmanPacket } from './codec';
import { huffmanMessageCopy } from './copy';
import { visibleHuffmanMerges } from './model';

interface HuffmanMessageState {
  step: number;
  page: number;
  snapshot: RunSnapshot<Record<string, never>, HuffmanPacket> | null;
}

const CODES_PER_PAGE = 16;

export default function HuffmanMessageLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'huffman-message') {
    throw new Error(`HuffmanMessageLab expected definition kind "huffman-message", received "${definition.kind}".`);
  }

  const journey = useRequiredMessageJourney();
  const copy = huffmanMessageCopy[lang];
  const inspection = inspectUnicode(journey.state.messageText);
  if (!inspection.ok || inspection.value.bytes.length === 0) throw new Error('invalid-message-source');
  const state = readState(value);
  const snapshot = state.snapshot;
  const stale = snapshot !== null && snapshot.messageRevision !== journey.state.messageRevision;
  const decoded = snapshot === null ? null : decodeHuffman(snapshot.result.container);
  const exact = snapshot !== null && decoded?.ok === true && sameBytes(decoded.value, snapshot.source);
  const run = () => {
    const encoded = encodeHuffman(inspection.value.bytes);
    if (!encoded.ok) return;
    onChange({
      step: 0,
      page: 0,
      snapshot: makeSnapshot(journey.state.messageRevision, inspection.value.bytes, encoded.value),
    });
  };
  const status = snapshot === null
    ? ''
    : stale
      ? <><span aria-hidden="true">↺</span>{' '}{copy.staleStatus}</>
      : !decoded?.ok
        ? <><span aria-hidden="true">!</span>{' '}{copy.decoderRejectedStatus}</>
        : !exact
          ? <><span aria-hidden="true">!</span>{' '}{copy.mismatch}</>
          : snapshot.result.totalBits > snapshot.source.length * 8
            ? <><span aria-hidden="true">↑</span>{' '}{copy.larger}</>
            : snapshot.result.totalBits < snapshot.source.length * 8
              ? <><span aria-hidden="true">↓</span>{' '}{copy.smaller}</>
              : <><span aria-hidden="true">◆</span>{' '}{copy.equal}</>;

  return <CommunicationLabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    prediction={<p>{copy.prediction}</p>}
    observation={snapshot === null
      ? <p>{copy.awaiting}</p>
      : <HuffmanObservation
        snapshot={snapshot}
        step={state.step}
        page={state.page}
        maxVisibleNodes={definition.config.maxVisibleNodes}
        stale={stale}
        decoderOk={decoded?.ok === true}
        exact={exact}
        labels={copy}
        onPage={(page) => onChange({ ...state, page })}
      />}
    explanation={<div>
      <p>{copy.feedback}</p>
      <p>{copy.teachingNotice}</p>
      <p>{copy.modelLimit}</p>
    </div>}
    result={status}
    onReset={onReset}
    onBack={onBack}
  >
    <MessageEditor lang={lang} />
    <button type="button" onClick={run}>{copy.run}</button>
    {snapshot === null ? null : <div className="huffman-message-step-controls">
      <button
        type="button"
        disabled={state.step >= snapshot.result.merges.length}
        onClick={() => onChange({ ...state, step: Math.min(snapshot.result.merges.length, state.step + 1) })}
      >{copy.step}</button>
      <button
        type="button"
        disabled={state.step >= snapshot.result.merges.length}
        onClick={() => onChange({ ...state, step: snapshot.result.merges.length })}
      >{copy.complete}</button>
    </div>}
  </CommunicationLabFrame>;
}

function HuffmanObservation({ snapshot, step, page, maxVisibleNodes, stale, decoderOk, exact, labels, onPage }: {
  snapshot: RunSnapshot<Record<string, never>, HuffmanPacket>;
  step: number;
  page: number;
  maxVisibleNodes: number;
  stale: boolean;
  decoderOk: boolean;
  exact: boolean;
  labels: typeof huffmanMessageCopy.en;
  onPage: (page: number) => void;
}) {
  const packet = snapshot.result;
  const merges = visibleHuffmanMerges(packet, step);
  const visibleNodes = selectedTreeWindow(packet, merges.length, maxVisibleNodes);
  const pageCount = Math.max(1, Math.ceil(packet.codes.length / CODES_PER_PAGE));
  const activePage = Math.min(page, pageCount - 1);
  const start = activePage * CODES_PER_PAGE;
  const codes = packet.codes.slice(start, start + CODES_PER_PAGE);
  const sizeRows = [
    [labels.raw, snapshot.source.length * 8],
    [labels.payload, packet.payloadBits],
    [labels.header, packet.headerBits],
    [labels.padding, packet.paddingBits],
    [labels.total, packet.totalBits],
  ] as const;

  return <div className="huffman-message-observation">
    {stale ? <p>{labels.staleBanner}</p> : null}
    <p>{labels.byteSummary(snapshot.source.length, packet.codes.length)}</p>
    <p>{labels.mergeProgress(merges.length, packet.merges.length)}</p>
    <HuffmanTree nodes={visibleNodes} labels={labels} />
    <p>{labels.treeWindow(visibleNodes.length, packet.nodes.length)}</p>
    <AccessibleTreeWindow nodes={visibleNodes} packet={packet} labels={labels} />
    <section aria-label={labels.mergeHistory}>
      <h5>{labels.mergeHistory}</h5>
      {merges.length === 0 ? <p>{labels.noMerges}</p> : <ol>{merges.slice(-8).map((merge) => <li key={merge.parent}>
        {labels.merge(
          nodeShortLabel(packet.nodes[merge.left]!, labels),
          nodeShortLabel(packet.nodes[merge.right]!, labels),
          merge.parent,
        )}
      </li>)}</ol>}
    </section>
    <table aria-label={labels.codesTable}>
      <thead><tr><th>{labels.byte}</th><th>{labels.count}</th><th>{labels.code}</th><th>{labels.length}</th></tr></thead>
      <tbody>{codes.map((entry) => <tr key={entry.byte}>
        <th scope="row">{byteHex(entry.byte)}</th>
        <td>{entry.count}</td>
        <td><code>{entry.code}</code></td>
        <td>{entry.code.length}</td>
      </tr>)}</tbody>
    </table>
    <p>{labels.codeRange(start + 1, start + codes.length, packet.codes.length)}</p>
    <div className="huffman-message-code-pages">
      <button type="button" disabled={activePage === 0} onClick={() => onPage(activePage - 1)}>{labels.previousCodes}</button>
      <button type="button" disabled={activePage >= pageCount - 1} onClick={() => onPage(activePage + 1)}>{labels.nextCodes}</button>
    </div>
    <table aria-label={labels.sizeTable}>
      <thead><tr><th>{labels.sizePart}</th><th>{labels.bits}</th></tr></thead>
      <tbody>{sizeRows.map(([label, bits]) => <tr key={label}><th scope="row">{label}</th><td>{bits}</td></tr>)}</tbody>
    </table>
    {!decoderOk ? <p role="alert">{labels.decoderRejected}</p> : <p>{exact ? labels.exact : labels.mismatch}</p>}
  </div>;
}

function AccessibleTreeWindow({ nodes, packet, labels }: {
  nodes: readonly HuffmanNode[];
  packet: HuffmanPacket;
  labels: typeof huffmanMessageCopy.en;
}) {
  const visibleIds = new Set(nodes.map((node) => node.id));
  return <ul aria-label={labels.visibleNodes}>{nodes.map((node) => <li key={node.id}>
    {nodeLabel(node, labels)}.{node.byte !== null ? <>{' '}{labels.leafBoundary}</> : <>
      {' '}{edgeLabel(0, packet.nodes[node.left!]!, visibleIds, labels)}
      {' '}{edgeLabel(1, packet.nodes[node.right!]!, visibleIds, labels)}
    </>}
  </li>)}</ul>;
}

function edgeLabel(
  bit: 0 | 1,
  child: HuffmanNode,
  visibleIds: ReadonlySet<number>,
  labels: typeof huffmanMessageCopy.en,
): string {
  return labels.edge(bit, nodeShortLabel(child, labels), child.count, !visibleIds.has(child.id));
}

function HuffmanTree({ nodes, labels }: { nodes: readonly HuffmanNode[]; labels: typeof huffmanMessageCopy.en }) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const rows = Math.max(1, Math.ceil(nodes.length / columns));
  const width = 720;
  const height = Math.max(180, rows * 90);
  const positions = new Map(nodes.map((node, index) => [node.id, {
    x: ((index % columns) + 0.5) * (width / columns),
    y: (Math.floor(index / columns) + 0.5) * (height / rows),
  }]));

  return <svg role="img" aria-label={labels.tree} viewBox={`0 0 ${width} ${height}`}>
    {nodes.flatMap((node) => [node.left, node.right].flatMap((child) => {
      if (child === null || !nodeIds.has(child)) return [];
      const from = positions.get(node.id)!;
      const to = positions.get(child)!;
      return [<line key={`${node.id}-${child}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="currentColor" opacity="0.4" />];
    }))}
    {nodes.map((node) => {
      const position = positions.get(node.id)!;
      return <g key={node.id} data-huffman-node={node.id} transform={`translate(${position.x} ${position.y})`}>
        <circle r="28" fill="none" stroke="currentColor" />
        <text textAnchor="middle" y="-2">{node.byte === null ? `#${node.id}` : byteHex(node.byte)}</text>
        <text textAnchor="middle" y="16">×{node.count}</text>
      </g>;
    })}
  </svg>;
}

function selectedTreeWindow(packet: HuffmanPacket, step: number, limit: number): HuffmanNode[] {
  const max = Math.max(1, Math.min(32, Math.trunc(limit)));
  const selected = step === 0 ? null : packet.merges[Math.min(step, packet.merges.length) - 1]!.parent;
  const queue = selected === null
    ? packet.nodes.filter((node) => node.byte !== null).map((node) => node.id)
    : [selected];
  const ids: number[] = [];
  const seen = new Set<number>();
  while (queue.length > 0 && ids.length < max) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    const node = packet.nodes[id]!;
    if (node.left !== null) queue.push(node.left);
    if (node.right !== null) queue.push(node.right);
  }
  return ids.map((id) => packet.nodes[id]!);
}

function nodeShortLabel(node: HuffmanNode, labels: typeof huffmanMessageCopy.en): string {
  return node.byte === null ? labels.shortNode(node.id) : byteHex(node.byte);
}

function nodeLabel(node: HuffmanNode, labels: typeof huffmanMessageCopy.en): string {
  return node.byte === null ? labels.branchNode(node.id, node.count) : labels.leafNode(byteHex(node.byte), node.count);
}

function byteHex(byte: number): string {
  return `0x${byte.toString(16).padStart(2, '0').toUpperCase()}`;
}

function makeSnapshot(messageRevision: number, source: Bytes, packet: HuffmanPacket): RunSnapshot<Record<string, never>, HuffmanPacket> {
  return Object.freeze({
    messageRevision,
    source: Object.freeze([...source]),
    config: Object.freeze({}),
    result: Object.freeze({
      ...packet,
      container: Object.freeze([...packet.container]),
      nodes: Object.freeze(packet.nodes.map((node) => Object.freeze({ ...node }))),
      merges: Object.freeze(packet.merges.map((merge) => Object.freeze({ ...merge }))),
      codes: Object.freeze(packet.codes.map((code) => Object.freeze({ ...code }))),
    }),
  });
}

function readState(value: unknown): HuffmanMessageState {
  if (typeof value !== 'object' || value === null) return initialState();
  const candidate = value as Partial<HuffmanMessageState>;
  return {
    step: Number.isSafeInteger(candidate.step) && candidate.step! >= 0 ? candidate.step! : 0,
    page: Number.isSafeInteger(candidate.page) && candidate.page! >= 0 ? candidate.page! : 0,
    snapshot: isSnapshot(candidate.snapshot) ? candidate.snapshot : null,
  };
}

function initialState(): HuffmanMessageState {
  return { step: 0, page: 0, snapshot: null };
}

function isSnapshot(value: unknown): value is RunSnapshot<Record<string, never>, HuffmanPacket> {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<RunSnapshot<Record<string, never>, HuffmanPacket>>;
  if (!Number.isSafeInteger(snapshot.messageRevision) || !isBytes(snapshot.source) ||
    typeof snapshot.config !== 'object' || snapshot.config === null ||
    typeof snapshot.result !== 'object' || snapshot.result === null) return false;
  const packet = snapshot.result as Partial<HuffmanPacket>;
  return isBytes(packet.container) && Array.isArray(packet.nodes) && Array.isArray(packet.merges) &&
    Array.isArray(packet.codes) && [packet.payloadBits, packet.headerBits, packet.paddingBits, packet.totalBits]
      .every((number) => Number.isSafeInteger(number) && number! >= 0);
}

function isBytes(value: unknown): value is Bytes {
  return Array.isArray(value) && value.every((byte, index) => Object.hasOwn(value, index) &&
    Number.isInteger(byte) && byte >= 0 && byte <= 255);
}

function sameBytes(left: Bytes, right: Bytes): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
