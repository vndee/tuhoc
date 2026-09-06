export type RouteId = 'north' | 'middle' | 'south';

interface FictionalRouteTerrain {
  length: number;
  hard: number;
  deep: number;
}

/** Fixed teaching data in conventional units; these are not observed routes or historical measurements. */
export const FICTIONAL_ROUTE_DATA = {
  fictional: true,
  routes: {
    north: { length: 11, hard: 2, deep: 4 },
    middle: { length: 9, hard: 5, deep: 1 },
    south: { length: 13, hard: 1, deep: 2 },
  },
} as const satisfies { fictional: true; routes: Record<RouteId, FictionalRouteTerrain> };

export interface RouteCost {
  length: number;
  hard: number;
  deep: number;
  components: readonly number[];
  total: number;
}

export function routeCost(id: RouteId): RouteCost {
  if (!Object.hasOwn(FICTIONAL_ROUTE_DATA.routes, id)) throw new RangeError('invalid-route-id');
  const { length, hard, deep } = FICTIONAL_ROUTE_DATA.routes[id];
  const components = [length, 4 * hard, 2 * deep];
  return {
    length,
    hard,
    deep,
    components,
    total: components.reduce((sum, component) => sum + component, 0),
  };
}
