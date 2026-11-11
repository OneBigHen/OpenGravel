import { describe, expect, it } from 'vitest';
import { chunkAnchors, MIN_SNAP_COVERAGE, pickAnchors, snapProfileFor, snapRiderLine, stitchPieces } from '../../../scripts/scorecard/rider-line';
import { measure } from '../../../scripts/scorecard/measure';
import { riderMatch } from '../../../scripts/scorecard/geometry';
import { GraphHopperProviderError } from '../../../src/infrastructure/routing/graphhopper/response-parser';
import { haversine } from '../../../src/domain/geometry/analysis';
import { unknownEvidence } from '../../../src/domain/evidence/types';
import type { Coordinate } from '../../../src/domain/ride/types';
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from '../../../src/application/planner/route-provider';
import type { Ride } from '../../../scripts/scorecard/types';

// A winding "rider track" on a rural secondary road: one vertex every 200 m, a bend every 2.5 km.
const at = (i: number): Coordinate => ({ lon: -75 + i * 0.0023, lat: 40 + 0.012 * Math.sin(i / 4) });
const track = Array.from({ length: 101 }, (_, i) => at(i));
const key = (p: Coordinate) => `${p.lon.toFixed(7)},${p.lat.toFixed(7)}`;
const trackIndex = new Map(track.map((p, i) => [key(p), i]));
const length = (line: readonly Coordinate[]) => line.slice(1).reduce((sum, p, i) => sum + haversine(line[i]!, p), 0);

/** A fake router: follows the rider's own vertices between the request's points (as a good snap does), one road class, one turn instruction per via point. */
function fakeRouter(options: { reject?: (points: Coordinate[]) => 'no-route' | 'provider-unavailable' | null; calls?: ProviderRouteRequest[] } = {}): RouteCandidateProvider {
  return {
    id: 'fake', capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: false }),
    async candidates(request) {
      options.calls?.push(request);
      const points = [request.origin, ...request.stops, request.destination];
      const rejected = options.reject?.(points);
      if (rejected) throw new GraphHopperProviderError('nope', rejected);
      const geometry: Coordinate[] = [];
      const turns: number[] = [];
      points.forEach((p, i) => {
        if (i > 0) { const a = trackIndex.get(key(points[i - 1]!))!; const b = trackIndex.get(key(p))!; geometry.push(...track.slice(a + 1, b)); }
        turns.push(geometry.length); geometry.push(p);
      });
      const meters = length(geometry);
      const candidate: ProviderCandidate = {
        providerId: 'fake', profile: request.profile, geometry, distanceMeters: meters, durationSeconds: meters / 15,
        instructions: turns.slice(1, -1).map(geometryIndex => ({ text: 'Turn', distanceMeters: 0, durationSeconds: 0, type: 'turn', maneuver: 'left' as const, geometryIndex })),
        roadSummary: { totalMeters: meters, surfaceByRoadClassMeters: { 'asphalt|secondary': meters }, curvatureMeters: {}, tollMeters: 0,
          roadRuns: [{ meters, durationSeconds: null, surface: 'asphalt', roadClass: 'secondary', roadEnvironment: 'road', urbanDensity: 'rural', curvatureRatio: null, toll: null }] },
      };
      return { candidates: [candidate] };
    },
  };
}

describe('rider-line anchors', () => {
  it('uses real track points about 1.5 km apart along the ride and always keeps both ends', () => {
    const anchors = pickAnchors(track);
    expect(anchors[0]).toBe(track[0]);
    expect(anchors.at(-1)).toBe(track.at(-1));
    expect(anchors.every(a => track.includes(a))).toBe(true);
    for (let i = 1; i < anchors.length - 1; i++) expect(haversine(anchors[i - 1]!, anchors[i]!)).toBeGreaterThan(1000);
    expect(anchors.length).toBeLessThan(track.length / 4);
  });
  it('never interpolates across a thinned gap: a 5 km jump stays two real points', () => {
    const jump = pickAnchors([track[0]!, { lon: -75.06, lat: 40 }, track[1]!]);
    expect(jump).toHaveLength(3);
  });
  it('chunks at most eight anchors with shared boundaries', () => {
    const anchors = Array.from({ length: 20 }, (_, i) => at(i));
    const chunks = chunkAnchors(anchors);
    expect(chunks.every(c => c.length <= 8)).toBe(true);
    expect(chunks[0]!.at(-1)).toBe(chunks[1]![0]);
    expect(chunks.at(-1)!.at(-1)).toBe(anchors.at(-1));
  });
  it('snaps gravel rides on the adventure profile and curvy rides on the twisty one', () => {
    expect(snapProfileFor('gravel')).toBe('motorcycle_adventure');
    expect(snapProfileFor('dual-sport')).toBe('motorcycle_adventure');
    expect(snapProfileFor('curvy')).toBe('motorcycle_twisty');
  });
});

describe('snapping a rider line', () => {
  it('goes through the app road matcher in groups of eight and stitches one measurable line', async () => {
    const calls: ProviderRouteRequest[] = [];
    const snap = await snapRiderLine(track, { provider: fakeRouter({ calls }), profile: 'motorcycle_twisty' });
    const anchors = pickAnchors(track);
    expect(calls).toHaveLength(chunkAnchors(anchors).length);
    expect(calls.every(c => c.profile === 'motorcycle_twisty' && c.stops.length <= 6)).toBe(true);
    expect(snap.routerCalls).toBe(calls.length);
    expect(snap.coverage).toBe(1);
    const line = snap.candidate!;
    expect(line.geometry[0]).toEqual(anchors[0]);
    expect(line.geometry.at(-1)).toEqual(anchors.at(-1));
    // The stitched line is as long as the pieces added up, and its road runs add up to the same length.
    expect(line.roadSummary!.roadRuns!.reduce((s, r) => s + r.meters, 0)).toBeCloseTo(length(line.geometry), 3);
    expect(line.distanceMeters).toBeCloseTo(length(line.geometry), 3);
    // The line sits on the rider's own track.
    expect(riderMatch(track, line.geometry)).toBeGreaterThan(0.9);
  });
  it('keeps turn instructions pointing at the right vertex after stitching', async () => {
    const line = (await snapRiderLine(track, { provider: fakeRouter(), profile: 'motorcycle_twisty' })).candidate!;
    const instructions = line.instructions!;
    expect(instructions.length).toBeGreaterThan(5);
    for (const instruction of instructions) {
      const index = instruction.geometryIndex!;
      // Every fake turn sits on one of the rider's own anchor points.
      expect(pickAnchors(track).some(a => haversine(a, line.geometry[index]!) < 1)).toBe(true);
    }
  });
  it('splits a stretch the router cannot match and keeps what it can, labelling the rest missing', async () => {
    const bad = pickAnchors(track)[3]!;
    const snap = await snapRiderLine(track, { provider: fakeRouter({ reject: points => points.some(p => p === bad || (p.lon === bad.lon && p.lat === bad.lat)) ? 'no-route' : null }), profile: 'motorcycle_twisty' });
    expect(snap.gaps).toBeGreaterThan(0);
    expect(snap.coverage).toBeLessThan(1);
    expect(snap.coverage).toBeGreaterThan(MIN_SNAP_COVERAGE);
    const runs = snap.candidate!.roadSummary!.roadRuns!;
    const missing = runs.filter(r => r.roadClass === 'missing').reduce((s, r) => s + r.meters, 0);
    expect(missing).toBeCloseTo(snap.gapMeters, 3);
    expect(runs.reduce((s, r) => s + r.meters, 0)).toBeCloseTo(length(snap.candidate!.geometry), 3);
    expect(snap.note).toContain('raw gap');
  });
  it('does not measure a rider line it could barely match', async () => {
    const snap = await snapRiderLine(track, { provider: fakeRouter({ reject: () => 'no-route' }), profile: 'motorcycle_twisty' });
    expect(snap.candidate).toBeNull();
    expect(snap.coverage).toBe(0);
    expect(snap.note).toContain('not measured');
  });
  it('stops the run when the router is down instead of calling that a gap', async () => {
    await expect(snapRiderLine(track, { provider: fakeRouter({ reject: () => 'provider-unavailable' }), profile: 'motorcycle_twisty' })).rejects.toThrow('provider-unavailable');
  });
});

describe('measuring the snapped line like any other contestant', () => {
  const ride: Ride = { id: 'r', label: 'R', source: 'catalog', mode: 'curvy', requestId: 'x', start: track[0]!, loopMinutes: 60 };
  const options = { vehicle: 'motorcycle' as const, includeAlternatives: false, avoidHighways: false, tollPolicy: 'allow-with-warning' as const, bike: { category: 'street' as const, maintainedGravel: 'allow' as const, roughTracks: 'avoid' as const } };
  const authority = { failures: [], warnings: [], evidence: { closures: unknownEvidence<number>('No feed'), access: unknownEvidence<number>('No feed') } };
  it('gets good miles from the planner bend measure, and unknown stretches earn nothing', async () => {
    const snap = await snapRiderLine(track, { provider: fakeRouter(), profile: 'motorcycle_twisty' });
    const m = measure(snap.candidate!, ride, options, 1, 0, authority);
    expect(m.goodMiles).toBeGreaterThan(0);
    const missingOnly = stitchPieces([{ kind: 'gap', to: track.at(-1)! }], track[0]!, 'p');
    expect(measure(missingOnly.candidate, ride, options, 1, 0, authority).goodMiles).toBe(0);
  });
});
