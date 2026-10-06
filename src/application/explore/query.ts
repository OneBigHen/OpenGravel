import type { CatalogEntry, CatalogSource } from "./catalog";
import { parsePaRidingArea, startsInPaRidingArea, type PaRidingArea } from "./riding-areas";

/** Short ≤ 30 mi, medium 30–90 mi, long > 90 mi. */
export type DistanceBucket = "short" | "medium" | "long";

const KM_PER_MILE = 1.609344;
const SHORT_MAX_KM = 30 * KM_PER_MILE;
const MEDIUM_MAX_KM = 90 * KM_PER_MILE;

/** Links shared before the buckets moved to miles keep working. */
const LEGACY_BUCKETS: Readonly<Record<string, DistanceBucket>> = {
  "under-50": "short",
  "50-150": "medium",
  "over-150": "long",
};
export type ExploreSort = "recommended" | "distance-asc" | "distance-desc" | "name" | "near";

export interface ExploreQuery {
  readonly source?: CatalogSource;
  readonly distance?: DistanceBucket;
  readonly region?: string;
  readonly area?: PaRidingArea;
  readonly search?: string;
  readonly surface?: "paved" | "gravel";
  readonly curvy?: boolean;
  readonly sort: ExploreSort;
}

const DEFAULT_QUERY: ExploreQuery = { sort: "recommended" };

export function matchesCatalogSurface(summary: string, surface: NonNullable<ExploreQuery["surface"]>): boolean {
  return surface === "gravel"
    ? /gravel|unpaved|mixed/i.test(summary)
    : /\bpaved\b/i.test(summary);
}

function source(value: string | null): CatalogSource | undefined {
  return value === "catalog" || value === "personal" || value === "import" ? value : undefined;
}

function distance(value: string | null): DistanceBucket | undefined {
  if (value === "short" || value === "medium" || value === "long") return value;
  return value === null ? undefined : LEGACY_BUCKETS[value];
}

function sort(value: string | null): ExploreSort {
  if (value === "near") return DEFAULT_QUERY.sort;
  return value === "recommended" || value === "distance-asc" || value === "distance-desc" || value === "name"
    ? value
    : DEFAULT_QUERY.sort;
}

export function parseExploreQuery(value: string | URLSearchParams): ExploreQuery {
  const params = typeof value === "string" ? new URLSearchParams(value.startsWith("?") ? value.slice(1) : value) : value;
  const parsedSource = source(params.get("source"));
  const parsedDistance = distance(params.get("distance"));
  const area = parsePaRidingArea(params.get("area"));
  const region = params.get("region")?.trim() ?? "";
  const search = params.get("search")?.trim() ?? "";
  const surface = params.get("surface");
  const curvy = params.get("curvy");
  return {
    ...(parsedSource === undefined ? {} : { source: parsedSource }),
    ...(parsedDistance === undefined ? {} : { distance: parsedDistance }),
    ...(region.length === 0 ? {} : { region }),
    ...(search.length === 0 ? {} : { search }),
    ...(surface === "paved" || surface === "gravel" ? { surface } : {}),
    ...(curvy === "true" ? { curvy: true } : {}),
    ...(area === undefined ? {} : { area }),
    sort: sort(params.get("sort")),
  };
}

export function serializeExploreQuery(query: ExploreQuery): string {
  const params = new URLSearchParams();
  if (query.area !== undefined) params.set("area", query.area);
  if (query.source !== undefined) params.set("source", query.source);
  if (query.distance !== undefined) params.set("distance", query.distance);
  if (query.region?.trim()) params.set("region", query.region.trim());
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.surface !== undefined) params.set("surface", query.surface);
  if (query.curvy === true) params.set("curvy", "true");
  if (query.sort !== DEFAULT_QUERY.sort && query.sort !== "near") params.set("sort", query.sort);
  const value = params.toString();
  return value.length === 0 ? "" : `?${value}`;
}

function inDistanceBucket(entry: CatalogEntry, bucket: DistanceBucket): boolean {
  if (entry.distanceKm === null) return false;
  if (bucket === "short") return entry.distanceKm <= SHORT_MAX_KM;
  if (bucket === "medium") return entry.distanceKm > SHORT_MAX_KM && entry.distanceKm <= MEDIUM_MAX_KM;
  return entry.distanceKm > MEDIUM_MAX_KM;
}

function distanceBetween(first: readonly [number, number], second: readonly [number, number]): number {
  const [firstLon, firstLat] = first;
  const [secondLon, secondLat] = second;
  const radians = Math.PI / 180;
  const deltaLat = (secondLat - firstLat) * radians;
  const deltaLon = (secondLon - firstLon) * radians;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(firstLat * radians) * Math.cos(secondLat * radians) * Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function memberEntries(entry: CatalogEntry): readonly CatalogEntry[] {
  return entry.catalogMembers?.map((member) => ({
    ...entry,
    ...member,
    id: member.id,
    geometry: member.previewGeometry,
    previewGeometry: member.previewGeometry,
    catalogMembers: entry.catalogMembers,
  })) ?? [entry];
}

/** Kilometres from the rider to where a route starts (Infinity without a line). */
export function distanceToStartKm(origin: readonly [number, number], entry: CatalogEntry): number {
  return distanceFrom(origin, entry);
}

function distanceFrom(origin: readonly [number, number], entry: CatalogEntry): number {
  const point = entry.geometry[0];
  return point === undefined ? Number.POSITIVE_INFINITY : distanceBetween(origin, [point.lon, point.lat]);
}

function selectCatalogCardMember(
  members: readonly CatalogEntry[],
  query: ExploreQuery,
  origin?: readonly [number, number],
): CatalogEntry {
  return [...members].sort((a, b) => {
    if ((query.sort === "near" || query.sort === "recommended") && origin !== undefined) {
      return distanceFrom(origin, a) - distanceFrom(origin, b) || compareCatalogQuality(a, b);
    }
    if (query.sort === "name") return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    if (query.sort === "distance-desc") return (b.distanceKm ?? -Infinity) - (a.distanceKm ?? -Infinity) || a.id.localeCompare(b.id);
    if (query.sort === "distance-asc") return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.id.localeCompare(b.id);
    return compareCatalogQuality(a, b);
  })[0]!;
}

function matchesQuery(entry: CatalogEntry, query: ExploreQuery): boolean {
  return (query.source === undefined || entry.source === query.source)
    && (query.distance === undefined || inDistanceBucket(entry, query.distance))
    && (query.area === undefined || startsInPaRidingArea(entry, query.area))
    && (query.region === undefined || entry.region.toLowerCase().includes(query.region.trim().toLowerCase()))
    && (query.search === undefined || `${entry.name} ${entry.region} ${entry.summary}`.toLowerCase().includes(query.search.trim().toLowerCase()))
    && (query.surface === undefined || (entry.surfaceSummary !== undefined
      && matchesCatalogSurface(entry.surfaceSummary, query.surface)))
    && (query.curvy !== true || (entry.curvatureSummary !== undefined && entry.curvatureSummary !== "Few curves"));
}

export function compareCatalogQuality(a: CatalogEntry, b: CatalogEntry): number {
  const hasEvidence = (entry: CatalogEntry): boolean => entry.surfaceSummary !== undefined || entry.curvatureSummary !== undefined;
  const hasCurves = (entry: CatalogEntry): boolean => entry.curvatureSummary !== undefined && !/few curves|unknown|not measured/i.test(entry.curvatureSummary);
  const hasUsefulDistance = (entry: CatalogEntry): boolean => entry.distanceKm !== null
    && entry.distanceKm >= 30 * KM_PER_MILE && entry.distanceKm <= 250 * KM_PER_MILE;
  const isNamed = (entry: CatalogEntry): boolean => entry.nameIsGenerated !== true;
  return Number(hasEvidence(b)) - Number(hasEvidence(a))
    || Number(hasCurves(b)) - Number(hasCurves(a))
    || Number(hasUsefulDistance(b)) - Number(hasUsefulDistance(a))
    || Number(isNamed(b)) - Number(isNamed(a))
    || a.id.localeCompare(b.id);
}

export function filterAndSortCatalog(
  entries: readonly CatalogEntry[],
  query: ExploreQuery,
  origin?: readonly [number, number],
): readonly CatalogEntry[] {
  const filtered = entries.flatMap((entry) => {
    const matchingMembers = memberEntries(entry).filter((member) => matchesQuery(member, query));
    return matchingMembers.length === 0 ? [] : [selectCatalogCardMember(matchingMembers, query, origin)];
  });
  return [...filtered].sort((a, b) => {
    if (query.sort === "name") return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    if (query.sort === "distance-desc") return (b.distanceKm ?? -Infinity) - (a.distanceKm ?? -Infinity) || a.id.localeCompare(b.id);
    if ((query.sort === "near" || query.sort === "recommended") && origin !== undefined) {
      return distanceFrom(origin, a) - distanceFrom(origin, b) || compareCatalogQuality(a, b);
    }
    if (query.sort === "near") return compareCatalogQuality(a, b);
    if (query.sort === "recommended") return compareCatalogQuality(a, b);
    return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.id.localeCompare(b.id);
  });
}
