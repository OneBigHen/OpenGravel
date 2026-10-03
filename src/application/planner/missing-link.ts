/**
 * Missing-link discovery between two known/curated riding corridors.
 *
 * Two good corridors do not make the road between them good. This module keeps
 * that semantic boundary explicit:
 *
 * 1. orient/order two source corridors relative to one planning request;
 * 2. ask the provider for the gap alone;
 * 3. evaluate that returned connector with normal OpenGravel evidence/coherence;
 * 4. only then build a full shaped request through A -> connector -> B.
 *
 * Source corridor value never transfers to the connector.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { ProviderRouteRequest } from "./route-provider";
import type { LibraryCorridorSource } from "./library-corridor-probes";

const DEFAULT_MAX_GAP_METERS = 12_000;
const DEFAULT_MIN_CORRIDOR_METERS = 3_000;
const DEFAULT_MAX_CORRIDOR_ANCHORS = 3;
const DEFAULT_MAX_CONNECTOR_ANCHORS = 3;
const MAX_ANCHORS_PER_PART = 8;
const EPSILON = 1e-9;

export interface MissingLinkOptions {
  /** Straight-line gap eligible for one connector search. */
  readonly maxGapMeters?: number;
  /** Ignore tiny source fragments that are not meaningful riding corridors. */
  readonly minimumCorridorMeters?: number;
  readonly maxCorridorAnchors?: number;
  readonly maxConnectorAnchors?: number;
}

export interface MissingLinkPlan {
  readonly firstSourceId: string;
  readonly secondSourceId: string;
  readonly firstDirection: "forward" | "reverse";
  readonly secondDirection: "forward" | "reverse";
  readonly firstCorridor: readonly Coordinate[];
  readonly secondCorridor: readonly Coordinate[];
  readonly gapStart: Coordinate;
  readonly gapEnd: Coordinate;
  readonly gapDirectMeters: number;
  /** Cheap ordering proxy: origin -> A + gap + B -> destination. */
  readonly structuralConnectorMeters: number;
  /** One call whose returned road section must earn its own quality. */
  readonly connectorRequest: ProviderRouteRequest;
  readonly maxCorridorAnchors: number;
  readonly maxConnectorAnchors: number;
}

export interface MissingLinkConnectorAssessment {
  readonly endpointFit: boolean;
  readonly startOffsetMeters: number;
  readonly endOffsetMeters: number;
  readonly distanceMeters: number;
  readonly stretchOverDirect: number | null;
}

interface ResolvedOptions {
  readonly maxGapMeters: number;
  readonly minimumCorridorMeters: number;
  readonly maxCorridorAnchors: number;
  readonly maxConnectorAnchors: number;
}

interface OrientedSource {
  readonly source: LibraryCorridorSource;
  readonly direction: "forward" | "reverse";
  readonly geometry: readonly Coordinate[];
  readonly meters: number;
}

interface PairCandidate {
  readonly first: OrientedSource;
  readonly second: OrientedSource;
  readonly gapMeters: number;
  readonly structuralConnectorMeters: number;
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

function lineMeters(line: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 0; index + 1 < line.length; index += 1) {
    const from = line[index];
    const to = line[index + 1];
    if (from === undefined || to === undefined) continue;
    total += haversine(from, to);
  }
  return total;
}

function resolveOptions(options: MissingLinkOptions): ResolvedOptions | null {
  const maxGapMeters = options.maxGapMeters ?? DEFAULT_MAX_GAP_METERS;
  const minimumCorridorMeters =
    options.minimumCorridorMeters ?? DEFAULT_MIN_CORRIDOR_METERS;
  const maxCorridorAnchors =
    options.maxCorridorAnchors ?? DEFAULT_MAX_CORRIDOR_ANCHORS;
  const maxConnectorAnchors =
    options.maxConnectorAnchors ?? DEFAULT_MAX_CONNECTOR_ANCHORS;

  if (
    !Number.isFinite(maxGapMeters) ||
    maxGapMeters <= 0 ||
    !Number.isFinite(minimumCorridorMeters) ||
    minimumCorridorMeters <= 0 ||
    !Number.isSafeInteger(maxCorridorAnchors) ||
    maxCorridorAnchors < 2 ||
    maxCorridorAnchors > MAX_ANCHORS_PER_PART ||
    !Number.isSafeInteger(maxConnectorAnchors) ||
    maxConnectorAnchors < 2 ||
    maxConnectorAnchors > MAX_ANCHORS_PER_PART
  ) {
    return null;
  }

  return {
    maxGapMeters,
    minimumCorridorMeters,
    maxCorridorAnchors,
    maxConnectorAnchors,
  };
}

function orientations(
  source: LibraryCorridorSource,
  minimumMeters: number,
): readonly OrientedSource[] {
  if (source.id.trim().length === 0 || !validLine(source.geometry)) return [];
  const meters = lineMeters(source.geometry);
  if (meters + EPSILON < minimumMeters) return [];

  return [
    {
      source,
      direction: "forward",
      geometry: source.geometry.map(copy),
      meters,
    },
    {
      source,
      direction: "reverse",
      geometry: [...source.geometry].reverse().map(copy),
      meters,
    },
  ];
}

function requestCompatible(request: ProviderRouteRequest): boolean {
  return (
    request.discovery === undefined &&
    request.stops.length === 0 &&
    request.shaping.length === 0 &&
    request.sketch === undefined &&
    (request.roadSpans?.length ?? 0) === 0
  );
}

function pairCandidates(
  request: ProviderRouteRequest,
  left: LibraryCorridorSource,
  right: LibraryCorridorSource,
  options: ResolvedOptions,
): readonly PairCandidate[] {
  if (left.id === right.id) return [];

  const pairs: PairCandidate[] = [];
  const orders: readonly [
    LibraryCorridorSource,
    LibraryCorridorSource,
  ][] = [
    [left, right],
    [right, left],
  ];

  for (const [firstSource, secondSource] of orders) {
    for (const first of orientations(
      firstSource,
      options.minimumCorridorMeters,
    )) {
      for (const second of orientations(
        secondSource,
        options.minimumCorridorMeters,
      )) {
        const firstStart = first.geometry[0]!;
        const firstEnd = first.geometry.at(-1)!;
        const secondStart = second.geometry[0]!;
        const secondEnd = second.geometry.at(-1)!;

        const gapMeters = haversine(firstEnd, secondStart);
        if (gapMeters > options.maxGapMeters + EPSILON) continue;

        const structuralConnectorMeters =
          haversine(request.origin, firstStart) +
          gapMeters +
          haversine(secondEnd, request.destination);

        pairs.push({
          first,
          second,
          gapMeters,
          structuralConnectorMeters,
        });
      }
    }
  }

  return pairs;
}

/**
 * Selects the most structurally sensible A -> gap -> B orientation/order.
 *
 * This ranking allocates a connector-search call; it is not a motorcycle route
 * score. The gap itself remains untrusted until the provider returns it and the
 * normal evidence pipeline measures it.
 */
export function planMissingLink(
  request: ProviderRouteRequest,
  first: LibraryCorridorSource,
  second: LibraryCorridorSource,
  options: MissingLinkOptions = {},
): MissingLinkPlan | null {
  if (!requestCompatible(request)) return null;
  const resolved = resolveOptions(options);
  if (resolved === null) return null;

  const candidates = [...pairCandidates(
    request,
    first,
    second,
    resolved,
  )];
  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    if (
      left.structuralConnectorMeters !==
      right.structuralConnectorMeters
    ) {
      return (
        left.structuralConnectorMeters -
        right.structuralConnectorMeters
      );
    }
    if (left.gapMeters !== right.gapMeters) {
      return left.gapMeters - right.gapMeters;
    }
    const leftKey =
      left.first.source.id +
      ":" +
      left.first.direction +
      ">" +
      left.second.source.id +
      ":" +
      left.second.direction;
    const rightKey =
      right.first.source.id +
      ":" +
      right.first.direction +
      ">" +
      right.second.source.id +
      ":" +
      right.second.direction;
    return leftKey.localeCompare(rightKey);
  });

  const winner = candidates[0]!;
  const gapStart = copy(winner.first.geometry.at(-1)!);
  const gapEnd = copy(winner.second.geometry[0]!);

  return {
    firstSourceId: winner.first.source.id,
    secondSourceId: winner.second.source.id,
    firstDirection: winner.first.direction,
    secondDirection: winner.second.direction,
    firstCorridor: winner.first.geometry.map(copy),
    secondCorridor: winner.second.geometry.map(copy),
    gapStart,
    gapEnd,
    gapDirectMeters: winner.gapMeters,
    structuralConnectorMeters: winner.structuralConnectorMeters,
    connectorRequest: {
      ...request,
      origin: gapStart,
      destination: gapEnd,
      stops: [],
      shaping: [],
      options: {
        ...request.options,
        includeAlternatives: false,
      },
    },
    maxCorridorAnchors: resolved.maxCorridorAnchors,
    maxConnectorAnchors: resolved.maxConnectorAnchors,
  };
}

function cumulativeMeters(
  line: readonly Coordinate[],
): readonly number[] {
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

function firstIndexAtOrAfter(
  cumulative: readonly number[],
  target: number,
): number {
  for (let index = 0; index < cumulative.length; index += 1) {
    const value = cumulative[index];
    if (value !== undefined && value >= target) return index;
  }
  return cumulative.length - 1;
}

function sampleAnchors(
  line: readonly Coordinate[],
  maximum: number,
): readonly Coordinate[] {
  if (line.length <= maximum) return line.map(copy);
  const cumulative = cumulativeMeters(line);
  const total = cumulative.at(-1) ?? 0;
  if (!(total > 0)) return [copy(line[0]!), copy(line.at(-1)!)];

  const indexes: number[] = [];
  for (let slot = 0; slot < maximum; slot += 1) {
    const target = (total * slot) / (maximum - 1);
    const index = firstIndexAtOrAfter(cumulative, target);
    if (indexes.at(-1) !== index) indexes.push(index);
  }
  if (indexes[0] !== 0) indexes.unshift(0);
  const last = line.length - 1;
  if (indexes.at(-1) !== last) indexes.push(last);

  const interior = indexes
    .filter((index) => index !== last)
    .slice(0, maximum - 1)
    .map((index) => copy(line[index]!));
  return [...interior, copy(line[last]!)];
}

/**
 * Basic structural measurements of the connector-only provider answer.
 *
 * Quality is intentionally absent. The caller must run the connector through
 * canonical evidence/coherence before calling {@link buildMissingLinkRoute}.
 */
export function assessMissingLinkConnector(
  plan: MissingLinkPlan,
  connector: readonly Coordinate[],
  endpointToleranceMeters = 150,
): MissingLinkConnectorAssessment | null {
  if (
    !validLine(connector) ||
    !Number.isFinite(endpointToleranceMeters) ||
    endpointToleranceMeters <= 0
  ) {
    return null;
  }

  const startOffsetMeters = haversine(
    connector[0]!,
    plan.gapStart,
  );
  const endOffsetMeters = haversine(
    connector.at(-1)!,
    plan.gapEnd,
  );
  const distanceMeters = lineMeters(connector);

  return {
    endpointFit:
      startOffsetMeters <= endpointToleranceMeters &&
      endOffsetMeters <= endpointToleranceMeters,
    startOffsetMeters,
    endOffsetMeters,
    distanceMeters,
    stretchOverDirect:
      plan.gapDirectMeters > 0
        ? distanceMeters / plan.gapDirectMeters
        : null,
  };
}

/**
 * Creates the full A -> connector -> B treatment request after the connector
 * has independently passed caller-owned evidence/coherence gates.
 */
export function buildMissingLinkRoute(
  request: ProviderRouteRequest,
  plan: MissingLinkPlan,
  connector: readonly Coordinate[],
): ProviderRouteRequest | null {
  if (!requestCompatible(request) || !validLine(connector)) return null;

  const assessment = assessMissingLinkConnector(plan, connector);
  if (assessment === null || !assessment.endpointFit) return null;

  const first = sampleAnchors(
    plan.firstCorridor,
    plan.maxCorridorAnchors,
  );
  const middle = sampleAnchors(
    connector,
    plan.maxConnectorAnchors,
  );
  const second = sampleAnchors(
    plan.secondCorridor,
    plan.maxCorridorAnchors,
  );

  // Drop adjacent duplicate boundary points. The route provider still receives
  // an ordered corridor sequence, but no zero-length via hops.
  const shaping: Coordinate[] = [];
  for (const point of [...first, ...middle, ...second]) {
    const previous = shaping.at(-1);
    if (
      previous !== undefined &&
      haversine(previous, point) < 1
    ) {
      continue;
    }
    shaping.push(copy(point));
  }

  return shaping.length >= 4
    ? {
        ...request,
        shaping,
        options: {
          ...request.options,
          includeAlternatives: false,
        },
      }
    : null;
}
