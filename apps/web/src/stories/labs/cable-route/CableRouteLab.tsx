import { CommunicationLabFrame } from '../communication/CommunicationLabFrame';
import type { LabRuntimeProps } from '../runtime';
import { cableRouteCopy } from './copy';
import { routeCost, type RouteId } from './model';

interface CableRouteState {
  route: RouteId;
  budget: number;
  step: number;
}

const ROUTE_IDS: readonly RouteId[] = ['north', 'middle', 'south'];
const PROFILE_PATHS: Record<RouteId, string> = {
  north: 'M8 20 C26 5 42 35 60 18 S94 8 112 24',
  middle: 'M8 14 C27 38 39 4 58 26 S88 34 112 12',
  south: 'M8 13 C31 24 48 18 68 29 S95 28 112 16',
};

export default function CableRouteLab({ definition, lang, value, onChange, onReset, onBack }: LabRuntimeProps) {
  if (definition.kind !== 'cable-route') {
    throw new Error(`CableRouteLab expected definition kind "cable-route", received "${definition.kind}".`);
  }

  const copy = cableRouteCopy[lang];
  const state = readState(value, definition.config.defaultBudget);
  const selected = routeCost(state.route);
  const shortfall = Math.max(0, selected.total - state.budget);
  const margin = Math.max(0, state.budget - selected.total);
  const status = shortfall > 0
    ? copy.shortBy(shortfall)
    : margin === 0 ? copy.enoughExact : copy.enoughWithMargin(margin);
  const update = (next: Partial<CableRouteState>) => onChange({ ...state, ...next });

  return <CommunicationLabFrame
    lang={lang}
    title={definition.title[lang]}
    instruction={definition.instruction[lang]}
    prediction={<p>{copy.prediction}</p>}
    observation={<RouteObservation route={state.route} budget={state.budget} step={state.step} labels={copy} />}
    explanation={<div>
      <p>{copy.feedback}</p>
      <p>{copy.fictionalLimit}</p>
      <p>{copy.excludedFactors}</p>
    </div>}
    result={status}
    onReset={onReset}
    onBack={onBack}
  >
    <fieldset>
      <legend>{copy.routes}</legend>
      {ROUTE_IDS.map((route) => {
        const cost = routeCost(route);
        const name = copy.routeName[route];
        return <label key={route}>
          <input
            type="radio"
            name="cable-route"
            value={route}
            checked={state.route === route}
            onChange={() => update({ route })}
          />
          <span>{copy.routeOption(name, cost.length, cost.hard, cost.deep)}</span>
          <RouteProfile route={route} label={copy.profile(name)} />
        </label>;
      })}
    </fieldset>
    <label>
      {copy.budget}
      <input
        type="number"
        aria-label={copy.budget}
        min={15}
        max={40}
        step={1}
        value={state.budget}
        onChange={(event) => {
          const budget = event.currentTarget.valueAsNumber;
          if (Number.isInteger(budget) && budget >= 15 && budget <= 40) update({ budget });
        }}
      />
      <span>{copy.units}</span>
    </label>
    <button type="button" disabled={state.step >= 3} onClick={() => update({ step: Math.min(3, state.step + 1) })}>
      {state.step >= 3 ? copy.allRevealed : copy.revealNext}
    </button>
  </CommunicationLabFrame>;
}

function RouteProfile({ route, label }: { route: RouteId; label: string }) {
  return <svg role="img" aria-label={label} viewBox="0 0 120 40" data-route={route}>
    <path d="M4 6 V34 H116" fill="none" stroke="currentColor" opacity="0.35" />
    <path d={PROFILE_PATHS[route]} fill="none" stroke="currentColor" strokeWidth="3" />
  </svg>;
}

function RouteObservation({ route, budget, step, labels }: {
  route: RouteId;
  budget: number;
  step: number;
  labels: typeof cableRouteCopy.en;
}) {
  const cost = routeCost(route);
  const shortfall = Math.max(0, cost.total - budget);
  const componentRows = [
    [labels.length, `L = ${cost.length}`, cost.components[0]],
    [labels.hard, `4 × H = 4 × ${cost.hard}`, cost.components[1]],
    [labels.deep, `2 × D = 2 × ${cost.deep}`, cost.components[2]],
  ] as const;

  return <div>
    <p>{step === 0 ? labels.awaiting : `${step}/3`}</p>
    <table aria-label={labels.table}>
      <thead><tr><th>{labels.item}</th><th>{labels.calculation}</th><th>{labels.value}</th></tr></thead>
      <tbody>
        <tr><th scope="row">{labels.formula}</th><td>C = L + 4H + 2D</td><td>—</td></tr>
        {componentRows.slice(0, step).map(([label, calculation, component]) => <tr key={label}>
          <th scope="row">{label}</th><td>{calculation}</td><td>{component}</td>
        </tr>)}
        <tr><th scope="row">{labels.total}</th><td>{step >= 3 ? cost.components.join(' + ') : '—'}</td><td>{cost.total}</td></tr>
        <tr><th scope="row">{labels.shortfall}</th><td>max(0, {cost.total} − {budget})</td><td>{shortfall}</td></tr>
      </tbody>
    </table>
  </div>;
}

function readState(value: unknown, defaultBudget: number): CableRouteState {
  if (typeof value !== 'object' || value === null) return { route: 'south', budget: defaultBudget, step: 0 };
  const candidate = value as Partial<CableRouteState>;
  return {
    route: isRoute(candidate.route) ? candidate.route : 'south',
    budget: isIntegerInRange(candidate.budget, 15, 40) ? candidate.budget : defaultBudget,
    step: isIntegerInRange(candidate.step, 0, 3) ? candidate.step : 0,
  };
}

function isRoute(value: unknown): value is RouteId {
  return typeof value === 'string' && ROUTE_IDS.includes(value as RouteId);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
