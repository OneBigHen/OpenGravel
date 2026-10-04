import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "./route-provider";

const UNPAVED = new Set(["unpaved", "gravel", "fine_gravel", "compacted", "dirt", "ground", "grass", "sand"]);
const BUSY = new Set(["motorway", "trunk", "primary"]);

/** Union exposure in travelled metres; missing road runs keep busy share unknown. */
export function riderEnvelopeMetrics(candidate: ProviderCandidate): { unpavedShare: number; busyShare: number | null } | null {
  const summary = candidate.roadSummary;
  if (summary === undefined || summary.totalMeters <= 0) return null;
  const unpavedMeters = Object.entries(summary.surfaceByRoadClassMeters).reduce((sum, [key, meters]) => sum + (UNPAVED.has(key.split("|")[0]!.toLowerCase()) ? meters : 0), 0);
  const busyMeters = summary.roadRuns?.reduce((sum, run) => sum + (BUSY.has(run.roadClass.toLowerCase()) || run.urbanDensity.toLowerCase() === "city" ? run.meters : 0), 0);
  return { unpavedShare: unpavedMeters / summary.totalMeters, busyShare: busyMeters === undefined ? null : busyMeters / summary.totalMeters };
}

/** A slower route must buy at least one point of dirt per this many extra minutes. */
export const DIRT_MINUTES_PER_POINT = 3;
const MIN_DIRT_GAIN = 0.02;
/** Dirt mode may stretch the trip this far; {@link DIRT_MINUTES_PER_POINT} decides if it should. */
export const DIRT_DETOUR_CAP = 1.75;

/** Walk fastest-first; step up only when the extra dirt pays for the extra minutes. */
function dirtKnee<T extends { candidate: ProviderCandidate; unpavedShare: number }>(byDuration: readonly T[]): T | undefined {
  let chosen = byDuration[0];
  for (const next of byDuration.slice(1)) {
    if (chosen === undefined) break;
    const gain = next.unpavedShare - chosen.unpavedShare;
    const minutes = (next.candidate.durationSeconds - chosen.candidate.durationSeconds) / 60;
    if (gain >= MIN_DIRT_GAIN && gain * 100 * DIRT_MINUTES_PER_POINT >= minutes) chosen = next;
  }
  return chosen;
}

/**
 * Dirt strengths a sweep tries, most informative first; a budget of n takes
 * the first n. The router answers dirt pressure in steps (Lock Haven -> Slate
 * Run: 0% up to 1, 28% from 1.25), so one parallel wave with alternatives
 * finds the steps a three-call bisection missed.
 */
export const DIRT_SWEEP_FACTORS: readonly number[] = [0, 2, 1.25, 3, 1, 1.5, 5, 1.75, 0.75, 4];
/** Default and ceiling for the dirt sweep's router calls. */
export const DIRT_SWEEP_CALLS = 7;
export const MAX_DIRT_SWEEP_CALLS = DIRT_SWEEP_FACTORS.length;

export interface RiderModeTrial {
  readonly factor: number;
  readonly unpavedShare: number;
  readonly busyShare: number | null;
  readonly minutes: number;
}

function sameRoute(a: ProviderCandidate, b: ProviderCandidate): boolean {
  return a.durationSeconds === b.durationSeconds && a.distanceMeters === b.distanceMeters && a.geometry.length === b.geometry.length;
}

/** Bounded strength search. The caller still applies canonical eligibility and ranking. */
export async function searchRiderEnvelope(input: {
  readonly request: ProviderRouteRequest;
  readonly candidates: readonly ProviderCandidate[];
  readonly baselineRequest?: ProviderRouteRequest;
  readonly provider: RouteCandidateProvider;
  readonly screen?: (candidate: ProviderCandidate) => boolean;
  readonly verify?: (candidates: readonly ProviderCandidate[], signal: AbortSignal) => Promise<readonly ProviderCandidate[]>;
  readonly maxCalls: number;
  /** Router calls for the parallel dirt sweep; dirt modes only. Defaults to maxCalls. */
  readonly sweepCalls?: number;
  readonly deadlineMs: number;
  readonly signal: AbortSignal;
}): Promise<{ candidate: ProviderCandidate | null; calls: number; trials: readonly RiderModeTrial[] }> {
  if (input.signal.aborted) throw input.signal.reason;
  const target = input.request.options.targetUnpavedShare ?? (input.request.options.surfacePreference === "dirt-preferred" ? 0.5 : 0);
  const avoidBusy = input.request.options.traffic === "protect-ride" && input.request.options.roadCharacter !== "efficient";
  const trials: RiderModeTrial[] = [];
  const measured: { candidate: ProviderCandidate; factor: number; unpavedShare: number; busyShare: number | null }[] = [];
  const add = (candidate: ProviderCandidate, factor: number): void => {
    const metrics = riderEnvelopeMetrics(candidate);
    if (metrics === null) return;
    measured.push({ candidate, factor, ...metrics });
    trials.push({ factor, ...metrics, minutes: candidate.durationSeconds / 60 });
  };
  input.candidates.forEach(candidate => add(candidate, 1));
  if (measured.length === 0 || (target === 0 && (!avoidBusy || measured.every(entry => entry.busyShare === null))) || input.request.sketch !== undefined || input.request.discovery !== undefined) {
    return { candidate: null, calls: 0, trials };
  }
  const initialCount = measured.length;
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(Math.max(1, input.deadlineMs))]);
  let calls = 0;
  // Profiles time the same road differently (adventure runs 0.82x car speed),
  // so the cap never measures against an ETA faster than the rider's own model.
  // The pipeline also carries a fastest-profile line; only the rider's own
  // profile sets the baseline when it is there (Gettysburg -> Pine Grove: 36
  // min fastest vs 44 own pushed the 66-min dirt route 30 s over the cap).
  const own = measured.filter(entry => entry.candidate.profile === input.request.profile);
  const ownSeconds = Math.min(...(own.length > 0 ? own : measured).map(entry => entry.candidate.durationSeconds));
  let baselineSeconds = ownSeconds;
  const cap = target > 0 ? DIRT_DETOUR_CAP : 1.35;
  let low = 0;
  let high = 4;
  if (target > 0) {
    // Dirt: one parallel wave of strengths, each with the router's alternatives.
    const factors = DIRT_SWEEP_FACTORS.slice(0, Math.min(MAX_DIRT_SWEEP_CALLS, Math.max(0, input.sweepCalls ?? input.maxCalls)));
    calls = factors.length;
    const settled = await Promise.allSettled(factors.map(factor => {
      const trialRequest = factor === 0 ? input.baselineRequest ?? input.request : input.request;
      return input.provider.candidates({ ...trialRequest, options: { ...trialRequest.options, includeAlternatives: factor > 0, riderModeFactor: factor } }, signal);
    }));
    if (input.signal.aborted) throw input.signal.reason;
    settled.forEach((outcome, index) => {
      if (outcome.status !== "fulfilled") return;
      const factor = factors[index]!;
      const kept = outcome.value.candidates.filter(candidate => input.screen?.(candidate) ?? true);
      kept.forEach(candidate => add(candidate, factor));
      if (factor === 0 && kept.length > 0) baselineSeconds = Math.max(ownSeconds, Math.min(...kept.map(candidate => candidate.durationSeconds)));
    });
  }
  const limit = target > 0 ? 0 : Math.min(3, Math.max(0, input.maxCalls));
  for (let index = 0; index < limit && !signal.aborted; index += 1) {
    const factor = index === 0 ? 0 : (low + high) / 2;
    calls += 1;
    try {
      const trialRequest = index === 0 ? input.baselineRequest ?? input.request : input.request;
      const result = await input.provider.candidates({ ...trialRequest, options: { ...trialRequest.options, includeAlternatives: false, riderModeFactor: factor } }, signal);
      const start = measured.length;
      const verified = result.candidates.filter(candidate => input.screen?.(candidate) ?? true);
      verified.forEach(candidate => add(candidate, factor));
      if (index === 0 && verified.length > 0) baselineSeconds = Math.max(ownSeconds, Math.min(...verified.map(candidate => candidate.durationSeconds)));
      if (index === 0) {
        const initialWithinCap = measured.slice(0, start).filter(entry => entry.candidate.durationSeconds <= baselineSeconds * cap);
        if (initialWithinCap.length === 0 || (target > 0 && initialWithinCap.some(entry => entry.unpavedShare >= target))) high = 1;
        else low = 1;
      }
      const entries = measured.slice(start);
      const meets = entries.some(entry => entry.candidate.durationSeconds <= baselineSeconds * cap && (target > 0 ? entry.unpavedShare >= target : entry.busyShare !== null && entry.busyShare <= Math.min(...measured.slice(0, start).map(previous => previous.busyShare ?? 1))));
      if (index > 0 && entries.length > 0) {
        if (meets || entries.every(entry => entry.candidate.durationSeconds > baselineSeconds * cap)) high = factor;
        else low = factor;
      }
    } catch {
      if (input.signal.aborted) throw input.signal.reason;
    }
  }
  if (input.signal.aborted) throw input.signal.reason;
  // Neighbouring strengths often return the same line; keep the first.
  const distinct = measured.filter((entry, index) => index < initialCount || !measured.slice(0, index).some(other => sameRoute(other.candidate, entry.candidate)));
  let accepted = distinct;
  if (input.verify !== undefined) {
    try {
      const verified = new Set(await input.verify(distinct.slice(initialCount).map(entry => entry.candidate), signal));
      accepted = distinct.filter((entry, index) => index < initialCount || verified.has(entry.candidate));
    } catch {
      if (input.signal.aborted) throw input.signal.reason;
      accepted = distinct.slice(0, initialCount);
    }
  }
  // The pipeline already accepted its own candidates; the cap bounds trials only.
  const feasible = accepted.filter((entry, index) => index < initialCount || entry.candidate.durationSeconds <= baselineSeconds * cap);
  const hits = target > 0 ? feasible.filter(entry => entry.unpavedShare >= target) : [];
  const pool = hits.length > 0 ? hits : feasible;
  pool.sort((a, b) => {
    if (hits.length > 0 || target > 0) return a.candidate.durationSeconds - b.candidate.durationSeconds;
    return (a.busyShare ?? 1) - (b.busyShare ?? 1) || a.candidate.durationSeconds - b.candidate.durationSeconds;
  });
  const chosen = hits.length === 0 && target > 0 ? dirtKnee(pool) : pool[0];
  return {
    candidate: chosen === undefined ? null : { ...chosen.candidate, providerMetadata: { ...chosen.candidate.providerMetadata, riderModeFactor: chosen.factor, riderModeTrials: JSON.stringify(trials), riderModeAddedMinutes: (chosen.candidate.durationSeconds - baselineSeconds) / 60 } },
    calls,
    trials,
  };
}
