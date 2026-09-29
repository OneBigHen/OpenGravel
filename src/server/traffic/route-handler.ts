import { matchCorridor, type CorridorMatch } from "@/application/traffic";
import type { Coordinate } from "@/domain/ride/types";
import {
  createTomTomTrafficProvider,
  type TrafficProvider,
  type TrafficResponse,
} from "@/infrastructure/traffic";

export const MAX_ROUTE_TRAFFIC_POINTS = 128;

export interface RouteTrafficRequestBody {
  readonly corridor: readonly Coordinate[];
  readonly departureTime: string;
  readonly waypoints?: readonly Coordinate[];
}

export interface RouteTrafficResponseBody {
  readonly traffic: TrafficResponse;
  readonly corridorMatch: CorridorMatch;
}

export interface RouteTrafficErrorBody {
  readonly error: { readonly code: "validation"; readonly message: string };
}

export interface RouteTrafficHandlerDeps {
  readonly provider?: TrafficProvider;
}

export type RouteTrafficHandlerResult =
  | { readonly status: 200; readonly body: RouteTrafficResponseBody }
  | { readonly status: 400; readonly body: RouteTrafficErrorBody };

function coordinate(value: unknown): value is Coordinate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate["lon"] === "number"
    && Number.isFinite(candidate["lon"])
    && candidate["lon"] >= -180
    && candidate["lon"] <= 180
    && typeof candidate["lat"] === "number"
    && Number.isFinite(candidate["lat"])
    && candidate["lat"] >= -90
    && candidate["lat"] <= 90;
}

function validBody(value: unknown): value is RouteTrafficRequestBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const corridor = candidate["corridor"];
  const waypoints = candidate["waypoints"];
  return Array.isArray(corridor)
    && corridor.length >= 2
    && corridor.length <= MAX_ROUTE_TRAFFIC_POINTS
    && corridor.every(coordinate)
    && (waypoints === undefined
      || (Array.isArray(waypoints)
        && waypoints.length <= MAX_ROUTE_TRAFFIC_POINTS
        && waypoints.every(coordinate)))
    && typeof candidate["departureTime"] === "string"
    && Number.isFinite(Date.parse(candidate["departureTime"]));
}

function validationError(message: string): RouteTrafficHandlerResult {
  return { status: 400, body: { error: { code: "validation", message } } };
}

/** The optional provider boundary for `/api/route-traffic`. */
export async function handleRouteTrafficRequest(
  body: unknown,
  deps: RouteTrafficHandlerDeps = {},
  signal?: AbortSignal,
): Promise<RouteTrafficHandlerResult> {
  if (!validBody(body)) return validationError("The traffic request needs a bounded route corridor and departure time.");
  const provider = deps.provider ?? createTomTomTrafficProvider();
  try {
    const traffic = await provider.getTraffic({
      corridor: body.corridor,
      ...(body.waypoints === undefined ? {} : { waypoints: body.waypoints }),
      departureTime: body.departureTime,
      signal,
    });
    return {
      status: 200,
      body: { traffic, corridorMatch: matchCorridor(body.corridor, traffic) },
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    const unknown = await createTomTomTrafficProvider({ env: {} }).getTraffic({
      corridor: body.corridor,
      departureTime: body.departureTime,
    });
    return {
      status: 200,
      body: {
        traffic: { ...unknown, reason: "Traffic is unavailable right now." },
        corridorMatch: matchCorridor(body.corridor, unknown),
      },
    };
  }
}
