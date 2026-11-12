import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { measureRoadBends, ROAD_BENDS_VERSION } from '@/domain/geometry/road-bends';
import { buildFixture, FIXTURES, type RoadBendFixture } from '../../../scripts/geometry/write-road-bend-fixtures';

/**
 * The shared road-bend fixtures pin the app's bend measure. The router's og_curve raw pass
 * (infra/graphhopper/moto/ext/OgChecks.java) reads the same files, so if this measure changes,
 * these files must be rewritten (scripts/geometry/write-road-bend-fixtures.ts) and the router
 * check re-run: the graph and the app must keep counting the same bends.
 */
const dir = 'tests/fixtures/road-bends';
const fixtures = readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as RoadBendFixture);
const byName = new Map(fixtures.map(f => [f.name, f]));

describe('road-bend fixtures shared with the router', () => {
  it('has the ten fixtures the writer makes, unchanged', () => {
    expect(fixtures.map(f => f.name)).toEqual(FIXTURES.map(f => f.name));
    for (const spec of FIXTURES) expect(buildFixture(spec)).toEqual(byName.get(spec.name));
  });

  it.each(fixtures.map(f => [f.name, f] as const))('%s still measures as written', (_name, fixture) => {
    const result = measureRoadBends(fixture.line, [fixture.run]);
    expect(result?.version).toBe(ROAD_BENDS_VERSION);
    expect(result!.bendMeters).toBeCloseTo(fixture.expected.bendMeters, 6);
    expect(result!.tightMeters).toBeCloseTo(fixture.expected.tightMeters, 6);
  });

  it('reads like a rider would', () => {
    const share = (name: string): number => byName.get(name)!.expected.bendShare;
    expect(share('01-straight')).toBe(0);
    expect(share('08-town-street')).toBe(0);
    expect(share('09-primary-sweeper')).toBe(0);
    expect(share('10-primary-tight')).toBeGreaterThan(0);
    expect(share('04-hairpins-25')).toBeGreaterThan(share('02-sweeper-150'));
    expect(share('06-s-bends-60')).toBeGreaterThan(share('05-zigzag') * 3);
  });
});
