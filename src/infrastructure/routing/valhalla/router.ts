/**
 * Basic motorcycle routing outside OpenGravel's own graph, through a Valhalla
 * `/route` service.
 *
 * GraphHopper stays the routing authority wherever its graph reaches. This
 * adapter is only asked for rides that leave that graph (or when our router is
 * down), and every answer it gives is a plain line plus turn-by-turn: no surface
 * mix, no closure or access check, no score. Those stay unknown.
 *
 * Upstream choice, in order:
 * 1. Stadia Maps (hosted Valhalla) when `STADIA_API_KEY` is set.
 * 2. The FOSSGIS public server, identified as "OpenGravel-personal" and paced to
 *    one request a second across the whole server process, as its usage policy
 *    asks.
 *
 * A busy, failing or unreachable upstream is a clear rider error. Geometry is
 * never invented.
 */

import type { ProviderInstruction, ProviderRouteRequest } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";

import { valhallaCostingOptions } from "./costing";
import { createIntervalLimiter, LimiterBusyError, type IntervalLimiter } from "./limiter";

export type ValhallaUpstreamId = "stadia" | "fossgis";

export const STADIA_ROUTE_URL = "https://api.stadiamaps.com/route/v1";
export const FOSSGIS_ROUTE_URL = "https://valhalla1.openstreetmap.de/route";
/** How OpenGravel names itself to the public server. */
export const VALHALLA_CLIENT_ID = "OpenGravel-personal";
const USER_AGENT = `${VALHALLA_CLIENT_ID} (OpenGravel motorcycle planner; https://github.com/OneBigHen/OpenGravel)`;

/** Valhalla's default per-request location ceiling. */
export const MAX_VALHALLA_LOCATIONS = 20;
const REQUEST_TIMEOUT_MS = 20_000;
/** Identical questions inside this window share one upstream answer. */
const SHARED_ANSWER_MS = 60_000;
const MAX_SHARED_ANSWERS = 32;

/** One request a second for the whole process (FOSSGIS usage policy). */
const FOSSGIS_LIMITER = createIntervalLimiter({ intervalMs: 1_000, maxWaitMs: 10_000 });

export type ValhallaErrorCode = "no-route" | "provider-unavailable" | "provider-timeout";

/** A failure in rider copy; the upstream's own text never reaches a rider. */
export class ValhallaRoutingError extends Error {
  readonly code: ValhallaErrorCode;
  readonly recoverable: boolean;
  constructor(code: ValhallaErrorCode, message: string, recoverable: boolean) {
    super(message);
    this.name = "ValhallaRoutingError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export const VALHALLA_COPY = {
  busy: "The basic route service is busy right now. Wait a minute and try again.",
  unreachable: "The basic route service could not be reached. Try again in a few minutes.",
  timeout: "The basic route service did not answer in time. Try again in a minute.",
  noRoute: "No basic route was found between these points. Try moving a point onto a nearby road.",
  tooLong: "This ride is too long for a basic route. Add a stop part way and try again.",
} as const;

export interface BasicRoute {
  readonly geometry: readonly Coordinate[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly instructions: readonly ProviderInstruction[];
}

export interface ValhallaUpstream {
  readonly id: ValhallaUpstreamId;
  /** The address to call. For Stadia it carries the key, so it is never logged. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export function valhallaUpstreamFromEnv(env: Readonly<Record<string, string | undefined>>): ValhallaUpstream {
  const key = env["STADIA_API_KEY"]?.trim() ?? "";
  if (key !== "") {
    return {
      id: "stadia",
      url: `${STADIA_ROUTE_URL}?api_key=${encodeURIComponent(key)}`,
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
    };
  }
  return {
    id: "fossgis",
    url: FOSSGIS_ROUTE_URL,
    headers: { "content-type": "application/json", "user-agent": USER_AGENT, "x-client-id": VALHALLA_CLIENT_ID },
  };
}

export interface ValhallaRouter {
  readonly upstream: ValhallaUpstreamId;
  route(request: ProviderRouteRequest, signal: AbortSignal): Promise<BasicRoute>;
}

interface Location {
  readonly lon: number;
  readonly lat: number;
  readonly type: "break" | "through";
  readonly heading?: number;
  readonly heading_tolerance?: number;
}

/** Evenly keeps `count` of `points`, always including the first and the last. */
function sample<T>(points: readonly T[], count: number): readonly T[] {
  if (points.length <= count) return points;
  if (count <= 0) return [];
  if (count === 1) return [points[Math.floor(points.length / 2)]!];
  return Array.from({ length: count }, (_, at) => points[Math.round((at * (points.length - 1)) / (count - 1))]!);
}

/**
 * The Valhalla `/route` body for one ride. Point order follows the GraphHopper
 * builder: origin, stops, shaping, sketch anchors, destination. Stops are legs;
 * shaping and sketch points are pass-through and are thinned to fit the
 * location ceiling.
 */
export function valhallaRouteBody(request: ProviderRouteRequest): Record<string, unknown> {
  const through = [...request.shaping, ...(request.sketch?.anchors ?? [])];
  const room = Math.max(0, MAX_VALHALLA_LOCATIONS - 2 - request.stops.length);
  const origin: Location = {
    lon: request.origin.lon,
    lat: request.origin.lat,
    type: "break",
    ...(request.originHeadingDegrees === undefined ? {} : { heading: Math.round(request.originHeadingDegrees), heading_tolerance: 45 }),
  };
  const locations: Location[] = [
    origin,
    ...request.stops.map((stop): Location => ({ lon: stop.lon, lat: stop.lat, type: "break" })),
    ...sample(through, room).map((point): Location => ({ lon: point.lon, lat: point.lat, type: "through" })),
    { lon: request.destination.lon, lat: request.destination.lat, type: "break" },
  ];
  return {
    locations,
    costing: "motorcycle",
    costing_options: { motorcycle: valhallaCostingOptions(request.options) },
    units: "kilometers",
    language: "en-US",
    directions_type: "instructions",
    ...(request.avoidPolygons.length === 0
      ? {}
      : { exclude_polygons: request.avoidPolygons.map((ring) => ring.map((point) => [point.lon, point.lat])) }),
  };
}

/** Decodes a polyline at six decimals (Valhalla's `shape`). */
export function decodePolyline6(encoded: string): Coordinate[] {
  const points: Coordinate[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error("truncated polyline");
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push({ lat: lat / 1e6, lon: lon / 1e6 });
  }
  return points;
}

interface ValhallaManeuver {
  readonly type?: number;
  readonly instruction?: string;
  readonly length?: number;
  readonly time?: number;
  readonly begin_shape_index?: number;
  readonly street_names?: readonly string[];
  readonly roundabout_exit_count?: number;
}

interface ValhallaLeg {
  readonly shape?: string;
  readonly maneuvers?: readonly ValhallaManeuver[];
}

interface ValhallaTrip {
  readonly legs?: readonly ValhallaLeg[];
  readonly summary?: { readonly length?: number; readonly time?: number };
}

/** Valhalla maneuver types as OpenGravel's instruction kinds. */
function instructionKind(type: number | undefined, lastLeg: boolean): Pick<ProviderInstruction, "type" | "maneuver"> {
  switch (type) {
    case 4: case 5: case 6: return { type: lastLeg ? "finish" : "via" };
    case 7: case 8: case 17: case 22: case 25: case 37: case 38: return { type: "continue", maneuver: "straight" };
    case 9: case 18: case 20: return { type: "turn", maneuver: "slight-right" };
    case 10: case 11: return { type: "turn", maneuver: "right" };
    case 12: case 13: return { type: "turn", maneuver: "uturn" };
    case 14: case 15: return { type: "turn", maneuver: "left" };
    case 16: case 19: case 21: return { type: "turn", maneuver: "slight-left" };
    case 23: return { type: "keep-right", maneuver: "slight-right" };
    case 24: return { type: "keep-left", maneuver: "slight-left" };
    case 26: return { type: "roundabout" };
    default: return { type: "continue" };
  }
}

/** One continuous line and its maneuvers from the trip's legs. */
export function parseValhallaTrip(trip: ValhallaTrip): BasicRoute | null {
  const legs = trip.legs ?? [];
  const raw: Coordinate[] = [];
  const rawInstructions: { readonly maneuver: ValhallaManeuver; readonly offset: number; readonly lastLeg: boolean }[] = [];
  legs.forEach((leg, legIndex) => {
    const shape = decodePolyline6(leg.shape ?? "");
    const offset = raw.length;
    raw.push(...shape);
    const lastLeg = legIndex === legs.length - 1;
    for (const maneuver of leg.maneuvers ?? []) {
      // A leg's own arrival is a via point for the rider; its next leg's
      // departure repeats it and is dropped.
      if (legIndex > 0 && (maneuver.type === 1 || maneuver.type === 2 || maneuver.type === 3)) continue;
      rawInstructions.push({ maneuver, offset, lastLeg });
    }
  });
  // Joined legs repeat their shared point; a repeated point is not a rideable step.
  const geometry: Coordinate[] = [];
  const indexMap: number[] = [];
  for (const point of raw) {
    const last = geometry.at(-1);
    if (last === undefined || last.lon !== point.lon || last.lat !== point.lat) geometry.push(point);
    indexMap.push(geometry.length - 1);
  }
  if (geometry.length < 2) return null;
  const instructions = rawInstructions.map(({ maneuver, offset, lastLeg }): ProviderInstruction => {
    const begin = maneuver.begin_shape_index;
    const geometryIndex = begin === undefined ? undefined : indexMap[offset + begin];
    const exits = maneuver.roundabout_exit_count;
    const roadName = maneuver.street_names?.[0];
    return {
      text: maneuver.instruction ?? "",
      distanceMeters: Math.round((maneuver.length ?? 0) * 1000),
      durationSeconds: maneuver.time ?? 0,
      ...instructionKind(maneuver.type, lastLeg),
      ...(roadName === undefined ? {} : { roadName }),
      ...(geometryIndex === undefined ? {} : { geometryIndex }),
      ...(maneuver.type === 26 && exits !== undefined && Number.isInteger(exits) && exits >= 1 && exits <= 20 ? { exitNumber: exits } : {}),
    };
  });
  return {
    geometry,
    distanceMeters: Math.round((trip.summary?.length ?? 0) * 1000),
    durationSeconds: Math.round(trip.summary?.time ?? 0),
    instructions,
  };
}

/** Valhalla error codes that mean "answered: there is no such ride". */
function refusal(body: unknown): ValhallaRoutingError | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { readonly error_code?: unknown }).error_code;
  const text = (body as { readonly error?: unknown }).error;
  if (typeof code !== "number") return null;
  if (typeof text === "string" && /exceed/i.test(text)) return new ValhallaRoutingError("no-route", VALHALLA_COPY.tooLong, false);
  // 17x: no road near a point / unconnected regions; 44x: no path.
  if ((code >= 170 && code < 180) || (code >= 440 && code < 450)) return new ValhallaRoutingError("no-route", VALHALLA_COPY.noRoute, false);
  return null;
}

export function createValhallaRouter(options: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetcher?: typeof fetch;
  /** Overrides the process-wide FOSSGIS pacing (tests). */
  readonly limiter?: IntervalLimiter | null;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}): ValhallaRouter {
  const upstream = valhallaUpstreamFromEnv(options.env);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const limiter = options.limiter !== undefined ? options.limiter : upstream.id === "fossgis" ? FOSSGIS_LIMITER : null;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const shared = new Map<string, { readonly at: number; readonly answer: Promise<BasicRoute> }>();

  const ask = async (body: string, signal: AbortSignal): Promise<BasicRoute> => {
    try {
      await limiter?.acquire(signal);
    } catch (error) {
      if (error instanceof LimiterBusyError) throw new ValhallaRoutingError("provider-unavailable", VALHALLA_COPY.busy, true);
      throw error;
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetcher(upstream.url, {
        method: "POST",
        headers: upstream.headers,
        body,
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (timeout.aborted) throw new ValhallaRoutingError("provider-timeout", VALHALLA_COPY.timeout, true);
      void error;
      throw new ValhallaRoutingError("provider-unavailable", VALHALLA_COPY.unreachable, true);
    }
    if (response.status === 429) throw new ValhallaRoutingError("provider-unavailable", VALHALLA_COPY.busy, true);
    const parsed: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const refused = response.status < 500 ? refusal(parsed) : null;
      throw refused ?? new ValhallaRoutingError("provider-unavailable", VALHALLA_COPY.unreachable, true);
    }
    const trip = (parsed as { readonly trip?: ValhallaTrip } | null)?.trip;
    let route: BasicRoute | null = null;
    try {
      route = trip === undefined ? null : parseValhallaTrip(trip);
    } catch {
      route = null;
    }
    if (route === null) throw new ValhallaRoutingError("provider-unavailable", VALHALLA_COPY.unreachable, true);
    return route;
  };

  return {
    upstream: upstream.id,
    async route(request: ProviderRouteRequest, signal: AbortSignal): Promise<BasicRoute> {
      const body = JSON.stringify(valhallaRouteBody(request));
      const time = now();
      for (const [key, entry] of shared) if (time - entry.at > SHARED_ANSWER_MS) shared.delete(key);
      let entry = shared.get(body);
      if (entry === undefined) {
        if (shared.size >= MAX_SHARED_ANSWERS) shared.delete(shared.keys().next().value!);
        // The shared call is not tied to one caller's cancellation.
        entry = { at: time, answer: ask(body, new AbortController().signal) };
        shared.set(body, entry);
        entry.answer.catch(() => shared.delete(body));
      }
      return await abortable(entry.answer, signal);
    },
  };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}
