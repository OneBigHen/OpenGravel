import {
  opportunityFromInterestingPlace,
  opportunityFromNearbyPlace,
  rankRiderOpportunities,
  type RiderOpportunity,
} from "@/application/discover/rider-opportunities";
import type { RiderOpportunitiesBody } from "@/application/discover/rider-opportunities-contract";
import type { InterestingPlace, InterestingPlaceSource } from "@/application/discover";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { defaultPlacesSource } from "@/server/places/handler";
import { discoverSourcesFromEnv, handleDiscoverCorridor } from "@/server/discover/handler";

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_RADIUS_MILES = 100;
const MAX_RADIUS_MILES = 125;
const MAX_TILE_DEGREES = 1.45;
const MAX_TILES = 12;
const MAX_LINE_POINTS = 5_000;
const ROUTE_EVENT_BUFFER_MILES = 10;
const ROUTE_DISCOVER_BUFFER_METERS = 7_500;
const MILES_TO_METERS = 1609.344;

export interface RiderOpportunitiesDependencies {
  readonly env?: Env;
  readonly now?: () => number;
}

function finite(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boxAround(center: Coordinate, radiusMiles: number) {
  const meters = radiusMiles * MILES_TO_METERS;
  const latDegrees = meters / 111_320;
  const lonDegrees = meters / (111_320 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180)));
  return {
    west: center.lon - lonDegrees,
    south: center.lat - latDegrees,
    east: center.lon + lonDegrees,
    north: center.lat + latDegrees,
  };
}

function tilesFor(center: Coordinate, radiusMiles: number) {
  const box = boxAround(center, radiusMiles);
  const xCount = Math.ceil((box.east - box.west) / MAX_TILE_DEGREES);
  const yCount = Math.ceil((box.north - box.south) / MAX_TILE_DEGREES);
  if (xCount * yCount > MAX_TILES) return [];
  const width = (box.east - box.west) / xCount;
  const height = (box.north - box.south) / yCount;
  return Array.from({ length: xCount * yCount }, (_, index) => {
    const x = index % xCount;
    const y = Math.floor(index / xCount);
    return {
      west: box.west + x * width,
      south: box.south + y * height,
      east: box.west + (x + 1) * width,
      north: box.south + (y + 1) * height,
    };
  });
}

function uniquePlaces<T extends { readonly id: string }>(values: readonly T[]): readonly T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

async function broadOsm(
  env: Env,
  center: Coordinate,
  radiusMeters: number,
  signal: AbortSignal,
): Promise<{ readonly places: readonly InterestingPlace[]; readonly status: "ok" | "unavailable"; readonly reason: string | null }> {
  const source: InterestingPlaceSource | undefined = discoverSourcesFromEnv(env).find((candidate) => candidate.id === "osm");
  if (source === undefined) {
    return { places: [], status: "unavailable", reason: "The regional places index is not configured." };
  }
  const result = await source.search({ samples: [{ center, radiusMeters }] }, signal);
  return {
    places: result.places,
    status: result.status === "unavailable" ? "unavailable" : "ok",
    reason: result.reason,
  };
}

export async function handleRiderOpportunitiesNear(
  request: Request,
  dependencies: RiderOpportunitiesDependencies = {},
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return Response.json({ error: { code: "validation", message: "Malformed opportunity query." } }, { status: 400 });
  }
  const lat = finite(url.searchParams.get("lat"));
  const lon = finite(url.searchParams.get("lon"));
  const radiusMiles = finite(url.searchParams.get("radiusMiles")) ?? DEFAULT_RADIUS_MILES;
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return Response.json({ error: { code: "validation", message: "A valid latitude and longitude are required." } }, { status: 400 });
  }
  if (!(radiusMiles > 0) || radiusMiles > MAX_RADIUS_MILES) {
    return Response.json({ error: { code: "validation", message: `radiusMiles must be greater than 0 and at most ${MAX_RADIUS_MILES}.` } }, { status: 400 });
  }

  const env = dependencies.env ?? process.env;
  const nowMs = (dependencies.now ?? Date.now)();
  const now = new Date(nowMs).toISOString();
  const center = { lon, lat };
  const tiles = tilesFor(center, radiusMiles);
  if (tiles.length === 0) {
    return Response.json({ error: { code: "validation", message: "The requested rider-opportunity area is too large." } }, { status: 400 });
  }

  const placesSource = await defaultPlacesSource(env);
  const [placesResults, osm] = await Promise.all([
    placesSource === null
      ? Promise.resolve([])
      : Promise.all(tiles.map((extent) =>
          placesSource.inExtent(extent, { kinds: ["happy_hour", "event"], window: "week" }, request.signal))),
    broadOsm(env, center, radiusMiles * MILES_TO_METERS, request.signal),
  ]);

  const radiusMeters = radiusMiles * MILES_TO_METERS;
  const nearbyPlaces = placesResults.flatMap((answer) =>
    answer.availability === "available" ? answer.places : []);
  const withinRadius = uniquePlaces(nearbyPlaces).filter((place) => haversine(center, place.coordinate) <= radiusMeters);
  const staticPlaces = uniquePlaces(osm.places).filter((place) => haversine(center, place.coordinate) <= radiusMeters);

  const context = { now, center, routeAware: false } as const;
  const ranked = rankRiderOpportunities([
    ...withinRadius.map((place) => opportunityFromNearbyPlace(place, context)),
    ...staticPlaces.map((place) => opportunityFromInterestingPlace(place, context)),
  ], 9);

  const placesUnavailable = placesSource === null || placesResults.every((result) => result.availability !== "available");
  const body: RiderOpportunitiesBody = {
    generatedAt: now,
    mode: "near",
    opportunities: ranked,
    searchedRadiusMiles: radiusMiles,
    sources: [
      {
        id: "events.henning.rodeo",
        status: placesUnavailable ? "unavailable" : placesResults.some((result) => result.availability !== "available") ? "partial" : "ok",
        reason: placesSource === null
          ? "The events and places provider is not configured."
          : placesUnavailable
            ? "Events and places are unavailable right now."
            : placesResults.some((result) => result.availability !== "available")
              ? "Only part of the rider radius could be checked."
              : null,
      },
      {
        id: "osm-rider-places",
        status: osm.status,
        reason: osm.reason,
      },
    ],
  };
  return Response.json(body, { headers: { "cache-control": "private, no-store" } });
}

function routePoint(value: unknown): Coordinate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const lon = record["lon"];
  const lat = record["lat"];
  return typeof lon === "number" && Number.isFinite(lon) && lon >= -180 && lon <= 180
    && typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90
    ? { lon, lat }
    : null;
}

export async function handleRiderOpportunitiesRoute(
  request: Request,
  dependencies: RiderOpportunitiesDependencies = {},
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: "validation", message: "A JSON body is required." } }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: { code: "validation", message: "A JSON body is required." } }, { status: 400 });
  }
  const raw = (body as Record<string, unknown>)["line"];
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_LINE_POINTS) {
    return Response.json({ error: { code: "validation", message: `line must contain 2–${MAX_LINE_POINTS} points.` } }, { status: 400 });
  }
  const line = raw.map(routePoint);
  if (line.some((point) => point === null)) {
    return Response.json({ error: { code: "validation", message: "line contains an invalid coordinate." } }, { status: 400 });
  }
  const route = line as Coordinate[];
  const env = dependencies.env ?? process.env;
  const nowMs = (dependencies.now ?? Date.now)();
  const now = new Date(nowMs).toISOString();

  const placesSource = await defaultPlacesSource(env);
  const [placesAnswer, discoverAnswer] = await Promise.all([
    placesSource === null
      ? Promise.resolve(null)
      : placesSource.alongRoute(
          { line: route, bufferMiles: ROUTE_EVENT_BUFFER_MILES },
          { kinds: ["happy_hour", "event"], window: "week" },
          request.signal,
        ),
    handleDiscoverCorridor({
      line: route.map((point) => [point.lon, point.lat]),
      bufferMeters: ROUTE_DISCOVER_BUFFER_METERS,
      limit: 60,
    }, { env }, request.signal),
  ]);

  const nearby = placesAnswer?.availability === "available" ? placesAnswer.places : [];
  const discovered = discoverAnswer.status === 200 && "places" in discoverAnswer.body
    ? discoverAnswer.body.places
    : [];
  const context = { now, routeAware: true } as const;
  const opportunities: RiderOpportunity[] = [
    ...uniquePlaces(nearby).map((place) => opportunityFromNearbyPlace(place, context)),
    ...uniquePlaces(discovered).map((place) => opportunityFromInterestingPlace(place, context)),
  ];

  const bodyOut: RiderOpportunitiesBody = {
    generatedAt: now,
    mode: "route",
    opportunities: rankRiderOpportunities(opportunities, 9),
    searchedRadiusMiles: null,
    sources: [
      {
        id: "events.henning.rodeo",
        status: placesSource === null || placesAnswer === null || placesAnswer.availability === "unavailable" ? "unavailable" : "ok",
        reason: placesSource === null
          ? "The events and places provider is not configured."
          : placesAnswer?.availability === "unavailable"
            ? placesAnswer.reason
            : null,
      },
      {
        id: "discover",
        status: discoverAnswer.status === 200 ? "ok" : "unavailable",
        reason: discoverAnswer.status === 200 ? null : "Route-side places are unavailable right now.",
      },
    ],
  };
  return Response.json(bodyOut, { headers: { "cache-control": "private, no-store" } });
}
