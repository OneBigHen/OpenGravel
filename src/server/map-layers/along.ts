/**
 * `/api/map-layers/along`: stops of one layer along a route (UX rework phase 8).
 *
 * TomTom's along-route search returns only a handful of results with a
 * category filter, so the route is sampled every few miles and each sample
 * asks nearby search for the category; results are deduplicated, placed along
 * the route and kept when they are within about a mile of it. Samples are
 * cached, so re-planning the same corridor costs nothing.
 */

import {
  isMapLayerId,
  lineLengthMeters,
  projectAlong,
  sampleLine,
  type AlongStop,
  type AlongStopsResult,
  type LngLat,
  type MapLayerId,
} from "@/application/map-layers";

import { TOMTOM_STOP_CATEGORIES, parseTomTomStops, tomtomSearch } from "./providers";

const SAMPLE_SPACING_METERS = 14_000;
const MAX_SAMPLES = 30;
const SEARCH_RADIUS_METERS = 4_500;
/** A stop further off the route than this is not "on the way". */
export const MAX_OFF_ROUTE_METERS = 1_900;
const MAX_LINE_POINTS = 6_000;
const SAMPLE_TTL_MS = 30 * 60_000;
/** Requests are paced by `tomtomSearch`; a few in flight keep latency down. */
const CONCURRENCY = 4;

const WORLD = { west: -180, south: -90, east: 180, north: 90 };
const sampleCache = new Map<string, { readonly stops: ReturnType<typeof parseTomTomStops>; readonly expiresAt: number }>();

export interface AlongHandlerResult {
  readonly status: number;
  readonly body: AlongStopsResult | { readonly error: { readonly code: "validation"; readonly message: string } };
}

export interface AlongDeps {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

function validation(message: string): AlongHandlerResult {
  return { status: 400, body: { error: { code: "validation", message } } };
}

export function parseLine(value: unknown): readonly LngLat[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_LINE_POINTS) return null;
  const line: LngLat[] = [];
  for (const pair of value) {
    if (!Array.isArray(pair) || typeof pair[0] !== "number" || typeof pair[1] !== "number") return null;
    if (!Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || Math.abs(pair[0]) > 180 || Math.abs(pair[1]) > 90) return null;
    line.push([pair[0], pair[1]]);
  }
  return line;
}

async function inBatches<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...(await Promise.all(items.slice(index, index + size).map(work))));
  }
  return results;
}

export async function handleStopsAlong(body: unknown, deps: AlongDeps = {}, signal?: AbortSignal): Promise<AlongHandlerResult> {
  const request = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const line = parseLine(request["line"]);
  if (line === null) return validation(`line must be 2–${MAX_LINE_POINTS} [lon, lat] pairs.`);
  const layer = typeof request["layer"] === "string" ? request["layer"] : "";
  if (!isMapLayerId(layer) || TOMTOM_STOP_CATEGORIES[layer] === undefined) return validation("layer must be a stop layer.");
  const env = deps.env ?? process.env;
  const key = env["TOMTOM_API_KEY"] ?? env["TOMTOM_TRAFFIC_API_KEY"];
  if (key === undefined || key.trim() === "") return { status: 200, body: { stops: [], available: false } };
  const layerId: MapLayerId = layer;
  const category = TOMTOM_STOP_CATEGORIES[layerId]!;
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetch ?? fetch;

  const samples = sampleLine(line, SAMPLE_SPACING_METERS, MAX_SAMPLES);
  let failures = 0;
  const answers = await inBatches(samples, CONCURRENCY, async (sample) => {
    const cacheKey = `${layerId}:${sample[0].toFixed(2)},${sample[1].toFixed(2)}`;
    const cached = sampleCache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > now()) return cached.stops;
    try {
      const url =
        `https://api.tomtom.com/search/2/nearbySearch/.json?key=${encodeURIComponent(key.trim())}` +
        `&lat=${sample[1].toFixed(5)}&lon=${sample[0].toFixed(5)}&radius=${SEARCH_RADIUS_METERS}&limit=25&categorySet=${category}&language=en-US`;
      const stops = parseTomTomStops(await tomtomSearch(doFetch, url, signal), layerId, WORLD);
      if (sampleCache.size > 4_000) sampleCache.clear();
      sampleCache.set(cacheKey, { stops, expiresAt: now() + SAMPLE_TTL_MS });
      return stops;
    } catch {
      failures += 1;
      return [];
    }
  });

  const seen = new Set<string>();
  const stops: AlongStop[] = [];
  for (const feature of answers.flat()) {
    if (seen.has(feature.id) || feature.geometry.type !== "Point") continue;
    seen.add(feature.id);
    const placed = projectAlong(line, feature.geometry.coordinates);
    if (placed.offMeters > MAX_OFF_ROUTE_METERS) continue;
    stops.push({ feature, alongMeters: placed.alongMeters, offMeters: placed.offMeters });
  }
  stops.sort((a, b) => a.alongMeters - b.alongMeters);
  const total = lineLengthMeters(line);
  return {
    status: 200,
    body: {
      stops: stops.filter((stop) => stop.alongMeters <= total + 1),
      // Most samples failing is an unavailable answer, not "no fuel out here".
      available: failures <= samples.length / 3,
    },
  };
}
