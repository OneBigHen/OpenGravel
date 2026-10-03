/**
 * The fun-route candidate generator family (routing research Phase 7).
 *
 * The production lanes ask the engine the same question with different
 * profiles. The generators ask *different questions*: "ride this rider-curated
 * corridor on the way" (#33), "keep the good route but swap its weak middle for
 * a curated corridor" (#41), "join two curated corridors through a gap the
 * engine finds" (#44), and "collect worthwhile corridors on a timeboxed loop"
 * (#42). Each strategy is a {@link FunCandidateGenerator}; one runner owns
 * everything they must share:
 *
 * - **one budget**: a hard cap on provider calls and a wall-clock deadline for
 *   the whole family, so two strategies are only ever compared at equal cost;
 * - **one allocation policy**: fixed round-robin, or the adaptive marginal-regret
 *   allocator of #53 that spends the next call where a missing curvy tradeoff is
 *   most likely to be found;
 * - **one verification gate**: every routed answer goes through the caller's
 *   canonical hard eligibility (legality, access, closures, avoid areas, spans)
 *   before it can count; a generator never decides eligibility;
 * - **one dedup**: an eligible answer that overlaps a production route or an
 *   earlier generated route as much as the diversity policy's duplicate
 *   threshold is reported as a duplicate, not a new option;
 * - **provenance**: every pooled route says which generator and probe made it.
 *
 * Nothing here scores a route for the rider or changes the production winner.
 * The pool is the hand-off to whoever judges fun (the canonical scorer, the Jev
 * judge lane, or a rider-blinded comparison).
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { routeSimilarity } from "@/domain/route/diversity";
import { selectNextFrontierProbe } from "./frontier-probe-allocation";
import type { FrontierCandidate, FrontierPreferenceProfile } from "./frontier-routing";
import { FRONTIER_QUALITY_KEYS } from "./frontier-routing";
import type { LibraryCorridorSource } from "./library-corridor-probes";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "./route-provider";

export const FUN_GENERATOR_IDS = ["corridor-probe", "departure-rejoin", "missing-link", "prize-loop"] as const;
export type FunGeneratorId = (typeof FUN_GENERATOR_IDS)[number];

export type FunGeneratorAllocation = "fixed" | "adaptive";

/** Hard caps for one family run. */
export interface FunGeneratorBudget {
  /** Provider calls the whole family may spend (each HTTP request counts once). */
  readonly maxProviderCalls: number;
  /** Wall-clock budget for the whole family, in milliseconds. */
  readonly deadlineMs: number;
}

/** Upper bounds the runner enforces whatever the caller asks for. */
export const MAX_FUN_GENERATOR_CALLS = 8;
export const MAX_FUN_GENERATOR_DEADLINE_MS = 30_000;
/** Proposals any one generator may put forward per run. */
export const MAX_PROPOSALS_PER_GENERATOR = 4;

/**
 * The measured facts the family compares, read from a route that already passed
 * canonical eligibility. Unknown stays `null`; nothing here is a forecast.
 */
export interface FunRouteMeasurement {
  readonly fingerprint: string;
  readonly durationSeconds: number;
  readonly distanceMeters: number;
  /** Line-measured bend metres over total metres, 0..1. */
  readonly bendShare: number | null;
  /** The canonical curvature unit (bend share scaled to "fully curvy"), 0..1. */
  readonly curvatureUnit: number | null;
  /** Metres off motorways/trunks/primaries over measured metres, 0..1. */
  readonly backroadShare: number | null;
  /** Longest uninterrupted bend run, in metres. */
  readonly longestBendRunMeters: number | null;
}

/** An eligible production route the generators are measured against. */
export interface ProductionRoute {
  readonly id: string;
  readonly geometry: readonly Coordinate[];
  readonly measurement: FunRouteMeasurement;
}

/** Everything a generator may read when it proposes probes. Pure data. */
export interface FunGeneratorContext {
  readonly request: ProviderRouteRequest;
  /** Eligible production routes, Best Ride first. May be empty. */
  readonly production: readonly ProductionRoute[];
  /** Caller-approved corridor library windows near this ride. */
  readonly sources: readonly LibraryCorridorSource[];
}

/**
 * A search-allocation guess, derived only from measured source geometry and the
 * measured production routes. It is never route evidence and never reported as
 * a property of a returned route.
 */
export interface FunProbeForecast {
  readonly curvatureUnit: number | null;
  readonly addedSeconds: number | null;
}

/** One budgeted provider call; resolves with the engine's first path or null. */
export type FunProviderCall = (request: ProviderRouteRequest) => Promise<ProviderCandidate | null>;

/** What one executed probe produced before verification. */
export interface FunProbeExecution {
  readonly candidate: ProviderCandidate | null;
  /** Share of the intended corridor(s) the route actually rode, when measurable. */
  readonly adherence: number | null;
  /** Machine token describing why there is no candidate, or "ok". */
  readonly note: string;
}

export interface FunProbe {
  /** Unique within one run; `${generator}:${key}`. */
  readonly id: string;
  readonly generator: FunGeneratorId;
  /** Calls the probe may spend; the runner reserves all of them up front. */
  readonly maxProviderCalls: number;
  readonly sourceIds: readonly string[];
  readonly forecast: FunProbeForecast;
  readonly execute: (call: FunProviderCall) => Promise<FunProbeExecution>;
}

export interface FunCandidateGenerator {
  readonly id: FunGeneratorId;
  /** Ordered, best first. Pure: no provider calls happen here. */
  propose(context: FunGeneratorContext): readonly FunProbe[];
}

/** The caller's canonical hard-eligibility gate for one routed answer. */
export type FunCandidateVerdict =
  | { readonly eligible: true; readonly measurement: FunRouteMeasurement }
  | { readonly eligible: false; readonly codes: readonly string[] };
export type FunCandidateVerifier = (candidate: ProviderCandidate) => Promise<FunCandidateVerdict>;

export type FunProbeStatus =
  | "new"
  | "duplicate"
  | "ineligible"
  | "no-route"
  | "failed"
  | "skipped-budget"
  | "skipped-deadline";

export interface FunProbeReport {
  readonly probeId: string;
  readonly generator: FunGeneratorId;
  readonly sourceIds: readonly string[];
  readonly status: FunProbeStatus;
  readonly providerCalls: number;
  readonly elapsedMs: number;
  readonly note: string;
  readonly adherence: number | null;
  readonly ineligibleCodes?: readonly string[];
  /** Production route id or earlier probe id this answer duplicates. */
  readonly duplicateOf?: string;
  readonly overlap?: number;
  readonly measurement?: FunRouteMeasurement;
}

/** An eligible, non-duplicate generated route, with provenance. */
export interface GeneratedFunCandidate {
  readonly probeId: string;
  readonly generator: FunGeneratorId;
  readonly sourceIds: readonly string[];
  readonly adherence: number | null;
  readonly candidate: ProviderCandidate;
  readonly measurement: FunRouteMeasurement;
}

export interface FunGeneratorReport {
  readonly allocation: FunGeneratorAllocation;
  readonly budget: FunGeneratorBudget;
  readonly providerCallsUsed: number;
  readonly elapsedMs: number;
  readonly proposals: Readonly<Partial<Record<FunGeneratorId, number>>>;
  readonly probes: readonly FunProbeReport[];
  /** What a judge (canonical scorer, Jev, blinded rider test) gets to rank. */
  readonly pool: readonly GeneratedFunCandidate[];
}

/**
 * The seam for the sibling Jev fun-judge lane: rank a pool of already-eligible
 * generated routes against production. A judge orders; it never makes a route
 * eligible and never edits geometry.
 */
export interface FunPoolJudge {
  rank(
    pool: readonly GeneratedFunCandidate[],
    production: readonly ProductionRoute[],
    signal: AbortSignal,
  ): Promise<readonly string[] | null>;
}

export interface RunFunGeneratorsInput {
  readonly context: FunGeneratorContext;
  readonly generators: readonly FunCandidateGenerator[];
  readonly provider: RouteCandidateProvider;
  readonly budget: FunGeneratorBudget;
  readonly allocation: FunGeneratorAllocation;
  readonly verify: FunCandidateVerifier;
  readonly signal: AbortSignal;
  /** Overlap at or above which a route is the same option (policy: 0.85). */
  readonly duplicateSimilarityThreshold: number;
  readonly now?: () => number;
}

class BudgetExhausted extends Error {
  constructor() {
    super("fun-generator-budget-exhausted");
  }
}

function clampBudget(budget: FunGeneratorBudget): FunGeneratorBudget {
  const calls = Number.isSafeInteger(budget.maxProviderCalls) ? budget.maxProviderCalls : 0;
  const deadline = Number.isFinite(budget.deadlineMs) ? budget.deadlineMs : 0;
  return {
    maxProviderCalls: Math.max(0, Math.min(MAX_FUN_GENERATOR_CALLS, calls)),
    deadlineMs: Math.max(0, Math.min(MAX_FUN_GENERATOR_DEADLINE_MS, deadline)),
  };
}

/** Round-robin across generators, each in its own best-first order. */
function fixedOrder(proposals: readonly FunProbe[]): FunProbe[] {
  const queues = new Map<FunGeneratorId, FunProbe[]>();
  for (const probe of proposals) {
    const queue = queues.get(probe.generator) ?? [];
    queue.push(probe);
    queues.set(probe.generator, queue);
  }
  const ordered: FunProbe[] = [];
  for (let round = 0; ordered.length < proposals.length; round += 1) {
    for (const id of FUN_GENERATOR_IDS) {
      const probe = queues.get(id)?.[round];
      if (probe !== undefined) ordered.push(probe);
    }
  }
  return ordered;
}

/**
 * Preference profiles for the adaptive allocator: small variations of "time vs
 * curves". They allocate calls only; they never rank rider-visible routes.
 */
const ALLOCATION_PROFILES: readonly FrontierPreferenceProfile[] = [
  { id: "balanced", weights: { timeEfficiency: 1, curvature: 1 } },
  { id: "curvy", weights: { timeEfficiency: 1, curvature: 3 } },
  { id: "very-curvy", weights: { timeEfficiency: 1, curvature: 6 } },
];

/**
 * The chance a probe returns a distinct eligible route. An explicit allocation
 * prior, not data: it only scales forecasts equally across probes, so the
 * allocator's ranking is driven by the forecast tradeoff and the call cost.
 */
const ALLOCATION_SUCCESS_PRIOR = 0.5;

function emptyQuality(): Record<(typeof FRONTIER_QUALITY_KEYS)[number], number | null> {
  return Object.fromEntries(FRONTIER_QUALITY_KEYS.map((key) => [key, null])) as Record<
    (typeof FRONTIER_QUALITY_KEYS)[number],
    number | null
  >;
}

function frontierRoute(id: string, measurement: { curvatureUnit: number | null; durationSeconds: number }, fastestSeconds: number): FrontierCandidate {
  return {
    id,
    quality: {
      ...emptyQuality(),
      timeEfficiency: Math.min(1, fastestSeconds / measurement.durationSeconds),
      curvature: measurement.curvatureUnit,
    },
  };
}

/**
 * The #53 marginal-regret allocator over the probes still affordable. Falls
 * back to the fixed order when the evidence is not comparable (for example no
 * measured production route), so an unknown never silently looks like a win.
 */
function adaptivePick(
  remaining: readonly FunProbe[],
  measured: readonly { readonly id: string; readonly measurement: FunRouteMeasurement }[],
  callsUsed: number,
  maxCalls: number,
): FunProbe | null {
  const known = measured.filter((route) => route.measurement.curvatureUnit !== null && route.measurement.durationSeconds > 0);
  if (known.length === 0) return null;
  const fastest = Math.min(...known.map((route) => route.measurement.durationSeconds));
  // The allocator accepts at most six measured routes: keep the fastest and the
  // curviest ones, which are the ends of the tradeoff it reasons about.
  const bounded = [...known]
    .sort((left, right) => (right.measurement.curvatureUnit ?? 0) - (left.measurement.curvatureUnit ?? 0))
    .slice(0, 5);
  const fastestRoute = known.find((route) => route.measurement.durationSeconds === fastest);
  if (fastestRoute !== undefined && !bounded.includes(fastestRoute)) bounded.push(fastestRoute);
  const candidates = bounded.map((route) => frontierRoute(`route:${route.id}`, route.measurement, fastest));
  const forecastable = remaining
    .filter((probe) => probe.forecast.curvatureUnit !== null && probe.forecast.addedSeconds !== null)
    .slice(0, 8);
  if (forecastable.length === 0) return null;
  const forecasts = forecastable.map((probe) => ({
    id: probe.id,
    maximumProviderAttempts: Math.max(1, probe.maxProviderCalls),
    outcomes: [{
      probability: ALLOCATION_SUCCESS_PRIOR,
      candidate: frontierRoute(`forecast:${probe.id}`, {
        curvatureUnit: probe.forecast.curvatureUnit,
        durationSeconds: fastest + Math.max(0, probe.forecast.addedSeconds ?? 0),
      }, fastest),
    }],
  }));
  const allocation = selectNextFrontierProbe({
    candidates,
    profiles: ALLOCATION_PROFILES,
    forecasts,
    maxResults: 3,
    budget: {
      maximumProviderAttempts: maxCalls,
      providerAttemptsUsed: callsUsed,
      // Attempted probes have left `remaining`, so none of them is forecast again.
      attemptedProbeIds: [],
    },
  });
  if (allocation.status !== "selected") return null;
  return remaining.find((probe) => probe.id === allocation.probeId) ?? null;
}

function deadlineSignal(parent: AbortSignal, ms: number): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("fun-generator-deadline")), Math.max(0, ms));
  const onAbort = (): void => controller.abort(parent.reason);
  if (parent.aborted) controller.abort(parent.reason);
  else parent.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * Runs the family once. Never throws for a provider or generator failure; only
 * a caller abort rejects. Every probe that was proposed is reported, including
 * the ones the budget or deadline never let run.
 */
export async function runFunGenerators(input: RunFunGeneratorsInput): Promise<FunGeneratorReport> {
  if (input.signal.aborted) throw input.signal.reason;
  const now = input.now ?? (() => Date.now());
  const budget = clampBudget(input.budget);
  const started = now();
  const run = deadlineSignal(input.signal, budget.deadlineMs);

  const proposals: FunProbe[] = [];
  const proposalCounts: Partial<Record<FunGeneratorId, number>> = {};
  const seenIds = new Set<string>();
  for (const generator of input.generators) {
    let proposed: readonly FunProbe[] = [];
    try {
      proposed = generator.propose(input.context);
    } catch {
      proposed = [];
    }
    const accepted = proposed
      .filter((probe) => probe.generator === generator.id && !seenIds.has(probe.id))
      .slice(0, MAX_PROPOSALS_PER_GENERATOR);
    for (const probe of accepted) seenIds.add(probe.id);
    proposalCounts[generator.id] = accepted.length;
    proposals.push(...accepted);
  }

  let callsUsed = 0;
  const reports: FunProbeReport[] = [];
  const pool: GeneratedFunCandidate[] = [];
  const measured: { id: string; measurement: FunRouteMeasurement }[] = input.context.production.map((route) => ({
    id: route.id,
    measurement: route.measurement,
  }));
  const compareAgainst: { id: string; geometry: readonly Coordinate[] }[] = input.context.production.map((route) => ({
    id: route.id,
    geometry: route.geometry,
  }));

  let remaining = fixedOrder(proposals);

  try {
    while (remaining.length > 0) {
      if (input.signal.aborted) throw input.signal.reason;
      const left = budget.maxProviderCalls - callsUsed;
      const affordable = remaining.filter((probe) => probe.maxProviderCalls <= left);
      if (affordable.length === 0 || run.signal.aborted) break;
      const pick =
        (input.allocation === "adaptive"
          ? adaptivePick(affordable, measured, callsUsed, budget.maxProviderCalls)
          : null) ?? affordable[0]!;
      remaining = remaining.filter((probe) => probe !== pick);

      let probeCalls = 0;
      let reserved = pick.maxProviderCalls;
      const call: FunProviderCall = async (request) => {
        if (reserved <= 0 || callsUsed >= budget.maxProviderCalls) throw new BudgetExhausted();
        reserved -= 1;
        callsUsed += 1;
        probeCalls += 1;
        const answer = await input.provider.candidates(
          { ...request, options: { ...request.options, includeAlternatives: false } },
          run.signal,
        );
        return answer.candidates[0] ?? null;
      };

      const probeStart = now();
      let execution: FunProbeExecution;
      try {
        execution = await pick.execute(call);
      } catch (error) {
        if (input.signal.aborted) throw input.signal.reason;
        execution = {
          candidate: null,
          adherence: null,
          note: run.signal.aborted ? "deadline" : error instanceof BudgetExhausted ? "budget" : "provider-failed",
        };
      }
      const base = {
        probeId: pick.id,
        generator: pick.generator,
        sourceIds: pick.sourceIds,
        providerCalls: probeCalls,
        adherence: execution.adherence,
        note: execution.note,
      };
      if (execution.candidate === null) {
        reports.push({
          ...base,
          status: execution.note === "provider-failed" || execution.note === "deadline" ? "failed" : "no-route",
          elapsedMs: now() - probeStart,
        });
        continue;
      }
      const verdict = await input.verify(execution.candidate);
      if (!verdict.eligible) {
        reports.push({ ...base, status: "ineligible", ineligibleCodes: verdict.codes, elapsedMs: now() - probeStart });
        continue;
      }
      let duplicate: { id: string; overlap: number } | null = null;
      for (const other of compareAgainst) {
        const similarity = routeSimilarity(
          { id: 0, geometry: execution.candidate.geometry, score: { total: 0 } },
          { id: 1, geometry: other.geometry, score: { total: 0 } },
        );
        if (similarity.mode !== "unknown" && similarity.overlap >= input.duplicateSimilarityThreshold) {
          duplicate = { id: other.id, overlap: similarity.overlap };
          break;
        }
      }
      if (duplicate !== null) {
        reports.push({
          ...base,
          status: "duplicate",
          duplicateOf: duplicate.id,
          overlap: duplicate.overlap,
          measurement: verdict.measurement,
          elapsedMs: now() - probeStart,
        });
        continue;
      }
      reports.push({ ...base, status: "new", measurement: verdict.measurement, elapsedMs: now() - probeStart });
      pool.push({
        probeId: pick.id,
        generator: pick.generator,
        sourceIds: pick.sourceIds,
        adherence: execution.adherence,
        candidate: execution.candidate,
        measurement: verdict.measurement,
      });
      measured.push({ id: pick.id, measurement: verdict.measurement });
      compareAgainst.push({ id: pick.id, geometry: execution.candidate.geometry });
    }
  } finally {
    run.dispose();
  }

  const deadlineHit = run.signal.aborted && !input.signal.aborted;
  for (const probe of remaining) {
    reports.push({
      probeId: probe.id,
      generator: probe.generator,
      sourceIds: probe.sourceIds,
      status: deadlineHit ? "skipped-deadline" : "skipped-budget",
      providerCalls: 0,
      elapsedMs: 0,
      note: deadlineHit ? "deadline" : "budget",
      adherence: null,
    });
  }

  return {
    allocation: input.allocation,
    budget,
    providerCallsUsed: callsUsed,
    elapsedMs: now() - started,
    proposals: proposalCounts,
    probes: reports,
    pool,
  };
}

/** Straight-line helper shared by the strategies' allocation proxies. */
export function straightMeters(from: Coordinate, to: Coordinate): number {
  const meters = haversine(from, to);
  return Number.isFinite(meters) && meters > 0 ? meters : 0;
}
