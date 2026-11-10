import { expect, it } from 'vitest';
import { measure } from '../../../scripts/scorecard/measure';
import { unknownEvidence } from '../../../src/domain/evidence/types';
import type { ProviderCandidate, ProviderRoadRun, ProviderRouteOptions } from '../../../src/application/planner/route-provider';
import type { Ride } from '../../../scripts/scorecard/types';
const ride: Ride = { id: 'fixture', label: 'Fixture', source: 'corpus', mode: 'gravel', requestId: 'fixed', start: { lat: 40, lon: -77 }, end: { lat: 40.01, lon: -77 } };
const options: ProviderRouteOptions = { vehicle: 'motorcycle', includeAlternatives: false, avoidHighways: false, tollPolicy: 'allow-with-warning', bike: { category: 'adventure', maintainedGravel: 'allow', roughTracks: 'avoid' } };
const authority = { failures: [], warnings: [], evidence: { closures: unknownEvidence<number>('No feed'), access: unknownEvidence<number>('No feed') } };
function candidate(runs: Partial<ProviderRoadRun>[]): ProviderCandidate {
  return { providerId: 'fixture', profile: 'motorcycle_fastest', distanceMeters: 1000, durationSeconds: 120, geometry: [ride.start, ride.end!], instructions: [], roadSummary: {
    totalMeters: 1000, surfaceByRoadClassMeters: {}, curvatureMeters: {}, tollMeters: 0,
    roadRuns: runs.map(r => ({ meters: 500, surface: 'missing', roadClass: 'tertiary', roadEnvironment: 'road', urbanDensity: 'rural', curvatureRatio: null, toll: null, durationSeconds: null, ...r })),
  } };
}
it('never credits unknown surfaces as dirt and weights busy and unknown by distance', () => {
  const m = measure(candidate([{ surface: 'gravel' }, { roadClass: 'primary' }]), ride, options, 1, 0.5, authority);
  expect(m.goodMiles).toBeCloseTo(500 / 1609.344);
  expect(m.busyShare).toBe(0.5);
  expect(m.unknownSurfaceShare).toBe(0.5);
  expect(m.extraMinutes).toBe(1);
  expect(m.unknownTrust).toContain('Road-authority closure coverage incomplete');
});
it('checks access, sand and bike roughness identically for any contestant', () => {
  const m = measure(candidate([{ surface: 'sand', roadAccess: 'private' }, { trackType: 'grade4', smoothness: 'bad' }]), ride, options, 1, 0, authority);
  expect(m.trustFailures).toEqual(expect.arrayContaining(['access-prohibited', 'sand', 'bike-incompatible']));
  const dual = measure(candidate([{ trackType: 'grade4', smoothness: 'bad' }, { surface: 'asphalt' }]), { ...ride, mode: 'dual-sport' }, { ...options, bike: { category: 'dual-sport', maintainedGravel: 'allow', roughTracks: 'allow' } }, 1, 0, authority);
  expect(dual.trustFailures).not.toContain('bike-incompatible');
});
it('does not call missing ordered road details clear', () => {
  const m = measure({ ...candidate([]), roadSummary: undefined, instructions: undefined }, ride, options, 1, 0, authority);
  expect(m.busyShare).toBeNull(); expect(m.dirtShare).toBeNull(); expect(m.unknownSurfaceShare).toBe(1);
  expect(m.unknownTrust.length).toBeGreaterThan(0);
});
it('reports an official closure on the route', () => {
  expect(measure(candidate([{ surface: 'asphalt', meters: 1000 }]), ride, options, 1, 0, { ...authority, failures: [{ code: 'road-closed', message: 'Seasonal gate closed' }] }).trustFailures).toContain('road-closed: Seasonal gate closed');
});
