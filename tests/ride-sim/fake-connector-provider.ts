/**
 * A fake router for the RM-6 reroute checks: it knows the planned line and
 * answers a "way back" request the way a router would on a simple road
 * network: from the rider, round any avoided spot, onto the planned road a
 * little before the target, then along it to the target.
 *
 * A request whose destination is not on the line (a full replan to the finish)
 * gets a straight line, so a fallback is visible as a route that does not keep
 * the planned line. Nothing here reaches a network.
 */

import type { ProviderCandidate, ProviderRouteRequest } from "@/application/planner/route-provider";
import { chainage, nearestAlong, pointAlong } from "@/application/ride-session/rejoin-splice";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteInstruction } from "@/domain/route/types";

export interface FakeConnectorOptions {
  readonly line: readonly Coordinate[];
  readonly instructions: readonly RouteInstruction[];
  /** Connector riding speed. */
  readonly speedMps?: number;
  /** Extra seconds added to every connector (to force the "too slow" fallback). */
  readonly extraSeconds?: number;
}

export interface FakeConnectorProvider {
  readonly requests: ProviderRouteRequest[];
  readonly beginAttempt: (identity: unknown) => void;
  readonly candidates: (request: ProviderRouteRequest, signal: AbortSignal) => Promise<{ readonly candidates: readonly ProviderCandidate[] }>;
}

function insideRing(point: Coordinate, ring: readonly Coordinate[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index] as Coordinate;
    const b = ring[previous] as Coordinate;
    if ((a.lat > point.lat) !== (b.lat > point.lat) &&
      point.lon < ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

function segmentsCross(p: Coordinate, q: Coordinate, a: Coordinate, b: Coordinate): boolean {
  const rx = q.lon - p.lon, ry = q.lat - p.lat, sx = b.lon - a.lon, sy = b.lat - a.lat;
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return false;
  const t = ((a.lon - p.lon) * sy - (a.lat - p.lat) * sx) / denominator;
  const u = ((a.lon - p.lon) * ry - (a.lat - p.lat) * rx) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** True when any leg of `path` enters or touches the ring (exact, not sampled). */
function crossesRing(path: readonly Coordinate[], ring: readonly Coordinate[]): boolean {
  if (path.some((point) => insideRing(point, ring))) return true;
  for (let leg = 1; leg < path.length; leg += 1) {
    for (let edge = 0; edge < ring.length; edge += 1) {
      if (segmentsCross(path[leg - 1] as Coordinate, path[leg] as Coordinate, ring[edge] as Coordinate, ring[(edge + 1) % ring.length] as Coordinate)) return true;
    }
  }
  return false;
}

function pathMeters(path: readonly Coordinate[]): number {
  return path.slice(1).reduce((sum, point, index) => sum + haversine(path[index] as Coordinate, point), 0);
}

/**
 * A way round a ring, as a road network would offer one: the shortest walk
 * along the corners of a box well outside it (either way round) that keeps
 * every leg out of the ring. Empty when the straight way already misses it.
 */
function roundRing(from: Coordinate, to: Coordinate, ring: readonly Coordinate[]): Coordinate[] {
  if (!crossesRing([from, to], ring)) return [];
  const lons = ring.map((point) => point.lon);
  const lats = ring.map((point) => point.lat);
  const pad = 0.004; // ~350 m
  const west = Math.min(...lons) - pad, east = Math.max(...lons) + pad;
  const south = Math.min(...lats) - pad, north = Math.max(...lats) + pad;
  // Clockwise from the south-west corner.
  const corners: Coordinate[] = [
    { lon: west, lat: south }, { lon: west, lat: north }, { lon: east, lat: north }, { lon: east, lat: south },
  ];
  let best: Coordinate[] = [];
  let bestMeters = Number.POSITIVE_INFINITY;
  for (let first = 0; first < 4; first += 1) {
    for (const step of [1, 3]) {
      for (let count = 1; count <= 4; count += 1) {
        const walk = Array.from({ length: count }, (_, index) => corners[(first + step * index) % 4] as Coordinate);
        const path = [from, ...walk, to];
        if (crossesRing(path, ring)) continue;
        const meters = pathMeters(path);
        if (meters < bestMeters) {
          best = walk;
          bestMeters = meters;
        }
      }
    }
  }
  return best;
}

export function createFakeConnectorProvider(options: FakeConnectorOptions): FakeConnectorProvider {
  const chain = chainage(options.line);
  const speed = options.speedMps ?? 12;
  const requests: ProviderRouteRequest[] = [];
  const roadAt = (segmentIndex: number): string | undefined =>
    [...options.instructions].reverse().find((instruction) => (instruction.geometryIndex ?? 0) <= segmentIndex)?.roadName;

  return {
    requests,
    beginAttempt: () => undefined,
    async candidates(request) {
      requests.push(request);
      const along = nearestAlong(options.line, chain, request.destination);
      const onLine = pointAlong(options.line, chain, along);
      const isConnector = haversine(onLine.coordinate, request.destination) < 5 && along < (chain.at(-1) as number) - 1;
      let geometry: Coordinate[];
      let instructions: RouteInstruction[];
      if (isConnector) {
        const segmentStart = chain[onLine.segmentIndex] as number;
        const before = pointAlong(options.line, chain, Math.max(segmentStart, along - 150)).coordinate;
        const detours = request.avoidPolygons.flatMap((ring) => roundRing(request.origin, before, ring));
        geometry = [request.origin, ...detours, before, request.destination];
        const lengths = geometry.slice(1).map((point, index) => haversine(geometry[index] as Coordinate, point));
        const approach = lengths.slice(0, -1).reduce((sum, value) => sum + value, 0);
        const last = lengths.at(-1) as number;
        const extra = options.extraSeconds ?? 0;
        const road = roadAt(onLine.segmentIndex);
        instructions = [
          { text: "Head out on Connector Road", type: "depart", roadName: "Connector Road", geometryIndex: 0, distanceMeters: approach, durationSeconds: approach / speed + extra },
          { text: `Turn onto ${road ?? "the road"}`, type: "turn", maneuver: "right", ...(road === undefined ? {} : { roadName: road }), geometryIndex: geometry.length - 2, distanceMeters: last, durationSeconds: last / speed },
          { text: "Arrive", type: "finish", geometryIndex: geometry.length - 1, distanceMeters: 0, durationSeconds: 0 },
        ];
      } else {
        geometry = [request.origin, request.destination];
        const meters = haversine(request.origin, request.destination);
        instructions = [
          { text: "Head out", type: "depart", geometryIndex: 0, distanceMeters: meters, durationSeconds: meters / speed },
          { text: "Arrive", type: "finish", geometryIndex: 1, distanceMeters: 0, durationSeconds: 0 },
        ];
      }
      const distanceMeters = instructions.reduce((sum, instruction) => sum + instruction.distanceMeters, 0);
      const durationSeconds = instructions.reduce((sum, instruction) => sum + instruction.durationSeconds, 0);
      return {
        candidates: [{
          providerId: "fake",
          profile: request.profile,
          geometry,
          distanceMeters,
          durationSeconds,
          instructions,
          providerMetadata: { candidateId: `route_fake_${requests.length}`, bestRide: true },
        }],
      };
    },
  };
}
