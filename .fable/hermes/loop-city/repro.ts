/** Loop-into-the-city repro (owner 2026-11-13, 3-loop-into-philly.jpg).
 * Plans default loops (Roads Balanced, Surface Mixed, 2 h) with the real planner against the
 * prod router through the tunnel (ssh -N -L 8989:127.0.0.1:8989 docker-stable).
 * Usage: node --conditions=react-server --import tsx .fable/hermes/loop-city/repro.ts <out.json> [runs]
 */
import { writeFile, readFile } from 'node:fs/promises';
import { createGraphHopperProvider } from '../../../src/infrastructure/routing/graphhopper/provider';
import { planRide } from '../../../src/server/planning/plan-service';
import { createGravelAtlas } from '../../../src/server/roads/gravel-atlas';
import { candidateGeometryFun } from '../../../src/application/planner/geometry-fun';
import { loopCentroid, bearingDegrees } from '../../../src/application/planner/loop-heading';
import type { ProviderCandidate, ProviderRouteRequest } from '../../../src/application/planner/route-provider';

const STARTS = [
  { id: 'hatboro', label: 'Hatboro', start: { lat: 40.1748, lon: -75.1063 } },
  { id: 'doylestown', label: 'Doylestown', start: { lat: 40.3101, lon: -75.1299 } },
  { id: 'lansdale', label: 'Lansdale', start: { lat: 40.2415, lon: -75.2838 } },
];
const SWITCHES = { OGV_RIDER_MODES: 'on', OGV_DIRT_LOOP_GENERATORS: 'on', OGV_ROAD_AUTHORITY: 'off', OGV_TRAFFIC_LIVE_AVOID: 'off', OGV_ATLAS_CALLS: '4' };

function request(start: { lat: number; lon: number }, requestId: string): ProviderRouteRequest {
  return {
    requestId, origin: start, destination: start, stops: [], shaping: [], avoidPolygons: [], profile: 'motorcycle_fastest',
    options: {
      includeAlternatives: true, avoidHighways: false, tollPolicy: 'avoid', surfacePreference: 'mixed',
      bike: { category: 'touring', maintainedGravel: 'allow', roughTracks: 'avoid' }, traffic: 'protect-ride',
      departureNow: true, roadCharacter: 'balanced', noveltyPreference: 'balanced', vehicle: 'motorcycle',
    },
    discovery: { targetMinutes: 120, toleranceMinutes: 18 },
  } as ProviderRouteRequest;
}

export function stats(c: ProviderCandidate, origin: { lat: number; lon: number }) {
  const runs = c.roadSummary?.roadRuns ?? [];
  let city = 0, residential = 0, busy = 0;
  for (const r of runs) {
    const d = r.urbanDensity.toLowerCase();
    if (d === 'city') city += r.meters; else if (d === 'residential') residential += r.meters;
    if (['motorway', 'trunk', 'primary'].includes(r.roadClass.toLowerCase())) busy += r.meters;
  }
  const total = c.distanceMeters;
  const fun = candidateGeometryFun(c);
  const centre = loopCentroid(c.geometry);
  const south = Math.min(...c.geometry.map(p => p.lat));
  return {
    miles: +(total / 1609.344).toFixed(1), minutes: Math.round(c.durationSeconds / 60),
    curvyMiles: +(((fun?.bendMeters ?? 0)) / 1609.344).toFixed(1),
    cityPct: +(100 * city / total).toFixed(1), residentialPct: +(100 * residential / total).toFixed(1), busyPct: +(100 * busy / total).toFixed(1),
    bearing: centre ? Math.round(bearingDegrees(origin, centre)) : null, southmostLat: +south.toFixed(3),
  };
}

async function main() {
  const out = process.argv[2] ?? 'repro.json';
  const runs = Number(process.argv[3] ?? 3);
  const only = process.argv[4];
  const baseUrl = 'http://127.0.0.1:8989';
  const atlas = createGravelAtlas(process.env.OGV_GRAVEL_ATLAS_PATH ?? 'data/scorecard/gravel-atlas-v3.sqlite');
  const results: unknown[] = [];
  // REPLAY=<file>: answer router calls from a recording (made on first use), so two builds see identical pools.
  const replayPath = process.env.REPLAY;
  const tape: Record<string, unknown> = replayPath ? JSON.parse(await readFile(replayPath, 'utf8').catch(() => '{}')) : {};
  for (const s of STARTS.filter(s => !only || s.id === only)) {
    for (let n = 0; n < runs; n++) {
      const seen: ProviderCandidate[] = [];
      const inner = createGraphHopperProvider({ baseUrl, riderModesEnabled: true });
      const provider = { ...inner, capabilities: () => inner.capabilities(), async candidates(r: ProviderRouteRequest, sig: AbortSignal) { const key = JSON.stringify(r); const a = (replayPath && tape[key] ? tape[key] : await inner.candidates(r, sig)) as Awaited<ReturnType<typeof inner.candidates>>; if (replayPath) tape[key] = a; seen.push(...a.candidates.map(c => ({ ...c, _profile: r.profile } as ProviderCandidate))); return a; } };
      const req = request(s.start, `req_loopcity_${s.id}_${n}`);
      const t0 = performance.now();
      const result = await planRide({ identity: { rideId: `loopcity_${s.id}_${n}`, rideRevision: 1, planningGeneration: 1 }, request: req }, { provider, env: SWITCHES, gravelAtlas: atlas, roadAuthority: null });
      const secs = (performance.now() - t0) / 1000;
      if (!result.ok) { console.log(s.label, n, 'FAILED', result.error.code); results.push({ start: s.id, run: n, error: result.error.code }); continue; }
      const best = result.bundle.candidates.find(c => c.id === (result.bundle.roles['best-ride'] ?? result.bundle.selectedRouteId))!;
      const raw = seen.find(c => c.geometry.length === best.geometry.length && c.geometry.every((p, i) => p.lat === best.geometry[i]!.lat && p.lon === best.geometry[i]!.lon));
      const pool = seen.map(c => ({ profile: (c as unknown as { _profile: string })._profile, ...stats(c, s.start) }));
      const picked = raw ? { profile: (raw as unknown as { _profile: string })._profile, ...stats(raw, s.start) } : null;
      console.log(`${s.label} #${n} (${secs.toFixed(1)} s, ${seen.length} raw): picked`, JSON.stringify(picked));
      results.push({ start: s.id, run: n, seconds: secs, picked, geometry: raw?.geometry.map(p => [+p.lon.toFixed(5), +p.lat.toFixed(5)]), pool });
    }
  }
  await writeFile(out, JSON.stringify(results));
  if (replayPath) await writeFile(replayPath, JSON.stringify(tape));
}
if (process.argv[1]?.endsWith("repro.ts")) main().catch(e => { console.error(e); process.exit(1); });
