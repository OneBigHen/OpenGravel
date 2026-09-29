/**
 * Ordered road coverage for a planned route (07 §3/§5; Task 6.2).
 *
 * Matching owns which route intervals a road span describes. This module only
 * consumes those intervals (or projects a supplied matched geometry), unions
 * them, and assigns each metre of route to at most one road. That last rule is
 * what keeps frontage roads and ramps from inflating coverage.
 */

import { haversine } from "@/domain/geometry/analysis";
import { formatDistance } from "@/application/planner/measurements";
import type { Coordinate } from "@/domain/ride/types";
import type { RoadEntityId } from "@/domain/ride/ids";
import {
  aggregateSurface,
  type SurfaceAssessment,
  type SurfaceBand,
  type SurfaceClass,
  type SurfaceEvidence,
} from "@/domain/roads/surface";
import type {
  RoadEvidenceConfidenceBand,
  RoadEvidenceSummary,
} from "./road-evidence";
import { surfaceEvidenceFromRoadEvidence, surfaceBandLabel } from "./surface-evidence";

export type RoadMatchConfidence = "exact" | "matched" | "approximate";

export interface PlannedRouteForRoadSummary {
  readonly geometry: readonly Coordinate[];
  /** Provider-reported route length; geometry length is the safe fallback. */
  readonly distanceMeters?: number;
}

export interface MatchedRoadSpan {
  readonly entityId: RoadEntityId;
  /** Preferred: the matched span's measured interval along the returned route. */
  readonly startDistanceMeters?: number;
  readonly endDistanceMeters?: number;
  /** Fallback for callers that have the matched line but not its interval yet. */
  readonly geometry?: readonly Coordinate[];
  readonly matchConfidence?: RoadMatchConfidence;
  /** Optional direct band for a read model that has already joined evidence. */
  readonly confidenceBand?: RoadEvidenceConfidenceBand;
  /** Optional joined surface assessment for a matched span. */
  readonly surfaceAssessment?: SurfaceAssessment;
}

export interface RouteRoadSummaryRow {
  readonly entityId: RoadEntityId;
  readonly distanceKm: number;
  readonly percentage: number;
  readonly confidenceBand: RoadEvidenceConfidenceBand;
  readonly surfaceValue?: SurfaceClass;
  readonly surfaceBand?: SurfaceBand;
  readonly surfaceAssessment?: SurfaceAssessment;
}

export interface RouteRoadSummary {
  readonly roads: readonly RouteRoadSummaryRow[];
  readonly totalKm: number;
  readonly matchedKm: number;
  readonly unmatchedKm: number;
  readonly coveragePercent: number;
  readonly unverifiedRoadCount: number;
  readonly surfaceAssessment?: SurfaceAssessment;
  readonly surfaceBand?: SurfaceBand;
}

interface Interval extends MatchedRoadSpan {
  readonly start: number;
  readonly end: number;
}

interface Projection {
  readonly distanceAlongRoute: number;
  readonly distanceToPoint: number;
}

function finiteNonNegative(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function round(value: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function routeLength(route: PlannedRouteForRoadSummary): number {
  if (finiteNonNegative(route.distanceMeters) && route.distanceMeters > 0) {
    return route.distanceMeters;
  }
  let length = 0;
  for (let index = 1; index < route.geometry.length; index += 1) {
    const previous = route.geometry[index - 1];
    const current = route.geometry[index];
    if (previous !== undefined && current !== undefined) length += haversine(previous, current);
  }
  return length;
}

function projectOnSegment(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
): { readonly point: Coordinate; readonly fraction: number } {
  const cosLatitude = Math.cos((((start.lat + end.lat) / 2) * Math.PI) / 180);
  const startX = start.lon * cosLatitude;
  const endX = end.lon * cosLatitude;
  const pointX = point.lon * cosLatitude;
  const deltaX = endX - startX;
  const deltaY = end.lat - start.lat;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const raw = lengthSquared === 0
    ? 0
    : ((pointX - startX) * deltaX + (point.lat - start.lat) * deltaY) / lengthSquared;
  const fraction = Math.max(0, Math.min(1, raw));
  return {
    point: {
      lon: start.lon + (end.lon - start.lon) * fraction,
      lat: start.lat + (end.lat - start.lat) * fraction,
    },
    fraction,
  };
}

function projectToRoute(
  point: Coordinate,
  route: readonly Coordinate[],
): Projection | null {
  if (route.length === 0) return null;
  let travelled = 0;
  let best: Projection | null = null;
  for (let index = 0; index + 1 < route.length; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    if (start === undefined || end === undefined) continue;
    const length = haversine(start, end);
    const projected = projectOnSegment(point, start, end);
    const distanceToPoint = haversine(point, projected.point);
    const candidate = {
      distanceAlongRoute: travelled + length * projected.fraction,
      distanceToPoint,
    };
    if (best === null || candidate.distanceToPoint < best.distanceToPoint) best = candidate;
    travelled += length;
  }
  return best;
}

function confidenceRank(confidence: RoadMatchConfidence | undefined): number {
  switch (confidence) {
    case "exact": return 3;
    case "matched": return 2;
    case "approximate": return 1;
    default: return 0;
  }
}

function intervalFor(
  span: MatchedRoadSpan,
  route: PlannedRouteForRoadSummary,
  totalMeters: number,
): Interval | null {
  let start = span.startDistanceMeters;
  let end = span.endDistanceMeters;
  if (!finiteNonNegative(start) || !finiteNonNegative(end)) {
    const geometry = span.geometry;
    const first = geometry?.[0];
    const last = geometry?.at(-1);
    if (first === undefined || last === undefined) return null;
    const firstProjection = projectToRoute(first, route.geometry);
    const lastProjection = projectToRoute(last, route.geometry);
    if (firstProjection === null || lastProjection === null) return null;
    start = firstProjection.distanceAlongRoute;
    end = lastProjection.distanceAlongRoute;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const boundedStart = Math.max(0, Math.min(totalMeters, Math.min(start, end)));
  const boundedEnd = Math.max(0, Math.min(totalMeters, Math.max(start, end)));
  if (boundedEnd <= boundedStart) return null;
  return { ...span, start: boundedStart, end: boundedEnd };
}

function bandFor(
  entityId: RoadEntityId,
  spans: readonly Interval[],
  evidence: ReadonlyMap<RoadEntityId, RoadEvidenceSummary>,
): RoadEvidenceConfidenceBand {
  const summaryBand = evidence.get(entityId)?.confidenceBand;
  if (summaryBand !== undefined) return summaryBand;
  const bands = spans
    .map((span) => span.confidenceBand)
    .filter((band): band is RoadEvidenceConfidenceBand => band !== undefined);
  if (bands.length === 0) return "Unverified";
  return bands.sort((left, right) => bandRank(left) - bandRank(right))[0] ?? "Unverified";
}

function surfaceAssessmentFor(
  entityId: RoadEntityId,
  spans: readonly Interval[],
  evidence: ReadonlyMap<RoadEntityId, RoadEvidenceSummary>,
): SurfaceAssessment {
  const summary = evidence.get(entityId);
  if (summary?.surfaceAssessment !== undefined) return summary.surfaceAssessment;
  const direct = spans.find((span) => span.entityId === entityId);
  return direct?.surfaceAssessment ?? aggregateSurface([]);
}

function bandRank(band: RoadEvidenceConfidenceBand): number {
  switch (band) {
    case "High": return 3;
    case "Medium": return 2;
    case "Low": return 1;
    case "Unverified": return 0;
  }
}

/**
 * Builds an ordered, overlap-safe road summary. `evidence` is optional so a
 * route with no reports still renders roads honestly as Unverified.
 */
export function buildRouteRoadSummary(
  route: PlannedRouteForRoadSummary,
  matchedSpans: readonly MatchedRoadSpan[],
  evidence: readonly RoadEvidenceSummary[] = [],
): RouteRoadSummary {
  const totalMeters = routeLength(route);
  const evidenceByEntity = new Map(evidence.map((summary) => [summary.entityId, summary]));
  if (totalMeters <= 0 || !Number.isFinite(totalMeters)) {
    return {
      roads: [],
      totalKm: 0,
      matchedKm: 0,
      unmatchedKm: 0,
      coveragePercent: 0,
      unverifiedRoadCount: 0,
      surfaceAssessment: aggregateSurface([]),
      surfaceBand: "unknown",
    };
  }

  const intervals = matchedSpans
    .map((span) => intervalFor(span, route, totalMeters))
    .filter((interval): interval is Interval => interval !== null);
  const boundaries = [...new Set(intervals.flatMap((interval) => [interval.start, interval.end, 0, totalMeters]))]
    .sort((left, right) => left - right);
  const assigned = new Map<RoadEntityId, { distance: number; first: number; spans: Interval[] }>();
  let matchedMeters = 0;

  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (start === undefined || end === undefined || end <= start) continue;
    const midpoint = start + (end - start) / 2;
    const active = intervals
      .filter((interval) => interval.start <= midpoint && interval.end >= midpoint)
      .sort((left, right) => confidenceRank(right.matchConfidence) - confidenceRank(left.matchConfidence)
        || left.entityId.localeCompare(right.entityId)
        || left.start - right.start);
    const winner = active[0];
    if (winner === undefined) continue;
    const current = assigned.get(winner.entityId) ?? { distance: 0, first: start, spans: [] };
    current.distance += end - start;
    current.first = Math.min(current.first, start);
    if (!current.spans.includes(winner)) current.spans.push(winner);
    assigned.set(winner.entityId, current);
    matchedMeters += end - start;
  }

  const roads = [...assigned.entries()]
    .sort((left, right) => left[1].first - right[1].first || left[0].localeCompare(right[0]))
    .map(([entityId, item]) => {
      const distanceKm = round(item.distance / 1000, 2);
      const percentage = round((item.distance / totalMeters) * 100, 1);
      const surfaceAssessment = surfaceAssessmentFor(entityId, item.spans, evidenceByEntity);
      return {
        entityId,
        distanceKm,
        percentage,
        confidenceBand: bandFor(entityId, item.spans, evidenceByEntity),
        surfaceValue: surfaceAssessment.value,
        surfaceBand: surfaceAssessment.band,
        surfaceAssessment,
      } satisfies RouteRoadSummaryRow;
    });
  const matchedKm = round(matchedMeters / 1000, 2);
  const totalKm = round(totalMeters / 1000, 2);
  const unmatchedKm = round(Math.max(0, totalKm - matchedKm), 2);
  const routeSurfaceEvidence: SurfaceEvidence[] = roads.flatMap((road) => {
    const summary = evidenceByEntity.get(road.entityId);
    if (summary === undefined) return [];
    if (summary.records.length > 0) {
      return summary.records.map(surfaceEvidenceFromRoadEvidence);
    }
    if (summary.surfaceAssessment !== undefined) {
      return summary.surfaceAssessment.provenance.map((record) => ({
        id: record.evidenceId,
        value: record.value,
        source: record.source,
        sourceLabel: record.sourceLabel,
        observedAt: record.observedAt ?? undefined,
        weight: record.weight,
        confidence: record.confidence,
      }));
    }
    return [];
  });
  const surfaceAssessment = aggregateSurface(routeSurfaceEvidence);
  return {
    roads,
    totalKm,
    matchedKm,
    unmatchedKm,
    coveragePercent: round((matchedMeters / totalMeters) * 100, 1),
    unverifiedRoadCount: roads.filter((road) => road.surfaceBand === "unknown").length,
    surfaceAssessment,
    surfaceBand: surfaceAssessment.band,
  };
}

/** Compatibility spelling for callers that use the domain noun first. */
export const summarizeRouteRoads = buildRouteRoadSummary;

/** The compact coverage line used by route detail. */
export function routeRoadCoverageLabel(summary: RouteRoadSummary): string {
  const roadNoun = summary.roads.length === 1 ? "road" : "roads";
  return `${formatDistance(summary.matchedKm * 1000)} matched · ${summary.roads.length} ${roadNoun} · ${summary.unverifiedRoadCount} surface unknown`;
}

/** Route-level surface copy never supplies a default class for unknown data. */
export function routeSurfaceLabel(summary: RouteRoadSummary): string {
  return surfaceBandLabel(summary.surfaceBand ?? "unknown");
}
