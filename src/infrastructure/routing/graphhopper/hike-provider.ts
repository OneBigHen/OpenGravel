import type { ProviderCandidateSet, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
import type { ElevationSource } from "@/application/planner/ports/hike-elevation";
import { haversine } from "@/domain/geometry/analysis";
import { computeHikeStats } from "@/domain/hike/stats";
import { buildHikeProfile } from "@/domain/hike/profile";
import { toblerTime } from "@/domain/hike/time";
import type { Coordinate } from "@/domain/ride/types";
import { createTerrariumElevationSource } from "@/infrastructure/elevation/terrarium-source";

export type HikeRoutingErrorCode = "hike-routing-unavailable" | "no-trail-route";
export class HikeRoutingError extends Error {
  constructor(readonly code: HikeRoutingErrorCode) {
    super(code === "no-trail-route" ? "No trail route between these points. Try another trailhead or waypoint." : "Hike routing unavailable. Try again when the trail router is available.");
  }
}
const TRAILS = new Set(["path", "footway", "track", "steps", "bridleway", "cycleway", "pedestrian"]);
const ROADS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service", "living_street", "road"]);
const elevationSource = createTerrariumElevationSource();

function coordinates(value: unknown): Coordinate[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 100000) throw new HikeRoutingError("hike-routing-unavailable");
  return value.map((entry: unknown) => {
    if (!Array.isArray(entry) || typeof entry[0] !== "number" || typeof entry[1] !== "number" || !Number.isFinite(entry[0]) || !Number.isFinite(entry[1]) || Math.abs(entry[0]) > 180 || Math.abs(entry[1]) > 90) throw new HikeRoutingError("hike-routing-unavailable");
    return { lon: entry[0], lat: entry[1] };
  });
}

/** Preserve every turn, densifying long segments to 30 m for route-local DEM. */
export function hikeElevationLine(line: readonly Coordinate[]): Coordinate[] {
  const result: Coordinate[] = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!;
    const count = Math.max(1, Math.ceil(haversine(a, b) / 30));
    if (result.length + count > 100000) throw new HikeRoutingError("hike-routing-unavailable");
    for (let j = 1; j <= count; j++) result.push({ lon: a.lon + (b.lon - a.lon) * j / count, lat: a.lat + (b.lat - a.lat) * j / count });
  }
  return result;
}

/** Isolated foot adapter: no rider profiles, request models or hosted fallback. */
export function createHikeProvider(options: { readonly url: string; readonly apiKey?: string; readonly fetcher?: typeof fetch; readonly elevation?: ElevationSource }): RouteCandidateProvider {
  return {
    id: "graphhopper-hike",
    capabilities: () => ({ profiles: ["hike"], supportsAlternatives: false, supportsAvoidPolygons: false }),
    async candidates(request: ProviderRouteRequest, signal: AbortSignal): Promise<ProviderCandidateSet> {
      const runSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
      try {
        // The loop generator's stock snapping is not trail constrained. Ask the
        // patched via router for an explicitly authored loop instead.
        const points = request.sketch?.anchors.length ? request.sketch.anchors : [request.origin, ...request.stops, ...request.shaping, request.destination];
        if (request.discovery && points.length === 2 && haversine(points[0]!, points[1]!) < 1) throw new HikeRoutingError("no-trail-route");
        const url = new URL(`${options.url.replace(/\/$/, "")}/route`);
        if (options.apiKey) url.searchParams.set("key", options.apiKey);
        const response = await (options.fetcher ?? fetch)(url, { method: "POST", headers: { "content-type": "application/json" }, signal: runSignal,
          body: JSON.stringify({ profile: "hike", points: points.map(p => [p.lon, p.lat]), points_encoded: false, instructions: false, details: ["road_class"] }) });
        const raw = await response.json();
        if (!response.ok) {
          const noRoute = response.status === 400 && Array.isArray(raw.hints) && raw.hints.some((hint: { details?: string }) => /PointNotFoundException|ConnectionNotFoundException|PointOutOfBoundsException/.test(hint.details ?? ""));
          throw new HikeRoutingError(noRoute ? "no-trail-route" : "hike-routing-unavailable");
        }
        const path = raw.paths?.[0];
        if (!path || !Number.isFinite(path.distance) || path.distance <= 0) throw new HikeRoutingError("no-trail-route");
        const outbound = coordinates(path.points?.coordinates);
        const geometry = request.hikeReturnToStart ? [...outbound, ...outbound.slice(0, -1).reverse()] : outbound;
        const snaps = coordinates(path.snapped_waypoints?.coordinates);
        if (snaps.length !== points.length) throw new HikeRoutingError("hike-routing-unavailable");
        const snapMeters = points.map((p, i) => haversine(p, snaps[i]!));
        if (snapMeters.some(m => m > 2001)) throw new HikeRoutingError("no-trail-route");
        let roadMeters: number | null = 0;
        const details: unknown = path.details?.road_class;
        let covered = 0;
        if (!Array.isArray(details)) roadMeters = null;
        else for (const entry of details) {
          if (!Array.isArray(entry) || !Number.isInteger(entry[0]) || !Number.isInteger(entry[1]) || entry[0] !== covered || entry[1] <= entry[0] || entry[1] >= outbound.length) { roadMeters = null; break; }
          const [start, end, roadClass] = entry as [number, number, string];
          covered = end;
          if (!TRAILS.has(roadClass) && !ROADS.has(roadClass)) { roadMeters = null; break; }
          if (ROADS.has(roadClass)) for (let i = start; i < end; i++) roadMeters += haversine(geometry[i]!, geometry[i + 1]!);
        }
        if (covered !== outbound.length - 1) roadMeters = null;
        if (request.hikeReturnToStart && roadMeters !== null) roadMeters *= 2;
        const line = hikeElevationLine(geometry);
        const dem = await (options.elevation ?? elevationSource).elevations(line, runSignal);
        const elevations = dem.availability === "available" && dem.elevationsMeters.length === line.length ? dem.elevationsMeters : line.map(() => null);
        const stats = computeHikeStats(line, elevations);
        const time = toblerTime(buildHikeProfile(line, elevations));
        if (runSignal.aborted) throw runSignal.reason;
        return { candidates: [{ providerId: "graphhopper-hike", profile: "hike", geometry, distanceMeters: path.distance * (request.hikeReturnToStart ? 2 : 1), durationSeconds: time.preciseMinutes * 60,
          hike: { gainMeters: stats.gainMeters, lossMeters: stats.lossMeters, elevationMeasuredShare: stats.elevation.measuredLengthShare, timeMethod: "Tobler", roadMeters, snapMeters },
        }] };
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (error instanceof HikeRoutingError) throw error;
        throw new HikeRoutingError("hike-routing-unavailable");
      }
    },
  };
}
