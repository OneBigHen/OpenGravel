import { readFileSync } from 'node:fs';
import { planRide } from '../../../src/server/planning/plan-service';
import { bearingDegrees, loopCentroid } from '../../../src/application/planner/loop-heading';
import { candidateGeometryFun } from '../../../src/application/planner/geometry-fun';
const f = JSON.parse(readFileSync('tests/fixtures/route-plan/hatboro-loops.json', 'utf8'));
const cand = (l: any) => ({ ...l, geometry: l.geometry.map(([lon, lat]: number[]) => ({ lon, lat })), roadSummary: { ...l.roadSummary, roadRuns: l.roadSummary.roadRuns.map((r: any) => ({ durationSeconds: null, curvatureRatio: null, toll: null, ...r })) } });
const city = cand(f.intoPhiladelphia), farms = cand(f.northToFarms);
for (const c of [city, farms]) { const g = candidateGeometryFun(c); console.log('fun', JSON.stringify(g)); }
const character = process.argv[2] ?? 'balanced';
const provider = { id: 't', capabilities: () => ({ profiles: ['motorcycle_scenic', 'motorcycle_twisty', 'motorcycle_fastest'], supportsAlternatives: true, supportsAvoidPolygons: true }), candidates: async () => ({ candidates: [city, farms] }) };
const noAtlas = { availability: () => ({ available: false, path: null, schemaVersion: null, corridorCount: 0 }), corridorsNear: () => [] };
async function main() {
const r = await planRide({ identity: { rideId: 'r', rideRevision: 1, planningGeneration: 1 }, request: { requestId: 'x', origin: f.start, destination: f.start, stops: [], shaping: [], avoidPolygons: [], profile: 'motorcycle_fastest', discovery: { targetMinutes: 120, toleranceMinutes: 18 }, options: { vehicle: 'motorcycle', includeAlternatives: true, avoidHighways: false, tollPolicy: 'avoid', traffic: 'protect-ride', surfacePreference: 'mixed', roadCharacter: character, bike: { category: 'touring', maintainedGravel: 'allow', roughTracks: 'avoid' } } } as any }, { provider: provider as any, gravelAtlas: noAtlas as any, env: { OGV_RIDER_MODES: 'on', OGV_DIRT_LOOP_GENERATORS: 'off', OGV_TRAFFIC_LIVE_AVOID: 'off' }, roadAuthority: null });
if (!r.ok) throw new Error(r.error.code);
for (const c of r.bundle.candidates) console.log(c.id === r.bundle.roles['best-ride'] ? '*' : ' ', Math.round(bearingDegrees(f.start, loopCentroid(c.geometry)!)), c.score.total, JSON.stringify(Object.fromEntries(Object.entries(c.score.components).map(([k, v]: any) => [k, [v.input === null ? null : +v.input.toFixed(3), +v.contribution.toFixed(1)]]))));
console.log(r.bundle.candidates.length, JSON.stringify(r.bundle.roles));
}
main();
