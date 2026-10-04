import { analyzeFrancoCurvature } from "@/domain/geometry/franco-curvature";
import { riderEnvelopeMetrics, type RiderModeTrial } from "./rider-mode-search";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "./route-provider";

/** A twistier route must gain at least this much Franco curvature per km. */
export const MIN_CURVY_GAIN = 5;
/** Extra minutes one Franco point per km is worth. */
export const CURVY_MINUTES_PER_POINT = 0.75;
/** Curvy may stretch the trip this far over the rider's own ETA. */
export const CURVY_DETOUR_CAP = 1.35;
/** Busy-road share a twistier route may add when the rider avoids busy roads. */
const BUSY_SLACK = 0.1;

/** Router calls for the Curvy sweep: busy-road strengths on the twisty profile plus scenic. */
export const CURVY_SWEEP: readonly { readonly profile?: string; readonly factor: number }[] = [
  { profile: "motorcycle_fastest", factor: 0 },
  { factor: 1 },
  { profile: "motorcycle_scenic", factor: 1 },
  { factor: 2 },
  { factor: 4 },
];

interface Measured {
  readonly candidate: ProviderCandidate;
  readonly factor: number;
  readonly perKm: number;
  readonly busyShare: number | null;
}

const francoPerKm = (candidate: ProviderCandidate): number => analyzeFrancoCurvature(candidate.geometry).curvaturePerKm;

function sameRoute(a: ProviderCandidate, b: ProviderCandidate): boolean {
  return a.durationSeconds === b.durationSeconds && a.distanceMeters === b.distanceMeters && a.geometry.length === b.geometry.length;
}

/**
 * Curvy picks by twistiness. The pipeline ranked without measuring curves, so
 * twistier lines it already held lost to blander ones (Cherry Hill -> Batsto:
 * 61 min at 35 Franco/km in the pool, 68 min at 13 picked). One parallel wave
 * adds the router's alternatives on the twisty and scenic profiles; the pick
 * trades Franco curvature per km against minutes from the pipeline's choice.
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
  /** Curvature per km; Franco by default. */
  readonly curvature?: (candidate: ProviderCandidate) => number;
}): Promise<{ candidate: ProviderCandidate | null; calls: number; trials: readonly RiderModeTrial[] }> {
  if (input.signal.aborted) throw input.signal.reason;
  const curvature = input.curvature ?? francoPerKm;
  const measure = (candidate: ProviderCandidate, factor: number): Measured => ({ candidate, factor, perKm: curvature(candidate), busyShare: riderEnvelopeMetrics(candidate)?.busyShare ?? null });
  const measured = input.candidates.map(candidate => measure(candidate, 1));
  const trialsOf = (entries: readonly Measured[]): RiderModeTrial[] => entries.map(entry => ({ factor: entry.factor, unpavedShare: riderEnvelopeMetrics(entry.candidate)?.unpavedShare ?? 0, busyShare: entry.busyShare, dirtKm: 0, minutes: entry.candidate.durationSeconds / 60, curvaturePerKm: entry.perKm }));
  const leader = measured.find(entry => entry.candidate === input.incumbent) ?? measured[0];
  if (leader === undefined || input.request.sketch !== undefined) return { candidate: null, calls: 0, trials: trialsOf(measured) };
  const avoidBusy = input.request.options.traffic === "protect-ride";
  const busyLimit = avoidBusy && leader.busyShare !== null ? leader.busyShare + BUSY_SLACK : Number.POSITIVE_INFINITY;
  const discovery = input.request.discovery;
  const pick = (pool: readonly Measured[], minutesOk: (entry: Measured) => boolean): Measured | null => {
    const value = (entry: Measured): number => entry.perKm - Math.max(0, (entry.candidate.durationSeconds - leader.candidate.durationSeconds) / 60) / CURVY_MINUTES_PER_POINT;
    const best = pool
      .filter(entry => entry.perKm - leader.perKm >= MIN_CURVY_GAIN && (entry.busyShare ?? 0) <= busyLimit && minutesOk(entry))
      .reduce<Measured | null>((top, entry) => top === null || value(entry) > value(top) ? entry : top, null);
    return best !== null && value(best) > leader.perKm ? best : null;
  };
  const answer = (chosen: Measured | null, calls: number, all: readonly Measured[]) => ({
    candidate: chosen === null ? null : { ...chosen.candidate, providerMetadata: { ...chosen.candidate.providerMetadata, riderModeFactor: chosen.factor, curvaturePerKm: chosen.perKm } },
    calls,
    trials: trialsOf(all),
  });
  if (discovery !== undefined) {
    // Loops: the rider set the time; the twistiest loop in the window leads.
    const fits = (entry: Measured): boolean => Math.abs(entry.candidate.durationSeconds / 60 - discovery.targetMinutes) <= discovery.toleranceMinutes;
    const twistiest = measured.filter(fits).filter(entry => entry.perKm - leader.perKm >= MIN_CURVY_GAIN && (entry.busyShare ?? 0) <= busyLimit).reduce<Measured | null>((top, entry) => top === null || entry.perKm > top.perKm ? entry : top, null);
    return answer(twistiest, 0, measured);
  }
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(Math.max(1, input.deadlineMs))]);
  // Without busy-road avoidance the strengths change nothing; one twisty and one scenic call remain.
  const sweep = CURVY_SWEEP.filter(step => avoidBusy || step.factor <= 1).slice(0, Math.max(0, input.sweepCalls));
  const settled = await Promise.allSettled(sweep.map(step => input.provider.candidates({ ...input.request, profile: step.profile ?? input.request.profile, options: { ...input.request.options, includeAlternatives: step.factor > 0, riderModeFactor: step.factor } }, signal)));
  if (input.signal.aborted) throw input.signal.reason;
  const initialCount = measured.length;
  let fastestSeconds = Number.POSITIVE_INFINITY;
  settled.forEach((outcome, index) => {
    if (outcome.status !== "fulfilled") return;
    const step = sweep[index]!;
    for (const candidate of outcome.value.candidates) {
      if (!(input.screen?.(candidate) ?? true)) continue;
      if (step.factor === 0) fastestSeconds = Math.min(fastestSeconds, candidate.durationSeconds);
      if (!measured.some(entry => sameRoute(entry.candidate, candidate))) measured.push(measure(candidate, step.factor));
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
  // The cap measures from the rider's own profile, never a faster engine ETA.
  const own = measured.filter(entry => entry.candidate.profile === input.request.profile);
  const ownSeconds = Math.min(...(own.length > 0 ? own : measured).map(entry => entry.candidate.durationSeconds));
  const baseline = Math.max(ownSeconds, Number.isFinite(fastestSeconds) ? fastestSeconds : 0);
  return answer(pick(accepted, entry => entry.candidate.durationSeconds <= baseline * CURVY_DETOUR_CAP), sweep.length, measured);
}
