import { describe, expect, it } from 'vitest';
import { FICTIONAL_ROUTE_DATA, routeCost, type RouteId } from './model';

describe('cable-route model', () => {
  it('applies the published component weights to every fictional route', () => {
    expect(['north', 'middle', 'south'].map((id) => routeCost(id as RouteId).total)).toEqual([27, 31, 21]);
    expect(routeCost('south')).toMatchObject({
      length: 13,
      hard: 1,
      deep: 2,
      components: [13, 4, 4],
      total: 21,
    });
  });

  it('keeps the route dataset explicitly fictional and independent from returned components', () => {
    expect(FICTIONAL_ROUTE_DATA.fictional).toBe(true);
    const first = routeCost('north');
    const second = routeCost('north');

    expect(first.components).not.toBe(second.components);
  });

  it.each(['west', 'toString', '__proto__'])('rejects invalid runtime route id %s with a content-free code', (id) => {
    expect(() => routeCost(id as RouteId)).toThrowError(new RangeError('invalid-route-id'));
  });
});
