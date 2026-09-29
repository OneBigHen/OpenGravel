/**
 * `/api/discover`: interesting places near a point, along a route, or around
 * a destination. Server-side only: the browser never calls a provider and
 * never sends its continuous GPS anywhere but here; the server asks each
 * provider a few bounded, cached questions.
 *
 * - GET  ?lat=&lon=[&radius=][&kind=near|destination][&categories=a,b][&limit=]
 * - POST { line: [[lon,lat],…], bufferMeters?, categories?, limit? }
 *
 * Sources: the OSM index when `OGV_DISCOVER_OSM_PLACES` points at a built
 * `osm-places.json`, and Wikimedia (no key; `WIKIMEDIA_USER_AGENT`).
 * An unavailable source is reported per source; the answer is still 200.
 */

import { readFile } from "node:fs/promises";

import {
  createDiscoverCoordinator,
  DISCOVER_CATEGORIES,
  MAX_CORRIDOR_BUFFER_METERS,
  MAX_LIMIT,
  type DiscoverCategory,
  type DiscoverCoordinator,
  type DiscoverQuery,
  type DiscoverResult,
  type InterestingPlaceSource,
} from "@/application/discover";
import type { Coordinate } from "@/domain/ride/types";
import { createOsmPlacesSource, type OsmPlacesIndex } from "@/infrastructure/discover/osm-places-source";
import { createWikimediaSource } from "@/infrastructure/discover/wikimedia-source";

type Env = Readonly<Record<string, string | undefined>>;

export const MAX_NEAR_RADIUS_METERS = 25_000;
export const DEFAULT_NEAR_RADIUS_METERS = 8_000;
export const MAX_LINE_POINTS = 5_000;
const CACHE_TTL_MS = 5 * 60_000;

export interface DiscoverHandlerResult {
  readonly status: number;
  readonly body: DiscoverResult | { readonly error: { readonly code: "validation"; readonly message: string } };
}

function validation(message: string): DiscoverHandlerResult {
  return { status: 400, body: { error: { code: "validation", message } } };
}

function coordinate(lon: unknown, lat: unknown): Coordinate | null {
  const x = typeof lon === "string" ? Number(lon) : lon;
  const y = typeof lat === "string" ? Number(lat) : lat;
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) &&
    Math.abs(x) <= 180 && Math.abs(y) <= 90 ? { lon: x, lat: y } : null;
}

function categoriesOf(raw: unknown): readonly DiscoverCategory[] | null {
  if (raw === undefined || raw === null || raw === "") return [];
  const list = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : null;
  if (list === null) return null;
  const values = list.map((value) => (typeof value === "string" ? value.trim() : ""));
  return values.every((value) => (DISCOVER_CATEGORIES as readonly string[]).includes(value))
    ? [...new Set(values)] as DiscoverCategory[]
    : null;
}

function limitOf(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return 30;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT ? value : null;
}

export function discoverSourcesFromEnv(env: Env): readonly InterestingPlaceSource[] {
  const sources: InterestingPlaceSource[] = [];
  const osmPath = env["OGV_DISCOVER_OSM_PLACES"]?.trim();
  if (osmPath !== undefined && osmPath !== "") {
    sources.push(createOsmPlacesSource({
      load: async () => {
        try {
          return JSON.parse(await readFile(osmPath, "utf8")) as OsmPlacesIndex;
        } catch {
          return null;
        }
      },
    }));
  }
  sources.push(wikimedia(env));
  return sources;
}

let wikimediaShared: { readonly key: string; readonly source: ReturnType<typeof createWikimediaSource> } | null = null;
function wikimedia(env: Env): ReturnType<typeof createWikimediaSource> {
  const userAgent = env["WIKIMEDIA_USER_AGENT"]?.trim() || "OpenGravel/0.1 (https://github.com/OneBigHen/OpenGravel)";
  if (wikimediaShared?.key !== userAgent) wikimediaShared = { key: userAgent, source: createWikimediaSource({ userAgent }) };
  return wikimediaShared.source;
}

let shared: { readonly key: string; readonly coordinator: DiscoverCoordinator } | null = null;
function coordinatorFromEnv(env: Env): DiscoverCoordinator {
  const key = `${env["OGV_DISCOVER_OSM_PLACES"] ?? ""}|${env["WIKIMEDIA_USER_AGENT"] ?? ""}`;
  if (shared?.key !== key) {
    shared = { key, coordinator: createDiscoverCoordinator({ sources: discoverSourcesFromEnv(env), enrichers: [wikimedia(env)] }) };
  }
  return shared.coordinator;
}

const cache = new Map<string, { readonly result: DiscoverResult; readonly expiresAt: number }>();
export function clearDiscoverCache(): void {
  cache.clear();
}

export interface DiscoverHandlerDeps {
  readonly coordinator?: DiscoverCoordinator;
  readonly env?: Env;
  readonly now?: () => number;
}

async function answer(
  query: DiscoverQuery,
  categories: readonly DiscoverCategory[],
  limit: number,
  cacheKey: string,
  deps: DiscoverHandlerDeps,
  signal: AbortSignal,
): Promise<DiscoverHandlerResult> {
  const now = deps.now ?? Date.now;
  const hit = cache.get(cacheKey);
  if (hit !== undefined && hit.expiresAt > now()) return { status: 200, body: hit.result };
  const coordinator = deps.coordinator ?? coordinatorFromEnv(deps.env ?? process.env);
  const result = await coordinator.discover({ query, ...(categories.length === 0 ? {} : { categories }), limit }, signal);
  // Only a complete answer is worth reusing; an outage should retry soon.
  if (result.sources.every((source) => source.status === "ok")) {
    cache.set(cacheKey, { result, expiresAt: now() + CACHE_TTL_MS });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
  }
  return { status: 200, body: result };
}

export async function handleDiscoverNear(url: URL, deps: DiscoverHandlerDeps, signal: AbortSignal): Promise<DiscoverHandlerResult> {
  const center = coordinate(url.searchParams.get("lon"), url.searchParams.get("lat"));
  if (center === null) return validation("lat and lon are required.");
  const radiusText = url.searchParams.get("radius");
  const radius = radiusText === null ? DEFAULT_NEAR_RADIUS_METERS : Number(radiusText);
  if (!Number.isFinite(radius) || radius < 100 || radius > MAX_NEAR_RADIUS_METERS) return validation("radius must be 100–25000 metres.");
  const kind = url.searchParams.get("kind") ?? "near";
  if (kind !== "near" && kind !== "destination") return validation("kind must be near or destination.");
  const categories = categoriesOf(url.searchParams.get("categories"));
  if (categories === null) return validation("Unknown category.");
  const limit = limitOf(url.searchParams.get("limit"));
  if (limit === null) return validation(`limit must be 1–${MAX_LIMIT}.`);
  // Rounded to ~100 m: nearby riders share an answer, and the cache key holds no precise position.
  const key = `near:${kind}:${center.lat.toFixed(3)},${center.lon.toFixed(3)}:${radius}:${categories.join(",")}:${limit}`;
  return answer({ kind, center, radiusMeters: radius }, categories, limit, key, deps, signal);
}

export async function handleDiscoverCorridor(body: unknown, deps: DiscoverHandlerDeps, signal: AbortSignal): Promise<DiscoverHandlerResult> {
  if (typeof body !== "object" || body === null) return validation("A JSON body is required.");
  const input = body as Record<string, unknown>;
  if (!Array.isArray(input["line"]) || input["line"].length < 2 || input["line"].length > MAX_LINE_POINTS) {
    return validation(`line must be 2–${MAX_LINE_POINTS} [lon, lat] points.`);
  }
  const line: Coordinate[] = [];
  for (const point of input["line"] as unknown[]) {
    const parsed = Array.isArray(point) ? coordinate(point[0], point[1]) : null;
    if (parsed === null) return validation("line holds an invalid point.");
    line.push(parsed);
  }
  const buffer = input["bufferMeters"] === undefined ? 3_000 : Number(input["bufferMeters"]);
  if (!Number.isFinite(buffer) || buffer < 100 || buffer > MAX_CORRIDOR_BUFFER_METERS) return validation("bufferMeters must be 100–8000.");
  const categories = categoriesOf(input["categories"]);
  if (categories === null) return validation("Unknown category.");
  const limit = limitOf(input["limit"]);
  if (limit === null) return validation(`limit must be 1–${MAX_LIMIT}.`);
  const first = line[0]!;
  const last = line.at(-1)!;
  const key = `corridor:${line.length}:${first.lat.toFixed(3)},${first.lon.toFixed(3)}:${last.lat.toFixed(3)},${last.lon.toFixed(3)}:${buffer}:${categories.join(",")}:${limit}`;
  return answer({ kind: "corridor", line, bufferMeters: buffer }, categories, limit, key, deps, signal);
}
