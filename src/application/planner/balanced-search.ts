import type { GeometryFun } from "@/domain/geometry/heading-fun";
import { candidateGeometryFun, geometryFunExposureAllowed, geometryFunUtility } from "./geometry-fun";
import { riderEnvelopeMetrics, type RiderModeTrial } from "./rider-mode-search";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "./route-provider";

/** Balanced spends at most 25% over the fastest eligible route on real bends. */
export const BALANCED_DETOUR_CAP = 1.25;
const MAX_CANDIDATES = 16;
const SWEEP_FACTORS = [1, 4] as const;

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
  readonly measure?: (candidate: ProviderCandidate) => GeometryFun | null;
}): Promise<{ candidate: ProviderCandidate | null; calls: number; trials: readonly RiderModeTrial[] }> {
  if (input.signal.aborted) throw input.signal.reason;
  const request = input.request;
  if (request.sketch !== undefined || request.shaping.length > 0 || request.stops.length > 0 || (request.roadSpans?.length ?? 0) > 0) {
    return { candidate: null, calls: 0, trials: [] };
  }
  const measure = input.measure ?? candidateGeometryFun;
  const measured = input.candidates.slice(0, MAX_CANDIDATES).flatMap(candidate => {
    const fun = measure(candidate);
    return fun === null ? [] : [{ candidate, factor: 1, fun }];
  });
  const leader = measured.find(entry => entry.candidate === input.incumbent) ?? measured[0];
  if (leader === undefined) return { candidate: null, calls: 0, trials: [] };
  const discovery = request.discovery;
  const initialFastest = Math.min(...input.candidates.map(c => c.durationSeconds));
  const fits = (entry: (typeof measured)[number], fastest: number): boolean => discovery === undefined
    ? entry.candidate.durationSeconds <= fastest * BALANCED_DETOUR_CAP
    : Math.abs(entry.candidate.durationSeconds / 60 - discovery.targetMinutes) <= discovery.toleranceMinutes;
  const initialPool = measured.filter(entry => fits(entry, initialFastest) && geometryFunExposureAllowed(entry.fun, leader.fun, request.options.traffic === "protect-ride"));
  const strongest = [...initialPool].sort((a, b) => geometryFunUtility(b.fun, b.candidate.durationSeconds, initialFastest) - geometryFunUtility(a.fun, a.candidate.durationSeconds, initialFastest))[0];
  // Extra calls are reserved for weak pools. A sustained sweeping ride already
  // in budget needs no further alternatives, even if Franco alone calls it dull.
  const weak = strongest === undefined ||
    strongest.fun.funScore < Math.max(1, strongest.candidate.distanceMeters / 1000 * 0.2) ||
    strongest.fun.headingDegreesPerKm < 45 || strongest.fun.bendMeters < strongest.candidate.distanceMeters * 0.3;
  const initialCount = measured.length;
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(Math.max(1, input.deadlineMs))]);
  const serves = input.provider.capabilities().profiles;
  const profile = serves.length === 0 || serves.includes("motorcycle_twisty") ? "motorcycle_twisty" : request.profile;
  // Busy strengths are identical without busy-road avoidance. Also avoid a
  // second three-seed loop call when only one call can fit in the pool.
  const usefulCalls = request.options.traffic !== "protect-ride" || (request.discovery !== undefined && MAX_CANDIDATES - initialCount <= 3) ? 1 : 2;
  const factors = SWEEP_FACTORS.slice(0, Math.max(0, Math.min(weak && input.deadlineMs > 0 ? usefulCalls : 0, input.maxCalls)));
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
      const fun = measure(candidate);
      if (fun !== null) measured.push({ candidate, factor: factors[index]!, fun });
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
  const fastest = Math.min(...input.candidates.map(c => c.durationSeconds), ...accepted.map(entry => entry.candidate.durationSeconds));
  const value = (entry: (typeof measured)[number]): number => geometryFunUtility(entry.fun, entry.candidate.durationSeconds, discovery === undefined ? fastest : (discovery.targetMinutes - discovery.toleranceMinutes) * 60);
  const pool = accepted.filter(entry => fits(entry, fastest) && geometryFunExposureAllowed(entry.fun, leader.fun, request.options.traffic === "protect-ride"));
  const best = [...pool].sort((a, b) => value(b) - value(a) || a.candidate.durationSeconds - b.candidate.durationSeconds)[0];
  const chosen = best !== undefined && (best !== leader && (value(best) > value(leader) + 1e-9 || !fits(leader, fastest))) ? best : null;
  return {
    candidate: chosen === null ? null : { ...chosen.candidate, providerMetadata: { ...chosen.candidate.providerMetadata, riderModeFactor: chosen.factor, curvaturePerKm: chosen.fun.francoPerKm, funScore: chosen.fun.funScore } },
    calls: factors.length,
    trials: measured.map(entry => ({ factor: entry.factor, unpavedShare: riderEnvelopeMetrics(entry.candidate)?.unpavedShare ?? 0, busyShare: entry.fun.busyShare, dirtKm: 0, minutes: entry.candidate.durationSeconds / 60, curvaturePerKm: entry.fun.francoPerKm })),
  };
}
