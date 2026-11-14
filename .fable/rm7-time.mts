import { readFile, writeFile } from 'node:fs/promises';
import { createGraphHopperProvider } from '../src/infrastructure/routing/graphhopper/provider';
import { planRide } from '../src/server/planning/plan-service';
import { createGravelAtlas } from '../src/server/roads/gravel-atlas';
import { frozenAuthority } from '../scripts/scorecard/authority';
import { buildProviderRequest } from '../src/application/planner/build-plan-request';
import { defaultRideIntent } from '../src/domain/ride/create';
import { bearingDegrees, loopCentroid } from '../src/application/planner/loop-heading';
import type { ProviderRouteRequest } from '../src/application/planner/route-provider';

const SWITCHES = { OGV_RIDER_MODES: 'on', OGV_DIRT_LOOP_GENERATORS: 'on', OGV_ROAD_AUTHORITY: 'on', OGV_TRAFFIC_LIVE_AVOID: 'off' };
const baseUrl = process.env.GRAPHHOPPER_URL ?? 'http://127.0.0.1:8988';
const manifest = JSON.parse(await readFile('tests/scorecard/rides.json', 'utf8'));
const all = [...manifest.tuning, ...manifest.nj];
let inflight=0, maxInflight=0; const T0=performance.now(); const calls:any[]=[];
const tf: typeof fetch = async (u:any,init:any)=>{ const b=JSON.parse(init.body); const s=performance.now(); inflight++; maxInflight=Math.max(maxInflight,inflight);
  let vn:any; try{ const r=await fetch(u,init); try{ const j:any=await r.clone().json(); vn=j.hints?.['visited_nodes.sum']??j.hints?.[0]?.max_visited_nodes??(j.message?'ERR:'+String(j.message).slice(0,30):undefined); }catch{} return r; } finally{ inflight--; const e=performance.now(); calls.push({vn,t:+((s-T0)/1000).toFixed(1),dur:+((e-s)/1000).toFixed(1),prof:b.profile,pts:b.points?.length,alt:b['alternative_route.max_paths']??b.algorithm,algo:b.algorithm,rt:b['round_trip.distance'],seed:b['round_trip.seed'],hd:b.heading,body:process.env.BODY?b:undefined,ch:b['ch.disable'],lm:b['lm.disable'],mvn:b['alternative_route.max_paths'],hints:b.point_hints?.length,keys:Object.keys(b).filter(k=>/ch\.|lm\.|max_visited|alternative|round_trip|heading/.test(k)).join(',')}); } };
const provider = createGraphHopperProvider({ baseUrl, riderModesEnabled: true, shareIdenticalRequests: true, fetcher: tf });
const atlas = createGravelAtlas('data/scorecard/gravel-atlas-v3.sqlite');
const authority = await frozenAuthority(manifest.rideDate, false, SWITCHES);
function requestFor(ride: any): ProviderRouteRequest {
  const dirt = ride.mode !== 'curvy';
  return {
    requestId: ride.requestId, origin: ride.start, destination: ride.end ?? ride.start, stops: [], shaping: [], avoidPolygons: [],
    profile: dirt ? 'motorcycle_adventure' : 'motorcycle_twisty',
    options: { includeAlternatives: true, avoidHighways: ride.avoidHighways ?? false, tollPolicy: 'allow-with-warning', vehicle: 'motorcycle', roadCharacter: dirt ? 'balanced' : 'curvy',
      surfacePreference: dirt ? 'dirt-preferred' : 'mixed', ...(dirt ? { targetUnpavedShare: 0.5 } : {}), traffic: 'protect-ride',
      bike: { category: ride.mode === 'dual-sport' ? 'dual-sport' : dirt ? 'adventure' : 'street', maintainedGravel: 'allow', roughTracks: ride.mode === 'dual-sport' ? 'allow' : 'avoid' } },
    ...(ride.loopMinutes === undefined ? {} : { discovery: { targetMinutes: ride.loopMinutes, toleranceMinutes: ride.loopMinutes * 0.15 } }),
  } as ProviderRouteRequest;
}
const jobs: { name: string; request: ProviderRouteRequest; hatboro?: boolean }[] = [];
const hatIntent: any = { ...defaultRideIntent(), shape: 'loop', start: { id: 'pt_hatboro', kind: 'start', coordinate: { lat: 40.1790, lon: -75.1077 }, provenance: { type: 'map', selectedAt: '2026-11-13T15:58:00.000Z' } } };
const built = await buildProviderRequest(hatIntent, { resolveGeometry: () => null, includeAlternatives: true });
if (!built.ok) throw new Error('hatboro not buildable');
jobs.push({ name: 'Hatboro 2-hour (app default)', request: built.request, hatboro: true });
for (const key of ['Crystal Cave', 'Lansdale', 'Phoenixville', 'Green Lane and Back', 'Frenchtown']) {
  const ride = all.find((r: any) => r.label.includes(key)); if (!ride) throw new Error(key);
  jobs.push({ name: ride.label, request: requestFor(ride) });
}
const out: any[] = [];
const TRIES=+(process.env.TRIES??3); const ONLY=process.env.ONLY; for (const job of jobs) if(!ONLY||job.name.includes(ONLY)) for (let i = 1; i <= TRIES; i++) {
  const t0 = performance.now(); calls.length=0; maxInflight=0;
  const result = await planRide({ identity: { rideId: `t_${out.length}`, rideRevision: 1, planningGeneration: 1 }, request: job.request }, { provider, env: SWITCHES, gravelAtlas: atlas, roadAuthority: authority, now: () => manifest.rideDate });
  const seconds = (performance.now() - t0) / 1000;
  let extra: any = {};
  if (result.ok) {
    const best = result.bundle.candidates.find((c: any) => c.id === (result.bundle.roles['best-ride'] ?? result.bundle.selectedRouteId));
    if (best) {
      const g = best.geometry as any[];
      extra = { minutes: Math.round(best.durationSeconds / 60), miles: +(best.distanceMeters / 1609.344).toFixed(1), minLat: Math.min(...g.map(p => p.lat)).toFixed(3) };
      if (job.hatboro) { const o = job.request.origin; extra.headingDeg = Math.round(bearingDegrees(o, loopCentroid(g)!)); extra.intoPhilly = Math.min(...g.map(p => p.lat)) < 40.0; }
    }
  }
  const row = { name: job.name, try: i, seconds: +seconds.toFixed(1), ok: result.ok, err: result.ok ? null : result.error.code, ...extra };
  console.log(JSON.stringify(row)); if(process.env.CALLS) await writeFile('runs/calls-'+(process.env.TAG??'x')+'-'+job.name.slice(0,6)+i+'.json',JSON.stringify({maxInflight,calls},null,0)); out.push(row);
}
await writeFile('runs/loop-timing-'+(process.env.TAG??'x')+'.json', JSON.stringify(out, null, 1));
