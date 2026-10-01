/**
 * Derived progress on mapped, qualified roads.
 *
 * This is an evidence projection over local recorded rides and the existing
 * great-road/gravel catalogue. It does not own ride state, score routes, or
 * decide legality. The catalogue is deliberately treated as bounded evidence:
 * a successful answer is partial coverage, never proof that the rest of a ride
 * was not on a qualified road.
 */

import {
  clampLayerBounds,
  type InfoFeature,
  type InfoProvider,
  type MapLayerBounds,
  type MapLayersSource,
} from "@/application/map-layers/types";
import type { LibraryExploreRide } from "@/application/library/library-service";
import type { RideId } from "@/domain/ride/ids";
import type { Coordinate } from "@/domain/ride/types";
import { haversine } from "@/domain/geometry/analysis";
import {
  PERSONAL_HISTORY_MATCH_TOLERANCE_METERS,
  personalRideHistory,
  preparePersonalRoadHistory,
  type PersonalRideTrace,
  type PreparedPersonalRoadHistory,
} from "./personal-road-history";
import { indexRoute, type RouteIndex } from "./route-overlap";
import { MIN_GREAT_ROAD_RATING } from "./known-roads";

export type RoadProgressCoverage = "partial" | "unknown";

export interface RoadProgressProjection {
  readonly rideId: RideId;
  /** Distance in this recording that matched at least one qualified catalogue line. */
  readonly qualifiedMeters: number;
  /** Null when there is no usable earlier observed history to compare against. */
  readonly newToYouMeters: number | null;
  readonly coverage: RoadProgressCoverage;
  readonly historyAvailable: boolean;
  /** Catalogue portions actually matched by this recording, clipped to the match. */
  readonly matchedFeatures: readonly InfoFeature[];
}

export interface RoadProgressReader {
  read(rideId: RideId, signal?: AbortSignal): Promise<RoadProgressProjection>;
}

export interface RoadProgressReaderOptions {
  readonly listExploreRides: () => Promise<readonly LibraryExploreRide[]>;
  readonly mapLayersSource: MapLayersSource;
}

export type PreparedRoadHistory = PreparedPersonalRoadHistory;

interface HistoryOptions {
  readonly excludeRideId?: RideId;
  readonly beforeMs?: number;
}

function validLine(line: readonly Coordinate[]): boolean {
  return line.length >= 2 && line.every((point) =>
    Number.isFinite(point.lon) && Math.abs(point.lon) <= 180 &&
    Number.isFinite(point.lat) && Math.abs(point.lat) <= 90,
  );
}

function actualTraces(
  entries: readonly LibraryExploreRide[],
  options: HistoryOptions = {},
): readonly PersonalRideTrace[] {
  const candidates = entries.flatMap((entry): PersonalRideTrace[] => {
    if (
      entry.document.provenance.type !== "recorded" ||
      entry.summary.rideId === options.excludeRideId ||
      (options.beforeMs !== undefined && entry.riddenAt !== undefined &&
        (!Number.isFinite(Date.parse(entry.riddenAt)) || Date.parse(entry.riddenAt) >= options.beforeMs))
    ) return [];
    return [{ geometry: entry.geometry, ...(entry.riddenAt === undefined ? {} : { riddenAt: entry.riddenAt }) }];
  });
  return personalRideHistory(candidates);
}

export function prepareRoadHistory(
  entries: readonly LibraryExploreRide[],
  options: HistoryOptions = {},
): PreparedRoadHistory {
  return preparePersonalRoadHistory(actualTraces(entries, options)) ?? {
    available: false,
    edgeSeen: () => false,
    recentEdgeSeen: () => false,
  };
}

function coordinate(value: readonly [number, number]): Coordinate {
  return { lon: value[0], lat: value[1] };
}

function lineOf(feature: InfoFeature): readonly Coordinate[] | null {
  if (feature.geometry.type !== "LineString") return null;
  const line = feature.geometry.coordinates.map(coordinate);
  return validLine(line) ? line : null;
}

function qualified(feature: InfoFeature): boolean {
  if (feature.geometry.type !== "LineString") return false;
  if (feature.layerId === "great-roads") {
    return feature.weight !== null && feature.weight >= MIN_GREAT_ROAD_RATING;
  }
  return feature.layerId === "gravel";
}

interface IndexedCatalogueFeature {
  readonly feature: InfoFeature;
  readonly line: readonly Coordinate[];
  readonly index: RouteIndex;
}

function catalogue(features: readonly InfoFeature[]): readonly IndexedCatalogueFeature[] {
  return features.flatMap((feature): IndexedCatalogueFeature[] => {
    if (!qualified(feature)) return [];
    const line = lineOf(feature);
    return line === null ? [] : [{ feature, line, index: indexRoute(line) }];
  });
}

function edgeLength(from: Coordinate, to: Coordinate): number {
  const meters = haversine(from, to);
  return Number.isFinite(meters) && meters > 0 ? meters : 0;
}

function edgeMatches(
  from: Coordinate,
  to: Coordinate,
  features: readonly IndexedCatalogueFeature[],
): boolean {
  return features.some((feature) =>
    feature.index.probe(from) <= PERSONAL_HISTORY_MATCH_TOLERANCE_METERS &&
    feature.index.probe(to) <= PERSONAL_HISTORY_MATCH_TOLERANCE_METERS,
  );
}

function matchedMeters(
  line: readonly Coordinate[],
  features: readonly IndexedCatalogueFeature[],
  prior: PreparedRoadHistory | null,
): { readonly qualifiedMeters: number; readonly newToYouMeters: number | null } {
  let qualifiedMeters = 0;
  let newToYouMeters = prior?.available === true ? 0 : null;
  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1];
    const to = line[index];
    if (from === undefined || to === undefined) continue;
    const meters = edgeLength(from, to);
    if (meters === 0 || !edgeMatches(from, to, features)) continue;
    qualifiedMeters += meters;
    if (newToYouMeters !== null && !prior!.edgeSeen(from, to)) newToYouMeters += meters;
  }
  return { qualifiedMeters, newToYouMeters };
}

function clippedFeature(
  feature: IndexedCatalogueFeature,
  history: PreparedRoadHistory,
): readonly InfoFeature[] {
  if (!history.available) return [];
  const chunks: Coordinate[][] = [];
  let chunk: Coordinate[] = [];
  const flush = (): void => {
    if (chunk.length >= 2) chunks.push(chunk);
    chunk = [];
  };
  for (let index = 1; index < feature.line.length; index += 1) {
    const from = feature.line[index - 1];
    const to = feature.line[index];
    if (from === undefined || to === undefined) continue;
    if (!history.edgeSeen(from, to)) {
      flush();
      continue;
    }
    if (chunk.length === 0) chunk.push(from);
    chunk.push(to);
  }
  flush();
  return chunks.map((coordinates, index) => ({
    ...feature.feature,
    id: `road-history:${feature.feature.id}:${index}`,
    layerId: "road-history",
    overlay: "road-history",
    geometry: { type: "LineString", coordinates: coordinates.map((point) => [point.lon, point.lat] as const) },
    detail: feature.feature.detail === null
      ? "Estimated from your recorded rides"
      : `${feature.feature.detail} · Estimated ridden match`,
  }));
}

/** Returns only qualified catalogue portions that overlap observed recordings. */
export function observedRoadOverlayFeaturesForPreparedHistory(
  features: readonly InfoFeature[],
  history: PreparedRoadHistory,
): readonly InfoFeature[] {
  return catalogue(features).flatMap((feature) => clippedFeature(feature, history));
}

/** Returns only qualified catalogue portions that overlap observed recordings. */
export function observedRoadOverlayFeatures(
  features: readonly InfoFeature[],
  historyEntries: readonly LibraryExploreRide[],
): readonly InfoFeature[] {
  return observedRoadOverlayFeaturesForPreparedHistory(features, prepareRoadHistory(historyEntries));
}

function unknownProjection(rideId: RideId, historyAvailable = false): RoadProgressProjection {
  return {
    rideId,
    qualifiedMeters: 0,
    newToYouMeters: null,
    coverage: "unknown",
    historyAvailable,
    matchedFeatures: [],
  };
}

export function projectRoadProgress(input: {
  readonly ride: LibraryExploreRide;
  readonly history: readonly LibraryExploreRide[];
  readonly features: readonly InfoFeature[];
  readonly unavailable?: readonly InfoProvider[];
}): RoadProgressProjection {
  if (input.ride.document.provenance.type !== "recorded") {
    return unknownProjection(input.ride.summary.rideId);
  }
  const history = prepareRoadHistory(input.history);
  const selectedLine = input.ride.geometry;
  const qualifiedFeatures = catalogue(input.features);
  if (
    !validLine(selectedLine) ||
    qualifiedFeatures.length === 0 ||
    input.unavailable?.includes("roads") === true
  ) return unknownProjection(input.ride.summary.rideId, history.available);

  const selectedAt = input.ride.riddenAt === undefined ? Number.NaN : Date.parse(input.ride.riddenAt);
  const prior = Number.isFinite(selectedAt)
    ? prepareRoadHistory(input.history, { excludeRideId: input.ride.summary.rideId, beforeMs: selectedAt })
    : null;
  const selectedHistory = prepareRoadHistory([input.ride]);
  const measured = matchedMeters(selectedLine, qualifiedFeatures, prior);
  return {
    rideId: input.ride.summary.rideId,
    ...measured,
    coverage: "partial",
    historyAvailable: history.available,
    matchedFeatures: qualifiedFeatures.flatMap((feature) => clippedFeature(feature, selectedHistory)),
  };
}

function boundsFor(line: readonly Coordinate[]): MapLayerBounds | null {
  if (!validLine(line)) return null;
  const raw = line.reduce(
    (bounds, point) => ({
      west: Math.min(bounds.west, point.lon),
      south: Math.min(bounds.south, point.lat),
      east: Math.max(bounds.east, point.lon),
      north: Math.max(bounds.north, point.lat),
    }),
    { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity },
  );
  return raw;
}

export function createRoadProgressReader(options: RoadProgressReaderOptions): RoadProgressReader {
  return {
    async read(rideId, signal): Promise<RoadProgressProjection> {
      const entries = await options.listExploreRides();
      if (signal !== undefined && signal.aborted) throw new DOMException("The road-progress read was cancelled.", "AbortError");
      const ride = entries.find((entry) => entry.summary.rideId === rideId);
      if (ride === undefined) return unknownProjection(rideId);
      const rawBounds = boundsFor(ride.geometry);
      if (rawBounds === null) return unknownProjection(rideId);
      const bounded = clampLayerBounds(rawBounds);
      const result = await options.mapLayersSource.load(bounded, ["great-roads", "gravel"], signal);
      if (signal?.aborted === true) throw new DOMException("The road-progress read was cancelled.", "AbortError");
      const projection = projectRoadProgress({
        ride,
        history: entries,
        features: result.features,
        unavailable: result.unavailable,
      });
      return projection;
    },
  };
}
