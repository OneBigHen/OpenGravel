/** Scores every raw loop candidate from one start the way the pipeline does (diagnostic only).
 * Usage: node --conditions=react-server --import tsx .fable/hermes/loop-city/diag.ts hatboro [runIndex] */
import { createGraphHopperProvider } from '../../../src/infrastructure/routing/graphhopper/provider';
import { planRide } from '../../../src/server/planning/plan-service';
import { createGravelAtlas } from '../../../src/server/roads/gravel-atlas';
import { scoreCandidate } from '../../../src/domain/route/scoring';
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from '../../../src/domain/route/policy';
import { engineRoadEvidence, engineUrbanFrictionEvidence } from '../../../src/application/roads/engine-road-evidence';
import type { ProviderCandidate, ProviderRouteRequest } from '../../../src/application/planner/route-provider';
import { stats } from './repro';

const STARTS: Record<string, { lat: number; lon: number }> = {
  hatboro: { lat: 40.1748, lon: -75.1063 }, doylestown: { lat: 40.3101, lon: -75.1299 }, lansdale: { lat: 40.2415, lon: -75.2838 },
};
const SWITCHES = { OGV_RIDER_MODES: 'on', OGV_DIRT_LOOP_GENERATORS: 'on', OGV_ROAD_AUTHORITY: 'off', OGV_TRAFFIC_LIVE_AVOID: 'off', OGV_ATLAS_CALLS: '4' };
async function main() {
  const id = process.argv[2] ?? 'hatboro'; const run = Number(process.argv[3] ?? 0);
  const start = STARTS[id]!;
  const req = {
    requestId: `req_loopcity_${id}_${run}`, origin: start, destination: start, stops: [], shaping: [], avoidPolygons: [], profile: 'motorcycle_fastest',
    options: { includeAlternatives: true, avoidHighways: false, tollPolicy: 'avoid', surfacePreference: 'mixed', bike: { category: 'touring', maintainedGravel: 'allow', roughTracks: 'avoid' }, traffic: 'protect-ride', departureNow: true, roadCharacter: 'balanced', noveltyPreference: 'balanced', vehicle: 'motorcycle' },
    discovery: { targetMinutes: 120, toleranceMinutes: 18 },
  } as ProviderRouteRequest;
  const seen: ProviderCandidate[] = [];
  const inner = createGraphHopperProvider({ baseUrl: 'http://127.0.0.1:8989', riderModesEnabled: true });
  const provider = { ...inner, capabilities: () => inner.capabilities(), async candidates(r: ProviderRouteRequest, s: AbortSignal) { const a = await inner.candidates(r, s); seen.push(...a.candidates.map(c => ({ ...c, _p: r.profile } as ProviderCandidate))); return a; } };
  const atlas = createGravelAtlas('data/scorecard/gravel-atlas-v3.sqlite');
  const result = await planRide({ identity: { rideId: `x_${id}`, rideRevision: 1, planningGeneration: 1 }, request: req }, { provider, env: SWITCHES, gravelAtlas: atlas, roadAuthority: null });
  if (!result.ok) { console.log('FAILED', result.error.code); return; }
  const best = result.bundle.candidates.find(c => c.id === (result.bundle.roles['best-ride'] ?? result.bundle.selectedRouteId))!;
  const fastest = Math.min(...seen.map(c => c.durationSeconds));
  const rows = seen.map(c => {
    const s = scoreCandidate({ candidate: c, intent: { shape: 'loop', roadCharacter: 'balanced', surface: { preference: 'mixed' } }, policy: PA_NJ_ROUTE_POLICY_VNEXT_1, evidence: { ...engineRoadEvidence(c.roadSummary, 'mixed'), ...(process.env.NOURBAN ? {} : engineUrbanFrictionEvidence(c.roadSummary)) }, baselineDurationSeconds: fastest });
    const comp = Object.fromEntries(Object.entries(s.components).map(([k, v]) => [k, +v.contribution.toFixed(1)]));
    return { picked: c.geometry.length === best.durationSeconds * 0 + best.distanceMeters * 0 + c.geometry.length && c.distanceMeters === best.distanceMeters ? '*' : ' ', p: (c as unknown as { _p: string })._p.replace('motorcycle_', ''), total: s.total, ...stats(c, start), comp };
  });
  rows.sort((a, b) => b.total - a.total);
  for (const r of rows) console.log(r.picked, r.p.padEnd(9), String(r.total).padStart(5), `${r.minutes}m b${r.bearing} curvy${r.curvyMiles} res${r.residentialPct} city${r.cityPct} busy${r.busyPct}`, JSON.stringify(r.comp));
  console.log('picked', best.distanceMeters, best.durationSeconds, 'score', best.score.total);
}
main().catch(e => { console.error(e); process.exit(1); });
