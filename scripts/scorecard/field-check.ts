/**
 * RM-1 field check: does the graph's own og_curve agree with the bends riders choose?
 *
 * For each Curvy tuning ride with a rider's line: snap the rider's line onto the router being checked
 * (the scorecard's own snapRiderLine) and ask that router for the fastest route, both with og_curve
 * added to the requested details. Then read, per line, the length-weighted mean og_curve and the
 * scorecard's bend share (road-bends-v1 good miles over length).
 *
 * Pass: the rider's line has the higher mean og_curve on at least 5 of the 6 rides, and the rank
 * agreement (Spearman) between mean og_curve and bend share over all measured lines is 0.8 or better.
 *
 *   GRAPHHOPPER_URL=http://127.0.0.1:8988 node --conditions=react-server --import tsx scripts/scorecard/field-check.ts [--out FILE]
 *
 * Exit 0: pass. Exit 3: measured, but the field missed. Exit 1: could not measure.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { haversine } from '../../src/domain/geometry/analysis';
import { createGraphHopperProvider } from '../../src/infrastructure/routing/graphhopper/provider';
import { candidateGeometryFun } from '../../src/application/planner/geometry-fun';
import { decodeCatalogPolyline } from '../../src/application/explore/catalog-build';
import type { ProviderCandidate, ProviderRouteRequest } from '../../src/application/planner/route-provider';
import type { Coordinate } from '../../src/domain/ride/types';
import { snapProfileFor, snapRiderLine } from './rider-line';
import type { Ride } from './types';

export const FIELD = 'og_curve';
export const MIN_RIDER_WINS = 5;
export const MIN_SPEARMAN = 0.8;

const segmentKey = (a: Coordinate, b: Coordinate): string => `${a.lat.toFixed(6)},${a.lon.toFixed(6)}>${b.lat.toFixed(6)},${b.lon.toFixed(6)}`;

/** og_curve per route segment, read from every router answer that passes through the fetcher. */
export function fieldRecordingFetcher(base: typeof fetch, field = FIELD): { fetcher: typeof fetch; values: Map<string, number> } {
  const values = new Map<string, number>();
  const fetcher: typeof fetch = async (input, init) => {
    let request = init;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (init?.method === 'POST' && /\/route(\?|$)/.test(url) && typeof init.body === 'string') {
      const body = JSON.parse(init.body) as { details?: string[] };
      if (Array.isArray(body.details) && !body.details.includes(field)) body.details = [...body.details, field];
      request = { ...init, body: JSON.stringify(body) };
    }
    const response = await base(input, request);
    if (request !== init && response.ok) {
      const payload = await response.clone().json() as { paths?: Array<{ points?: { coordinates?: number[][] }; details?: Record<string, Array<[number, number, number]>> }> };
      for (const path of payload.paths ?? []) {
        const coords = path.points?.coordinates ?? [];
        for (const [from, to, value] of path.details?.[field] ?? []) {
          for (let i = from; i < to && i + 1 < coords.length; i++) {
            const a = { lat: coords[i]![1]!, lon: coords[i]![0]! };
            const b = { lat: coords[i + 1]![1]!, lon: coords[i + 1]![0]! };
            values.set(segmentKey(a, b), Number(value));
          }
        }
      }
    }
    return response;
  };
  return { fetcher, values };
}

/** Length-weighted mean of the field along a line; segments the router never answered for count as 0. */
export function meanAlong(line: readonly Coordinate[], values: ReadonlyMap<string, number>): { mean: number; knownShare: number } {
  let total = 0, weighted = 0, known = 0;
  for (let i = 1; i < line.length; i++) {
    const meters = haversine(line[i - 1]!, line[i]!);
    total += meters;
    const value = values.get(segmentKey(line[i - 1]!, line[i]!));
    if (value !== undefined) { weighted += meters * value; known += meters; }
  }
  return { mean: total > 0 ? weighted / total : 0, knownShare: total > 0 ? known / total : 0 };
}

/** The scorecard's Curvy good share: road-bends-v1 bend metres over the line's length. */
export function bendShare(candidate: ProviderCandidate): number | null {
  const total = Math.max(candidate.distanceMeters, candidate.roadSummary?.totalMeters ?? 0);
  const fun = candidateGeometryFun(candidate);
  if (fun === null || !(total > 0)) return null;
  return Math.min(total, fun.bendMeters) / total;
}

function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    for (let k = i; k <= j; k++) out[order[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation, ties averaged. */
export function spearman(x: readonly number[], y: readonly number[]): number {
  const rx = ranks(x), ry = ranks(y);
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) { num += (rx[i]! - mx) * (ry[i]! - my); dx += (rx[i]! - mx) ** 2; dy += (ry[i]! - my) ** 2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

function fastestRequest(ride: Ride): ProviderRouteRequest {
  return {
    requestId: `${ride.requestId}-field`, origin: ride.start, destination: ride.end ?? ride.start,
    stops: [], shaping: [], avoidPolygons: [], profile: 'motorcycle_fastest',
    options: { vehicle: 'motorcycle', includeAlternatives: false, avoidHighways: ride.avoidHighways ?? false, tollPolicy: 'allow-with-warning', roadCharacter: 'efficient', surfacePreference: 'mixed' },
    ...(ride.loopMinutes === undefined ? {} : { discovery: { targetMinutes: ride.loopMinutes, toleranceMinutes: ride.loopMinutes * 0.15 } }),
  };
}

interface LineResult { kind: 'rider' | 'fastest'; miles: number; meanCurve: number; knownShare: number; bendShare: number | null }
interface RideResult { id: string; label: string; rider: LineResult | null; fastest: LineResult | null; riderWins: boolean | null; notes: string[] }

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1]! : 'scorecard-out/field-check.json';
  const baseUrl = process.env.GRAPHHOPPER_URL ?? 'http://127.0.0.1:8988';
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname)) throw new Error('Use a local tunnel to the router being checked');
  const manifest = JSON.parse(await readFile('tests/scorecard/rides.json', 'utf8')) as { tuning: Ride[] };
  const rides = manifest.tuning.filter(r => r.mode === 'curvy' && r.riderTrack);
  const { fetcher, values } = fieldRecordingFetcher(fetch);
  const provider = createGraphHopperProvider({ baseUrl, riderModesEnabled: false, reseedDeadEndLoops: false, fetcher });
  const measureLine = (kind: LineResult['kind'], candidate: ProviderCandidate): LineResult => {
    const { mean, knownShare } = meanAlong(candidate.geometry, values);
    return { kind, miles: candidate.distanceMeters / 1609.344, meanCurve: mean, knownShare, bendShare: bendShare(candidate) };
  };
  const results: RideResult[] = [];
  for (const ride of rides) {
    const notes: string[] = [];
    let rider: LineResult | null = null, fastest: LineResult | null = null;
    const snap = await snapRiderLine(decodeCatalogPolyline(ride.riderTrack!.geometryPolyline), { provider, profile: snapProfileFor('curvy'), signal: AbortSignal.timeout(600_000) });
    notes.push(snap.note);
    if (snap.candidate) rider = measureLine('rider', snap.candidate);
    const answer = await provider.candidates(fastestRequest(ride), AbortSignal.timeout(120_000));
    if (answer.candidates[0]) fastest = measureLine('fastest', answer.candidates[0]);
    else notes.push('fastest: no route');
    const riderWins = rider && fastest ? rider.meanCurve > fastest.meanCurve : null;
    results.push({ id: ride.id, label: ride.label, rider, fastest, riderWins, notes });
    const f = (l: LineResult | null): string => l ? `og_curve ${l.meanCurve.toFixed(3)} (read on ${(l.knownShare * 100).toFixed(0)}%), bend share ${l.bendShare === null ? '?' : (l.bendShare * 100).toFixed(2) + '%'}, ${l.miles.toFixed(1)} mi` : 'not measured';
    console.log(`${ride.label}\n  rider:   ${f(rider)}\n  fastest: ${f(fastest)}\n  rider line ${riderWins === null ? 'not compared' : riderWins ? 'reads curvier' : 'does NOT read curvier'}`);
  }
  const lines = results.flatMap(r => [r.rider, r.fastest]).filter((l): l is LineResult => l !== null && l.bendShare !== null);
  const rho = spearman(lines.map(l => l.meanCurve), lines.map(l => l.bendShare!));
  const wins = results.filter(r => r.riderWins === true).length;
  const passed = wins >= MIN_RIDER_WINS && rho >= MIN_SPEARMAN;
  const summary = { router: baseUrl, field: FIELD, rides: results.length, riderWins: wins, minRiderWins: MIN_RIDER_WINS, spearman: rho, minSpearman: MIN_SPEARMAN, linesMeasured: lines.length, passed, generatedAt: new Date().toISOString(), results };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(summary, null, 2));
  console.log(`Rider line curvier on ${wins} of ${results.length} (need ${MIN_RIDER_WINS}); Spearman ${rho.toFixed(3)} over ${lines.length} lines (need ${MIN_SPEARMAN}). ${passed ? 'PASS' : 'MISS'}. Written to ${out}`);
  process.exitCode = passed ? 0 : 3;
}

if (process.argv[1]?.endsWith('field-check.ts')) main().then(() => process.exit(process.exitCode ?? 0), error => { console.error(error); process.exit(1); });
