/**
 * `/api/places` and `/api/places/along`: the privacy and key boundary for the
 * places overlay.
 *
 * - The provider key lives only here (`OGV_PLACES_API_KEY`); the browser never
 *   sees it.
 * - Requests are validated before anything leaves the server, and upstream text
 *   never reaches the rider.
 * - Viewport answers are cached for a minute per (extent, query), so riders
 *   panning the same area cost the provider one call.
 * - `OGV_PLACES_FIXTURE=1` answers from `tests/fixtures/places/` for CI and
 *   browser gates, the same way weather and route-plan fixtures work.
 * - With no provider configured, the answer is an honest `unavailable` (HTTP
 *   200, the state is in the body), never an empty "nothing nearby".
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  MAX_PLACE_EXTENT_DEGREES,
  type PlaceExtent,
  type PlaceKind,
  type PlaceQuery,
  type PlacesResult,
  type PlacesSource,
  type PlaceWindow,
} from "@/application/places";
import type { Coordinate } from "@/domain/ride/types";
import { createPlacesApiSource, parsePlacesCollection } from "@/infrastructure/places";

export const PLACES_CACHE_TTL_MS = 60_000;
export const PLACES_CACHE_MAX_ENTRIES = 256;
export const MAX_ALONG_REQUEST_POINTS = 5000;

const KINDS: readonly PlaceKind[] = ["happy_hour", "event"];
const WINDOWS: readonly PlaceWindow[] = ["now", "today", "week"];

export interface PlacesHandlerDeps {
  readonly source?: PlacesSource | null;
  readonly now?: () => number;
}

export interface PlacesHandlerResult {
  readonly status: number;
  readonly body: PlacesResult | { readonly error: { readonly code: "validation"; readonly message: string } };
}

const cache = new Map<string, { readonly result: PlacesResult; readonly expiresAt: number }>();

export function clearPlacesCache(): void {
  cache.clear();
}

function validation(message: string): PlacesHandlerResult {
  return { status: 400, body: { error: { code: "validation", message } } };
}

function notConfigured(): PlacesHandlerResult {
  return {
    status: 200,
    body: { availability: "unavailable", places: [], reason: "Places are not set up on this server.", retryable: false },
  };
}

function parseKinds(raw: unknown): readonly PlaceKind[] | null {
  const list = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : ["happy_hour", "event"];
  const kinds = list.map((k) => (typeof k === "string" ? k.trim() : "")).filter((k) => k !== "");
  if (kinds.length === 0 || !kinds.every((k) => KINDS.includes(k as PlaceKind))) return null;
  return [...new Set(kinds)] as PlaceKind[];
}

function parseWindow(raw: unknown): PlaceWindow | null {
  if (raw === undefined || raw === null || raw === "") return "today";
  return WINDOWS.includes(raw as PlaceWindow) ? (raw as PlaceWindow) : null;
}

export function parseExtent(raw: string | null): PlaceExtent | string {
  if (raw === null) return "bbox is required (west,south,east,north).";
  const parts = raw.split(",").map((p) => Number(p));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return "bbox must be four numbers: west,south,east,north.";
  const [west, south, east, north] = parts as [number, number, number, number];
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    return "bbox is out of range or inverted.";
  }
  if (east - west > MAX_PLACE_EXTENT_DEGREES || north - south > MAX_PLACE_EXTENT_DEGREES) {
    return "bbox is too large; zoom in.";
  }
  return { west, south, east, north };
}

function coordinate(value: unknown): value is Coordinate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  const lon = c["lon"];
  const lat = c["lat"];
  return typeof lon === "number" && Number.isFinite(lon) && lon >= -180 && lon <= 180
    && typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

async function fixtureSource(): Promise<PlacesSource> {
  const file = path.join(process.cwd(), "tests", "fixtures", "places", "sample-places.json");
  const parsed = parsePlacesCollection(JSON.parse(await readFile(file, "utf8")) as unknown);
  const answer = (keep: (c: Coordinate) => boolean): PlacesResult => ({
    availability: "available",
    places: parsed.places.filter((p) => keep(p.coordinate)),
    fetchedAt: parsed.fetchedAt,
    attribution: `${parsed.attribution} (fixture)`,
  });
  return {
    id: "fixture",
    inExtent: async (e) => answer((c) => c.lon >= e.west && c.lon <= e.east && c.lat >= e.south && c.lat <= e.north),
    alongRoute: async () => answer(() => true),
  };
}

/** The configured source: fixture, places-api, or `null` when nothing is set up. */
export async function defaultPlacesSource(env: Readonly<Record<string, string | undefined>> = process.env): Promise<PlacesSource | null> {
  if (env["OGV_PLACES_FIXTURE"] === "1") return fixtureSource();
  const baseUrl = env["OGV_PLACES_API_URL"];
  const apiKey = env["OGV_PLACES_API_KEY"];
  if (!baseUrl || !apiKey) return null;
  return createPlacesApiSource({ baseUrl, apiKey });
}

async function resolveSource(deps: PlacesHandlerDeps): Promise<PlacesSource | null> {
  return deps.source === undefined ? defaultPlacesSource() : deps.source;
}

/**
 * An unavailable answer is still an answer: the honest state lives in the body
 * (`availability: "unavailable"`, `reason`, `retryable`), so the route answers
 * 200 and a browser never logs a failed resource for a provider that is merely
 * down or not set up. Only a malformed request is an HTTP error (400).
 */
const ANSWERED = 200;

export async function handlePlacesExtentRequest(
  url: URL,
  deps: PlacesHandlerDeps = {},
  signal?: AbortSignal,
): Promise<PlacesHandlerResult> {
  const extent = parseExtent(url.searchParams.get("bbox"));
  if (typeof extent === "string") return validation(extent);
  const kinds = parseKinds(url.searchParams.get("kinds") ?? undefined);
  if (kinds === null) return validation("kinds must be happy_hour and/or event.");
  const window = parseWindow(url.searchParams.get("when"));
  if (window === null) return validation("when must be now, today or week.");
  const source = await resolveSource(deps);
  if (source === null) return notConfigured();

  const query: PlaceQuery = { kinds, window };
  const now = deps.now ?? Date.now;
  const key = `${source.id}|${extent.west},${extent.south},${extent.east},${extent.north}|${[...kinds].sort().join(",")}|${window}`;
  const hit = cache.get(key);
  if (hit !== undefined && hit.expiresAt > now()) return { status: 200, body: hit.result };

  const result = await source.inExtent(extent, query, signal);
  if (result.availability === "available") {
    cache.set(key, { result, expiresAt: now() + PLACES_CACHE_TTL_MS });
    while (cache.size > PLACES_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  return { status: ANSWERED, body: result };
}

export async function handlePlacesAlongRequest(
  body: unknown,
  deps: PlacesHandlerDeps = {},
  signal?: AbortSignal,
): Promise<PlacesHandlerResult> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return validation("JSON body expected.");
  const candidate = body as Record<string, unknown>;
  const line = candidate["line"];
  if (!Array.isArray(line) || line.length < 2 || line.length > MAX_ALONG_REQUEST_POINTS || !line.every(coordinate)) {
    return validation(`line must be 2–${MAX_ALONG_REQUEST_POINTS} {lon, lat} points.`);
  }
  const buffer = candidate["bufferMiles"] ?? 1;
  if (typeof buffer !== "number" || !Number.isFinite(buffer) || buffer <= 0 || buffer > 10) {
    return validation("bufferMiles must be between 0 and 10.");
  }
  const kinds = parseKinds(candidate["kinds"]);
  if (kinds === null) return validation("kinds must be happy_hour and/or event.");
  const window = parseWindow(candidate["window"]);
  if (window === null) return validation("window must be now, today or week.");
  const source = await resolveSource(deps);
  if (source === null) return notConfigured();
  const result = await source.alongRoute({ line, bufferMiles: buffer }, { kinds, window }, signal);
  return { status: ANSWERED, body: result };
}
