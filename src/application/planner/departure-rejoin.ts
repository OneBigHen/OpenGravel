/**
 * Departure-and-rejoin corridor replacement.
 *
 * Given one already-good baseline route and one library/curated corridor, this
 * planner finds an ordered baseline departure/rejoin pair and builds a bounded
 * shaped request through the corridor.
 *
 * P1 is deliberately conservative:
 * - point-to-point only;
 * - no authored stops/shaping/sketch/spans;
 * - no claim that the corridor is legal/open/good today;
 * - no route score changes.
 *
 * The routed treatment must still pass canonical eligibility/evidence/scoring,
 * and this module can measure whether it actually traversed the corridor and
 * preserved the unaffected baseline before/after the replacement.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { indexRoute, lineOverlap } from "@/application/roads/route-overlap";
import type { ProviderRouteRequest } from "./route-provider";

const DEFAULT_MAX_CONNECTOR_METERS = 2_500;
const DEFAULT_MIN_REPLACED_BASELINE_METERS = 2_000;
const DEFAULT_MAX_EXTRA_PROXY_METERS = 20_000;
const DEFAULT_MAX_SHAPING_ANCHORS = 5;
const MAX_SHAPING_ANCHORS = 16;
const DEFAULT_ADHERENCE_TOLERANCE_METERS = 35;

export interface DepartureRejoinOptions {
  readonly maxConnectorMeters?: number;
  readonly minimumReplacedBaselineMeters?: number;
  readonly maximumExtraProxyMeters?: number;
  readonly maxShapingAnchors?: number;
}

export interface DepartureRejoinPlan {
  readonly direction: "forward" | "reverse";
  readonly departureIndex: number;
  readonly rejoinIndex: number;
  readonly departure: Coordinate;
  readonly rejoin: Coordinate;
  readonly corridor: readonly Coordinate[];
  readonly shaping: readonly Coordinate[];
  readonly entryConnectorMeters: number;
  readonly exitConnectorMeters: number;
  readonly replacedBaselineMeters: number;
  readonly corridorMeters: number;
  readonly extraProxyMeters: number;
}

export interface DepartureRejoinAssessment {
  readonly corridorAdherenceShare: number;
  readonly preservedBaselineShare: number;
  readonly preservedPrefixShare: number | null;
  readonly preservedSuffixShare: number | null;
}

interface ResolvedOptions {
  readonly maxConnectorMeters: number;
  readonly minimumReplacedBaselineMeters: number;
  readonly maximumExtraProxyMeters: number;
  readonly maxShapingAnchors: number;
}

function validCoordinate(point: Coordinate): boolean {
  return (
    Number.isFinite(point.lon) &&
    Math.abs(point.lon) <= 180 &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90
  );
}

function validLine(line: readonly Coordinate[]): boolean {
  return line.length >= 2 && line.every(validCoordinate);
}

function copy(point: Coordinate): Coordinate {
  return { lon: point.lon, lat: point.lat };
}

function cumulativeMeters(line: readonly Coordinate[]): readonly number[] {
  const cumulative = [0];
  let total = 0;
  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1];
    const to = line[index];
    if (from === undefined || to === undefined) continue;
    total += haversine(from, to);
    cumulative.push(total);
  }
  return cumulative;
}

function lineMeters(line: readonly Coordinate[]): number {
  return cumulativeMeters(line).at(-1) ?? 0;
}

function nearestVertex(
  line: readonly Coordinate[],
  point: Coordinate,
): { readonly index: number; readonly meters: number } | null {
  let best: { index: number; meters: number } | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const candidate = line[index];
    if (candidate === undefined) continue;
    const meters = haversine(candidate, point);
    if (
      best === null ||
      meters < best.meters ||
      (meters === best.meters && index < best.index)
    ) {
      best = { index, meters };
    }
  }
  return best;
}

function firstIndexAtOrAfter(
  cumulative: readonly number[],
  targetMeters: number,
): number {
  for (let index = 0; index < cumulative.length; index += 1) {
    const value = cumulative[index];
    if (value !== undefined && value >= targetMeters) return index;
  }
  return cumulative.length - 1;
}

function sampleCorridor(
  corridor: readonly Coordinate[],
  maximumAnchors: number,
): readonly Coordinate[] {
  if (corridor.length <= maximumAnchors) return corridor.map(copy);

  const cumulative = cumulativeMeters(corridor);
  const total = cumulative.at(-1) ?? 0;
  if (!(total > 0)) return [copy(corridor[0]!), copy(corridor.at(-1)!)];

  const indexes: number[] = [];
  for (let slot = 0; slot < maximumAnchors; slot += 1) {
    const target = (total * slot) / (maximumAnchors - 1);
    const index = firstIndexAtOrAfter(cumulative, target);
    if (indexes.at(-1) !== index) indexes.push(index);
  }

  if (indexes[0] !== 0) indexes.unshift(0);
  const last = corridor.length - 1;
  if (indexes.at(-1) !== last) indexes.push(last);

  const bounded = indexes
    .filter((index) => index !== last)
    .slice(0, maximumAnchors - 1);
  return [...bounded.map((index) => copy(corridor[index]!)), copy(corridor[last]!)];
}

function resolveOptions(options: DepartureRejoinOptions): ResolvedOptions | null {
  const maxConnectorMeters =
    options.maxConnectorMeters ?? DEFAULT_MAX_CONNECTOR_METERS;
  const minimumReplacedBaselineMeters =
    options.minimumReplacedBaselineMeters ??
    DEFAULT_MIN_REPLACED_BASELINE_METERS;
  const maximumExtraProxyMeters =
    options.maximumExtraProxyMeters ?? DEFAULT_MAX_EXTRA_PROXY_METERS;
  const maxShapingAnchors =
    options.maxShapingAnchors ?? DEFAULT_MAX_SHAPING_ANCHORS;

  if (
    !Number.isFinite(maxConnectorMeters) ||
    maxConnectorMeters <= 0 ||
    !Number.isFinite(minimumReplacedBaselineMeters) ||
    minimumReplacedBaselineMeters <= 0 ||
    !Number.isFinite(maximumExtraProxyMeters) ||
    maximumExtraProxyMeters < 0 ||
    !Number.isSafeInteger(maxShapingAnchors) ||
    maxShapingAnchors < 2 ||
    maxShapingAnchors > MAX_SHAPING_ANCHORS
  ) {
    return null;
  }

  return {
    maxConnectorMeters,
    minimumReplacedBaselineMeters,
    maximumExtraProxyMeters,
    maxShapingAnchors,
  };
}

interface OrientedPlan {
  readonly direction: "forward" | "reverse";
  readonly corridor: readonly Coordinate[];
  readonly departureIndex: number;
  readonly rejoinIndex: number;
  readonly entryConnectorMeters: number;
  readonly exitConnectorMeters: number;
  readonly replacedBaselineMeters: number;
  readonly corridorMeters: number;
  readonly extraProxyMeters: number;
}

function candidateForOrientation(
  baseline: readonly Coordinate[],
  baselineCumulative: readonly number[],
  corridor: readonly Coordinate[],
  direction: "forward" | "reverse",
  options: ResolvedOptions,
): OrientedPlan | null {
  const entry = corridor[0];
  const exit = corridor.at(-1);
  if (entry === undefined || exit === undefined) return null;

  const departure = nearestVertex(baseline, entry);
  const rejoin = nearestVertex(baseline, exit);
  if (
    departure === null ||
    rejoin === null ||
    departure.index >= rejoin.index ||
    departure.meters > options.maxConnectorMeters ||
    rejoin.meters > options.maxConnectorMeters
  ) {
    return null;
  }

  const departureMeters = baselineCumulative[departure.index] ?? 0;
  const rejoinMeters = baselineCumulative[rejoin.index] ?? departureMeters;
  const replacedBaselineMeters = rejoinMeters - departureMeters;
  if (
    replacedBaselineMeters + 1e-9 <
    options.minimumReplacedBaselineMeters
  ) {
    return null;
  }

  const corridorMeters = lineMeters(corridor);
  if (!(corridorMeters > 0)) return null;

  const extraProxyMeters = Math.max(
    0,
    departure.meters +
      corridorMeters +
      rejoin.meters -
      replacedBaselineMeters,
  );
  if (extraProxyMeters > options.maximumExtraProxyMeters) return null;

  return {
    direction,
    corridor,
    departureIndex: departure.index,
    rejoinIndex: rejoin.index,
    entryConnectorMeters: departure.meters,
    exitConnectorMeters: rejoin.meters,
    replacedBaselineMeters,
    corridorMeters,
    extraProxyMeters,
  };
}

/**
 * Finds the best feasible orientation of one corridor relative to a baseline.
 *
 * This is a search-allocation decision only. Lower connector burden and lower
 * extra-distance proxy win deterministically; no rider-facing route score is
 * produced here.
 */
export function planDepartureRejoin(
  baseline: readonly Coordinate[],
  sourceCorridor: readonly Coordinate[],
  options: DepartureRejoinOptions = {},
): DepartureRejoinPlan | null {
  if (!validLine(baseline) || !validLine(sourceCorridor)) return null;
  const resolved = resolveOptions(options);
  if (resolved === null) return null;

  const cumulative = cumulativeMeters(baseline);
  const forward = candidateForOrientation(
    baseline,
    cumulative,
    sourceCorridor.map(copy),
    "forward",
    resolved,
  );
  const reverse = candidateForOrientation(
    baseline,
    cumulative,
    [...sourceCorridor].reverse().map(copy),
    "reverse",
    resolved,
  );
  const feasible = [forward, reverse].filter(
    (candidate): candidate is OrientedPlan => candidate !== null,
  );
  if (feasible.length === 0) return null;

  feasible.sort((left, right) => {
    const leftConnectors =
      left.entryConnectorMeters + left.exitConnectorMeters;
    const rightConnectors =
      right.entryConnectorMeters + right.exitConnectorMeters;
    if (leftConnectors !== rightConnectors) {
      return leftConnectors - rightConnectors;
    }
    if (left.extraProxyMeters !== right.extraProxyMeters) {
      return left.extraProxyMeters - right.extraProxyMeters;
    }
    if (left.replacedBaselineMeters !== right.replacedBaselineMeters) {
      return right.replacedBaselineMeters - left.replacedBaselineMeters;
    }
    return left.direction.localeCompare(right.direction);
  });

  const winner = feasible[0]!;
  const departure = copy(baseline[winner.departureIndex]!);
  const rejoin = copy(baseline[winner.rejoinIndex]!);
  const corridorAnchors = sampleCorridor(
    winner.corridor,
    resolved.maxShapingAnchors,
  );

  return {
    direction: winner.direction,
    departureIndex: winner.departureIndex,
    rejoinIndex: winner.rejoinIndex,
    departure,
    rejoin,
    corridor: winner.corridor.map(copy),
    shaping: [
      departure,
      ...corridorAnchors,
      rejoin,
    ],
    entryConnectorMeters: winner.entryConnectorMeters,
    exitConnectorMeters: winner.exitConnectorMeters,
    replacedBaselineMeters: winner.replacedBaselineMeters,
    corridorMeters: winner.corridorMeters,
    extraProxyMeters: winner.extraProxyMeters,
  };
}

export function departureRejoinRequestIncompatibility(
  request: ProviderRouteRequest,
): string | null {
  if (request.discovery !== undefined) return "discovery-round-trip";
  if (request.stops.length > 0) return "authored-stops";
  if (request.shaping.length > 0) return "authored-shaping";
  if (request.sketch !== undefined) return "authored-sketch";
  if ((request.roadSpans?.length ?? 0) > 0) return "authored-road-spans";
  return null;
}

/**
 * Applies one replacement as an ordinary shaped provider request.
 *
 * Alternatives are disabled because the treatment is one bounded route-space
 * probe and GraphHopper alternative routing is not compatible with multi-point
 * via routing.
 */
export function applyDepartureRejoinPlan(
  request: ProviderRouteRequest,
  plan: DepartureRejoinPlan,
): ProviderRouteRequest | null {
  if (departureRejoinRequestIncompatibility(request) !== null) return null;
  if (plan.shaping.length < 4 || !plan.shaping.every(validCoordinate)) return null;

  return {
    ...request,
    shaping: plan.shaping.map(copy),
    options: {
      ...request.options,
      includeAlternatives: false,
    },
  };
}

function overlapShare(
  routeIndex: ReturnType<typeof indexRoute>,
  line: readonly Coordinate[],
  toleranceMeters: number,
): number | null {
  if (line.length < 2) return null;
  const overlap = lineOverlap(routeIndex, line, toleranceMeters);
  if (!(overlap.lineMeters > 0)) return null;
  return overlap.riddenMeters / overlap.lineMeters;
}

/**
 * Measures whether the treatment did both jobs:
 * 1) actually ride the proposed corridor;
 * 2) preserve the baseline outside the replaced middle section.
 */
export function assessDepartureRejoin(
  route: readonly Coordinate[],
  baseline: readonly Coordinate[],
  plan: DepartureRejoinPlan,
  toleranceMeters = DEFAULT_ADHERENCE_TOLERANCE_METERS,
): DepartureRejoinAssessment | null {
  if (
    !validLine(route) ||
    !validLine(baseline) ||
    !Number.isFinite(toleranceMeters) ||
    toleranceMeters <= 0 ||
    plan.departureIndex < 0 ||
    plan.rejoinIndex <= plan.departureIndex ||
    plan.rejoinIndex >= baseline.length
  ) {
    return null;
  }

  const routeIndex = indexRoute(route);
  const corridorShare = overlapShare(
    routeIndex,
    plan.corridor,
    toleranceMeters,
  );
  if (corridorShare === null) return null;

  const prefix = baseline.slice(0, plan.departureIndex + 1);
  const suffix = baseline.slice(plan.rejoinIndex);
  const prefixShare = overlapShare(routeIndex, prefix, toleranceMeters);
  const suffixShare = overlapShare(routeIndex, suffix, toleranceMeters);

  const prefixMeters = lineMeters(prefix);
  const suffixMeters = lineMeters(suffix);
  const preservedMeters =
    (prefixShare ?? 0) * prefixMeters +
    (suffixShare ?? 0) * suffixMeters;
  const outsideMeters = prefixMeters + suffixMeters;
  const preservedBaselineShare =
    outsideMeters > 0 ? preservedMeters / outsideMeters : 1;

  return {
    corridorAdherenceShare: corridorShare,
    preservedBaselineShare,
    preservedPrefixShare: prefixShare,
    preservedSuffixShare: suffixShare,
  };
}
