import { analyzeFrancoCurvature } from '../../src/domain/geometry/franco-curvature';
import { decodeCatalogPolyline } from '../../src/application/explore/catalog-build';
import { candidateGeometryFun } from '../../src/application/planner/geometry-fun';
import { riderRoadEligibility } from '../../src/application/planner/rider-road-eligibility';
import type { ProviderCandidate, ProviderRouteOptions } from '../../src/application/planner/route-provider';
import type { RoadAuthorityVerdict } from '../../src/application/route-intelligence/coordinator';
import { deadEndSpurs, riderMatch, uTurns } from './geometry';
import type { Measurement, Ride } from './types';

const DIRT = new Set(['gravel', 'fine_gravel', 'compacted', 'dirt', 'ground', 'unpaved', 'earth']);
const PAVED = new Set(['asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'cobblestone', 'sett', 'metal', 'wood']);
const BUSY = new Set(['motorway', 'trunk', 'primary']);
export function measure(candidate: ProviderCandidate, ride: Ride, bikeOptions: ProviderRouteOptions, baselineMinutes: number, planningSeconds: number, authority: RoadAuthorityVerdict): Measurement {
  const runs = candidate.roadSummary?.roadRuns ?? [];
  const total = Math.max(candidate.distanceMeters, candidate.roadSummary?.totalMeters ?? 0);
  let known = 0; let described = 0; let dirt = 0; let busy = 0;
  for (const run of runs) {
    if (!(run.meters > 0)) continue;
    described += run.meters;
    const surface = run.surface.toLowerCase();
    if (DIRT.has(surface)) dirt += run.meters;
    if (DIRT.has(surface) || PAVED.has(surface) || surface === 'sand' || surface === 'mud' || surface === 'grass') known += run.meters;
    if (BUSY.has(run.roadClass.toLowerCase()) || run.roadClassLink === true || run.urbanDensity.toLowerCase() === 'city') busy += run.meters;
  }
  const franco = analyzeFrancoCurvature(candidate.geometry);
  const trustFailures = riderRoadEligibility(candidate, bikeOptions).failures.filter(f => f.code === 'bike-incompatible').map(f => f.code as string);
  if (runs.some(r => r.meters > 0 && (r.carAccess === false || ['private', 'no'].includes(r.roadAccess?.toLowerCase() ?? '')))) trustFailures.push('access-prohibited');
  if (runs.some(r => r.meters > 0 && r.surface.toLowerCase() === 'sand')) trustFailures.push('sand');
  trustFailures.push(...authority.failures.map(f => `${f.code}: ${f.message}`));
  const spurs = deadEndSpurs(candidate.geometry);
  const turns = uTurns(candidate.instructions ?? []);
  if (spurs > 0) trustFailures.push(`dead-end-spur: ${spurs} retraced branches over 300 m`);
  if (turns > 0) trustFailures.push(`u-turn: ${turns}`);
  const unknownTrust: string[] = [];
  if (runs.length === 0) unknownTrust.push('No ordered road details: access, bike limits and sand unverified');
  else {
    if (runs.some(r => r.carAccess == null || r.roadAccess == null || r.roadAccess === 'missing')) unknownTrust.push('Access tags incomplete; gates without mapped permission cannot be independently verified');
    if (runs.some(r => !r.trackType || r.trackType === 'missing' || !r.smoothness || r.smoothness === 'missing')) unknownTrust.push('Track grade or smoothness incomplete');
  }
  if (!candidate.instructions) unknownTrust.push('U-turn instructions unavailable');
  if (authority.evidence.closures.status === 'unknown') unknownTrust.push('Road-authority closure coverage incomplete');
  if (authority.evidence.access.status === 'unknown') unknownTrust.push('Road-authority motorcycle access unknown');
  // Scorecard v2: Curvy good miles are the planner's own bend metres (heading-fun-v1),
  // which skips junction corners, town streets, ramps and roundabouts. v1 counted raw
  // Franco bends, so both are kept: v2 decides the verdict, v1 only feeds the old headline.
  const fun = ride.mode === 'curvy' ? candidateGeometryFun(candidate) : null;
  if (ride.mode === 'curvy' && fun === null) unknownTrust.push('Bend measure unavailable: ordered road details missing or inconsistent, so no curvy miles are credited');
  const goodMeters = ride.mode === 'curvy' ? Math.min(total, fun?.bendMeters ?? 0) : dirt;
  const v1GoodMeters = ride.mode === 'curvy' ? Math.min(total, franco.bendMeters) : dirt;
  const minutes = candidate.durationSeconds / 60;
  return {
    miles: candidate.distanceMeters / 1609.344, minutes, goodMiles: goodMeters / 1609.344,
    goodShare: total > 0 ? goodMeters / total : 0,
    v1GoodMiles: v1GoodMeters / 1609.344,
    v1GoodShare: total > 0 ? v1GoodMeters / total : 0,
    dirtShare: described > 0 && total > 0 ? dirt / total : null,
    francoPerKm: franco.curvaturePerKm,
    busyShare: described >= total * 0.99 && total > 0 ? Math.min(1, busy / total) : null,
    extraMinutes: ride.loopMinutes === undefined ? minutes - baselineMinutes : Math.abs(minutes - ride.loopMinutes),
    riderMatch: ride.riderTrack ? riderMatch(decodeCatalogPolyline(ride.riderTrack.geometryPolyline), candidate.geometry) : null,
    unknownSurfaceShare: total > 0 ? Math.max(0, 1 - known / total) : 1,
    planningSeconds, trustFailures: [...new Set(trustFailures)], unknownTrust,
    authorityWarnings: authority.warnings.map(w => w.message), geometry: candidate.geometry,
  };
}
