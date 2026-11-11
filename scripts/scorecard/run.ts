/** Measurement only; no routing overrides or network calls to Google.
 * Setup: ssh -N -L 8989:127.0.0.1:8989 docker-stable
 * Copy /var/lib/opengravel/gravel-atlas-v3.sqlite into ignored data/scorecard/.
 * npm run scorecard -- --set tuning (default); --set holdout on ship days only.
 * --refresh-authority replaces frozen feed evidence; ride date lives in rides.json.
 * Exit 0 means all 20 comparisons ran, not that OpenGravel won or was safe.
 */
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createGraphHopperProvider } from '../../src/infrastructure/routing/graphhopper/provider';
import { planRide } from '../../src/server/planning/plan-service';
import { createGravelAtlas } from '../../src/server/roads/gravel-atlas';
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from '../../src/application/planner/route-provider';
import type { BoundingBox } from '../../src/application/route-intelligence/types';
import { frozenAuthority } from './authority';
import { measure } from './measure';
import { winTieLoss } from './scoring';
import { headline, report } from './report';
import type { Measurement, Ride, Row } from './types';

const SWITCHES = {
  OGV_RIDER_MODES: 'on', OGV_DIRT_LOOP_GENERATORS: 'on', OGV_ATLAS_GENERATORS: 'off',
  OGV_RIDE_FORMULA: 'shadow', OGV_FUN_GENERATORS: 'shadow', OGV_ROAD_AUTHORITY: 'on',
  OGV_TRAFFIC_LIVE_AVOID: 'off', OGV_JEV_FUN_JUDGE: 'off',
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
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const set = args.includes('--set') ? args[args.indexOf('--set') + 1] : 'tuning';
  if (set !== 'tuning' && set !== 'holdout') throw new Error('--set must be tuning or holdout');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set') i++;
    else if (args[i] !== '--refresh-authority') throw new Error(`Unknown argument: ${args[i]}`);
  }
  const raw = await readFile('tests/scorecard/rides.json', 'utf8');
  const manifest = JSON.parse(raw) as { rideDate: string; notes: string[]; tuning: Ride[]; holdout: Ride[] };
  const rides = manifest[set];
  if (rides.length !== 20 || new Set(rides.map(r => r.requestId)).size !== 20) throw new Error('Expected 20 rides with unique request IDs');
  const baseUrl = process.env.GRAPHHOPPER_URL ?? 'http://127.0.0.1:8989';
  const url = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Use the local SSH tunnel to docker-stable');
  const atlasPath = process.env.OGV_GRAVEL_ATLAS_PATH ?? 'data/scorecard/gravel-atlas-v3.sqlite';
  const atlas = createGravelAtlas(atlasPath);
  if (!atlas.availability().available) throw new Error(`Local atlas unavailable: ${JSON.stringify(atlas.availability())}`);
  await mkdir('scorecard-out', { recursive: true });
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Another scorecard is running (scorecard-out/.run.lock). If interrupted, verify it stopped before removing a stale lock.'); });
  ownsLock = true;
  await lock.writeFile(String(process.pid));
  await lock.close();
  const authority = await frozenAuthority(manifest.rideDate, args.includes('--refresh-authority'), SWITCHES);
  // Serialize at HTTP level, including detached production shadow generators.
  // Consume each response body before releasing the next request.
  let tail: Promise<unknown> = Promise.resolve();
  let calls = 0;
  const fetcher: typeof fetch = (input, init) => {
    const next = tail.then(async () => {
      calls++;
      const response = await fetch(input, init);
      const body = await response.arrayBuffer();
      if (!response.ok) await writeFile(`scorecard-out/router-error-${calls}.json`, Buffer.from(body));
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    });
    tail = next.catch(() => undefined);
    return next;
  };
  const production = createGraphHopperProvider({ baseUrl, riderModesEnabled: true, rideFormulaEnabled: false, fetcher });
  // The baseline is the engine's plain fastest loop; only OpenGravel re-seeds loops that retrace a dead-end road.
  const fastest = createGraphHopperProvider({ baseUrl, riderModesEnabled: false, rideFormulaEnabled: false, reseedDeadEndLoops: false, fetcher });
  const rows: Row[] = [];
  for (const ride of rides) {
    const request = requestFor(ride);
    let baseline: Measurement | null = null; let selected: Measurement | null = null;
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
      const seen: ProviderCandidate[] = [];
      let pending = 0;
      const recorder: RouteCandidateProvider = {
        id: production.id, capabilities: () => production.capabilities(),
        async candidates(req, signal) { pending++; try { const result = await production.candidates(req, signal); seen.push(...result.candidates); return result; } finally { pending--; } },
      };
      const started = performance.now();
      let shadowDone = false;
      const result = await planRide({ identity: { rideId: `scorecard_${ride.id}`, rideRevision: 1, planningGeneration: 1 }, request }, {
        provider: recorder, env: SWITCHES, gravelAtlas: atlas, roadAuthority: authority,
        now: () => manifest.rideDate, funJudge: null, funCharacterClassifier: null,
        onFunGeneratorReport: () => { shadowDone = true; },
      });
      const seconds = (performance.now() - started) / 1000;
      if (!result.ok) throw new Error(`planRide: ${result.error.code}`);
      const best = result.bundle.candidates.find(c => c.id === (result.bundle.roles['best-ride'] ?? result.bundle.selectedRouteId));
      if (!best) throw new Error('No selected Best Ride');
      const candidate = seen.find(c => Math.abs(c.durationSeconds - best.durationSeconds) < 1 && c.geometry.length === best.geometry.length && c.geometry.every((p, i) => p.lat === best.geometry[i]!.lat && p.lon === best.geometry[i]!.lon));
      if (!candidate) throw new Error('Selected geometry not matched to raw provider answer');
      const roads = await authority.assess(bounds(candidate), AbortSignal.timeout(10_000));
      selected = measure(candidate, ride, request.options, baseline?.minutes ?? 0, seconds, roads.evaluate(candidate.geometry));
      // Shadow work is excluded from user-facing planning latency but drained
      // before the next ride. No background router searches can stack up.
      const deadline = Date.now() + 90_000;
      while ((!shadowDone || pending > 0) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      await tail;
      if (!shadowDone || pending > 0) throw new Error('Shadow generator did not finish within 90 seconds');
    } catch (error) { errors.push(`OpenGravel: ${String(error)}`); }
    const outcome = selected && baseline ? winTieLoss(ride, selected, baseline) : { verdict: 'Loss' as const, reasons: ['Planning failed; comparison unavailable'] };
    const row: Row = { ride, openGravel: selected, fastest: baseline, ...outcome, errors };
    rows.push(row);
    console.log(`${rows.length}/20 ${ride.label}: ${row.verdict}; trust ${selected?.trustFailures.length ?? 'unknown'}; ${[...row.reasons, ...errors].join('; ')}`);
    await writeFile('scorecard-out/progress.json', JSON.stringify(rows, null, 2));
  }
  await tail;
  const summary = {
    wins: rows.filter(r => r.verdict === 'Win').length, ties: rows.filter(r => r.verdict === 'Tie').length,
    losses: rows.filter(r => r.verdict === 'Loss').length,
    trustFailures: rows.reduce((n, r) => n + (r.openGravel?.trustFailures.length ?? 0), 0),
    baselineTrustFailures: rows.reduce((n, r) => n + (r.fastest?.trustFailures.length ?? 0), 0),
    planningErrors: rows.filter(r => r.errors.length).length,
    ridesWithUnknownTrust: rows.filter(r => r.openGravel && r.openGravel.unknownTrust.length > 0).length,
  };
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceWarnings = (await readFile('src/server/planning/plan-service.ts', 'utf8')).includes('OGV_DIRT_LOOP_GENERATORS') ? [] : ['This checkout does not read OGV_DIRT_LOOP_GENERATORS; results describe this revision, not the newer production planner.'];
  const result = { headline: headline(rows), summary, set, generatedAt: new Date().toISOString(), rideDate: manifest.rideDate,
    gitHead, sourceWarnings,
    manifestSha256: createHash('sha256').update(raw).digest('hex'), atlasSha256: createHash('sha256').update(await readFile(atlasPath)).digest('hex'),
    authoritySha256: createHash('sha256').update(await readFile('scorecard-out/authority-snapshots.json')).digest('hex'),
    switches: SWITCHES, router: baseUrl, routerCalls: calls, assumptions: manifest.notes, rows };
  await writeFile('scorecard-out/latest.json', JSON.stringify(result, null, 2));
  await writeFile('scorecard-out/index.html', report(rows, set, manifest.rideDate, [`Measured source revision: ${gitHead}`, ...manifest.notes], sourceWarnings));
  console.log(result.headline);
  if (summary.planningErrors > 0) process.exitCode = 1;
}
main().finally(releaseLock).then(() => process.exit(process.exitCode ?? 0), error => { console.error(error); process.exit(1); });
