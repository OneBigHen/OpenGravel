import { describe, expect, it } from 'vitest';
import { createRouterMeter, instrumentProvider, loadLine, percentile, routerLoad } from '../../../scripts/scorecard/load';
import type { ProviderCandidate, RouteCandidateProvider } from '../../../src/application/planner/route-provider';

describe('router calls and first-route seconds', () => {
  it('takes the nearest-rank 75th percentile', () => {
    expect(percentile([1, 2, 3, 4], 0.75)).toBe(3);
    expect(percentile([10, 1, 7, 3, 5, 9, 2, 8], 0.75)).toBe(8);
    expect(percentile([5], 0.75)).toBe(5);
    expect(percentile([], 0.75)).toBeNull();
  });
  it('summarises calls, first-route seconds and plans over the cap of six', () => {
    const use = (calls: number, firstCallSeconds: number | null, firstAnswerSeconds: number | null = firstCallSeconds === null ? null : firstCallSeconds / 2) => ({ routerUse: { calls, shadowCalls: 0, firstCallSeconds, firstAnswerSeconds } });
    const load = routerLoad([use(3, 2), use(4, 3), use(7, 9), use(12, null), { routerUse: null }]);
    expect(load).toMatchObject({ rides: 4, callsP75: 7, callsMax: 12, ridesOverCallCap: 2, firstCallSecondsP75: 9, firstCallSecondsMax: 9, callsP95: 12, firstAnswerSecondsP50: 1.5, firstAnswerSecondsP75: 4.5, firstAnswerSecondsP95: 4.5 });
    expect(loadLine(load)).toContain('p50 1.5, p75 4.5, p95 4.5');
    expect(loadLine(load)).toContain('75th percentile 7');
    expect(loadLine(load)).toContain('2 of 4 over the cap of 6');
    expect(loadLine(routerLoad([]))).toContain('unknown');
  });
  it('counts every router request, one at a time, in order', async () => {
    const order: string[] = [];
    let running = 0; let overlap = 0;
    const base = (async (input: RequestInfo | URL) => {
      running++; overlap = Math.max(overlap, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      order.push(String(input)); running--;
      return new Response(String(input).includes('bad') ? 'oops' : '{}', { status: String(input).includes('bad') ? 500 : 200 });
    }) as typeof fetch;
    const failures: number[] = [];
    const meter = createRouterMeter(base, call => { failures.push(call); });
    const before = meter.count();
    await Promise.all([meter.fetcher('a'), meter.fetcher('bad'), meter.fetcher('c')]);
    await meter.idle();
    expect(meter.count() - before).toBe(3);
    expect(order).toEqual(['a', 'bad', 'c']);
    expect(overlap).toBe(1);
    expect(failures).toEqual([2]);
  });
  it('times the first answer that carried a route, not the later ones', async () => {
    let clock = 1000;
    const candidate = { geometry: [] } as unknown as ProviderCandidate;
    const answers = [{ candidates: [] as ProviderCandidate[] }, { candidates: [candidate] }, { candidates: [candidate] }];
    const inner: RouteCandidateProvider = {
      id: 'x', capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: false }),
      async candidates() { clock += 2000; return answers.shift()!; },
    };
    const watched = instrumentProvider(inner, () => clock);
    expect(watched.firstRouteSeconds()).toBeNull();
    watched.start();
    await watched.provider.candidates({} as never, new AbortController().signal);
    expect(watched.firstRouteSeconds()).toBeNull();
    await watched.provider.candidates({} as never, new AbortController().signal);
    await watched.provider.candidates({} as never, new AbortController().signal);
    expect(watched.firstRouteSeconds()).toBe(4);
    expect(watched.seen).toHaveLength(2);
    expect(watched.pending()).toBe(0);
  });
});
