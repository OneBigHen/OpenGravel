import type { Coordinate } from "@/domain/ride/types";
import { DIRT_SURFACES, type GoodMilesMode } from "@/domain/route/good-miles";
import { candidateGeometryFun, candidateGoodMeters, geometryFunExposureAllowed } from "./geometry-fun";
import { rideBudgetFactor } from "./ride-budget";
import type { ProviderCandidate, ProviderGraphFacts, ProviderRouteRequest, RouteCandidateProvider } from "./route-provider";

/**
 * A-to-B in one wave (RM-4): at most five single-route calls, sent together,
 * then one pick. Replaces the curvy, balanced and dirt searches with their
 * three caps; the ride budget (`ride-budget.ts`) is the only detour limit and
 * good miles (`good-miles.ts`) the only score. Hard gates stay the caller's:
 * the pick sees only candidates that passed them.
 */

/** The "strong" dirt strength: the existing dirt sweep's strength 3. */
export const STRONG_DIRT_FACTOR = 3;
/** On a graph without the curve field, "strong" curvy asks busy roads at this strength instead. */
export const STRONG_BUSY_FACTOR = 3;
/** The "gentle" dirt strength: between the rider's own 1 and strong 3. */
export const GENTLE_DIRT_FACTOR = 2;
/** The "gentle" curvy line: the scenic profile, milder than twisty. */
export const GENTLE_CURVY_PROFILE = "motorcycle_scenic";
/** At most this many detours through a known good road join the wave (RM-5 fills the one slot left). */
export const MAX_WAVE_DETOURS = 1;
/** Wave calls: fastest, the rider's profile, strong, gentle, one detour. */
export const MAX_WAVE_CALLS = 5;

/** What a pick optimises: dirt metres, bend metres, or (for Efficient) time alone. */
export type RidePickMode = GoodMilesMode | "time";

export type WaveRole = "fastest" | "own" | "strong" | "gentle" | "detour";

export interface WaveMember {
  readonly role: WaveRole;
  readonly request: ProviderRouteRequest;
  /** The rider-mode strength the request carries, for diagnostics and live traffic. */
  readonly factor: number;
}

/** Known good roads a detour may pass through (RM-5 provides the source). */
export interface DetourAnchorsPort {
  anchorsFor(input: {
    readonly origin: Coordinate;
    readonly destination: Coordinate;
    readonly mode: RidePickMode;
    readonly budgetFactor: number;
  }, signal: AbortSignal): Promise<readonly Coordinate[]>;
}

/** A gravel, dual-sport or dirt-preferred request scores dirt. */
export function seeksDirt(options: ProviderRouteRequest["options"]): boolean {
  return options.surfacePreference === "dirt-preferred" || (options.targetUnpavedShare ?? 0) > 0 || options.bike?.category === "dual-sport";
}

export function ridePickMode(options: ProviderRouteRequest["options"]): RidePickMode {
  if (seeksDirt(options)) return "dirt";
  return options.roadCharacter === "efficient" ? "time" : "curvy";
}

/** Sketches, stops, shaping points and road spans keep their own single request. */
export function waveApplies(request: ProviderRouteRequest): boolean {
  return request.discovery === undefined && request.sketch === undefined && request.shaping.length === 0 &&
    request.stops.length === 0 && (request.roadSpans?.length ?? 0) === 0;
}

/**
 * The wave's requests. `own` is byte for byte the first answer's request, so
 * a provider that shares identical requests answers it from the first answer.
 */
export function waveMembers(input: {
  readonly request: ProviderRouteRequest;
  /** The first answer's profile (the rider's own). */
  readonly ownProfile: string;
  readonly fastestProfile: string;
  readonly graph: ProviderGraphFacts | null;
  readonly anchors?: readonly Coordinate[];
  /** The profiles the provider offers; the gentle curvy line needs scenic. */
  readonly profiles?: readonly string[];
}): WaveMember[] {
  const { request } = input;
  const options = request.options;
  const mode = ridePickMode(options);
  const own: ProviderRouteRequest = { ...request, profile: input.ownProfile, options: { ...options, includeAlternatives: false } };
  const members: WaveMember[] = [
    {
      role: "fastest",
      factor: 0,
      // The reference: no rider preference at all, but every hard zero (bike
      // limits, access, sand, avoid areas) still applies.
      request: { ...request, profile: input.fastestProfile, options: { ...options, includeAlternatives: false, riderModeFactor: 0, roadCharacter: "efficient" } },
    },
    { role: "own", factor: options.riderModeFactor ?? 1, request: own },
  ];
  if (mode === "dirt") {
    members.push({ role: "strong", factor: STRONG_DIRT_FACTOR, request: { ...own, options: { ...own.options, riderModeFactor: STRONG_DIRT_FACTOR } } });
  } else if (mode === "curvy") {
    if (input.graph?.encodedValues.includes("og_curve") === true) {
      members.push({ role: "strong", factor: options.riderModeFactor ?? 1, request: { ...own, options: { ...own.options, curvePressure: "strong" } } });
    } else if (options.traffic === "protect-ride") {
      members.push({ role: "strong", factor: STRONG_BUSY_FACTOR, request: { ...own, options: { ...own.options, riderModeFactor: STRONG_BUSY_FACTOR } } });
    }
  }
  // The gentle line: a milder take on the rider's wish, so a ride whose own
  // line runs past the budget still has a middle option before the highway.
  // An extra candidate, never a replacement: the pick still takes the most
  // good miles that fit.
  if (mode === "dirt" && (options.riderModeFactor ?? 1) < GENTLE_DIRT_FACTOR) {
    members.push({ role: "gentle", factor: GENTLE_DIRT_FACTOR, request: { ...own, options: { ...own.options, riderModeFactor: GENTLE_DIRT_FACTOR } } });
  } else if (mode === "curvy" && own.profile !== GENTLE_CURVY_PROFILE && (input.profiles === undefined || input.profiles.length === 0 || input.profiles.includes(GENTLE_CURVY_PROFILE))) {
    members.push({ role: "gentle", factor: options.riderModeFactor ?? 1, request: { ...own, profile: GENTLE_CURVY_PROFILE } });
  }
  for (const anchor of (input.anchors ?? []).slice(0, MAX_WAVE_DETOURS)) {
    members.push({ role: "detour", factor: options.riderModeFactor ?? 1, request: { ...own, shaping: [anchor] } });
  }
  return members.slice(0, MAX_WAVE_CALLS);
}

export interface WaveAnswer {
  readonly member: WaveMember;
  readonly candidates: readonly ProviderCandidate[];
  readonly error: unknown;
}

/** Sends every member at once; one failed call never fails the wave. */
export async function runWave(members: readonly WaveMember[], provider: RouteCandidateProvider, signal: AbortSignal): Promise<WaveAnswer[]> {
  if (signal.aborted) throw signal.reason;
  const settled = await Promise.allSettled(members.map(member => provider.candidates(member.request, signal)));
  if (signal.aborted) throw signal.reason;
  return settled.map((outcome, index) => ({
    member: members[index]!,
    candidates: outcome.status === "fulfilled" ? outcome.value.candidates : [],
    error: outcome.status === "rejected" ? outcome.reason : null,
  }));
}

export interface WaveCandidate {
  readonly candidate: ProviderCandidate;
  readonly member: WaveMember;
}

function sameRoute(a: ProviderCandidate, b: ProviderCandidate): boolean {
  return a.durationSeconds === b.durationSeconds && a.distanceMeters === b.distanceMeters && a.geometry.length === b.geometry.length &&
    a.geometry.every((point, at) => point.lat === b.geometry[at]!.lat && point.lon === b.geometry[at]!.lon);
}

/** Every distinct line the wave returned, the first member that found it keeping it. */
export function waveCandidates(answers: readonly WaveAnswer[]): WaveCandidate[] {
  const out: WaveCandidate[] = [];
  for (const answer of answers) {
    for (const candidate of answer.candidates) {
      if (!out.some(entry => sameRoute(entry.candidate, candidate))) out.push({ candidate, member: answer.member });
    }
  }
  return out;
}

export interface RidePickEntry {
  readonly entry: WaveCandidate;
  readonly goodMeters: number;
  readonly fits: boolean;
  readonly exposureOk: boolean;
}

export interface RidePick {
  readonly chosen: WaveCandidate | null;
  /** True when nothing fitted the budget and the closest was taken. */
  readonly overBudget: boolean;
  /**
   * True when the rider gets the plain fastest line because every line with
   * more good miles ran past the budget: the rider is told, not left guessing.
   */
  readonly fellBackToFastest: boolean;
  readonly referenceSeconds: number | null;
  readonly budgetSeconds: number | null;
  readonly entries: readonly RidePickEntry[];
}

/**
 * Pick once. Among candidates that passed every hard gate and fit the budget,
 * the most good miles; ties go to the shorter time. Busy share may sit at
 * most 10 points and residential share 3 points over the fastest reference
 * (non-dirt modes, as today). If nothing fits the budget, the closest to it,
 * marked as over.
 */
export function pickRide(input: {
  /** Candidates that passed every hard gate. */
  readonly eligible: readonly WaveCandidate[];
  /**
   * The fastest call's line, whether or not it passed the gates. Absent, the
   * quickest eligible line.
   */
  readonly reference?: ProviderCandidate;
  /**
   * Every line the wave returned, gated or not. The budget is measured from
   * the quickest of these and the reference: the fastest profile weighs
   * distance heavily, so with highways avoided another line can be quicker
   * than it (Hawk Mountain 59.0 min "fastest", 53.0 min twisty).
   */
  readonly all?: readonly ProviderCandidate[];
  readonly mode: RidePickMode;
  readonly budget?: ProviderRouteRequest["options"]["rideBudget"];
  readonly protectBusy: boolean;
}): RidePick {
  const { eligible, mode } = input;
  if (eligible.length === 0) return { chosen: null, overBudget: false, fellBackToFastest: false, referenceSeconds: null, budgetSeconds: null, entries: [] };
  const reference = input.reference ?? [...eligible].sort((a, b) => a.candidate.durationSeconds - b.candidate.durationSeconds)[0]!.candidate;
  const referenceSeconds = Math.min(reference.durationSeconds, ...(input.all ?? []).map(candidate => candidate.durationSeconds), ...eligible.map(entry => entry.candidate.durationSeconds));
  const budgetSeconds = referenceSeconds * rideBudgetFactor(input.budget);
  const referenceFun = candidateGeometryFun(reference);
  const entries: RidePickEntry[] = eligible.map(entry => {
    const fun = mode === "curvy" ? candidateGeometryFun(entry.candidate) : null;
    return {
      entry,
      goodMeters: mode === "time" ? 0 : candidateGoodMeters(entry.candidate, mode),
      fits: entry.candidate.durationSeconds <= budgetSeconds + 1e-6,
      // Unmeasured exposure is never read as quiet; only the reference itself needs no proof.
      exposureOk: mode === "dirt" || entry.candidate === reference || (fun !== null && geometryFunExposureAllowed(fun, referenceFun, input.protectBusy)),
    };
  });
  const better = (a: RidePickEntry, b: RidePickEntry): number =>
    (Math.abs(b.goodMeters - a.goodMeters) >= 1 ? b.goodMeters - a.goodMeters : 0) || a.entry.candidate.durationSeconds - b.entry.candidate.durationSeconds;
  const fitting = entries.filter(entry => entry.fits && entry.exposureOk);
  // The fastest line was taken while a line with more good miles was left
  // out only for running past the budget.
  const fellBack = (chosen: WaveCandidate): boolean => mode !== "time" && chosen.member.role === "fastest" &&
    entries.some(entry => !entry.fits && entry.exposureOk && entry.entry.member.role !== "fastest" &&
      entry.goodMeters >= (entries.find(item => item.entry === chosen)?.goodMeters ?? 0) + 1);
  if (fitting.length > 0) {
    const chosen = [...fitting].sort(better)[0]!.entry;
    return { chosen, overBudget: false, fellBackToFastest: fellBack(chosen), referenceSeconds, budgetSeconds, entries };
  }
  const shortest = (pool: readonly RidePickEntry[]): WaveCandidate => [...pool].sort((a, b) => a.entry.candidate.durationSeconds - b.entry.candidate.durationSeconds)[0]!.entry;
  const inBudget = entries.filter(entry => entry.fits);
  if (inBudget.length > 0) {
    const chosen = shortest(inBudget);
    return { chosen, overBudget: false, fellBackToFastest: fellBack(chosen), referenceSeconds, budgetSeconds, entries };
  }
  return { chosen: shortest(entries), overBudget: true, fellBackToFastest: false, referenceSeconds, budgetSeconds, entries };
}

/** Loops keep their own time window; they share the scorer and the pick rule. */
export function pickLoop<T extends ProviderCandidate>(input: {
  readonly candidates: readonly T[];
  readonly incumbent?: T;
  readonly discovery: NonNullable<ProviderRouteRequest["discovery"]>;
  readonly mode: RidePickMode;
  readonly protectBusy: boolean;
}): T | null {
  const { candidates, discovery, mode } = input;
  const leader = input.incumbent ?? candidates[0];
  if (leader === undefined || mode === "time") return null;
  const leaderFun = candidateGeometryFun(leader);
  const fits = (candidate: T): boolean => Math.abs(candidate.durationSeconds / 60 - discovery.targetMinutes) <= discovery.toleranceMinutes;
  const allowed = (candidate: T): boolean => {
    if (mode === "dirt" || candidate === leader) return true;
    const fun = candidateGeometryFun(candidate);
    return fun !== null && geometryFunExposureAllowed(fun, leaderFun, input.protectBusy);
  };
  const good = (candidate: T): number => candidateGoodMeters(candidate, mode);
  const best = candidates.filter(candidate => fits(candidate) && allowed(candidate))
    .sort((a, b) => (Math.abs(good(b) - good(a)) >= 1 ? good(b) - good(a) : 0) || a.durationSeconds - b.durationSeconds)[0];
  if (best === undefined || best === leader) return null;
  return !fits(leader) || good(best) >= good(leader) + 1 ? best : null;
}

/** One line per wave candidate, for diagnostics and the scorecard's row table. */
export interface WaveTrial {
  readonly factor: number;
  readonly role: WaveRole;
  readonly unpavedShare: number;
  readonly busyShare: number | null;
  readonly minutes: number;
  readonly goodMiles: number;
  readonly eligible: boolean;
  readonly fits: boolean;
  readonly chosen: boolean;
}

/** Busy share in travelled metres (motorway, trunk, primary or city); null without road runs. */
function busyShare(candidate: ProviderCandidate): number | null {
  const runs = candidate.roadSummary?.roadRuns;
  const total = candidate.roadSummary?.totalMeters ?? 0;
  if (runs === undefined || runs.length === 0 || total <= 0) return null;
  return runs.reduce((sum, run) => sum + (["motorway", "trunk", "primary"].includes(run.roadClass.toLowerCase()) || run.urbanDensity.toLowerCase() === "city" ? run.meters : 0), 0) / total;
}

export function waveTrials(all: readonly WaveCandidate[], pick: RidePick, mode: RidePickMode): WaveTrial[] {
  return all.map(entry => {
    const picked = pick.entries.find(item => item.entry.candidate === entry.candidate);
    const summary = entry.candidate.roadSummary;
    const total = summary?.totalMeters ?? 0;
    const unpaved = summary === undefined ? 0 : Object.entries(summary.surfaceByRoadClassMeters)
      .reduce((sum, [key, meters]) => sum + (DIRT_SURFACES.has(key.split("|")[0]!.toLowerCase()) ? meters : 0), 0);
    return {
      factor: entry.member.factor,
      role: entry.member.role,
      unpavedShare: total > 0 ? unpaved / total : 0,
      busyShare: busyShare(entry.candidate),
      minutes: entry.candidate.durationSeconds / 60,
      goodMiles: (mode === "time" ? 0 : candidateGoodMeters(entry.candidate, mode)) / 1609.344,
      eligible: picked !== undefined,
      fits: picked?.fits ?? (pick.budgetSeconds !== null && entry.candidate.durationSeconds <= pick.budgetSeconds),
      chosen: pick.chosen?.candidate === entry.candidate,
    };
  });
}
