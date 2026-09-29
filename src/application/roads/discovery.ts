/**
 * Deterministic, evidence-led RoadEntity discovery for Explore (07 §18;
 * Wave 6 Task 6.4).
 *
 * This module ranks observations, not opinions. A road earns the Great roads
 * slice only when a matched span, evidence report, or measured geometry proxy
 * exists. The curvature value is the existing `analyzeGeometry` twistiness
 * measurement over the supplied road geometry; it is explicitly a proxy and
 * never pretends to be a mapped road-quality fact.
 */

import { analyzeGeometry, haversine, type GeometryAnalysis } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { formatDistance } from "@/application/planner/measurements";
import type { RoadEntity } from "@/domain/roads/road-entity";
import {
  aggregateRoadEvidence,
  type RoadEvidenceConfidenceBand,
  type RoadEvidenceRecord,
  type RoadEvidenceSummary,
} from "./road-evidence";
import { aggregateRoadSurface } from "./surface-evidence";
import type { SurfaceBand, SurfaceClass, SurfaceAssessment } from "@/domain/roads/surface";
import type { RoadEntityId } from "@/domain/ride/ids";

export type RoadDiscoverySlice = "great" | "gravel" | "new-to-me";

export type RoadWhySignalKind =
  | "matched-distance"
  | "evidence-quality"
  | "evidence-agreement"
  | "low-conflict"
  | "curvature-proxy"
  | "gravel"
  | "unknown-surface"
  | "new-to-me";

export interface RoadWhySignal {
  readonly kind: RoadWhySignalKind;
  readonly label: string;
}

/** One road observation joined from a RoadEntity and a matched route span. */
export interface RoadDiscoveryRoad {
  readonly entity: RoadEntity;
  /** Geometry supplied by the matcher or a bounded preview proxy. */
  readonly geometry?: readonly Coordinate[];
  /** Measured matched span length; unknown/invalid values are treated as zero. */
  readonly matchedDistanceKm?: number;
  /** Compatibility input for adapters that keep the measurement in meters. */
  readonly matchedDistanceMeters?: number;
  /** Number of actual ridden/imported matches represented by this observation. */
  readonly matchedRideCount?: number;
  /** Read-model spelling retained by the 6.2 catalog adapter. */
  readonly ridesThroughCount?: number;
  readonly region?: string | null;
  readonly aliases?: readonly string[];
  readonly evidence?: readonly RoadEvidenceRecord[];
  readonly evidenceSummary?: RoadEvidenceSummary;
  readonly sourceRouteIds?: readonly string[];
}

export interface RoadDiscoveryScope {
  readonly roads: readonly RoadDiscoveryRoad[];
  /** Road entities present in marked rider history or imported history. */
  readonly riddenRoadIds?: readonly RoadEntityId[];
  readonly currentRegion?: string;
}

export interface RoadCandidate {
  readonly id: RoadEntityId;
  readonly entity: RoadEntity;
  readonly geometry: readonly Coordinate[];
  readonly region: string | null;
  readonly aliases: readonly string[];
  readonly lengthKm: number;
  readonly matchedDistanceKm: number;
  readonly matchedRideCount: number;
  readonly sourceRouteIds: readonly string[];
  readonly evidence: readonly RoadEvidenceRecord[];
  readonly evidenceSummary: RoadEvidenceSummary;
  readonly surface: SurfaceAssessment;
  readonly surfaceValue: SurfaceClass;
  readonly surfaceBand: SurfaceBand;
  readonly confidenceBand: RoadEvidenceConfidenceBand;
  readonly conflict: boolean;
  readonly evidenceCount: number;
  readonly sourceDiversity: number;
  readonly curvatureProxy: GeometryAnalysis | null;
  /** All discovery slices to which this entity belongs. */
  readonly slices: readonly RoadDiscoverySlice[];
  /** The first slice in display priority order, for simple consumers. */
  readonly slice: RoadDiscoverySlice;
  readonly why: readonly RoadWhySignal[];
  readonly whySignals: readonly RoadWhySignal[];
  readonly whyLine: string;
}

export type RoadSurfaceFilter = "any" | "gravel" | "unknown";

export interface RoadCandidateFilter {
  readonly surface?: RoadSurfaceFilter;
  readonly origin?: readonly [number, number];
  readonly maxDistanceKm?: number;
}

const CONFIDENCE_RANK: Readonly<Record<RoadEvidenceConfidenceBand, number>> = {
  High: 3,
  Medium: 2,
  Low: 1,
  Unverified: 0,
};

const SLICE_PRIORITY: readonly RoadDiscoverySlice[] = ["great", "gravel", "new-to-me"];

function finiteNonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

function rounded(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function count(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function evidenceSummaryFor(road: RoadDiscoveryRoad): RoadEvidenceSummary {
  if (road.evidenceSummary !== undefined) return road.evidenceSummary;
  const records = road.evidence ?? [];
  return aggregateRoadEvidence(records)[0] ?? {
    entityId: road.entity.id,
    surfaceValue: null,
    confidence: null,
    confidenceBand: "Unverified",
    conflict: false,
    evidenceCount: 0,
    sourceDiversity: 0,
    latestObservedAt: null,
    records: [],
    surfaceAssessment: aggregateRoadSurface([]),
    surfaceBand: "unknown",
  };
}

function roadDistanceKm(candidate: RoadCandidate, origin: readonly [number, number]): number | null {
  const first = candidate.geometry[0];
  if (first === undefined || !Number.isFinite(first.lon) || !Number.isFinite(first.lat)) return null;
  return haversine({ lon: origin[0], lat: origin[1] }, first) / 1000;
}

function compareDescending(left: number, right: number): number {
  return right - left;
}

function compareGreat(left: RoadCandidate, right: RoadCandidate): number {
  return compareDescending(left.matchedDistanceKm, right.matchedDistanceKm)
    || compareDescending(CONFIDENCE_RANK[left.confidenceBand], CONFIDENCE_RANK[right.confidenceBand])
    || compareDescending(left.evidenceCount > 0 && !left.conflict ? 1 : 0, right.evidenceCount > 0 && !right.conflict ? 1 : 0)
    || compareDescending(left.evidenceSummary.sourceDiversity, right.evidenceSummary.sourceDiversity)
    || compareDescending(left.curvatureProxy?.twistiness ?? -1, right.curvatureProxy?.twistiness ?? -1)
    || compareDescending(left.matchedRideCount, right.matchedRideCount)
    || left.entity.normalizedName.localeCompare(right.entity.normalizedName)
    || left.id.localeCompare(right.id);
}

function compareFallback(left: RoadCandidate, right: RoadCandidate): number {
  return compareDescending(left.matchedDistanceKm, right.matchedDistanceKm)
    || compareDescending(left.evidenceCount, right.evidenceCount)
    || compareDescending(left.matchedRideCount, right.matchedRideCount)
    || left.entity.normalizedName.localeCompare(right.entity.normalizedName)
    || left.id.localeCompare(right.id);
}

function surfaceLabel(value: SurfaceClass, band: SurfaceBand): RoadWhySignal | null {
  if (value === "gravel") return { kind: "gravel", label: `gravel ${band}` };
  if (value === "unknown") return { kind: "unknown-surface", label: "surface unknown" };
  return value.length === 0 ? null : { kind: "evidence-quality", label: `${value} ${band}` };
}

function whyFor(
  road: RoadDiscoveryRoad,
  candidate: Omit<RoadCandidate, "why" | "whySignals" | "whyLine" | "slices" | "slice">,
  isNewToMe: boolean,
): readonly RoadWhySignal[] {
  const signals: RoadWhySignal[] = [];
  if (candidate.matchedRideCount > 0) {
    signals.push({
      kind: "matched-distance",
      label: `matched on ${candidate.matchedRideCount} ride${candidate.matchedRideCount === 1 ? "" : "s"}`,
    });
  } else if (candidate.matchedDistanceKm > 0) {
    signals.push({ kind: "matched-distance", label: `${formatDistance(candidate.matchedDistanceKm * 1000)} matched` });
  }

  if (candidate.evidenceCount > 0) {
    signals.push({ kind: "evidence-quality", label: `${candidate.confidenceBand.toLowerCase()} evidence` });
    if (candidate.evidenceSummary.sourceDiversity >= 2 && !candidate.conflict) {
      signals.push({ kind: "evidence-agreement", label: "evidence agrees across sources" });
    }
    if (!candidate.conflict) {
      signals.push({ kind: "low-conflict", label: "no conflicting evidence" });
    }
  }

  if (candidate.curvatureProxy !== null) {
    signals.push({ kind: "curvature-proxy", label: "observed geometry curvature proxy" });
  }

  const surface = surfaceLabel(candidate.surfaceValue, candidate.surfaceBand);
  if (surface !== null) signals.push(surface);
  if (isNewToMe) signals.push({ kind: "new-to-me", label: "new to your marked rides" });

  if (signals.length === 0 && road.entity.spans.length === 0) {
    return [{ kind: "unknown-surface", label: "no discovery evidence yet" }];
  }
  return signals;
}

function normalizedRoads(scope: RoadDiscoveryScope): readonly RoadDiscoveryRoad[] {
  const byId = new Map<RoadEntityId, RoadDiscoveryRoad>();
  for (const road of scope.roads) {
    const previous = byId.get(road.entity.id);
    if (previous === undefined) {
      byId.set(road.entity.id, road);
      continue;
    }
    const evidence = [...(previous.evidence ?? []), ...(road.evidence ?? [])];
    const evidenceById = new Map(evidence.map((record) => [record.id, record]));
    const sourceRouteIds = [...new Set([...(previous.sourceRouteIds ?? []), ...(road.sourceRouteIds ?? [])])].sort();
    byId.set(road.entity.id, {
      ...previous,
      geometry: (road.geometry?.length ?? 0) > (previous.geometry?.length ?? 0) ? road.geometry : previous.geometry,
      matchedDistanceKm: Math.max(previous.matchedDistanceKm ?? 0, road.matchedDistanceKm ?? 0),
      matchedDistanceMeters: undefined,
      matchedRideCount: Math.max(
        count(previous.matchedRideCount ?? previous.ridesThroughCount),
        count(road.matchedRideCount ?? road.ridesThroughCount),
        sourceRouteIds.length,
      ),
      evidence: [...evidenceById.values()].sort((left, right) => left.id.localeCompare(right.id)),
      evidenceSummary: evidence.length === 0 ? previous.evidenceSummary ?? road.evidenceSummary : undefined,
      sourceRouteIds,
      aliases: [...new Set([...(previous.aliases ?? []), ...(road.aliases ?? [])])].sort(),
    });
  }
  return [...byId.values()];
}

/**
 * Creates one candidate per stable RoadEntity. Candidates are ordered by the
 * documented lexicographic measurement tuple: matched distance, confidence
 * band, non-conflicting evidence, curvature proxy, ride matches, then ID.
 */
export function discoverRoads(scope: RoadDiscoveryScope): RoadCandidate[] {
  const ridden = new Set(scope.riddenRoadIds ?? []);
  const candidates = normalizedRoads(scope).flatMap((road): RoadCandidate[] => {
    const matchedDistanceKm = rounded(Math.max(
      finiteNonNegative(road.matchedDistanceKm),
      finiteNonNegative(road.matchedDistanceMeters) / 1000,
    ));
    const evidence = road.evidence ?? road.evidenceSummary?.records ?? [];
    const evidenceSummary = evidenceSummaryFor({ ...road, evidence });
    const surface = evidenceSummary.surfaceAssessment ?? aggregateRoadSurface(evidence);
    const geometry = road.geometry === undefined ? [] : [...road.geometry];
    const curvatureProxy = geometry.length >= 3 ? analyzeGeometry(geometry) : null;
    const matchedRideCount = count(
      road.matchedRideCount
        ?? road.ridesThroughCount
        ?? road.sourceRouteIds?.length,
    );
    const isNewToMe = !ridden.has(road.entity.id)
      && count(road.ridesThroughCount) === 0
      && (scope.currentRegion === undefined
        || road.region === undefined
        || road.region === null
        || road.region.toLocaleLowerCase("en-US").includes(scope.currentRegion.trim().toLocaleLowerCase("en-US")));
    const great = matchedDistanceKm > 0;
    const surfaceSlice = surface.value === "gravel" || surface.value === "unknown";
    if (!great && !surfaceSlice && !isNewToMe) return [];
    const slices = SLICE_PRIORITY.filter((slice) =>
      (slice === "great" && great)
      || (slice === "gravel" && surfaceSlice)
      || (slice === "new-to-me" && isNewToMe));
    const base = {
      id: road.entity.id,
      entity: road.entity,
      geometry,
      region: road.region ?? null,
      aliases: road.aliases ?? [],
      lengthKm: matchedDistanceKm,
      matchedDistanceKm,
      matchedRideCount,
      sourceRouteIds: road.sourceRouteIds ?? [],
      evidence,
      evidenceSummary,
      surface,
      surfaceValue: surface.value,
      surfaceBand: surface.band,
      confidenceBand: evidenceSummary.confidenceBand,
      conflict: evidenceSummary.conflict,
      evidenceCount: evidenceSummary.evidenceCount,
      sourceDiversity: evidenceSummary.sourceDiversity,
      curvatureProxy,
    } satisfies Omit<RoadCandidate, "why" | "whySignals" | "whyLine" | "slices" | "slice">;
    const why = whyFor(road, base, isNewToMe);
    return [{
      ...base,
      slices,
      slice: slices[0] ?? "new-to-me",
      why,
      whySignals: why,
      whyLine: why.map((signal) => signal.label).join(" · "),
    }];
  });

  return [...candidates].sort((left, right) => {
    const leftGreat = left.slices.includes("great");
    const rightGreat = right.slices.includes("great");
    if (leftGreat !== rightGreat) return leftGreat ? -1 : 1;
    return leftGreat ? compareGreat(left, right) : compareFallback(left, right);
  });
}

/** Great/gravel/unknown filtering preserves discovery order and never treats a missing line as nearby. */
export function filterRoadCandidates(
  candidates: readonly RoadCandidate[],
  filter: RoadCandidateFilter = {},
): readonly RoadCandidate[] {
  const filtered = candidates.filter((candidate) => {
    const surface = filter.surface ?? "any";
    if (surface === "gravel" && candidate.surfaceValue !== "gravel") return false;
    if (surface === "unknown" && candidate.surfaceValue !== "unknown") return false;
    if (filter.maxDistanceKm === undefined) return true;
    if (filter.origin === undefined || !Number.isFinite(filter.maxDistanceKm) || filter.maxDistanceKm < 0) return false;
    const distance = roadDistanceKm(candidate, filter.origin);
    return distance !== null && distance <= filter.maxDistanceKm;
  });
  if (filter.origin === undefined) return filtered;
  return [...filtered].sort((left, right) => {
    const leftDistance = roadDistanceKm(left, filter.origin!);
    const rightDistance = roadDistanceKm(right, filter.origin!);
    return (leftDistance ?? Number.POSITIVE_INFINITY) - (rightDistance ?? Number.POSITIVE_INFINITY)
      || left.entity.normalizedName.localeCompare(right.entity.normalizedName)
      || left.id.localeCompare(right.id);
  });
}

/** Exposed for the UI's explicit location action and for deterministic tests. */
export function distanceFromOriginKm(
  candidate: RoadCandidate,
  origin: readonly [number, number],
): number | null {
  return roadDistanceKm(candidate, origin);
}

/** Stable label for the three user-facing discovery slices. */
export function roadDiscoverySliceLabel(slice: RoadDiscoverySlice): string {
  switch (slice) {
    case "great": return "Great roads";
    case "gravel": return "Gravel / unknown surface";
    case "new-to-me": return "New to me";
  }
}
