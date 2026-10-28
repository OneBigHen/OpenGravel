/**
 * The wind layer's provider behind `/api/map-layers` (MAP-EXPERIENCE-NEXT Wave 3,
 * item 13).
 *
 * The browser asks for the visible view like any other layer; this module turns
 * that view into a coarse arrow grid ({@link sampleWindGrid}), reads the wind
 * forecast for each distinct NWS cell, and projects the readings the grid has as
 * tappable features. The parts that matter:
 *
 * 1. **The shared weather cache does the caching.** Wind series live in
 *    `@/server/weather/cache` under their own `wind:` kind, next to the forecast
 *    the weather pill already warms. One view costs at most one upstream read per
 *    distinct cell (`/points` plus `/gridpoints`, so two requests), and a pan back
 *    to the same area costs none.
 * 2. **A cell that cannot be read stays unknown.** Its arrows are left out, and
 *    the rest of the view still draws. Only a view where *no* cell answered — or
 *    where NWS had no window covering now — is reported as unavailable, so the
 *    panel never shows a calm-looking map for a failed provider.
 * 3. **The reading is normalized once.** Speed, gust and the direction the wind
 *    blows from are a {@link WindReading}; the arrows and the feature card are
 *    projections of that one fact.
 */

import {
  sampleWindGrid,
  windGridFeatures,
  windReadingAt,
  WIND_FORECAST_STALE_MS,
  WIND_ATTRIBUTION,
  type WindPoint,
  type WindSeries,
} from "@/application/map-layers/wind";
import {
  fetchWindGridSeries,
  type FetchSnapshotOptions,
} from "@/infrastructure/weather/nws";
import {
  WEATHER_FORECAST_CACHE_TTL_MS,
  readWeatherCache,
  weatherCell,
  writeWeatherCache,
} from "@/server/weather/cache";

import type { LayerProvider, LayerSnapshot, ProviderContext } from "./providers";

/**
 * How long one cell's wind series is kept: the same half hour as the hourly
 * forecast. NWS republishes the grid about hourly, so a fresher read buys nothing.
 */
export const WIND_CELL_CACHE_TTL_MS = WEATHER_FORECAST_CACHE_TTL_MS;

/** How long one view's arrows are reused before the handler reads again. */
export const WIND_LAYER_TTL_MS = 10 * 60_000;

/**
 * How many NWS cells one view reads at once. A wide view can ask for 25 cells,
 * and each cell is two upstream reads: a burst of fifty is rude to a free public
 * service, so the reads are staggered a handful at a time.
 */
export const WIND_CELL_CONCURRENCY = 5;

type WindSeriesFetcher = (
  lat: number,
  lon: number,
  options?: FetchSnapshotOptions,
) => Promise<WindSeries>;

export interface WindProviderOptions {
  /** The NWS call, injectable so the provider can be tested without a network. */
  readonly fetchSeries?: WindSeriesFetcher;
}

/** Reads one cell, from the shared weather cache when it is warm. */
async function seriesFor(
  cell: { readonly lat: number; readonly lon: number },
  fetchSeries: WindSeriesFetcher,
  context: ProviderContext,
  atMs: number,
): Promise<WindSeries> {
  const key = weatherCell("wind", cell.lat, cell.lon);
  const cached = readWeatherCache<WindSeries>(key, atMs);
  if (cached !== null) return cached;
  const series = await fetchSeries(key.lat, key.lon, {
    fetcher: context.fetch,
    signal: context.signal,
  });
  writeWeatherCache(key, series, WIND_CELL_CACHE_TTL_MS, atMs);
  return series;
}

/**
 * Runs `task` over `items` with at most `limit` in flight, keeping the answers in
 * input order so a view's arrows never depend on which cell answered first.
 */
async function readCells<T, R>(
  items: readonly T[],
  task: (item: T) => Promise<R>,
  limit: number = WIND_CELL_CONCURRENCY,
): Promise<readonly R[]> {
  const answers = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      answers[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return answers;
}

export function createWindProvider(options: WindProviderOptions = {}): LayerProvider {
  const fetchSeries = options.fetchSeries ?? fetchWindGridSeries;
  return {
    id: "wind",
    layers: ["wind"],
    ttlMs: WIND_LAYER_TTL_MS,
    // `snapshot` is the whole answer: the wind layer's freshness carries the
    // forecast window, which a bare feature list cannot.
    async load() { return []; },
    async snapshot(bounds, _layers, context): Promise<LayerSnapshot> {
      const atMs = (context.now ?? Date.now)();
      const coordinates = sampleWindGrid(bounds);
      if (coordinates.length === 0) throw new Error("The wind grid needs a view with an area");

      // One read per distinct cell: two arrows a few kilometres apart often share
      // one NWS grid square, and the cache rounds to that square anyway.
      const cells = new Map<string, { readonly lat: number; readonly lon: number }>();
      for (const [lon, lat] of coordinates) {
        const cell = weatherCell("wind", lat, lon);
        if (!cells.has(cell.key)) cells.set(cell.key, { lat: cell.lat, lon: cell.lon });
      }
      const answers = await readCells([...cells.entries()], async ([key, cell]) => {
        try {
          return [key, await seriesFor(cell, fetchSeries, context, atMs)] as const;
        } catch {
          // The failure stays local: one unreadable cell is unknown weather at
          // those arrows, not a reason to take the other cells down with it.
          return [key, null] as const;
        }
      });
      const series = new Map(answers);

      const points: WindPoint[] = [];
      for (const coordinate of coordinates) {
        const key = weatherCell("wind", coordinate[1], coordinate[0]).key;
        const cellSeries = series.get(key);
        if (cellSeries === undefined || cellSeries === null) continue;
        const reading = windReadingAt(cellSeries, atMs);
        // No window covers the hour at this point: unknown, never calm.
        if (reading === null) continue;
        points.push({
          coordinate,
          reading: reading.reading,
          validFrom: new Date(reading.startMs).toISOString(),
        });
      }

      // Nothing known anywhere in the view is an unavailable layer, not an empty
      // sky: the rider must not read "no arrows" as "no wind".
      if (points.length === 0) throw new Error("NWS has no wind reading for this view");

      return {
        features: windGridFeatures(points),
        freshness: [{
          layerId: "wind",
          source: WIND_ATTRIBUTION,
          fetchedAt: new Date(atMs).toISOString(),
          observedAt: points
            .map((point) => point.validFrom)
            .sort()
            .at(-1) ?? new Date(atMs).toISOString(),
          stale: false,
          staleAfterMs: WIND_FORECAST_STALE_MS,
          note: `${points.length} of ${coordinates.length} grid points have a forecast for this hour; a point NWS did not publish stays unknown, not calm.`,
        }],
      };
    },
  };
}

export const windProvider: LayerProvider = createWindProvider();
