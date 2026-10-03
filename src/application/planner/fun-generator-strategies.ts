/**
 * The four fun-route generator strategies, each adapting one research primitive
 * to the {@link FunCandidateGenerator} contract:
 *
 * - `corridor-probe` (#33): route origin → one curated corridor → destination;
 * - `departure-rejoin` (#41): keep the Best Ride, swap one middle section for a
 *   curated corridor that leaves and rejoins it;
 * - `missing-link` (#44): ask the engine for only the gap between two curated
 *   corridors, admit the connector on its own merits, then route A → gap → B;
 * - `prize-loop` (#42): for a timeboxed loop, a bounded beam over curated
 *   corridor "prizes" that always reserves the way home.
 *
 * Every strategy only proposes ordered shaping anchors. GraphHopper (or any
 * provider) computes the path, and the family runner verifies eligibility.
 * Forecasts come from measured source geometry and are allocation hints only.
 */

import { isUsableEvidence } from "@/domain/evidence/types";
import { analyzeBends } from "@/domain/geometry/bends";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteEvidence } from "@/domain/route/types";
import { backroadShare } from "@/application/roads/engine-road-evidence";
import { indexRoute, lineOverlap } from "@/application/roads/route-overlap";
import { searchCorridorPrizeLoops, type CorridorPrize } from "./corridor-prize-loop";
import {
  applyDepartureRejoinPlan,
  assessDepartureRejoin,
  planDepartureRejoin,
  type DepartureRejoinPlan,
} from "./departure-rejoin";
import {
  type FunCandidateGenerator,
  type FunGeneratorContext,
  type FunProbe,
  type FunRouteMeasurement,
  MAX_PROPOSALS_PER_GENERATOR,
  straightMeters,
} from "./fun-generators";
import {
  applyLibraryCorridorProbe,
  assessLibraryCorridorAdherence,
  libraryCorridorLengthMeters,
  libraryCorridorProbeIncompatibility,
  selectLibraryCorridorProbes,
  type LibraryCorridorSource,
} from "./library-corridor-probes";
import { assessMissingLinkConnector, buildMissingLinkRoute, planMissingLink, type MissingLinkPlan } from "./missing-link";
import type { ProviderRouteRequest } from "./route-provider";

/** Bend share at which the canonical curvature unit saturates (Old Mine Road ≈ 19%). */
const FULLY_BENDY_SHARE = 0.2;
/** Allocation-only travel-speed proxy when no production route was measured (≈ 34 mph). */
const DEFAULT_PROXY_METERS_PER_SECOND = 15;

/**
 * The speed proxy for this ride: the Best Ride's own engine distance over
 * duration, bounded to plausible riding speeds. The fixed 15 m/s guess planned
 * a 120-minute Green Lane loop that the engine rode in 87 minutes (live,
 * 2026-10-03), so the proxy follows what the engine measured for this area.
 */
export function proxyMetersPerSecond(context: FunGeneratorContext): number {
  const best = context.production[0]?.measurement;
  if (best === undefined || !(best.durationSeconds > 0) || !(best.distanceMeters > 0)) return DEFAULT_PROXY_METERS_PER_SECOND;
  return Math.max(8, Math.min(25, best.distanceMeters / best.durationSeconds));
}
/** Straight-line → road distance proxy for connectors. */
const CONNECTOR_STRETCH = 1.35;
/** A corridor the route rode less than this share of did not do its job. */
const MIN_CORRIDOR_ADHERENCE = 0.5;
/** A missing-link connector longer than this over its straight gap is a dogleg. */
const MAX_CONNECTOR_STRETCH = 2.0;
/** A connector mostly on arterials is not a backroad link worth riding. */
const MIN_CONNECTOR_BACKROAD_SHARE = 0.5;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lineMeters(line: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 1; index < line.length; index += 1) total += straightMeters(line[index - 1]!, line[index]!);
  return total;
}

/** Curvature unit of a source line from its own geometry; null when unmeasurable. */
export function sourceCurvatureUnit(line: readonly Coordinate[]): number | null {
  const meters = lineMeters(line);
  if (!(meters > 0)) return null;
  return clamp01(analyzeBends(line).bendMeters / meters / FULLY_BENDY_SHARE);
}

function bestRideUnit(context: FunGeneratorContext): number | null {
  return context.production[0]?.measurement.curvatureUnit ?? null;
}

/** Length-weighted blend of a corridor's own unit and the Best Ride's measured unit. */
function blendedUnit(
  corridorUnit: number | null,
  corridorMeters: number,
  restUnit: number | null,
  restMeters: number,
): number | null {
  if (corridorUnit === null || restUnit === null) return null;
  const total = corridorMeters + restMeters;
  return total > 0 ? clamp01((corridorUnit * corridorMeters + restUnit * restMeters) / total) : null;
}

/** Ridden and total metres of `corridors` along `route` (35 m tolerance, as #33). */
function corridorAdherence(route: readonly Coordinate[], corridors: readonly (readonly Coordinate[])[]): number | null {
  if (route.length < 2) return null;
  const index = indexRoute(route);
  let ridden = 0;
  let total = 0;
  for (const line of corridors) {
    if (line.length < 2) continue;
    const overlap = lineOverlap(index, line, 35);
    ridden += overlap.riddenMeters;
    total += overlap.lineMeters;
  }
  return total > 0 ? clamp01(ridden / total) : null;
}

function singlePath(request: ProviderRouteRequest): ProviderRouteRequest {
  return { ...request, options: { ...request.options, includeAlternatives: false } };
}

/**
 * Reads the measured facts the family compares from a canonically verified
 * route. The keys are the ones engine road evidence writes (`curvature`,
 * `roadClassMix`); anything missing or malformed stays `null`.
 */
export function funRouteMeasurement(route: {
  readonly fingerprint: string;
  readonly durationSeconds: number;
  readonly distanceMeters: number;
  readonly evidence: RouteEvidence;
}): FunRouteMeasurement {
  let bendShare: number | null = null;
  let curvatureUnit: number | null = null;
  let longestBendRunMeters: number | null = null;
  const curvature = route.evidence["curvature"];
  if (curvature !== undefined && isUsableEvidence(curvature) && typeof curvature.value === "object" && curvature.value !== null) {
    const value = curvature.value as Record<string, unknown>;
    const curvy = value["curvyMeters"];
    const total = value["totalMeters"];
    const unit = value["unit"];
    const longest = value["longestRunMeters"];
    if (typeof curvy === "number" && typeof total === "number" && Number.isFinite(curvy) && total > 0) {
      bendShare = clamp01(curvy / total);
    }
    if (typeof unit === "number" && Number.isFinite(unit)) curvatureUnit = clamp01(unit);
    if (typeof longest === "number" && Number.isFinite(longest) && longest >= 0) longestBendRunMeters = longest;
  }
  let backroadShare: number | null = null;
  const roadClass = route.evidence["roadClassMix"];
  if (roadClass !== undefined && isUsableEvidence(roadClass) && typeof roadClass.value === "number" && Number.isFinite(roadClass.value)) {
    backroadShare = clamp01(roadClass.value);
  }
  return {
    fingerprint: route.fingerprint,
    durationSeconds: route.durationSeconds,
    distanceMeters: route.distanceMeters,
    bendShare,
    curvatureUnit,
    backroadShare,
    longestBendRunMeters,
  };
}

// ---------------------------------------------------------------------------
// corridor-probe (#33)

export const corridorProbeGenerator: FunCandidateGenerator = {
  id: "corridor-probe",
  propose(context) {
    if (libraryCorridorProbeIncompatibility(context.request) !== null) return [];
    const probes = selectLibraryCorridorProbes(context.request, context.sources, {
      maxProbes: MAX_PROPOSALS_PER_GENERATOR,
      maxPerSource: 1,
    });
    const rest = bestRideUnit(context);
    const speed = proxyMetersPerSecond(context);
    return probes.flatMap((probe): FunProbe[] => {
      const request = applyLibraryCorridorProbe(context.request, probe);
      if (request === null) return [];
      return [{
        id: `corridor-probe:${probe.id}`,
        generator: "corridor-probe",
        maxProviderCalls: 1,
        sourceIds: [probe.sourceId],
        forecast: {
          curvatureUnit: blendedUnit(sourceCurvatureUnit(probe.corridor), probe.corridorMeters, rest, probe.connectorMeters * CONNECTOR_STRETCH),
          addedSeconds: (probe.detourProxyMeters * CONNECTOR_STRETCH) / speed,
        },
        async execute(call) {
          const candidate = await call(singlePath(request));
          if (candidate === null) return { candidate: null, adherence: null, note: "no-path" };
          const adherence = assessLibraryCorridorAdherence(candidate.geometry, probe)?.share ?? null;
          return { candidate, adherence, note: adherence !== null && adherence < MIN_CORRIDOR_ADHERENCE ? "low-adherence" : "ok" };
        },
      }];
    });
  },
};

// ---------------------------------------------------------------------------
// departure-rejoin (#41)

export const departureRejoinGenerator: FunCandidateGenerator = {
  id: "departure-rejoin",
  propose(context) {
    const baseline = context.production[0];
    if (baseline === undefined || libraryCorridorProbeIncompatibility(context.request) !== null) return [];
    const rest = baseline.measurement.curvatureUnit;
    const plans: { source: LibraryCorridorSource; plan: DepartureRejoinPlan }[] = [];
    for (const source of context.sources) {
      const plan = planDepartureRejoin(baseline.geometry, source.geometry);
      if (plan !== null) plans.push({ source, plan });
    }
    plans.sort((left, right) =>
      (right.source.priority ?? 0.5) - (left.source.priority ?? 0.5) ||
      left.plan.extraProxyMeters - right.plan.extraProxyMeters ||
      left.source.id.localeCompare(right.source.id),
    );
    const seenGroups = new Set<string>();
    const picked = plans.filter(({ source }) => {
      const group = source.id.split("#")[0] ?? source.id;
      if (seenGroups.has(group)) return false;
      seenGroups.add(group);
      return true;
    }).slice(0, MAX_PROPOSALS_PER_GENERATOR);
    const baselineMeters = baseline.measurement.distanceMeters;
    const speed = proxyMetersPerSecond(context);
    return picked.flatMap(({ source, plan }): FunProbe[] => {
      const request = applyDepartureRejoinPlan(context.request, plan);
      if (request === null) return [];
      return [{
        id: `departure-rejoin:${source.id}:${plan.direction}`,
        generator: "departure-rejoin",
        maxProviderCalls: 1,
        sourceIds: [source.id],
        forecast: {
          curvatureUnit: blendedUnit(
            sourceCurvatureUnit(plan.corridor),
            plan.corridorMeters,
            rest,
            Math.max(0, baselineMeters - plan.replacedBaselineMeters) + (plan.entryConnectorMeters + plan.exitConnectorMeters) * CONNECTOR_STRETCH,
          ),
          addedSeconds: (plan.extraProxyMeters * CONNECTOR_STRETCH) / speed,
        },
        async execute(call) {
          const candidate = await call(singlePath(request));
          if (candidate === null) return { candidate: null, adherence: null, note: "no-path" };
          const assessment = assessDepartureRejoin(candidate.geometry, baseline.geometry, plan);
          const adherence = assessment?.corridorAdherenceShare ?? null;
          return { candidate, adherence, note: adherence !== null && adherence < MIN_CORRIDOR_ADHERENCE ? "low-adherence" : "ok" };
        },
      }];
    });
  },
};

// ---------------------------------------------------------------------------
// missing-link (#44)

/** Sources considered for pairing; pairs grow quadratically. */
const MISSING_LINK_SOURCE_LIMIT = 6;

export const missingLinkGenerator: FunCandidateGenerator = {
  id: "missing-link",
  propose(context) {
    if (libraryCorridorProbeIncompatibility(context.request) !== null) return [];
    const sources = context.sources.slice(0, MISSING_LINK_SOURCE_LIMIT);
    const plans: { plan: MissingLinkPlan; first: LibraryCorridorSource; second: LibraryCorridorSource }[] = [];
    for (let i = 0; i < sources.length; i += 1) {
      for (let j = i + 1; j < sources.length; j += 1) {
        const first = sources[i]!;
        const second = sources[j]!;
        // Two windows of one library ride are already connected by that ride.
        if ((first.id.split("#")[0] ?? first.id) === (second.id.split("#")[0] ?? second.id)) continue;
        const plan = planMissingLink(context.request, first, second);
        if (plan !== null) plans.push({ plan, first, second });
      }
    }
    plans.sort((left, right) =>
      left.plan.structuralConnectorMeters - right.plan.structuralConnectorMeters ||
      left.plan.gapDirectMeters - right.plan.gapDirectMeters ||
      `${left.first.id}>${left.second.id}`.localeCompare(`${right.first.id}>${right.second.id}`),
    );
    const direct = straightMeters(context.request.origin, context.request.destination);
    const rest = bestRideUnit(context);
    const speed = proxyMetersPerSecond(context);
    return plans.slice(0, MAX_PROPOSALS_PER_GENERATOR).map(({ plan }): FunProbe => {
      const firstMeters = libraryCorridorLengthMeters(plan.firstCorridor) ?? 0;
      const secondMeters = libraryCorridorLengthMeters(plan.secondCorridor) ?? 0;
      const firstUnit = sourceCurvatureUnit(plan.firstCorridor);
      const secondUnit = sourceCurvatureUnit(plan.secondCorridor);
      const corridorUnit = firstUnit === null || secondUnit === null || firstMeters + secondMeters <= 0
        ? null
        : (firstUnit * firstMeters + secondUnit * secondMeters) / (firstMeters + secondMeters);
      const structural = plan.structuralConnectorMeters * CONNECTOR_STRETCH;
      return {
        id: `missing-link:${plan.firstSourceId}:${plan.firstDirection}>${plan.secondSourceId}:${plan.secondDirection}`,
        generator: "missing-link",
        maxProviderCalls: 2,
        sourceIds: [plan.firstSourceId, plan.secondSourceId],
        forecast: {
          curvatureUnit: blendedUnit(corridorUnit, firstMeters + secondMeters, rest, structural),
          addedSeconds: Math.max(0, structural + firstMeters + secondMeters - direct * CONNECTOR_STRETCH) / speed,
        },
        async execute(call) {
          const connector = await call(plan.connectorRequest);
          if (connector === null) return { candidate: null, adherence: null, note: "connector-no-path" };
          const fit = assessMissingLinkConnector(plan, connector.geometry);
          if (fit === null || !fit.endpointFit) return { candidate: null, adherence: null, note: "connector-endpoint-misfit" };
          if (fit.stretchOverDirect === null || fit.stretchOverDirect > MAX_CONNECTOR_STRETCH) {
            return { candidate: null, adherence: null, note: "connector-dogleg" };
          }
          // The connector earns inclusion on its own measured roads; unknown is not a pass.
          const backroad = connector.roadSummary === undefined ? null : backroadShare(connector.roadSummary);
          if (backroad === null) return { candidate: null, adherence: null, note: "connector-unmeasured" };
          if (backroad < MIN_CONNECTOR_BACKROAD_SHARE) return { candidate: null, adherence: null, note: "connector-arterial" };
          const request = buildMissingLinkRoute(context.request, plan, connector.geometry);
          if (request === null) return { candidate: null, adherence: null, note: "compose-failed" };
          const candidate = await call(request);
          if (candidate === null) return { candidate: null, adherence: null, note: "no-path" };
          const adherence = corridorAdherence(candidate.geometry, [plan.firstCorridor, plan.secondCorridor]);
          return { candidate, adherence, note: adherence !== null && adherence < MIN_CORRIDOR_ADHERENCE ? "low-adherence" : "ok" };
        },
      };
    });
  },
};

// ---------------------------------------------------------------------------
// prize-loop (#42)

/** Corridor prizes the beam may consider; it is quadratic-ish per depth. */
const PRIZE_LIMIT = 16;

export const prizeLoopGenerator: FunCandidateGenerator = {
  id: "prize-loop",
  propose(context) {
    const request = context.request;
    const discovery = request.discovery;
    if (discovery === undefined) return [];
    if (request.stops.length > 0 || request.shaping.length > 0 || request.sketch !== undefined || (request.roadSpans?.length ?? 0) > 0) {
      return [];
    }
    const speed = proxyMetersPerSecond(context);
    const prizes: CorridorPrize[] = [];
    const byId = new Map<string, LibraryCorridorSource>();
    for (const source of context.sources.slice(0, PRIZE_LIMIT)) {
      const meters = libraryCorridorLengthMeters(source.geometry);
      const unit = sourceCurvatureUnit(source.geometry);
      if (meters === null || unit === null) continue;
      byId.set(source.id, source);
      prizes.push({
        id: source.id,
        entry: source.geometry[0]!,
        exit: source.geometry.at(-1)!,
        traversalSeconds: meters / speed,
        // Utility density is the corridor's own measured bend unit, never a route score.
        utility: unit,
        groupId: source.id.split("#")[0] ?? source.id,
      });
    }
    const found = searchCorridorPrizeLoops({
      origin: request.origin,
      budgetSeconds: (discovery.targetMinutes + discovery.toleranceMinutes) * 60,
      prizes,
      estimateConnectorSeconds: (from, to) => (straightMeters(from, to) * CONNECTOR_STRETCH) / speed,
      // Suburban origins must ride out to the good roads, so a loop may spend up
      // to 60% of its time connecting (the beam's default 45% found nothing
      // around Hatboro, where the nearest library corridor is ~17 km out).
      options: { maxResults: MAX_PROPOSALS_PER_GENERATOR, minimumPrizeUtility: 0.2, maxConnectorShare: 0.6 },
    });
    // The beam maximizes collected value under the upper bound; a loop that
    // cannot reach the lower bound of the rider's time window is not offered
    // unless nothing else is (then the longest one is still worth measuring).
    const minimumSeconds = (discovery.targetMinutes - discovery.toleranceMinutes) * 60;
    const fitting = found.filter((sequence) => sequence.estimatedSeconds >= minimumSeconds);
    const longest = [...found].sort((left, right) => right.estimatedSeconds - left.estimatedSeconds)[0];
    const sequences = fitting.length > 0 ? fitting : longest === undefined ? [] : [longest];
    return sequences.map((sequence): FunProbe => {
      const corridors = sequence.prizeIds.flatMap((id) => {
        const source = byId.get(id);
        return source === undefined ? [] : [source.geometry];
      });
      // Entry and exit of every prize, plus each prize's midpoint so the engine
      // rides the corridor rather than cutting across it.
      const shaping: Coordinate[] = corridors.flatMap((line) => [line[0]!, line[Math.floor(line.length / 2)]!, line.at(-1)!]);
      const loopRequest: ProviderRouteRequest = {
        ...request,
        destination: request.origin,
        shaping,
        options: { ...request.options, includeAlternatives: false },
      };
      delete (loopRequest as { discovery?: unknown }).discovery;
      return {
        id: `prize-loop:${sequence.prizeIds.join("+")}`,
        generator: "prize-loop",
        maxProviderCalls: 1,
        sourceIds: sequence.prizeIds,
        forecast: {
          curvatureUnit: sequence.estimatedSeconds > 0 ? clamp01(sequence.collectedValueSeconds / sequence.estimatedSeconds) : null,
          addedSeconds: Math.abs(sequence.estimatedSeconds - discovery.targetMinutes * 60),
        },
        async execute(call) {
          const candidate = await call(loopRequest);
          if (candidate === null) return { candidate: null, adherence: null, note: "no-path" };
          const adherence = corridorAdherence(candidate.geometry, corridors);
          return { candidate, adherence, note: adherence !== null && adherence < MIN_CORRIDOR_ADHERENCE ? "low-adherence" : "ok" };
        },
      };
    });
  },
};

/**
 * The production family. `missing-link` is deliberately absent: it needs two
 * calls before it can show anything, so at the equal budget the balanced lane
 * frees (one call) it never ran, and with extra budget it found one route in
 * six live cases, barely curvier than a one-call corridor probe on the same
 * trip (2026-10-03 lane report). It stays exported for corpus experiments.
 */
export const FUN_GENERATORS: readonly FunCandidateGenerator[] = [
  corridorProbeGenerator,
  departureRejoinGenerator,
  prizeLoopGenerator,
];

/** Every strategy, including the ones the production family leaves out. */
export const ALL_FUN_GENERATORS: readonly FunCandidateGenerator[] = [
  corridorProbeGenerator,
  departureRejoinGenerator,
  missingLinkGenerator,
  prizeLoopGenerator,
];
