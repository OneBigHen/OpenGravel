/** Captures the two Hatboro loops (into Philadelphia vs north to the farms) as a test fixture. */
import { writeFile } from 'node:fs/promises';
import { createGraphHopperProvider } from '../../../src/infrastructure/routing/graphhopper/provider';
import { loopCentroid, bearingDegrees } from '../../../src/application/planner/loop-heading';
import type { ProviderCandidate, ProviderRoadRun, ProviderRouteRequest } from '../../../src/application/planner/route-provider';
const start = { lat: 40.1748, lon: -75.1063 };
const provider = createGraphHopperProvider({ baseUrl: 'http://127.0.0.1:8989', riderModesEnabled: true });
const base = {
  origin: start, destination: start, stops: [], shaping: [], avoidPolygons: [],
  options: { includeAlternatives: true, avoidHighways: false, tollPolicy: 'avoid', surfacePreference: 'mixed', bike: { category: 'touring', maintainedGravel: 'allow', roughTracks: 'avoid' }, traffic: 'protect-ride', departureNow: true, roadCharacter: 'balanced', noveltyPreference: 'balanced', vehicle: 'motorcycle' },
  discovery: { targetMinutes: 120, toleranceMinutes: 18 },
};
function collapse(runs: readonly ProviderRoadRun[]): ProviderRoadRun[] {
  const out: ProviderRoadRun[] = [];
  const key = (r: ProviderRoadRun) => JSON.stringify({ ...r, meters: 0, durationSeconds: 0 });
  for (const r of runs) {
    const last = out.at(-1);
    if (last && key(last) === key(r)) out[out.length - 1] = { ...last, meters: last.meters + r.meters, durationSeconds: last.durationSeconds === null || r.durationSeconds === null ? null : last.durationSeconds + r.durationSeconds };
    else out.push({ ...r });
  }
  return out.map(r => ({ ...r, meters: +r.meters.toFixed(1), durationSeconds: r.durationSeconds === null ? null : +r.durationSeconds.toFixed(1) }));
}
async function main() {
  const all: ProviderCandidate[] = [];
  for (const profile of ['motorcycle_scenic', 'motorcycle_twisty']) {
    const r = await provider.candidates({ ...base, requestId: 'req_loopcity_hatboro_1', profile } as ProviderRouteRequest, new AbortController().signal);
    all.push(...r.candidates);
  }
  const bearing = (c: ProviderCandidate) => bearingDegrees(start, loopCentroid(c.geometry)!);
  for (const c of all) console.log(c.profile, Math.round(c.durationSeconds / 60), Math.round(bearing(c)));
  const city = all.find(c => c.profile === 'motorcycle_scenic' && bearing(c) > 200 && bearing(c) < 260)!;
  console.log('city', city && bearing(city), 'north', all.filter(c => c.profile === 'motorcycle_twisty').map(bearing));
  const north = all.find(c => c.profile === 'motorcycle_twisty' && bearing(c) < 60)!;
  const slim = (c: ProviderCandidate) => ({
    providerId: c.providerId, profile: c.profile, distanceMeters: c.distanceMeters, durationSeconds: c.durationSeconds,
    geometry: c.geometry.map(p => ({ lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5) })),
    roadSummary: { ...c.roadSummary!, roadRuns: collapse(c.roadSummary!.roadRuns ?? []), surfaceRuns: undefined },
  });
  await writeFile('tests/fixtures/route-plan/hatboro-loops.json', JSON.stringify({ start, intoPhiladelphia: slim(city), northToFarms: slim(north) }));
}
main().catch(e => { console.error(e); process.exit(1); });
