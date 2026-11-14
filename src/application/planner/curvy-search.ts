import type { GeometryFun } from "@/domain/geometry/heading-fun";
import { candidateGeometryFun, geometryFunExposureAllowed, geometryFunUtility } from "./geometry-fun";
import { riderEnvelopeMetrics, type RiderModeTrial } from "./rider-mode-search";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "./route-provider";

/** Curvy may stretch the trip this far over the fastest eligible ETA. */
export const CURVY_DETOUR_CAP = 1.35;

/** Two complementary alternative calls, in one parallel wave. The initial
 * lanes already supply the fastest reference; stronger busy-road searches
 * duplicated that pool while extending the tail of destination plans. */
export const CURVY_SWEEP: readonly { readonly profile?: string; readonly factor: number }[] = [
  { factor: 1 },
  { profile: "motorcycle_scenic", factor: 1 },
];

/** Below this much remaining search budget the alternative calls are skipped: they cannot finish and would only add tail latency. */
export const CURVY_MIN_SWEEP_BUDGET_MS = 1500;

interface Measured {
  readonly candidate: ProviderCandidate;
  readonly factor: number;
  readonly fun: GeometryFun;
}

function sameRoute(a: ProviderCandidate, b: ProviderCandidate): boolean {
  return a.durationSeconds === b.durationSeconds && a.distanceMeters === b.distanceMeters && a.geometry.length === b.geometry.length && a.geometry.every((p, i) => p.lat === b.geometry[i]!.lat && p.lon === b.geometry[i]!.lon);
}

/**
 * One parallel wave adds existing twisty/scenic alternatives. Geometry fun
 * values sustained sweepers and tight curves with a modest real ETA cost.
 * Both busy and residential exposure remain bounded against the incumbent.
 */
export async function searchCurvyEnvelope(input: {
  readonly request: ProviderRouteRequest;
  readonly candidates: readonly ProviderCandidate[];
  readonly incumbent?: ProviderCandidate;
  readonly provider: RouteCandidateProvider;
  readonly screen?: (candidate: ProviderCandidate) => boolean;
  readonly verify?: (candidates: readonly ProviderCandidate[], signal: AbortSignal) => Promise<readonly ProviderCandidate[]>;
  readonly sweepCalls: number;
  readonly deadlineMs: number;
  readonly signal: AbortSignal;
  /** Measured geometry facts; replace only at the search-policy test seam. */
  readonly measure?: (candidate: ProviderCandidate) => GeometryFun | null;
}): Promise<{ candidate: ProviderCandidate | null; calls: number; trials: readonly RiderModeTrial[] }> {
  if (input.signal.aborted) throw input.signal.reason;
  const measure = input.measure ?? candidateGeometryFun;
  const measureEntry = (candidate: ProviderCandidate, factor: number): Measured[] => {
    const fun = measure(candidate);
    return fun === null ? [] : [{ candidate, factor, fun }];
  };
  const measured = input.candidates.flatMap(candidate => measureEntry(candidate, 1));
  const trialsOf = (entries: readonly Measured[]): RiderModeTrial[] => entries.map(entry => ({ factor: entry.factor, unpavedShare: riderEnvelopeMetrics(entry.candidate)?.unpavedShare ?? 0, busyShare: entry.fun.busyShare, dirtKm: 0, minutes: entry.candidate.durationSeconds / 60, curvaturePerKm: entry.fun.francoPerKm }));
  const leader = measured.find(entry => entry.candidate === input.incumbent) ?? measured[0];
  if (leader === undefined || input.request.sketch !== undefined || input.request.shaping.length > 0 || input.request.stops.length > 0 || (input.request.roadSpans?.length ?? 0) > 0) return { candidate: null, calls: 0, trials: trialsOf(measured) };
  const avoidBusy = input.request.options.traffic === "protect-ride";
  const discovery = input.request.discovery;
  const pick = (pool: readonly Measured[], baseline: number): Measured | null => {
    const fits = (entry: Measured): boolean => discovery === undefined
      ? entry.candidate.durationSeconds <= baseline * CURVY_DETOUR_CAP
      : Math.abs(entry.candidate.durationSeconds / 60 - discovery.targetMinutes) <= discovery.toleranceMinutes;
    const value = (entry: Measured): number => geometryFunUtility(entry.fun, entry.candidate.durationSeconds, baseline);
    const best = pool.filter(entry => fits(entry) && geometryFunExposureAllowed(entry.fun, leader.fun, avoidBusy))
      .sort((a, b) => value(b) - value(a) || a.candidate.durationSeconds - b.candidate.durationSeconds)[0];
    return best !== undefined && best !== leader && (value(best) > value(leader) + 1e-9 || !fits(leader)) ? best : null;
  };
  const answer = (chosen: Measured | null, calls: number, all: readonly Measured[]) => ({
    candidate: chosen === null ? null : { ...chosen.candidate, providerMetadata: { ...chosen.candidate.providerMetadata, riderModeFactor: chosen.factor, curvaturePerKm: chosen.fun.francoPerKm, funScore: chosen.fun.funScore } },
    calls,
    trials: trialsOf(all),
  });
  const initialFastest = Math.min(...input.candidates.map(c => c.durationSeconds));
  if (discovery !== undefined) return answer(pick(measured, (discovery.targetMinutes - discovery.toleranceMinutes) * 60), 0, measured);
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(Math.max(1, input.deadlineMs))]);
  // Without busy-road avoidance the strengths change nothing; one twisty and one scenic call remain.
  const sweep = input.deadlineMs < CURVY_MIN_SWEEP_BUDGET_MS ? [] : CURVY_SWEEP.filter(step => avoidBusy || step.factor <= 1).slice(0, Math.max(0, input.sweepCalls));
  const settled = await Promise.allSettled(sweep.map(step => input.provider.candidates({ ...input.request, profile: step.profile ?? input.request.profile, options: { ...input.request.options, includeAlternatives: step.factor > 0, riderModeFactor: step.factor } }, signal)));
  if (input.signal.aborted) throw input.signal.reason;
  const initialCount = measured.length;
  settled.forEach((outcome, index) => {
    if (outcome.status !== "fulfilled") return;
    const step = sweep[index]!;
    for (const candidate of outcome.value.candidates) {
      if (!(input.screen?.(candidate) ?? true)) continue;
      if (!measured.some(entry => sameRoute(entry.candidate, candidate))) measured.push(...measureEntry(candidate, step.factor));
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
  const baseline = Math.min(initialFastest, ...accepted.map(entry => entry.candidate.durationSeconds));
  return answer(pick(accepted, baseline), sweep.length, measured);
}
