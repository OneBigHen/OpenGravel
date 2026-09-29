import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { TrafficResponse, TrafficSegment } from "@/infrastructure/traffic";

export const MAX_TRAFFIC_CORRIDOR_MATCH_METERS = 750;

export interface CorridorSegmentMatch {
  readonly routeSegmentIndex: number;
  readonly trafficSegmentId: string | null;
  readonly trafficSegment: TrafficSegment | null;
  readonly distanceMeters: number | null;
}

export interface CorridorMatch {
  readonly segmentMatches: readonly CorridorSegmentMatch[];
  readonly matchedTrafficSegmentIds: readonly string[];
  readonly unmatchedTrafficSegmentIds: readonly string[];
  readonly coverageRatio: number;
}

function toLocalMeters(point: Coordinate, latitude: number): readonly [number, number] {
  const scale = 111_320;
  const longitudeScale = Math.cos((latitude * Math.PI) / 180);
  return [point.lon * scale * longitudeScale, point.lat * scale];
}

function pointToSegmentMeters(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const latitude = (point.lat + start.lat + end.lat) / 3;
  const [px, py] = toLocalMeters(point, latitude);
  const [ax, ay] = toLocalMeters(start, latitude);
  const [bx, by] = toLocalMeters(end, latitude);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + projection * dx), py - (ay + projection * dy));
}

function segmentDistanceMeters(
  traffic: TrafficSegment,
  start: Coordinate,
  end: Coordinate,
): number {
  const samples = traffic.geometry.length > 0 ? traffic.geometry : [start, end];
  return Math.min(...samples.map((point) => pointToSegmentMeters(point, start, end)));
}

/**
 * Deterministically assigns each returned traffic segment to at most one
 * planned-route segment. Provider order is not trusted: ids are sorted before
 * matching, and ties resolve by distance then id. Empty/unavailable traffic is
 * an all-null match, never a clear result.
 */
export function matchCorridor(
  routeGeometry: readonly Coordinate[],
  trafficResponse: TrafficResponse,
): CorridorMatch {
  const routeSegmentCount = Math.max(0, routeGeometry.length - 1);
  const sortedTraffic = [...trafficResponse.segments].sort((left, right) => left.id.localeCompare(right.id));
  const assigned = new Set<string>();
  const segmentMatches: CorridorSegmentMatch[] = [];

  for (let routeSegmentIndex = 0; routeSegmentIndex < routeSegmentCount; routeSegmentIndex += 1) {
    const start = routeGeometry[routeSegmentIndex];
    const end = routeGeometry[routeSegmentIndex + 1];
    if (start === undefined || end === undefined) continue;
    const closest = sortedTraffic
      .filter((traffic) => !assigned.has(traffic.id))
      .map((traffic) => ({
        traffic,
        distanceMeters: segmentDistanceMeters(traffic, start, end),
      }))
      .filter((entry) => entry.distanceMeters <= MAX_TRAFFIC_CORRIDOR_MATCH_METERS)
      .sort((left, right) => left.distanceMeters - right.distanceMeters || left.traffic.id.localeCompare(right.traffic.id))[0];
    if (closest === undefined) {
      segmentMatches.push({ routeSegmentIndex, trafficSegmentId: null, trafficSegment: null, distanceMeters: null });
      continue;
    }
    assigned.add(closest.traffic.id);
    segmentMatches.push({
      routeSegmentIndex,
      trafficSegmentId: closest.traffic.id,
      trafficSegment: closest.traffic,
      distanceMeters: closest.distanceMeters,
    });
  }

  const matchedTrafficSegmentIds = segmentMatches
    .flatMap((match) => match.trafficSegmentId === null ? [] : [match.trafficSegmentId]);
  const matched = new Set(matchedTrafficSegmentIds);
  return {
    segmentMatches,
    matchedTrafficSegmentIds,
    unmatchedTrafficSegmentIds: sortedTraffic
      .map((traffic) => traffic.id)
      .filter((id) => !matched.has(id)),
    coverageRatio: routeSegmentCount === 0 ? 0 : matchedTrafficSegmentIds.length / routeSegmentCount,
  };
}

export const matchTrafficCorridor = matchCorridor;

/** A small public geometry helper for callers that need endpoint diagnostics. */
export function corridorEndpointDistanceMeters(first: Coordinate, second: Coordinate): number {
  return haversine(first, second);
}
