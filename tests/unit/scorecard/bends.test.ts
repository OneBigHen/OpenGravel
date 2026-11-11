import { describe, expect, it } from 'vitest';
import { measure } from '../../../scripts/scorecard/measure';
import { candidateGeometryFun } from '../../../src/application/planner/geometry-fun';
import { analyzeFrancoCurvature } from '../../../src/domain/geometry/franco-curvature';
import { haversine } from '../../../src/domain/geometry/analysis';
import { unknownEvidence } from '../../../src/domain/evidence/types';
import type { Coordinate } from '../../../src/domain/ride/types';
import type { ProviderCandidate, ProviderRouteOptions } from '../../../src/application/planner/route-provider';
import type { Ride } from '../../../scripts/scorecard/types';

const xy = (x: number, y: number): Coordinate => ({ lon: -75 + x / (111_320 * Math.cos(40 * Math.PI / 180)), lat: 40 + y / 111_195 });
// A flowing 1 km radius ridge (no tight Franco bends) and a 10 m zig-zag, the two shapes the old and new measures disagree on.
const ridge = Array.from({ length: 301 }, (_, i) => xy(1000 * Math.sin(i / 100), 1000 * (1 - Math.cos(i / 100))));
const saw = Array.from({ length: 301 }, (_, i) => xy(i * 10, i % 2 * 10));
const length = (line: readonly Coordinate[]) => line.slice(1).reduce((sum, p, i) => sum + haversine(line[i]!, p), 0);
const ride: Ride = { id: 'fixture', label: 'Fixture', source: 'corpus', mode: 'curvy', requestId: 'fixed', start: ridge[0]!, end: ridge.at(-1)! };
const options: ProviderRouteOptions = { vehicle: 'motorcycle', includeAlternatives: false, avoidHighways: false, tollPolicy: 'allow-with-warning', bike: { category: 'street', maintainedGravel: 'allow', roughTracks: 'avoid' } };
const authority = { failures: [], warnings: [], evidence: { closures: unknownEvidence<number>('No feed'), access: unknownEvidence<number>('No feed') } };
function candidate(line: readonly Coordinate[], roadClass: string, urbanDensity = 'rural', withRuns = true): ProviderCandidate {
  const meters = length(line);
  return {
    providerId: 'fixture', profile: 'motorcycle_twisty', distanceMeters: meters, durationSeconds: meters / 15, geometry: line, instructions: [],
    roadSummary: { totalMeters: meters, surfaceByRoadClassMeters: {}, curvatureMeters: {}, tollMeters: 0,
      ...(withRuns ? { roadRuns: [{ meters, surface: 'asphalt', roadClass, roadEnvironment: 'road', urbanDensity, curvatureRatio: null, toll: null, durationSeconds: null }] } : {}) },
  };
}
const measured = (c: ProviderCandidate, r: Ride = ride) => measure(c, r, options, 1, 0, authority);

describe('scorecard v2 curvy measure is the planner\'s own', () => {
  it('credits Curvy good miles with candidateGeometryFun bend metres, not raw Franco bends', () => {
    const c = candidate(ridge, 'secondary');
    const bend = candidateGeometryFun(c)!.bendMeters;
    expect(bend).toBeGreaterThan(2500);
    const m = measured(c);
    expect(m.goodMiles).toBeCloseTo(bend / 1609.344, 6);
    expect(m.goodShare).toBeCloseTo(bend / length(ridge), 6);
    // v1 only saw tight (<175 m) bends, so a sweeping ridge read as nothing.
    expect(m.v1GoodMiles).toBeCloseTo(analyzeFrancoCurvature(ridge).bendMeters / 1609.344, 6);
    expect(m.v1GoodMiles).toBeLessThan(m.goodMiles);
  });
  it('does not pay for zig-zags through town streets, which v1 counted', () => {
    const m = measured(candidate(saw, 'residential', 'residential'));
    expect(m.goodMiles).toBe(0);
    expect(m.goodShare).toBe(0);
    expect(m.v1GoodMiles).toBeGreaterThan(2);
  });
  it('leaves Gravel good miles as mapped dirt and v1 equal to v2', () => {
    const c = candidate(ridge, 'secondary');
    const dirt = { ...c, roadSummary: { ...c.roadSummary!, roadRuns: [{ ...c.roadSummary!.roadRuns![0]!, surface: 'gravel' }] } };
    const m = measured(dirt, { ...ride, mode: 'gravel' });
    expect(m.goodMiles).toBeCloseTo(length(ridge) / 1609.344, 6);
    expect(m.v1GoodMiles).toBe(m.goodMiles);
    expect(m.v1GoodShare).toBe(m.goodShare);
  });
  it('credits nothing, and says so, when road details are missing', () => {
    const m = measured(candidate(ridge, 'secondary', 'rural', false));
    expect(m.goodMiles).toBe(0);
    expect(m.unknownTrust.join(' ')).toContain('Bend measure unavailable');
  });
  it('passes the route\'s own turn instructions through, so junction corners earn nothing', () => {
    const corner = [...Array.from({ length: 101 }, (_, i) => xy(i * 10, 0)), ...Array.from({ length: 100 }, (_, i) => xy(1000, (i + 1) * 10))];
    const c = { ...candidate(corner, 'secondary'), instructions: [{ text: 'Turn left', distanceMeters: 1000, durationSeconds: 60, type: 'turn', maneuver: 'left' as const, geometryIndex: 100 }] };
    expect(measured(c).goodMiles).toBe(0);
  });
});
