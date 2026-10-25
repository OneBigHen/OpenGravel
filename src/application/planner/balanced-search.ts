import { analyzeBends } from "@/domain/geometry/bends";
import { analyzeFrancoCurvature } from "@/domain/geometry/franco-curvature";
import { riderEnvelopeMetrics, type RiderModeTrial } from "./rider-mode-search";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "./route-provider";

/** Balanced spends at most 25% over the fastest eligible route on real bends. */
export const BALANCED_DETOUR_CAP = 1.25;
const MIN_BEND_GAIN_METERS = 400;
const MIN_CURVATURE_GAIN = 5;
const MAX_CANDIDATES = 16;
const SWEEP_FACTORS = [1, 4] as const;

interface CurveMeasurement {
  readonly perKm: number;
  readonly bendMeters: number;
}

function residentialShare(candidate: ProviderCandidate): number | null {
  const runs = candidate.roadSummary?.roadRuns;
  if (runs === undefined || runs.length === 0) return null;
  const total = runs.reduce((sum, run) => sum + run.meters, 0);
  return total > 0 ? runs.reduce((sum, run) => sum + (
    ["residential", "service"].includes(run.roadClass.toLowerCase()) ||
    ["residential", "city"].includes(run.urbanDensity.toLowerCase()) ? run.meters : 0
  ), 0) / total : null;
}

/**
 * Balanced must buy curves, rather than choose the smallest busy-road share
 * regardless of curves. Two bounded twisty alternatives searches explore the
 * gaps between the character lanes. Loops use a second deterministic seed
 * family, with their own timebox instead of a point-to-point detour cap.
 * Canonical eligibility and road-authority checks remain caller-owned.
 */
export async function searchBalancedEnvelope(input: {
  readonly request: ProviderRouteRequest;
  readonly candidates: readonly ProviderCandidate[];
  readonly incumbent?: ProviderCandidate;
  readonly provider: RouteCandidateProvider;
  readonly maxCalls: number;
  readonly deadlineMs: number;
  readonly signal: AbortSignal;
  readonly screen?: (candidate: ProviderCandidate) => boolean;
  readonly verify?: (candidates: readonly ProviderCandidate[], signal: AbortSignal) => Promise<readonly ProviderCandidate[]>;
  readonly measure?: (candidate: ProviderCandidate) => CurveMeasurement;
}): Promise<{ candidate: ProviderCandidate | null; calls: number; trials: readonly RiderModeTrial[] }> {
  if (input.signal.aborted) throw input.signal.reason;
  const request = input.request;
  if (request.sketch !== undefined || request.shaping.length > 0 || request.stops.length > 0 || (request.roadSpans?.length ?? 0) > 0) {
    return { candidate: null, calls: 0, trials: [] };
  }
  const measure = input.measure ?? ((candidate: ProviderCandidate): CurveMeasurement => ({
    perKm: analyzeFrancoCurvature(candidate.geometry).curvaturePerKm,
    bendMeters: candidate.roadSummary?.bendMeters ?? analyzeBends(candidate.geometry).bendMeters,
  }));
  const measured = input.candidates.slice(0, MAX_CANDIDATES).map(candidate => ({
    candidate, factor: 1, ...measure(candidate),
    busy: riderEnvelopeMetrics(candidate)?.busyShare ?? null,
    residential: residentialShare(candidate),
  }));
  const leader = measured.find(entry => entry.candidate === input.incumbent) ?? measured[0];
  if (leader === undefined) return { candidate: null, calls: 0, trials: [] };
  const initialCount = measured.length;
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(Math.max(1, input.deadlineMs))]);
  const serves = input.provider.capabilities().profiles;
  const profile = serves.length === 0 || serves.includes("motorcycle_twisty") ? "motorcycle_twisty" : request.profile;
  // Busy strengths are identical without busy-road avoidance. Also avoid a
  // second three-seed loop call when only one call can fit in the pool.
  const usefulCalls = request.options.traffic !== "protect-ride" || (request.discovery !== undefined && MAX_CANDIDATES - initialCount <= 3) ? 1 : 2;
  const factors = SWEEP_FACTORS.slice(0, Math.max(0, Math.min(usefulCalls, input.maxCalls)));
  const settled = await Promise.allSettled(factors.map(factor => input.provider.candidates({
    ...request,
    // Same seed family on retries; distinct from the initial lane's three loops.
    requestId: request.discovery === undefined ? request.requestId : `${request.requestId}:balanced-curves`,
    profile,
    options: { ...request.options, includeAlternatives: true, riderModeFactor: factor },
  }, signal)));
  if (input.signal.aborted) throw input.signal.reason;
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    for (const candidate of result.value.candidates) {
      if (measured.length >= MAX_CANDIDATES) break;
      if (!(input.screen?.(candidate) ?? true)) continue;
      if (measured.some(entry => entry.candidate.durationSeconds === candidate.durationSeconds &&
        entry.candidate.distanceMeters === candidate.distanceMeters &&
        JSON.stringify(entry.candidate.geometry) === JSON.stringify(candidate.geometry))) continue;
      measured.push({ candidate, factor: factors[index]!, ...measure(candidate), busy: riderEnvelopeMetrics(candidate)?.busyShare ?? null, residential: residentialShare(candidate) });
    }
  });
  let accepted = measured;
  if (input.verify !== undefined && measured.length > initialCount) {
    try {
      const verified = new Set(await input.verify(measured.slice(initialCount).map(entry => entry.candidate), signal));
      accepted = measured.filter((entry, index) => index < initialCount || verified.has(entry.candidate));
    } catch {
      if (input.signal.aborted) throw input.signal.reason;
      accepted = measured.slice(0, initialCount);
    }
  }
  const fastest = Math.min(...accepted.map(entry => entry.candidate.durationSeconds));
  const discovery = request.discovery;
  const value = (entry: (typeof measured)[number]): number =>
    entry.bendMeters / 1000 + entry.perKm / 50 - (request.options.traffic === "protect-ride" ? (entry.busy ?? 1) * 5 : 0) - (discovery === undefined
      ? Math.max(0, (entry.candidate.durationSeconds - leader.candidate.durationSeconds) / 60) * 0.08 : 0);
  const fits = (entry: (typeof measured)[number]): boolean => discovery === undefined
    ? entry.candidate.durationSeconds <= fastest * BALANCED_DETOUR_CAP
    : Math.abs(entry.candidate.durationSeconds / 60 - discovery.targetMinutes) <= discovery.toleranceMinutes;
  const exposureOk = (entry: (typeof measured)[number]): boolean =>
    (request.options.traffic !== "protect-ride" || (entry.busy !== null && entry.busy <= (leader.busy ?? 0) + 0.1)) &&
    entry.residential !== null && entry.residential <= (leader.residential ?? 0) + 0.03;
  const pool = accepted.filter(entry => fits(entry) && exposureOk(entry));
  const best = pool.filter(entry =>
    // A large busy-road improvement can still earn a quieter ride. Tiny
    // exposure differences must never erase the pipeline's better curves.
    (entry.bendMeters >= leader.bendMeters + MIN_BEND_GAIN_METERS && entry.perKm >= leader.perKm + MIN_CURVATURE_GAIN) ||
      (request.options.traffic === "protect-ride" && leader.busy !== null && entry.busy !== null && leader.busy - entry.busy >= 0.1 &&
        entry.bendMeters >= leader.bendMeters * 0.95 && entry.perKm >= leader.perKm * 0.95),
  ).sort((a, b) => value(b) - value(a) || a.candidate.durationSeconds - b.candidate.durationSeconds)[0];
  // The incumbent came from the broader canonical envelope. If it exceeds
  // Balanced's limit, return the best measured in-budget line even when it
  // gives up some of that over-budget route's curves.
  const fallback = discovery === undefined && !fits(leader)
    ? [...pool].sort((a, b) => value(b) - value(a) || a.candidate.durationSeconds - b.candidate.durationSeconds)[0] : undefined;
  const chosen = best !== undefined && value(best) > value(leader) ? best : fallback ?? null;
  return {
    candidate: chosen === null ? null : { ...chosen.candidate, providerMetadata: { ...chosen.candidate.providerMetadata, riderModeFactor: chosen.factor, curvaturePerKm: chosen.perKm } },
    calls: factors.length,
    trials: measured.map(entry => ({ factor: entry.factor, unpavedShare: riderEnvelopeMetrics(entry.candidate)?.unpavedShare ?? 0, busyShare: entry.busy, dirtKm: 0, minutes: entry.candidate.durationSeconds / 60, curvaturePerKm: entry.perKm })),
  };
}
