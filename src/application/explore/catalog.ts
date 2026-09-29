import type { LibraryExploreRide, RideSummary } from "@/application/library/library-service";
import { routeAlongShapingPoints } from "@/application/import/import-artifact";
import type { BikeConstraintSnapshot, Coordinate, RideDocument, RidePoint } from "@/domain/ride/types";
import { createRideDocument } from "@/domain/ride/create";
import { newPointId } from "@/domain/ride/ids";
import type { RoadEntity } from "@/domain/roads/road-entity";
import type { RoadDiscoveryRoad, RoadDiscoveryScope } from "@/application/roads/discovery";
import { deepFreeze } from "@/domain/util/freeze";
import {
  aggregateRoadEvidence,
  type RoadEvidenceConfidenceBand,
  ROAD_EVIDENCE_SOURCE_WEIGHTS,
  type RoadEvidenceRecord,
  type RoadEvidenceSummary,
  type RoadEvidenceSource,
} from "@/application/roads/road-evidence";
import { aggregateSurface } from "@/domain/roads/surface";
import {
  buildRouteRoadSummary,
  type RouteRoadSummary,
  type RouteRoadSummaryRow,
} from "@/application/roads/route-road-summary";
import { createRoadEntity } from "@/domain/roads/road-entity";
import { haversine } from "@/domain/geometry/analysis";
import { parseRideStory, parseStoryTeaser, type CatalogRideStory, type CatalogStoryTeaser } from "@/application/explore/ride-story";
import type {
  LongTripCatalogFact,
  LongTripDaylightFact,
  LongTripFacts,
  LongTripWeatherFact,
} from "@/application/long-trip";

export type { LibraryExploreRide } from "@/application/library/library-service";
export type { CatalogRideStory, CatalogStoryTeaser } from "@/application/explore/ride-story";

export type CatalogSource = "catalog" | "personal" | "import";

export interface Bounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface ElevationPoint {
  readonly distanceKm: number;
  readonly elevationMeters: number;
}

export interface CatalogStats {
  readonly surfaceHint?: string;
  readonly elevationProfile?: readonly ElevationPoint[];
}

export interface CatalogVariantSummary {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly distanceKm: number | null;
  readonly copyCount: number;
}

/** Compact per-export facts used so a grouped card can still satisfy filters. */
export interface CatalogGroupMember {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly summary: string;
  readonly distanceKm: number | null;
  readonly previewGeometry: readonly Coordinate[];
  readonly surfaceSummary?: string;
  readonly curvatureSummary?: string;
  readonly nameIsGenerated?: boolean;
}

export interface CatalogRoadDetail {
  readonly entity: RoadEntity;
  /** Matched route geometry used for the static road preview and curvature proxy. */
  readonly geometry?: readonly Coordinate[];
  readonly aliases: readonly string[];
  readonly summary: RouteRoadSummaryRow;
  readonly evidence: readonly RoadEvidenceRecord[];
  readonly evidenceSummary: RoadEvidenceSummary;
  readonly ridesThroughCount: number;
}

export interface CatalogEntry {
  readonly id: string;
  readonly source: CatalogSource;
  readonly name: string;
  readonly region: string;
  readonly summary: string;
  readonly distanceKm: number | null;
  readonly bounds: Bounds | null;
  readonly geometry: readonly Coordinate[];
  /** Small list-card line; detail and planning use full `geometry`. */
  readonly previewGeometry?: readonly Coordinate[];
  readonly stats?: CatalogStats;
  readonly provenance: string;
  /**
   * The mechanics behind `provenance`, for the rider who wants them (09 §6 step
   * 8): what produced the geometry and what has not been checked about it. It is
   * shown behind a disclosure, because a rider choosing a ride needs the one-line
   * truth first.
   */
  readonly provenanceDetail?: string;
  /** M3 route evidence copied into rider-facing label functions at catalog build time. */
  readonly surfaceSummary?: string;
  readonly curvatureSummary?: string;
  /** Stable build-time card family and geometry-track identity for catalog routes. */
  readonly catalogGroupId?: string;
  readonly trackGroupId?: string;
  readonly trackLabel?: string;
  readonly variantCount?: number;
  readonly exportCount?: number;
  readonly nameIsGenerated?: boolean;
  readonly catalogMembers?: readonly CatalogGroupMember[];
  /** Where riders shared the route: post, replies, photos, marked stops (detail only). */
  readonly story?: CatalogRideStory;
  /** Byline-sized slice of the story, carried by the list. */
  readonly storyTeaser?: CatalogStoryTeaser;
  readonly estimatedTimeMinutes?: number;
  readonly roadSummary?: RouteRoadSummary;
  readonly roadDetails?: readonly CatalogRoadDetail[];
  /** Optional evidence bundle for a route that carries planning-time facts. */
  readonly longTripFacts?: LongTripFacts;
  /** The source document is retained only for personal/import derivatives. */
  readonly sourceDocument?: RideDocument;
}

interface RawCatalogEntry {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly region?: unknown;
  readonly summary?: unknown;
  readonly distanceKm?: unknown;
  readonly estimatedTimeMinutes?: unknown;
  readonly bounds?: unknown;
  readonly geometry?: unknown;
  readonly previewGeometry?: unknown;
  readonly stats?: unknown;
  readonly provenance?: unknown;
  readonly provenanceDetail?: unknown;
  readonly surfaceSummary?: unknown;
  readonly curvatureSummary?: unknown;
  readonly catalogGroupId?: unknown;
  readonly trackGroupId?: unknown;
  readonly trackLabel?: unknown;
  readonly variantCount?: unknown;
  readonly exportCount?: unknown;
  readonly nameIsGenerated?: unknown;
  readonly catalogMembers?: unknown;
  readonly roads?: unknown;
  readonly roadSummary?: unknown;
  readonly roadDetails?: unknown;
  readonly longTripFacts?: unknown;
  readonly story?: unknown;
  readonly storyTeaser?: unknown;
}

const SOURCE_ORDER: Readonly<Record<CatalogSource, number>> = {
  catalog: 0,
  personal: 1,
  import: 2,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function longTripCatalogFact(value: unknown): LongTripCatalogFact | undefined {
  if (!isRecord(value)) return undefined;
  const status = value.status;
  const gapKm = value.gapKm;
  if (
    (status !== "available" && status !== "gap" && status !== "unknown")
    || typeof value.summary !== "string"
    || typeof value.source !== "string"
    || typeof value.sourceRef !== "string"
    || (gapKm !== undefined && (!finiteNumber(gapKm) || gapKm < 0))
  ) return undefined;
  return {
    status,
    summary: value.summary,
    source: value.source,
    sourceRef: value.sourceRef,
    ...(gapKm === undefined ? {} : { gapKm }),
  };
}

function longTripFacts(value: unknown): LongTripFacts | undefined {
  if (!isRecord(value)) return undefined;
  const daylightValue = value.daylight;
  const daylight: LongTripDaylightFact | undefined = isRecord(daylightValue)
    && typeof daylightValue.sunset === "string"
    && typeof daylightValue.source === "string"
    && typeof daylightValue.sourceRef === "string"
    ? { sunset: daylightValue.sunset, source: daylightValue.source, sourceRef: daylightValue.sourceRef }
    : undefined;
  const weatherValue = value.weather;
  let weather: LongTripWeatherFact | undefined;
  if (isRecord(weatherValue)) {
    const alerts = weatherValue.alerts;
    const parsedAlerts = Array.isArray(alerts) && alerts.every((item) => isRecord(item) && typeof item.severity === "string")
      ? alerts.map((item) => ({
          severity: String(item.severity),
          ...(typeof item.event === "string" ? { event: item.event } : {}),
        }))
      : [];
    if (
      (weatherValue.state === "ready" || weatherValue.state === "stale")
      && typeof weatherValue.fetchedAt === "string"
      && typeof weatherValue.source === "string"
      && typeof weatherValue.sourceRef === "string"
      && (weatherValue.maxPrecipChance === undefined || (finiteNumber(weatherValue.maxPrecipChance) && weatherValue.maxPrecipChance >= 0 && weatherValue.maxPrecipChance <= 100))
      && (weatherValue.maxWindMph === undefined || (finiteNumber(weatherValue.maxWindMph) && weatherValue.maxWindMph >= 0))
      && (weatherValue.ageMinutes === undefined || (finiteNumber(weatherValue.ageMinutes) && weatherValue.ageMinutes >= 0))
    ) {
      weather = {
        state: weatherValue.state,
        fetchedAt: weatherValue.fetchedAt,
        source: weatherValue.source,
        sourceRef: weatherValue.sourceRef,
        ...(weatherValue.maxPrecipChance === undefined ? {} : { maxPrecipChance: weatherValue.maxPrecipChance }),
        ...(weatherValue.maxWindMph === undefined ? {} : { maxWindMph: weatherValue.maxWindMph }),
        ...(weatherValue.ageMinutes === undefined ? {} : { ageMinutes: weatherValue.ageMinutes }),
        alerts: parsedAlerts,
      };
    }
  }
  const lodging = longTripCatalogFact(value.lodging);
  const service = longTripCatalogFact(value.service);
  const now = typeof value.now === "string" ? value.now : undefined;
  if (daylight === undefined && weather === undefined && lodging === undefined && service === undefined && now === undefined) return undefined;
  return {
    ...(daylight === undefined ? {} : { daylight }),
    ...(weather === undefined ? {} : { weather }),
    ...(lodging === undefined ? {} : { lodging }),
    ...(service === undefined ? {} : { service }),
    ...(now === undefined ? {} : { now }),
  };
}

function coordinate(value: unknown): value is Coordinate {
  return isRecord(value) && finiteNumber(value.lon) && finiteNumber(value.lat);
}

function bounds(value: unknown): value is Bounds {
  return isRecord(value)
    && finiteNumber(value.west)
    && finiteNumber(value.south)
    && finiteNumber(value.east)
    && finiteNumber(value.north);
}

function roadEvidenceSource(value: unknown): value is RoadEvidenceSource {
  return typeof value === "string" && Object.hasOwn(ROAD_EVIDENCE_SOURCE_WEIGHTS, value);
}

function roadEvidenceRecords(
  value: unknown,
  entityId: RoadEntity["id"],
): readonly RoadEvidenceRecord[] | null {
  if (!Array.isArray(value)) return [];
  const records: RoadEvidenceRecord[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const confidence = item.confidence;
    if (
      typeof item.id !== "string"
      || !roadEvidenceSource(item.source)
      || typeof item.observedAt !== "string"
      || (item.value !== null && typeof item.value !== "string")
      || (confidence !== null && (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1))
    ) return null;
    records.push({
      id: item.id,
      entityId,
      source: item.source,
      observedAt: item.observedAt,
      value: item.value,
      confidence,
    });
  }
  return records;
}

function routeGeometrySlice(
  route: readonly Coordinate[],
  startMeters: number,
  endMeters: number,
  fallback: readonly Coordinate[],
): readonly Coordinate[] {
  if (route.length < 2) return fallback;
  const segments = route.slice(0, -1).map((start, index) => {
    const end = route[index + 1];
    return end === undefined ? 0 : haversine(start, end);
  });
  const totalMeters = segments.reduce((total, length) => total + length, 0);
  if (!Number.isFinite(totalMeters) || totalMeters <= 0) return fallback;
  const low = Math.max(0, Math.min(totalMeters, Math.min(startMeters, endMeters)));
  const high = Math.max(0, Math.min(totalMeters, Math.max(startMeters, endMeters)));
  if (high <= low) return fallback;

  function pointAt(target: number): Coordinate {
    let travelled = 0;
    for (let index = 0; index < segments.length; index += 1) {
      const length = segments[index] ?? 0;
      const start = route[index]!;
      const end = route[index + 1]!;
      if (target <= travelled + length || index === segments.length - 1) {
        const fraction = length <= 0 ? 0 : Math.max(0, Math.min(1, (target - travelled) / length));
        return {
          lon: start.lon + (end.lon - start.lon) * fraction,
          lat: start.lat + (end.lat - start.lat) * fraction,
        };
      }
      travelled += length;
    }
    return route.at(-1)!;
  }

  const points: Coordinate[] = [pointAt(low)];
  let travelled = 0;
  for (let index = 1; index < route.length - 1; index += 1) {
    travelled += segments[index - 1] ?? 0;
    if (travelled > low && travelled < high) points.push(route[index]!);
  }
  points.push(pointAt(high));
  return points.length >= 2 ? points : fallback;
}

function roadDetails(
  value: unknown,
  entry: Pick<CatalogEntry, "id" | "geometry" | "distanceKm">,
): { readonly details: readonly CatalogRoadDetail[]; readonly summary: RouteRoadSummary } | null {
  if (!Array.isArray(value)) return null;
  const candidates: Array<{
    readonly detail: CatalogRoadDetail;
    readonly startDistanceMeters: number;
    readonly endDistanceMeters: number;
    readonly evidence: readonly RoadEvidenceRecord[];
  }> = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return null;
    const endpoints = item.endpoints;
    const aliases = item.aliases;
    const ridesThroughCount = item.ridesThroughCount;
    const start = item.startDistanceMeters;
    const end = item.endDistanceMeters;
    if (
      typeof item.name !== "string"
      || typeof item.class !== "string"
      || !Array.isArray(endpoints)
      || !endpoints.every(coordinate)
      || endpoints.length < 2
      || !Array.isArray(aliases)
      || !aliases.every((alias): alias is string => typeof alias === "string")
      || typeof item.firstSeen !== "string"
      || typeof item.lastSeen !== "string"
      || typeof start !== "number"
      || !Number.isFinite(start)
      || typeof end !== "number"
      || !Number.isFinite(end)
      || typeof ridesThroughCount !== "number"
      || !Number.isSafeInteger(ridesThroughCount)
      || ridesThroughCount < 0
    ) return null;
    const identityEntity = createRoadEntity({
      name: item.name,
      class: item.class,
      endpoints,
      firstSeen: item.firstSeen,
      lastSeen: item.lastSeen,
      spans: [`${entry.id}:road-span:${String(index)}`],
    });
    const evidence = roadEvidenceRecords(item.evidence, identityEntity.id);
    if (evidence === null) return null;
    const entity = createRoadEntity({
      name: item.name,
      class: item.class,
      endpoints,
      firstSeen: item.firstSeen,
      lastSeen: item.lastSeen,
      spans: [`${entry.id}:road-span:${String(index)}`],
      evidenceRefs: evidence.map((record) => record.id),
    });
    const evidenceSummary = aggregateRoadEvidence(evidence)[0] ?? {
      entityId: entity.id,
      surfaceValue: null,
      confidence: null,
      confidenceBand: "Unverified" as const,
      conflict: false,
      evidenceCount: 0,
      sourceDiversity: 0,
      latestObservedAt: null,
      records: [],
      surfaceAssessment: aggregateSurface([]),
      surfaceBand: "unknown" as const,
    };
    const surfaceAssessment = evidenceSummary.surfaceAssessment ?? aggregateSurface([]);
    candidates.push({
      detail: {
        entity,
        geometry: routeGeometrySlice(entry.geometry, start, end, endpoints),
        aliases,
        summary: {
          entityId: entity.id,
          distanceKm: 0,
          percentage: 0,
          confidenceBand: "Unverified" as RoadEvidenceConfidenceBand,
          surfaceValue: surfaceAssessment.value,
          surfaceBand: surfaceAssessment.band,
          surfaceAssessment,
        },
        evidence,
        evidenceSummary,
        ridesThroughCount,
      },
      startDistanceMeters: start,
      endDistanceMeters: end,
      evidence,
    });
  }
  const allEvidence = candidates.flatMap((candidate) => candidate.evidence);
  const evidenceSummaries = aggregateRoadEvidence(allEvidence);
  const summary = buildRouteRoadSummary(
    {
      geometry: entry.geometry,
      ...(entry.distanceKm === null ? {} : { distanceMeters: entry.distanceKm * 1000 }),
    },
    candidates.map((candidate) => ({
      entityId: candidate.detail.entity.id,
      startDistanceMeters: candidate.startDistanceMeters,
      endDistanceMeters: candidate.endDistanceMeters,
      matchConfidence: "matched" as const,
    })),
    evidenceSummaries,
  );
  const byEntity = new Map(candidates.map((candidate) => [candidate.detail.entity.id, candidate.detail]));
  const details = summary.roads.flatMap((road) => {
    const candidate = byEntity.get(road.entityId);
    return candidate === undefined ? [] : [{ ...candidate, summary: road }];
  });
  return { details, summary };
}

function readModelRoadSummary(value: unknown): value is RouteRoadSummary {
  if (!isRecord(value) || !Array.isArray(value.roads)) return false;
  if (!finiteNumber(value.totalKm) || value.totalKm < 0
    || !finiteNumber(value.matchedKm) || value.matchedKm < 0
    || !finiteNumber(value.unmatchedKm) || value.unmatchedKm < 0
    || !finiteNumber(value.coveragePercent) || value.coveragePercent < 0 || value.coveragePercent > 100
    || typeof value.unverifiedRoadCount !== "number" || !Number.isSafeInteger(value.unverifiedRoadCount) || value.unverifiedRoadCount < 0) return false;
  return value.roads.every((row) => isRecord(row)
    && typeof row.entityId === "string"
    && finiteNumber(row.distanceKm) && row.distanceKm >= 0
    && finiteNumber(row.percentage) && row.percentage >= 0 && row.percentage <= 100
    && ["High", "Medium", "Low", "Unverified"].includes(String(row.confidenceBand)));
}

function readModelRoadDetails(value: unknown): value is readonly CatalogRoadDetail[] {
  if (!Array.isArray(value)) return false;
  return value.every((detail) => {
    if (!isRecord(detail) || !isRecord(detail.entity) || !isRecord(detail.summary)) return false;
    const entity = detail.entity;
    const row = detail.summary;
    if (typeof entity.id !== "string" || !Array.isArray(detail.evidence)) return false;
    const evidence = roadEvidenceRecords(detail.evidence, entity.id as RoadEntity["id"]);
    const lineageValid = Array.isArray(entity.lineage) && entity.lineage.every((item) => isRecord(item)
      && typeof item.reason === "string"
      && (item.parentId === undefined || typeof item.parentId === "string"));
    return typeof entity.id === "string"
      && typeof entity.name === "string"
      && typeof entity.normalizedName === "string"
      && typeof entity.class === "string"
      && typeof entity.firstSeen === "string"
      && typeof entity.lastSeen === "string"
      && lineageValid
      && Array.isArray(entity.spans) && entity.spans.every((span) => typeof span === "string")
      && Array.isArray(entity.evidenceRefs) && entity.evidenceRefs.every((id) => typeof id === "string")
      && Array.isArray(detail.aliases) && detail.aliases.every((alias) => typeof alias === "string")
      && (detail.geometry === undefined || (Array.isArray(detail.geometry) && detail.geometry.every(coordinate)))
      && row.entityId === entity.id
      && finiteNumber(row.distanceKm) && row.distanceKm >= 0
      && finiteNumber(row.percentage) && row.percentage >= 0 && row.percentage <= 100
      && ["High", "Medium", "Low", "Unverified"].includes(String(row.confidenceBand))
      && evidence !== null
      && isRecord(detail.evidenceSummary)
      && detail.evidenceSummary.entityId === entity.id
      && (detail.evidenceSummary.surfaceValue === null || typeof detail.evidenceSummary.surfaceValue === "string")
      && (detail.evidenceSummary.confidence === null || (finiteNumber(detail.evidenceSummary.confidence)
        && detail.evidenceSummary.confidence >= 0 && detail.evidenceSummary.confidence <= 1))
      && ["High", "Medium", "Low", "Unverified"].includes(String(detail.evidenceSummary.confidenceBand))
      && typeof detail.evidenceSummary.conflict === "boolean"
      && typeof detail.evidenceSummary.evidenceCount === "number"
      && Number.isSafeInteger(detail.evidenceSummary.evidenceCount)
      && detail.evidenceSummary.evidenceCount >= 0
      && typeof detail.evidenceSummary.sourceDiversity === "number"
      && Number.isSafeInteger(detail.evidenceSummary.sourceDiversity)
      && detail.evidenceSummary.sourceDiversity >= 0
      && (detail.evidenceSummary.latestObservedAt === null || typeof detail.evidenceSummary.latestObservedAt === "string")
      && Array.isArray(detail.evidenceSummary.records)
      && roadEvidenceRecords(detail.evidenceSummary.records, entity.id as RoadEntity["id"]) !== null
      && typeof detail.ridesThroughCount === "number"
      && Number.isSafeInteger(detail.ridesThroughCount)
      && detail.ridesThroughCount >= 0;
  });
}

function roadReadModel(
  summaryValue: unknown,
  detailsValue: unknown,
): { readonly summary: RouteRoadSummary; readonly details: readonly CatalogRoadDetail[] } | null {
  return readModelRoadSummary(summaryValue) && readModelRoadDetails(detailsValue)
    ? { summary: summaryValue, details: detailsValue }
    : null;
}

export function parseCatalogEntry(value: unknown): CatalogEntry | null {
  const raw = value as RawCatalogEntry;
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== "string" ||
    typeof raw.name !== "string" ||
    typeof raw.region !== "string" ||
    typeof raw.summary !== "string" ||
    typeof raw.provenance !== "string" ||
    !Array.isArray(raw.geometry) ||
    !raw.geometry.every(coordinate)
  ) return null;
  const distanceKm = raw.distanceKm === null ? null : raw.distanceKm;
  if (distanceKm !== null && !finiteNumber(distanceKm)) return null;
  const estimatedTimeMinutes = raw.estimatedTimeMinutes;
  if (estimatedTimeMinutes !== undefined && !finiteNumber(estimatedTimeMinutes)) return null;
  if (raw.bounds !== null && raw.bounds !== undefined && !bounds(raw.bounds)) return null;
  const previewGeometry = raw.previewGeometry === undefined
    ? undefined
    : Array.isArray(raw.previewGeometry) && raw.previewGeometry.every(coordinate)
      ? raw.previewGeometry
      : null;
  if (previewGeometry === null) return null;
  const catalogMembers = raw.catalogMembers === undefined
    ? undefined
    : Array.isArray(raw.catalogMembers) && raw.catalogMembers.every((member) => isRecord(member)
      && typeof member.id === "string"
      && typeof member.name === "string"
      && typeof member.region === "string"
      && typeof member.summary === "string"
      && (member.distanceKm === null || (finiteNumber(member.distanceKm) && member.distanceKm >= 0))
      && Array.isArray(member.previewGeometry)
      && member.previewGeometry.every(coordinate)
      && (member.surfaceSummary === undefined || typeof member.surfaceSummary === "string")
      && (member.curvatureSummary === undefined || typeof member.curvatureSummary === "string")
      && (member.nameIsGenerated === undefined || typeof member.nameIsGenerated === "boolean"))
      ? raw.catalogMembers as CatalogGroupMember[]
      : null;
  if (catalogMembers === null) return null;
  const story = parseRideStory(raw.story);
  const teaser = parseStoryTeaser(raw.storyTeaser);
  if (story === null || teaser === null) return null;
  const parsedLongTripFacts = longTripFacts(raw.longTripFacts);
  const base: CatalogEntry = {
    id: raw.id,
    source: "catalog",
    name: raw.name,
    region: raw.region,
    summary: raw.summary,
    distanceKm,
    bounds: raw.bounds === undefined ? null : raw.bounds,
    geometry: raw.geometry,
    ...(previewGeometry === undefined ? {} : { previewGeometry }),
    provenance: raw.provenance,
    ...(typeof raw.provenanceDetail === "string" ? { provenanceDetail: raw.provenanceDetail } : {}),
    ...(typeof raw.surfaceSummary === "string" ? { surfaceSummary: raw.surfaceSummary } : {}),
    ...(typeof raw.curvatureSummary === "string" ? { curvatureSummary: raw.curvatureSummary } : {}),
    ...(typeof raw.catalogGroupId === "string" ? { catalogGroupId: raw.catalogGroupId } : {}),
    ...(typeof raw.trackGroupId === "string" ? { trackGroupId: raw.trackGroupId } : {}),
    ...(typeof raw.trackLabel === "string" ? { trackLabel: raw.trackLabel } : {}),
    ...(typeof raw.variantCount === "number" && Number.isSafeInteger(raw.variantCount) && raw.variantCount > 0 ? { variantCount: raw.variantCount } : {}),
    ...(typeof raw.exportCount === "number" && Number.isSafeInteger(raw.exportCount) && raw.exportCount > 0 ? { exportCount: raw.exportCount } : {}),
    ...(typeof raw.nameIsGenerated === "boolean" ? { nameIsGenerated: raw.nameIsGenerated } : {}),
    ...(catalogMembers === undefined ? {} : { catalogMembers }),
    ...(story === undefined ? {} : { story }),
    ...(teaser === undefined ? {} : { storyTeaser: teaser }),
    ...(estimatedTimeMinutes === undefined ? {} : { estimatedTimeMinutes }),
    ...(parsedLongTripFacts === undefined ? {} : { longTripFacts: parsedLongTripFacts }),
  };
  const roadData = roadReadModel(raw.roadSummary, raw.roadDetails) ?? roadDetails(raw.roads, base);
  return roadData === null
    ? base
    : { ...base, roadSummary: roadData.summary, roadDetails: roadData.details };
}

export function parseCatalogEntries(value: unknown): readonly CatalogEntry[] {
  return deepFreeze(
    (Array.isArray(value) ? value : [])
    .map(parseCatalogEntry)
    .filter((entry): entry is CatalogEntry => entry !== null),
  );
}

export function boundsForGeometry(geometry: readonly Coordinate[]): Bounds | null {
  if (geometry.length === 0) return null;
  return geometry.reduce<Bounds>(
    (current, point) => ({
      west: Math.min(current.west, point.lon),
      south: Math.min(current.south, point.lat),
      east: Math.max(current.east, point.lon),
      north: Math.max(current.north, point.lat),
    }),
    {
      west: geometry[0]!.lon,
      south: geometry[0]!.lat,
      east: geometry[0]!.lon,
      north: geometry[0]!.lat,
    },
  );
}

function librarySource(summary: RideSummary): CatalogSource {
  return summary.provenanceType === "import" || summary.type === "imported"
    ? "import"
    : "personal";
}

function libraryProvenance(summary: RideSummary): string {
  const source = summary.sourceId === null ? "the saved library record" : `source ${summary.sourceId}`;
  return summary.provenanceType === "import"
    ? `imported route from the saved library (${source})`
    : `saved library ride (${source}); route geometry is not computed here`;
}

export function entryFromLibraryRide(ride: LibraryExploreRide): CatalogEntry {
  const geometry = ride.geometry;
  return {
    id: String(ride.summary.rideId),
    source: librarySource(ride.summary),
    name: ride.summary.title,
    region: ride.summary.area ?? "Your rides",
    summary: "A ride from your local library.",
    distanceKm: ride.summary.distanceMeters === null ? null : ride.summary.distanceMeters / 1000,
    ...(ride.summary.durationSeconds === null ? {} : { estimatedTimeMinutes: ride.summary.durationSeconds / 60 }),
    bounds: boundsForGeometry(geometry),
    geometry,
    provenance: libraryProvenance(ride.summary),
    sourceDocument: ride.document,
  };
}

function compareEntries(a: CatalogEntry, b: CatalogEntry): number {
  return SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]
    || a.name.localeCompare(b.name)
    || a.id.localeCompare(b.id);
}

/** Merge sources without mutating either input; the first source owns duplicate ids. */
export function mergeCatalogEntries(
  catalog: readonly CatalogEntry[],
  library: readonly CatalogEntry[],
): readonly CatalogEntry[] {
  const byId = new Map<string, CatalogEntry>();
  for (const entry of [...catalog, ...library]) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort(compareEntries);
}

export function loadCatalog(
  libraryRides: readonly LibraryExploreRide[] = [],
  catalogEntries: readonly CatalogEntry[] = [],
): readonly CatalogEntry[] {
  return mergeCatalogEntries(
    catalogEntries,
    libraryRides.map(entryFromLibraryRide),
  );
}

/**
 * Joins catalog road read-model rows with local ride history for discovery.
 * Catalog routes are source material, not ridden history; only a saved/imported
 * ride's marked road spans make an entity ineligible for New to me.
 */
export function roadDiscoveryScopeFromCatalog(
  entries: readonly CatalogEntry[],
): RoadDiscoveryScope {
  const roads: RoadDiscoveryRoad[] = [];
  const riddenRoadIds = new Set<RoadEntity["id"]>();
  for (const entry of entries) {
    for (const detail of entry.roadDetails ?? []) {
      roads.push({
        entity: detail.entity,
        geometry: detail.geometry,
        matchedDistanceKm: detail.summary.distanceKm,
        matchedRideCount: detail.ridesThroughCount,
        ridesThroughCount: detail.ridesThroughCount,
        region: entry.region,
        aliases: detail.aliases,
        evidence: detail.evidence,
        evidenceSummary: detail.evidenceSummary,
        sourceRouteIds: [entry.id],
      });
      if (detail.ridesThroughCount > 0) riddenRoadIds.add(detail.entity.id);
    }
    if (entry.source !== "catalog") {
      for (const span of entry.sourceDocument?.intent.roadSpans ?? []) {
        if (span.roadEntityId !== undefined) riddenRoadIds.add(span.roadEntityId);
      }
    }
  }
  return {
    roads,
    riddenRoadIds: [...riddenRoadIds].sort((left, right) => left.localeCompare(right)),
  };
}

function endpoint(kind: "start" | "finish", coordinate: Coordinate, sourceId: string): RidePoint {
  return {
    id: newPointId(),
    kind,
    coordinate,
    provenance: { type: "derived", reason: `Explore route ${sourceId} endpoint` },
  };
}

function sourceProvenance(entry: CatalogEntry): RideDocument["provenance"] {
  switch (entry.source) {
    case "catalog":
      return { type: "catalog", sourceId: entry.id };
    case "import":
      return { type: "import", sourceId: entry.id };
    case "personal":
      return { type: "derived", sourceId: entry.id };
  }
}

/** Build the private planner document used by the real Use this ride action. */
export function createExploreDerivative(
  entry: CatalogEntry,
  now = new Date().toISOString(),
  bike?: BikeConstraintSnapshot,
): RideDocument {
  const base = createRideDocument({
    now,
    title: `${entry.name} copy`,
    provenance: sourceProvenance(entry),
  });
  const sourceIntent = entry.sourceDocument?.intent;
  const start = sourceIntent?.start ?? (entry.geometry[0] === undefined ? null : endpoint("start", entry.geometry[0], entry.id));
  const finish = sourceIntent?.finish ?? (entry.geometry.at(-1) === undefined ? null : endpoint("finish", entry.geometry.at(-1)!, entry.id));
  const shaping = sourceIntent?.shaping.length
    ? sourceIntent.shaping
    : routeAlongShapingPoints(entry.geometry);
  const intent = deepFreeze({
    ...base.intent,
    ...(sourceIntent === undefined ? {} : sourceIntent),
    ...(bike === undefined ? {} : { bike }),
    start,
    finish,
    shaping,
  });
  return deepFreeze({
    ...base,
    intent,
    history: { ...base.history, baseIntent: intent },
  });
}

export function sourceKindForEntry(entry: CatalogEntry): "catalog" | "import" | "ride" {
  return entry.source === "personal" ? "ride" : entry.source;
}
