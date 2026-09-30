/**
 * Directed network opportunities for Free Ride.
 *
 * Ported conceptually from SwitchBack's RIG graph search, but expressed only in
 * OpenGravel application/domain types. This module does not route a candidate,
 * score it, or present it. It answers the smaller question:
 *
 *   "Which worthwhile corridor decisions are actually reachable ahead of the
 *    rider, in the current direction, with a real onward rejoin?"
 *
 * That is intentionally different from projecting a point ahead and asking the
 * router for arbitrary alternatives.
 */

import {
  haversine,
  pointToSegmentDistanceMeters,
} from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

const MAX_NETWORK_SEGMENTS = 50_000;
const MAX_NETWORK_CORRIDORS = 4_096;
const MAX_CORRIDOR_SEGMENTS = 4_096;
const MAX_SEARCH_STEPS = 8_192;
const MAX_MATCH_DISTANCE_METERS = 250;
const MAX_FRAGMENT_POINTS = 512;
const MIN_TRIGGER_DISTANCE_METERS = 400;
const MAX_DIRECTION_DELTA_DEGREES = 100;

export interface FreeRideNetworkSegment {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly geometry: readonly Coordinate[];
  readonly lengthMeters: number;
}

export interface FreeRideNetworkCorridor {
  readonly id: string;
  readonly segmentIds: readonly string[];
  readonly entryNodeId: string;
  readonly exitNodeId: string;
  /** Search-allocation value, not a canonical route score. */
  readonly expectedUtility: number;
  /** Confidence that the corridor catalogue itself is usable. */
  readonly confidence: number;
}

export interface FreeRideNetworkDocument {
  readonly schemaVersion: 1;
  readonly sourceBuild: string;
  readonly graphVersion: string;
  readonly segments: readonly FreeRideNetworkSegment[];
  readonly corridors: readonly FreeRideNetworkCorridor[];
}

export interface FreeRideNetworkIndex extends FreeRideNetworkDocument {
  readonly segmentsById: ReadonlyMap<string, FreeRideNetworkSegment>;
  readonly outgoingByNode: ReadonlyMap<string, readonly FreeRideNetworkSegment[]>;
}

export interface FreeRideNetworkOpportunity {
  readonly id: string;
  readonly corridorId: string;
  readonly expectedUtility: number;
  readonly confidence: number;
  readonly origin: Coordinate;
  readonly destination: Coordinate;
  /** Entry and corridor-exit anchors for the routing provider. */
  readonly via: readonly Coordinate[];
  /** The corridor geometry that the routed result must later prove it used. */
  readonly routeFragment: readonly Coordinate[];
  /** Estimated network distance from the rider to the corridor entry. */
  readonly triggerDistanceMeters: number;
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

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 256;
}

function unit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validSegment(segment: FreeRideNetworkSegment): boolean {
  return (
    validId(segment.id) &&
    validId(segment.fromNodeId) &&
    validId(segment.toNodeId) &&
    validLine(segment.geometry) &&
    Number.isFinite(segment.lengthMeters) &&
    segment.lengthMeters > 0
  );
}

function validCorridor(corridor: FreeRideNetworkCorridor): boolean {
  return (
    validId(corridor.id) &&
    validId(corridor.entryNodeId) &&
    validId(corridor.exitNodeId) &&
    corridor.segmentIds.length > 0 &&
    corridor.segmentIds.length <= MAX_CORRIDOR_SEGMENTS &&
    corridor.segmentIds.every(validId) &&
    new Set(corridor.segmentIds).size === corridor.segmentIds.length &&
    unit(corridor.expectedUtility) &&
    unit(corridor.confidence)
  );
}

/**
 * Validates one bounded network and prebuilds directed adjacency maps.
 *
 * A corridor is required to be a contiguous directed path. This prevents a
 * catalogue mistake from turning into a Free Ride suggestion that visually
 * resembles a route but cannot actually be traversed in that order.
 */
export function buildFreeRideNetwork(
  document: FreeRideNetworkDocument,
): FreeRideNetworkIndex {
  if (
    document.schemaVersion !== 1 ||
    !validId(document.sourceBuild) ||
    !validId(document.graphVersion) ||
    document.segments.length === 0 ||
    document.segments.length > MAX_NETWORK_SEGMENTS ||
    document.corridors.length > MAX_NETWORK_CORRIDORS
  ) {
    throw new Error("Free Ride network document is invalid.");
  }

  const segmentsById = new Map<string, FreeRideNetworkSegment>();
  const outgoingMutable = new Map<string, FreeRideNetworkSegment[]>();
  for (const segment of document.segments) {
    if (!validSegment(segment) || segmentsById.has(segment.id)) {
      throw new Error("Free Ride network contains an invalid or duplicate segment.");
    }
    segmentsById.set(segment.id, segment);
    const list = outgoingMutable.get(segment.fromNodeId) ?? [];
    list.push(segment);
    outgoingMutable.set(segment.fromNodeId, list);
  }

  const corridorIds = new Set<string>();
  for (const corridor of document.corridors) {
    if (!validCorridor(corridor) || corridorIds.has(corridor.id)) {
      throw new Error("Free Ride network contains an invalid or duplicate corridor.");
    }
    corridorIds.add(corridor.id);

    const first = segmentsById.get(corridor.segmentIds[0]!);
    const last = segmentsById.get(corridor.segmentIds.at(-1)!);
    if (
      first === undefined ||
      last === undefined ||
      first.fromNodeId !== corridor.entryNodeId ||
      last.toNodeId !== corridor.exitNodeId
    ) {
      throw new Error("Free Ride corridor anchors do not match its directed segments.");
    }

    for (let index = 1; index < corridor.segmentIds.length; index += 1) {
      const previous = segmentsById.get(corridor.segmentIds[index - 1]!);
      const current = segmentsById.get(corridor.segmentIds[index]!);
      if (
        previous === undefined ||
        current === undefined ||
        previous.toNodeId !== current.fromNodeId
      ) {
        throw new Error("Free Ride corridor is not a contiguous directed path.");
      }
    }
  }

  const outgoingByNode = new Map<string, readonly FreeRideNetworkSegment[]>();
  for (const [nodeId, segments] of outgoingMutable) {
    outgoingByNode.set(
      nodeId,
      [...segments].sort((left, right) => left.id.localeCompare(right.id)),
    );
  }

  return {
    ...document,
    segmentsById,
    outgoingByNode,
  };
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function bearingDegrees(from: Coordinate, to: Coordinate): number {
  const firstLat = radians(from.lat);
  const secondLat = radians(to.lat);
  const deltaLongitude = radians(to.lon - from.lon);
  const y = Math.sin(deltaLongitude) * Math.cos(secondLat);
  const x =
    Math.cos(firstLat) * Math.sin(secondLat) -
    Math.sin(firstLat) *
      Math.cos(secondLat) *
      Math.cos(deltaLongitude);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function headingDeltaDegrees(left: number, right: number): number {
  return Math.abs(((right - left + 540) % 360) - 180);
}

function segmentBearing(segment: FreeRideNetworkSegment): number {
  for (let index = 1; index < segment.geometry.length; index += 1) {
    const from = segment.geometry[index - 1];
    const to = segment.geometry[index];
    if (
      from !== undefined &&
      to !== undefined &&
      haversine(from, to) >= 2
    ) {
      return bearingDegrees(from, to);
    }
  }
  return bearingDegrees(segment.geometry[0]!, segment.geometry.at(-1)!);
}

interface SegmentMatch {
  readonly segment: FreeRideNetworkSegment;
  readonly offsetMeters: number;
}

function nearestOnSegmentLine(
  point: Coordinate,
  segment: FreeRideNetworkSegment,
): { readonly distanceMeters: number; readonly offsetMeters: number } {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestOffset = 0;
  let offset = 0;

  for (let index = 1; index < segment.geometry.length; index += 1) {
    const start = segment.geometry[index - 1];
    const finish = segment.geometry[index];
    if (start === undefined || finish === undefined) continue;
    const edgeLength = haversine(start, finish);
    const distance = pointToSegmentDistanceMeters(point, start, finish);

    if (distance < bestDistance) {
      // Approximate projection along the edge with endpoint distances. The
      // offset exists only to seed the network horizon, not to claim GPS-map
      // matching precision.
      const fromDistance = haversine(point, start);
      const toDistance = haversine(point, finish);
      const denominator = fromDistance + toDistance;
      const fraction =
        denominator <= 0 ? 0 : Math.max(0, Math.min(1, fromDistance / denominator));
      bestDistance = distance;
      bestOffset = offset + edgeLength * fraction;
    }
    offset += edgeLength;
  }

  return { distanceMeters: bestDistance, offsetMeters: bestOffset };
}

function matchCurrentSegment(
  network: FreeRideNetworkIndex,
  position: Coordinate,
  headingDegrees: number | null,
): SegmentMatch | null {
  let best:
    | {
        readonly segment: FreeRideNetworkSegment;
        readonly offsetMeters: number;
        readonly score: number;
      }
    | null = null;

  for (const segment of network.segments) {
    const headingDelta =
      headingDegrees === null
        ? 0
        : headingDeltaDegrees(headingDegrees, segmentBearing(segment));
    if (
      headingDegrees !== null &&
      headingDelta > MAX_DIRECTION_DELTA_DEGREES
    ) {
      continue;
    }

    const match = nearestOnSegmentLine(position, segment);
    if (match.distanceMeters > MAX_MATCH_DISTANCE_METERS) continue;

    const score = match.distanceMeters + headingDelta * 0.5;
    if (
      best === null ||
      score < best.score ||
      (score === best.score && segment.id.localeCompare(best.segment.id) < 0)
    ) {
      best = {
        segment,
        offsetMeters: match.offsetMeters,
        score,
      };
    }
  }

  return best === null
    ? null
    : { segment: best.segment, offsetMeters: best.offsetMeters };
}

interface QueueEntry {
  readonly nodeId: string;
  readonly distanceMeters: number;
}

function reachableSegments(
  network: FreeRideNetworkIndex,
  match: SegmentMatch,
  horizonMeters: number,
): ReadonlyMap<string, number> {
  const remainingCurrent = Math.max(
    0,
    match.segment.lengthMeters - match.offsetMeters,
  );
  const reachable = new Map<string, number>([[match.segment.id, 0]]);
  const bestNodeDistance = new Map<string, number>([
    [match.segment.toNodeId, remainingCurrent],
  ]);
  const queue: QueueEntry[] = [
    {
      nodeId: match.segment.toNodeId,
      distanceMeters: remainingCurrent,
    },
  ];

  let steps = 0;
  while (queue.length > 0 && steps < MAX_SEARCH_STEPS) {
    queue.sort(
      (left, right) =>
        left.distanceMeters - right.distanceMeters ||
        left.nodeId.localeCompare(right.nodeId),
    );
    const current = queue.shift();
    if (current === undefined) break;
    if (current.distanceMeters !== bestNodeDistance.get(current.nodeId)) continue;
    steps += 1;

    for (const segment of network.outgoingByNode.get(current.nodeId) ?? []) {
      const entryDistance = current.distanceMeters;
      const endDistance = entryDistance + segment.lengthMeters;
      if (endDistance > horizonMeters) continue;

      const knownSegment = reachable.get(segment.id);
      if (knownSegment !== undefined && knownSegment <= entryDistance) continue;
      reachable.set(segment.id, entryDistance);

      const knownNode = bestNodeDistance.get(segment.toNodeId);
      if (knownNode === undefined || endDistance < knownNode) {
        bestNodeDistance.set(segment.toNodeId, endDistance);
        queue.push({
          nodeId: segment.toNodeId,
          distanceMeters: endDistance,
        });
      }
    }
  }

  return reachable;
}

function findRejoinSegment(
  network: FreeRideNetworkIndex,
  corridor: FreeRideNetworkCorridor,
  recentSegmentIds: ReadonlySet<string>,
): FreeRideNetworkSegment | null {
  const last = network.segmentsById.get(corridor.segmentIds.at(-1)!);
  if (last === undefined) return null;

  const corridorIds = new Set(corridor.segmentIds);
  const candidates = (network.outgoingByNode.get(last.toNodeId) ?? [])
    .filter(
      (segment) =>
        !corridorIds.has(segment.id) &&
        !recentSegmentIds.has(segment.id) &&
        headingDeltaDegrees(
          segmentBearing(last),
          segmentBearing(segment),
        ) <= MAX_DIRECTION_DELTA_DEGREES,
    );

  return candidates[0] ?? null;
}

function corridorGeometry(
  network: FreeRideNetworkIndex,
  corridor: FreeRideNetworkCorridor,
): readonly Coordinate[] {
  const geometry: Coordinate[] = [];
  for (const id of corridor.segmentIds) {
    const segment = network.segmentsById.get(id);
    if (segment === undefined) return [];
    geometry.push(
      ...(geometry.length === 0
        ? segment.geometry.map((point) => ({ ...point }))
        : segment.geometry.slice(1).map((point) => ({ ...point }))),
    );
  }

  if (geometry.length <= MAX_FRAGMENT_POINTS) return geometry;
  return Array.from({ length: MAX_FRAGMENT_POINTS }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (geometry.length - 1)) / (MAX_FRAGMENT_POINTS - 1),
    );
    return { ...geometry[sourceIndex]! };
  });
}

/**
 * A distance horizon scaled to riding speed, ported from SwitchBack's live RIG
 * search. The search remains bounded even when GPS speed is missing.
 */
export function freeRideNetworkHorizonMeters(
  speedMph: number | undefined,
): number {
  if (!Number.isFinite(speedMph) || speedMph === undefined || speedMph < 25) {
    return 6 * METERS_PER_MILE;
  }
  if (speedMph < 45) return 10 * METERS_PER_MILE;
  if (speedMph < 65) return 16 * METERS_PER_MILE;
  return 22 * METERS_PER_MILE;
}

const METERS_PER_MILE = 1_609.344;

/**
 * Finds directed, forward, rejoinable corridor opportunities.
 *
 * Nothing here claims the corridor is currently legal/open or compatible with
 * the rider's bike. The normal Free Ride evidence/eligibility stage must still
 * verify the routed candidate before an opportunity can be shown.
 */
export function findFreeRideNetworkOpportunities(
  network: FreeRideNetworkIndex,
  position: Coordinate,
  headingDegrees: number | null,
  speedMph?: number,
  recentSegmentIds: ReadonlySet<string> = new Set(),
): readonly FreeRideNetworkOpportunity[] {
  if (!validCoordinate(position)) return [];

  const match = matchCurrentSegment(network, position, headingDegrees);
  if (match === null) return [];

  const reachable = reachableSegments(
    network,
    match,
    freeRideNetworkHorizonMeters(speedMph),
  );
  const opportunities: FreeRideNetworkOpportunity[] = [];

  for (const corridor of network.corridors) {
    if (corridor.segmentIds.some((id) => recentSegmentIds.has(id))) continue;

    const entryId = corridor.segmentIds[0];
    const entryDistance = reachable.get(entryId);
    if (
      entryDistance === undefined ||
      entryDistance < MIN_TRIGGER_DISTANCE_METERS
    ) {
      continue;
    }

    const first = network.segmentsById.get(entryId);
    const last = network.segmentsById.get(corridor.segmentIds.at(-1)!);
    const rejoin = findRejoinSegment(network, corridor, recentSegmentIds);
    const fragment = corridorGeometry(network, corridor);
    const destination = rejoin?.geometry.at(-1);
    if (
      first === undefined ||
      last === undefined ||
      rejoin === null ||
      destination === undefined ||
      fragment.length < 2
    ) {
      continue;
    }

    opportunities.push({
      id:
        "network:" +
        network.sourceBuild +
        ":" +
        corridor.id,
      corridorId: corridor.id,
      expectedUtility: corridor.expectedUtility,
      confidence: corridor.confidence,
      origin: { ...position },
      destination: { ...destination },
      via: [
        { ...first.geometry[0]! },
        { ...last.geometry.at(-1)! },
      ],
      routeFragment: fragment,
      triggerDistanceMeters: Number(entryDistance.toFixed(1)),
    });
  }

  return opportunities
    .sort(
      (left, right) =>
        right.expectedUtility - left.expectedUtility ||
        right.confidence - left.confidence ||
        left.triggerDistanceMeters - right.triggerDistanceMeters ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 3);
}

/**
 * Verifies that a routed suggestion actually traversed the proposed corridor.
 *
 * Crossing one point of the corridor is not enough: samples are checked against
 * route segments, so a suggestion must recover a meaningful share of the
 * fragment before the experiment can count it as a successful opportunity.
 */
export function freeRideFragmentTraversalRatio(
  routeGeometry: readonly Coordinate[],
  fragment: readonly Coordinate[],
): number {
  if (!validLine(routeGeometry) || !validLine(fragment)) return 0;

  const samples: Coordinate[] = [{ ...fragment[0]! }];
  let carry = 0;
  const spacingMeters = 120;

  for (let index = 0; index + 1 < fragment.length; index += 1) {
    const start = fragment[index];
    const finish = fragment[index + 1];
    if (start === undefined || finish === undefined) continue;

    const distance = haversine(start, finish);
    let position = spacingMeters - carry;
    while (position < distance) {
      const share = position / distance;
      samples.push({
        lon: start.lon + (finish.lon - start.lon) * share,
        lat: start.lat + (finish.lat - start.lat) * share,
      });
      position += spacingMeters;
    }
    carry = Math.max(0, distance - (position - spacingMeters));
  }

  samples.push({ ...fragment.at(-1)! });

  const covered = samples.filter((point) => {
    for (let index = 0; index + 1 < routeGeometry.length; index += 1) {
      const from = routeGeometry[index];
      const to = routeGeometry[index + 1];
      if (
        from !== undefined &&
        to !== undefined &&
        pointToSegmentDistanceMeters(point, from, to) <= 140
      ) {
        return true;
      }
    }
    return false;
  }).length;

  return samples.length > 0 ? covered / samples.length : 0;
}
