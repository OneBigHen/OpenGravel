/** Measurement only; no routing overrides or network calls to Google.
 * Setup: ssh -N -L 8989:127.0.0.1:8989 docker-stable
 * Copy /var/lib/opengravel/gravel-atlas-v3.sqlite into ignored data/scorecard/.
 * npm run scorecard -- --set tuning (default); --set holdout on ship days only.
 * --refresh-authority replaces frozen feed evidence; ride date lives in rides.json.
 * --refresh-rider-lines re-snaps the riders' own lines instead of reusing scorecard-out/rider-lines.json.
 * --freeze-threshold snaps the tuning riders' lines only and rewrites scripts/scorecard/frozen-threshold.ts
 * (the Curvy loop bar: 75% of the median rider-line share). Plans nothing.
 * Scorecard v2: Curvy good miles are the planner's own bend metres; a third contestant, the rider's own
 * line snapped to our roads, is measured with the same code but never used to plan or scored.
 * Exit 0 means all 20 comparisons ran, not that OpenGravel won or was safe. Exit 1: a planning error.
 * Exit 2: the yardstick failed (the rider's line did not beat fastest on good miles on 10 of 12 tracked rides).
 */
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createGraphHopperProvider } from '../../src/infrastructure/routing/graphhopper/provider';
import { planRide } from '../../src/server/planning/plan-service';
import { createGravelAtlas } from '../../src/server/roads/gravel-atlas';
import type { ProviderCandidate, ProviderRouteRequest } from '../../src/application/planner/route-provider';
import type { BoundingBox } from '../../src/application/route-intelligence/types';
import { frozenAuthority } from './authority';
import { measure } from './measure';
import { asV1, winTieLoss } from './scoring';
import { headline, headlineV1, report } from './report';
import { createRouterMeter, instrumentProvider, loadLine, routerLoad } from './load';
import { MIN_SNAP_COVERAGE, pickAnchors, snapProfileFor, snapRiderLine, type SnapResult } from './rider-line';
import { freezeCurvyThreshold, renderFrozenThreshold, riderCurvyShares } from './threshold';
import { FROZEN_CURVY_THRESHOLD } from './frozen-threshold';
import { yardstickCheck } from './yardstick';
import { decodeCatalogPolyline } from '../../src/application/explore/catalog-build';
import type { Measurement, Ride, RiderLineSnap, Row, RouterUse } from './types';

const SWITCHES = {
  OGV_RIDER_MODES: 'on', OGV_DIRT_LOOP_GENERATORS: 'on', OGV_ROAD_AUTHORITY: 'on',
  OGV_TRAFFIC_LIVE_AVOID: 'off',
};
function requestFor(ride: Ride): ProviderRouteRequest {
  const dirt = ride.mode !== 'curvy';
  return {
    requestId: ride.requestId, origin: ride.start, destination: ride.end ?? ride.start,
    stops: [], shaping: [], avoidPolygons: [], profile: dirt ? 'motorcycle_adventure' : 'motorcycle_twisty',
    options: {
      includeAlternatives: true, avoidHighways: ride.avoidHighways ?? false,
      tollPolicy: 'allow-with-warning', vehicle: 'motorcycle', roadCharacter: dirt ? 'balanced' : 'curvy',
      surfacePreference: dirt ? 'dirt-preferred' : 'mixed', ...(dirt ? { targetUnpavedShare: 0.5 } : {}), traffic: 'protect-ride',
      bike: { category: ride.mode === 'dual-sport' ? 'dual-sport' : dirt ? 'adventure' : 'street', maintainedGravel: 'allow', roughTracks: ride.mode === 'dual-sport' ? 'allow' : 'avoid' },
    },
    ...(ride.loopMinutes === undefined ? {} : { discovery: { targetMinutes: ride.loopMinutes, toleranceMinutes: ride.loopMinutes * 0.15 } }),
  };
}
function bounds(candidate: ProviderCandidate): BoundingBox {
  const points = candidate.geometry;
  return { west: Math.min(...points.map(p => p.lon)) - 0.005, east: Math.max(...points.map(p => p.lon)) + 0.005, south: Math.min(...points.map(p => p.lat)) - 0.005, north: Math.max(...points.map(p => p.lat)) + 0.005 };
}
const lockPath = 'scorecard-out/.run.lock';
let ownsLock = false;
function releaseLock() { if (ownsLock) { unlinkSync(lockPath); ownsLock = false; } }
process.on('SIGINT', () => { releaseLock(); process.exit(130); });
process.on('SIGTERM', () => { releaseLock(); process.exit(143); });
type RiderLineCache = Record<string, { snap: SnapResult }>;
const riderLineCachePath = 'scorecard-out/rider-lines.json';
async function readRiderLineCache(refresh: boolean): Promise<RiderLineCache> {
  if (refresh) return {};
  try { return JSON.parse(await readFile(riderLineCachePath, 'utf8')) as RiderLineCache; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return {}; }
}

/** The rider's own line: snapped to our roads (cached by track and profile), then measured with the same code. */
async function riderLineFor(ride: Ride, request: ProviderRouteRequest, router: ReturnType<typeof createGraphHopperProvider>, authority: Awaited<ReturnType<typeof frozenAuthority>>, cache: RiderLineCache, baselineMinutes: number): Promise<{ measurement: Measurement | null; snap: RiderLineSnap }> {
  const track = decodeCatalogPolyline(ride.riderTrack!.geometryPolyline);
  const profile = snapProfileFor(ride.mode);
  const key = createHash('sha256').update(JSON.stringify({ v: 1, profile, anchors: pickAnchors(track) })).digest('hex');
  const cached = cache[key];
  const result = cached?.snap ?? await snapRiderLine(track, { provider: router, profile, signal: AbortSignal.timeout(600_000) });
  if (!cached) { cache[key] = { snap: result }; await writeFile(riderLineCachePath, JSON.stringify(cache)); }
  const snap: RiderLineSnap = { coverage: result.coverage, routerCalls: cached ? 0 : result.routerCalls, profile, fromCache: cached !== undefined, note: result.note };
  if (!result.candidate) return { measurement: null, snap };
  const roads = await authority.assess(bounds(result.candidate), AbortSignal.timeout(10_000));
  return { measurement: measure(result.candidate, ride, request.options, baselineMinutes, 0, roads.evaluate(result.candidate.geometry)), snap };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const set = args.includes('--set') ? args[args.indexOf('--set') + 1] : 'tuning';
  if (set !== 'tuning' && set !== 'holdout') throw new Error('--set must be tuning or holdout');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set') i++;
    else if (!['--refresh-authority', '--refresh-rider-lines', '--freeze-threshold'].includes(args[i]!)) throw new Error(`Unknown argument: ${args[i]}`);
  }
  const freeze = args.includes('--freeze-threshold');
  if (freeze && set !== 'tuning') throw new Error('--freeze-threshold uses the tuning set only');
  const raw = await readFile('tests/scorecard/rides.json', 'utf8');
  const manifestSha256 = createHash('sha256').update(raw).digest('hex');
  const manifest = JSON.parse(raw) as { rideDate: string; notes: string[]; tuning: Ride[]; holdout: Ride[] };
  const rides = manifest[set];
  if (rides.length !== 20 || new Set(rides.map(r => r.requestId)).size !== 20) throw new Error('Expected 20 rides with unique request IDs');
  if (!freeze && FROZEN_CURVY_THRESHOLD.manifestSha256 !== manifestSha256) throw new Error('The frozen Curvy threshold was set for a different rides.json. Re-freeze it deliberately with: npm run scorecard -- --freeze-threshold');
  const baseUrl = process.env.GRAPHHOPPER_URL ?? 'http://127.0.0.1:8989';
  const url = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Use the local SSH tunnel to docker-stable');
  const atlasPath = process.env.OGV_GRAVEL_ATLAS_PATH ?? 'data/scorecard/gravel-atlas-v3.sqlite';
  const atlas = createGravelAtlas(atlasPath);
  if (!freeze && !atlas.availability().available) throw new Error(`Local atlas unavailable: ${JSON.stringify(atlas.availability())}`);
  await mkdir('scorecard-out', { recursive: true });
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Another scorecard is running (scorecard-out/.run.lock). If interrupted, verify it stopped before removing a stale lock.'); });
  ownsLock = true;
  await lock.writeFile(String(process.pid));
  await lock.close();
  const authority = await frozenAuthority(manifest.rideDate, args.includes('--refresh-authority'), SWITCHES);
  // Serialize at HTTP level, including detached production shadow generators, and count every request.
  // Counting lives here, not in src/, so the planner is measured exactly as it ships.
  const meter = createRouterMeter(fetch, (call, body) => writeFile(`scorecard-out/router-error-${call}.json`, Buffer.from(body)));
  const fetcher = meter.fetcher;
  const production = createGraphHopperProvider({ baseUrl, riderModesEnabled: true, fetcher });
  // The baseline is the engine's plain fastest loop; only OpenGravel re-seeds loops that retrace a dead-end road.
  const fastest = createGraphHopperProvider({ baseUrl, riderModesEnabled: false, reseedDeadEndLoops: false, fetcher });
  const riderLineCache = await readRiderLineCache(args.includes('--refresh-rider-lines'));

  if (freeze) {
    // Rider-line shares for the tuning Curvy rides only. No planning, no baseline.
    const rows: Pick<Row, 'ride' | 'riderLine'>[] = [];
    for (const ride of rides.filter(r => r.mode === 'curvy' && r.riderTrack)) {
      const { measurement, snap } = await riderLineFor(ride, requestFor(ride), fastest, authority, riderLineCache, 0);
      console.log(`${ride.label}: rider-line share ${measurement ? (measurement.goodShare * 100).toFixed(2) + '%' : 'not measured'} (${snap.note})`);
      rows.push({ ride, riderLine: measurement });
    }
    const shares = riderCurvyShares(rows);
    if (Object.keys(shares).length !== rows.length) throw new Error('A rider line could not be measured; not freezing a threshold from part of the set');
    const frozen = freezeCurvyThreshold(manifestSha256, shares);
    await writeFile('scripts/scorecard/frozen-threshold.ts', renderFrozenThreshold(frozen));
    console.log(`Frozen: median rider-line share ${(frozen.median * 100).toFixed(2)}%, Curvy loop threshold ${(frozen.threshold * 100).toFixed(2)}% (75% of the median). Router requests: ${meter.count()}.`);
    return;
  }

  const curvyThreshold = FROZEN_CURVY_THRESHOLD.threshold;
  const rows: Row[] = [];
  for (const ride of rides) {
    const request = requestFor(ride);
    let baseline: Measurement | null = null; let selected: Measurement | null = null; let riderLine: Measurement | null = null;
    let riderSnap: RiderLineSnap | null = null;
    let routerUse: RouterUse | null = null;
    const errors: string[] = [];
    try {
      const started = performance.now();
      const answer = await fastest.candidates({ ...request, profile: 'motorcycle_fastest', options: { vehicle: 'motorcycle', includeAlternatives: false, avoidHighways: request.options.avoidHighways, tollPolicy: 'allow-with-warning', roadCharacter: 'efficient', surfacePreference: 'mixed' } }, AbortSignal.timeout(120_000));
      const seconds = (performance.now() - started) / 1000;
      const candidate = answer.candidates[0];
      if (!candidate) throw new Error('Fastest returned no route');
      const roads = await authority.assess(bounds(candidate), AbortSignal.timeout(10_000));
      baseline = measure(candidate, ride, request.options, candidate.durationSeconds / 60, seconds, roads.evaluate(candidate.geometry));
    } catch (error) { errors.push(`Fastest: ${String(error)}`); }
    try {
      const watched = instrumentProvider(production);
      const callsBefore = meter.count();
      watched.start();
      const started = performance.now();
      const result = await planRide({ identity: { rideId: `scorecard_${ride.id}`, rideRevision: 1, planningGeneration: 1 }, request }, {
        provider: watched.provider, env: SWITCHES, gravelAtlas: atlas, roadAuthority: authority,
        now: () => manifest.rideDate,
      });
      const seconds = (performance.now() - started) / 1000;
      const callsAtReturn = meter.count();
      routerUse = { calls: callsAtReturn - callsBefore, shadowCalls: 0, firstRouteSeconds: watched.firstRouteSeconds() };
      if (!result.ok) throw new Error(`planRide: ${result.error.code}`);
      const best = result.bundle.candidates.find(c => c.id === (result.bundle.roles['best-ride'] ?? result.bundle.selectedRouteId));
      if (!best) throw new Error('No selected Best Ride');
      const candidate = watched.seen.find(c => Math.abs(c.durationSeconds - best.durationSeconds) < 1 && c.geometry.length === best.geometry.length && c.geometry.every((p, i) => p.lat === best.geometry[i]!.lat && p.lon === best.geometry[i]!.lon));
      if (!candidate) throw new Error('Selected geometry not matched to raw provider answer');
      const roads = await authority.assess(bounds(candidate), AbortSignal.timeout(10_000));
      selected = measure(candidate, ride, request.options, baseline?.minutes ?? 0, seconds, roads.evaluate(candidate.geometry));
      // Nothing is left running after the answer; the meter is drained so the
      // next ride's count starts clean.
      await meter.idle();
      routerUse = { ...routerUse, shadowCalls: meter.count() - callsAtReturn };
    } catch (error) { errors.push(`OpenGravel: ${String(error)}`); }
    // The rider's own line: third contestant. Runs after the plan has drained, so its router requests are never counted against OpenGravel.
    if (ride.riderTrack) {
      try {
        // A rider line that is too little matched stays unmeasured (its note is shown on the row); that is the
        // yardstick's problem (exit 2), not a planning error. Only a router failure lands in `errors`.
        ({ measurement: riderLine, snap: riderSnap } = await riderLineFor(ride, request, fastest, authority, riderLineCache, baseline?.minutes ?? 0));
      } catch (error) { errors.push(`Rider line: ${String(error)}`); }
    }
    const failed = { verdict: 'Loss' as const, reasons: ['Planning failed; comparison unavailable'] };
    const outcome = selected && baseline ? winTieLoss(ride, selected, baseline, curvyThreshold) : failed;
    const outcomeV1 = selected && baseline ? winTieLoss(ride, asV1(selected), asV1(baseline)) : failed;
    const row: Row = { ride, openGravel: selected, fastest: baseline, riderLine, riderSnap, ...outcome, verdictV1: outcomeV1.verdict, reasonsV1: outcomeV1.reasons, routerUse, errors };
    rows.push(row);
    const mine = routerUse ? `${routerUse.calls} router calls, first route ${routerUse.firstRouteSeconds === null ? '?' : routerUse.firstRouteSeconds.toFixed(1)}s` : 'router use unknown';
    const rider = riderLine && baseline ? `; rider line ${riderLine.goodMiles.toFixed(1)} vs fastest ${baseline.goodMiles.toFixed(1)} good mi` : '';
    console.log(`${rows.length}/20 ${ride.label}: ${row.verdict} (v1 ${row.verdictV1}); trust ${selected?.trustFailures.length ?? 'unknown'}; ${mine}${rider}; ${[...row.reasons, ...errors].join('; ')}`);
    await writeFile('scorecard-out/progress.json', JSON.stringify(rows, null, 2));
  }
  await meter.idle();
  const summary = {
    wins: rows.filter(r => r.verdict === 'Win').length, ties: rows.filter(r => r.verdict === 'Tie').length,
    losses: rows.filter(r => r.verdict === 'Loss').length,
    winsV1: rows.filter(r => r.verdictV1 === 'Win').length,
    trustFailures: rows.reduce((n, r) => n + (r.openGravel?.trustFailures.length ?? 0), 0),
    baselineTrustFailures: rows.reduce((n, r) => n + (r.fastest?.trustFailures.length ?? 0), 0),
    planningErrors: rows.filter(r => r.errors.length).length,
    ridesWithUnknownTrust: rows.filter(r => r.openGravel && r.openGravel.unknownTrust.length > 0).length,
  };
  const yardstick = yardstickCheck(rows);
  const load = routerLoad(rows);
  const warnings: string[] = [];
  const moved = set === 'tuning' ? Object.entries(riderCurvyShares(rows)).filter(([id, share]) => Math.abs(share - (FROZEN_CURVY_THRESHOLD.riderShares[id] ?? NaN)) > 1e-4 || !(id in FROZEN_CURVY_THRESHOLD.riderShares)) : [];
  if (moved.length) warnings.push(`Rider-line shares differ from the frozen Curvy threshold's inputs (${moved.map(([id]) => id).join(', ')}). The router or map may have changed; the threshold stays frozen until you deliberately run --freeze-threshold.`);
  const lowCoverage = rows.filter(r => r.riderSnap && r.riderSnap.coverage < 1).map(r => `${r.ride.label} ${(r.riderSnap!.coverage * 100).toFixed(0)}%`);
  if (lowCoverage.length) warnings.push(`Rider lines with unmatched stretches (measured, those stretches earn nothing; under ${MIN_SNAP_COVERAGE * 100}% is not measured): ${lowCoverage.join(', ')}`);
  if (!yardstick.passed) warnings.unshift(yardstick.message);
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceWarnings = (await readFile('src/server/planning/plan-service.ts', 'utf8')).includes('OGV_DIRT_LOOP_GENERATORS') ? [] : ['This checkout does not read OGV_DIRT_LOOP_GENERATORS; results describe this revision, not the newer production planner.'];
  const result = { headline: headline(rows), headlineV1: headlineV1(rows), yardstick, routerLoad: load, curvyLoopThreshold: curvyThreshold, summary, set, generatedAt: new Date().toISOString(), rideDate: manifest.rideDate,
    gitHead, sourceWarnings,
    manifestSha256, atlasSha256: createHash('sha256').update(await readFile(atlasPath)).digest('hex'),
    authoritySha256: createHash('sha256').update(await readFile('scorecard-out/authority-snapshots.json')).digest('hex'),
    switches: SWITCHES, router: baseUrl, routerCalls: meter.count(), assumptions: manifest.notes, rows };
  await writeFile('scorecard-out/latest.json', JSON.stringify(result, null, 2));
  await writeFile('scorecard-out/index.html', report(rows, set, manifest.rideDate, [`Measured source revision: ${gitHead}`, ...manifest.notes], [...warnings, ...sourceWarnings], { yardstick, load, curvyLoopThreshold: curvyThreshold }));
  console.log(`v2 (this scorecard): ${result.headline}`);
  console.log(`v1 (old yardstick):  ${result.headlineV1}`);
  console.log(yardstick.message);
  console.log(loadLine(load));
  for (const warning of warnings.slice(yardstick.passed ? 0 : 1)) console.log(`Note: ${warning}`);
  if (summary.planningErrors > 0) process.exitCode = 1;
  else if (!yardstick.passed) process.exitCode = 2;
}
main().finally(releaseLock).then(() => process.exit(process.exitCode ?? 0), error => { console.error(error); process.exit(1); });
