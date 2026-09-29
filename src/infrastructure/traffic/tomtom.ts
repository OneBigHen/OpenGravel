import type { Coordinate } from "@/domain/ride/types";
import {
  type TrafficProvider,
  type TrafficRequest,
  type TrafficResponse,
  type TrafficSegment,
  type TrafficSpeedClass,
} from "./traffic-provider";

/**
 * The rider-facing name of the traffic source.
 *
 * Provider identity is diagnostics-only (OGV-D-151): the adapter may know which
 * commercial flow service answered, but the rider is told what the value is, not
 * whose product produced it (VNX-007 / Rule E).
 */
const LIVE_TRAFFIC_PROVENANCE = "Live traffic feed";

/** TomTom Traffic API Flow Segment Data, service version 4. */
export const TOMTOM_TRAFFIC_BASE_URL = "https://api.tomtom.com";
export const TOMTOM_FLOW_SEGMENT_PATH = "/traffic/services/4/flowSegmentData";
export const TOMTOM_TRAFFIC_ZOOM = 10;
export const TOMTOM_CURRENT_DATA_WINDOW_MS = 15 * 60 * 1000;
export const TOMTOM_FLOW_FRESHNESS_WINDOW_MS = 60 * 1000;
export const TOMTOM_MAX_WAYPOINTS = 32;

type JsonRecord = Record<string, unknown>;

export interface TomTomTrafficProviderOptions {
  readonly apiKey?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetcher?: typeof fetch;
  readonly now?: () => string;
  readonly baseUrl?: string;
  readonly zoom?: number;
}

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validCoordinate(value: unknown): value is Coordinate {
  const candidate = record(value);
  return candidate !== null
    && finite(candidate["lon"])
    && finite(candidate["lat"])
    && candidate["lat"] >= -90
    && candidate["lat"] <= 90
    && candidate["lon"] >= -180
    && candidate["lon"] <= 180;
}

function copyCoordinate(value: Coordinate): Coordinate {
  return { lon: value.lon, lat: value.lat };
}

function unavailable(
  departureTime: string,
  departureApplicability: TrafficResponse["departureApplicability"],
  reason: string,
): TrafficResponse {
  return {
    availability: "unavailable",
    segments: [],
    freshness: {
      status: "unknown",
      fetchedAt: null,
      validUntil: null,
      departureTime,
    },
    departureApplicability,
    reason,
    provenance: LIVE_TRAFFIC_PROVENANCE,
    label: "Traffic unknown",
  };
}

function configuredApiKey(options: TomTomTrafficProviderOptions): string | null {
  const configured = options.apiKey
    ?? (options.env === undefined
      ? process.env["TOMTOM_TRAFFIC_API_KEY"] ?? process.env["TOMTOM_API_KEY"]
      : options.env["TOMTOM_TRAFFIC_API_KEY"] ?? options.env["TOMTOM_API_KEY"]);
  return typeof configured === "string" && configured.trim() !== ""
    ? configured.trim()
    : null;
}

function sampledWaypoints(request: TrafficRequest): readonly Coordinate[] {
  const source = request.waypoints === undefined || request.waypoints.length === 0
    ? request.corridor
    : request.waypoints;
  if (source.length <= TOMTOM_MAX_WAYPOINTS) return source.map(copyCoordinate);
  const last = source.length - 1;
  return Array.from({ length: TOMTOM_MAX_WAYPOINTS }, (_, index) =>
    copyCoordinate(source[Math.round((index * last) / (TOMTOM_MAX_WAYPOINTS - 1))]!),
  );
}

function departureApplicability(
  departureTime: string,
  now: string,
): TrafficResponse["departureApplicability"] {
  const departure = Date.parse(departureTime);
  const current = Date.parse(now);
  if (!Number.isFinite(departure) || !Number.isFinite(current)) return "unknown";
  const delta = departure - current;
  if (Math.abs(delta) <= TOMTOM_CURRENT_DATA_WINDOW_MS) return "current";
  return delta > 0 ? "future-unavailable" : "past-unavailable";
}

function segmentSpeedClass(
  currentSpeed: number | null,
  freeFlowSpeed: number | null,
  roadClosure: boolean | null,
): TrafficSpeedClass {
  if (roadClosure === true) return "closed";
  if (currentSpeed === null || freeFlowSpeed === null || freeFlowSpeed <= 0) return "unknown";
  const ratio = currentSpeed / freeFlowSpeed;
  if (ratio >= 0.9) return "free-flow";
  if (ratio >= 0.7) return "slow";
  return "congested";
}

function coordinateList(value: unknown): readonly Coordinate[] | null {
  const coordinates = record(value)?.["coordinate"];
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const parsed = coordinates.map((entry) => {
    const point = record(entry);
    if (point === null || !finite(point["latitude"]) || !finite(point["longitude"])) return null;
    const coordinate = { lat: point["latitude"], lon: point["longitude"] };
    return validCoordinate(coordinate) ? coordinate : null;
  });
  return parsed.every((entry): entry is Coordinate => entry !== null) ? parsed : null;
}

function parseSegment(value: unknown, fallbackPoint: Coordinate, observedAt: string): TrafficSegment | null {
  const root = record(value);
  const data = record(root?.["flowSegmentData"]);
  if (data === null) return null;
  const geometry = coordinateList(data["coordinates"]);
  if (geometry === null) return null;
  const currentSpeed = finite(data["currentSpeed"]) ? data["currentSpeed"] : null;
  const freeFlowSpeed = finite(data["freeFlowSpeed"]) ? data["freeFlowSpeed"] : null;
  const currentTravelTime = finite(data["currentTravelTime"]) ? data["currentTravelTime"] : null;
  const freeFlowTravelTime = finite(data["freeFlowTravelTime"]) ? data["freeFlowTravelTime"] : null;
  const confidence = finite(data["confidence"]) && data["confidence"] >= 0 && data["confidence"] <= 1
    ? data["confidence"]
    : null;
  const roadClosure = typeof data["roadClosure"] === "boolean" ? data["roadClosure"] : null;
  const openLr = typeof data["openlr"] === "string" && data["openlr"].trim() !== ""
    ? data["openlr"].trim()
    : null;
  return {
    id: openLr ?? `tomtom-flow:${fallbackPoint.lat}:${fallbackPoint.lon}`,
    geometry,
    speedClass: segmentSpeedClass(currentSpeed, freeFlowSpeed, roadClosure),
    delaySeconds: currentTravelTime === null || freeFlowTravelTime === null
      ? null
      : Math.max(0, currentTravelTime - freeFlowTravelTime),
    currentSpeed,
    freeFlowSpeed,
    confidence,
    roadClosure,
    observedAt,
  };
}

async function fetchSegment(
  point: Coordinate,
  apiKey: string,
  options: TomTomTrafficProviderOptions,
  request: TrafficRequest,
  observedAt: string,
): Promise<TrafficSegment | null> {
  const url = new URL(
    `${options.baseUrl ?? TOMTOM_TRAFFIC_BASE_URL}${TOMTOM_FLOW_SEGMENT_PATH}/absolute/${options.zoom ?? TOMTOM_TRAFFIC_ZOOM}/json`,
  );
  url.searchParams.set("key", apiKey);
  url.searchParams.set("point", `${point.lat},${point.lon}`);
  url.searchParams.set("unit", "mph");
  const response = await (options.fetcher ?? fetch)(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: request.signal,
  });
  if (!response.ok) return null;
  return parseSegment(await response.json(), point, observedAt);
}

export function createTomTomTrafficProvider(
  options: TomTomTrafficProviderOptions = {},
): TrafficProvider {
  return {
    id: "tomtom-traffic-flow",
    async getTraffic(request): Promise<TrafficResponse> {
      const now = (options.now ?? ((): string => new Date().toISOString()))();
      const departure = departureApplicability(request.departureTime, now);
      if (configuredApiKey(options) === null) {
        return unavailable(request.departureTime, "unknown", "Traffic data is not available right now.");
      }
      if (request.corridor.length < 2) {
        return unavailable(request.departureTime, "unknown", "Traffic needs a route corridor.");
      }
      if (departure !== "current") {
        return unavailable(
          request.departureTime,
          departure,
          "Traffic data covers current conditions only, not this departure time.",
        );
      }
      const apiKey = configuredApiKey(options)!;
      const segments: TrafficSegment[] = [];
      for (const point of sampledWaypoints(request)) {
        if (request.signal?.aborted) throw request.signal.reason;
        try {
          const segment = await fetchSegment(point, apiKey, options, request, now);
          if (segment !== null) segments.push(segment);
        } catch {
          if (request.signal?.aborted) throw request.signal.reason;
          // An optional provider outage is unknown, not a clear corridor.
        }
      }
      if (segments.length === 0) {
        return unavailable(request.departureTime, "current", "Traffic data is not available for this route right now.");
      }
      return {
        availability: "available",
        segments,
        freshness: {
          status: "fresh",
          fetchedAt: now,
          validUntil: new Date(Date.parse(now) + TOMTOM_FLOW_FRESHNESS_WINDOW_MS).toISOString(),
          departureTime: request.departureTime,
        },
        departureApplicability: "current",
        reason: null,
        provenance: LIVE_TRAFFIC_PROVENANCE,
        label: "Traffic available",
      };
    },
  };
}

export const createTomTomTrafficProviderFromEnv = createTomTomTrafficProvider;
