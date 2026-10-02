import { buildRoadOpeningCalendar, type RoadOpeningEvent, type UndatedSeasonalRoad } from "@/application/route-intelligence/opening-calendar";
import type {
  RoadOpeningsBody,
  RoadOpeningsUnavailableBody,
  RoadOpeningSummary,
  UndatedSeasonalRoadSummary,
} from "@/application/route-intelligence/opening-calendar-contract";
import type { RoadAuthorityCoordinator } from "@/application/route-intelligence/coordinator";
import type { BoundingBox, RoadAuthorityGeometry } from "@/application/route-intelligence/types";
import { roadAuthorityFromEnv } from "@/server/planning/road-authority";

const MAX_RADIUS_MILES = 150;
const MAX_DAYS = 180;
const MAX_EVENTS = 400;
const MAX_UNDATED = 250;
const MILES_TO_METERS = 1609.344;

export interface RoadOpeningsDependencies {
  readonly coordinator?: RoadAuthorityCoordinator | null;
  readonly now?: () => number;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function finite(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function anchor(geometry: RoadAuthorityGeometry): readonly [number, number] | null {
  if (geometry.type === "point") return [geometry.coordinate.lon, geometry.coordinate.lat];
  if (geometry.coordinates.length === 0) return null;
  const point = geometry.coordinates[Math.floor(geometry.coordinates.length / 2)];
  return point === undefined ? null : [point.lon, point.lat];
}

function summarize(event: RoadOpeningEvent): RoadOpeningSummary {
  return {
    id: event.id,
    sourceId: event.sourceId,
    roadName: event.roadName,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    certainty: event.certainty,
    anchor: anchor(event.geometry),
  };
}

function summarizeUndated(road: UndatedSeasonalRoad): UndatedSeasonalRoadSummary {
  return {
    id: road.id,
    sourceId: road.sourceId,
    roadName: road.roadName,
    description: road.description,
    anchor: anchor(road.geometry),
  };
}

function boxAround(lat: number, lon: number, radiusMiles: number): BoundingBox {
  const meters = radiusMiles * MILES_TO_METERS;
  const latDegrees = meters / 111_320;
  const lonDegrees = meters / (111_320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return {
    west: lon - lonDegrees,
    south: lat - latDegrees,
    east: lon + lonDegrees,
    north: lat + latDegrees,
  };
}

export async function handleRoadOpeningsRequest(
  request: Request,
  dependencies: RoadOpeningsDependencies = {},
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return Response.json({ unavailable: true, reason: "Road-opening query is malformed." } satisfies RoadOpeningsUnavailableBody, { status: 400 });
  }

  const lat = finite(url.searchParams.get("lat"));
  const lon = finite(url.searchParams.get("lon"));
  const radius = finite(url.searchParams.get("radiusMiles")) ?? 75;
  const days = finite(url.searchParams.get("days")) ?? 90;
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return Response.json({ unavailable: true, reason: "A valid latitude and longitude are required." } satisfies RoadOpeningsUnavailableBody, { status: 400 });
  }
  if (!(radius > 0) || radius > MAX_RADIUS_MILES || !(days > 0) || days > MAX_DAYS) {
    return Response.json({
      unavailable: true,
      reason: `Use a radius up to ${MAX_RADIUS_MILES} miles and a horizon up to ${MAX_DAYS} days.`,
    } satisfies RoadOpeningsUnavailableBody, { status: 400 });
  }

  const now = dependencies.now ?? Date.now;
  const generatedAt = new Date(now()).toISOString();
  const to = new Date(now() + days * 24 * 3_600_000).toISOString();
  const coordinator = dependencies.coordinator
    ?? roadAuthorityFromEnv(dependencies.env ?? process.env);
  if (coordinator === null) {
    return Response.json({
      unavailable: true,
      reason: "Road-opening intelligence is not enabled on this deployment.",
    } satisfies RoadOpeningsUnavailableBody, {
      status: 503,
      headers: { "cache-control": "private, no-store" },
    });
  }

  const assessment = await coordinator.assess(boxAround(lat, lon, radius), request.signal);
  const records = assessment.sources.flatMap((source) => source.snapshot.records);
  const calendar = buildRoadOpeningCalendar(records, { from: generatedAt, to });
  const truncated = calendar.events.length > MAX_EVENTS || calendar.undated.length > MAX_UNDATED;
  const body: RoadOpeningsBody = {
    generatedAt,
    from: calendar.from,
    to: calendar.to,
    events: calendar.events.slice(0, MAX_EVENTS).map(summarize),
    undated: calendar.undated.slice(0, MAX_UNDATED).map(summarizeUndated),
    truncated,
    sources: assessment.sources
      .filter((source) => source.info.facet === "access")
      .map((source) => ({
        id: source.info.id,
        label: source.info.label,
        status: source.snapshot.status,
        reason: source.snapshot.reason,
      })),
  };
  return Response.json(body, { headers: { "cache-control": "private, no-store" } });
}
