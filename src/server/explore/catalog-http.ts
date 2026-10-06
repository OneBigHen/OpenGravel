import type { CatalogEntry } from "@/application/explore/catalog";
import { compareCatalogQuality, matchesCatalogSurface } from "@/application/explore/query";
import { storyTeaser } from "@/application/explore/ride-story";

const MILES_PER_KM = 1 / 1.609344;
export const CATALOG_CACHE_HEADERS = {
  "cache-control": "public, max-age=0, s-maxage=15, must-revalidate",
};
const CATALOG_PRIVATE_HEADERS = { "cache-control": "private, no-store" };

export interface CatalogHttpResult {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string>>;
}

function result(
  status: number,
  body: Readonly<Record<string, unknown>>,
  headers: Readonly<Record<string, string>> = CATALOG_CACHE_HEADERS,
): CatalogHttpResult {
  return { status, body, headers };
}

function numericParameter(params: URLSearchParams, name: string, maximum: number): number | undefined | null {
  const raw = params.get(name);
  if (raw === null) return undefined;
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
}

function coordinates(raw: string | null): readonly [number, number] | undefined | null {
  if (raw === null) return undefined;
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(raw);
  if (match === null) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

function distanceKm(first: readonly [number, number], second: readonly [number, number]): number {
  const radians = Math.PI / 180;
  const dLat = (second[0] - first[0]) * radians;
  const dLon = (second[1] - first[1]) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(first[0] * radians) * Math.cos(second[0] * radians) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function compactPreview(points: CatalogEntry["geometry"]): CatalogEntry["geometry"] {
  if (points.length <= 24) return points;
  return Array.from({ length: 24 }, (_, index) => points[Math.round(index * (points.length - 1) / 23)]!);
}

export function handleCatalogList(url: URL, entries: readonly CatalogEntry[]): CatalogHttpResult {
  const params = url.searchParams;
  const minMiles = numericParameter(params, "minMiles", 10_000);
  const maxMiles = numericParameter(params, "maxMiles", 10_000);
  const near = coordinates(params.get("near"));
  const radiusMiles = numericParameter(params, "radiusMiles", 10_000);
  const surface = params.get("surface");
  const curvy = params.get("curvy");
  const search = params.get("search")?.trim().toLowerCase() ?? "";
  const headers = params.has("near") || params.has("search") ? CATALOG_PRIVATE_HEADERS : CATALOG_CACHE_HEADERS;
  const respond = (status: number, body: Readonly<Record<string, unknown>>) => result(status, body, headers);
  if (minMiles === null || maxMiles === null || near === null || radiusMiles === null
    || (minMiles !== undefined && maxMiles !== undefined && minMiles > maxMiles)
    || (surface !== null && surface !== "paved" && surface !== "gravel")
    || (curvy !== null && curvy !== "true" && curvy !== "false")
    || search.length > 100) return respond(400, { error: "Invalid catalog filter." });

  const filtered = entries.filter((entry) => {
    const miles = entry.distanceKm === null ? null : entry.distanceKm * MILES_PER_KM;
    const start = entry.geometry[0];
    return (minMiles === undefined || (miles !== null && miles >= minMiles))
      && (maxMiles === undefined || (miles !== null && miles <= maxMiles))
      && (near === undefined || (start !== undefined && distanceKm(near, [start.lat, start.lon]) <= (radiusMiles ?? 50) * 1.609344))
      && (surface === null || (entry.surfaceSummary !== undefined
        && matchesCatalogSurface(entry.surfaceSummary, surface)))
      && (curvy !== "true" || (entry.curvatureSummary !== undefined && entry.curvatureSummary !== "Few curves"))
      && (curvy !== "false" || (entry.curvatureSummary !== undefined && entry.curvatureSummary === "Few curves"))
      && (search.length === 0 || `${entry.name} ${entry.region} ${entry.summary} ${entry.story?.description ?? ""}`.toLowerCase().includes(search));
  });
  const filteredGroups = new Map<string, CatalogEntry[]>();
  for (const entry of filtered) {
    const key = entry.catalogGroupId ?? `single:${entry.id}`;
    filteredGroups.set(key, [...(filteredGroups.get(key) ?? []), entry]);
  }
  const allGroups = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const key = entry.catalogGroupId ?? `single:${entry.id}`;
    allGroups.set(key, [...(allGroups.get(key) ?? []), entry]);
  }
  const routes = [...filteredGroups].map(([key, members]) => {
    const representative = [...members].sort(compareCatalogQuality)[0]!;
    const sourceMembers = allGroups.get(key) ?? members;
    const variantCount = new Set(sourceMembers.map((entry) => entry.trackGroupId ?? entry.id)).size;
    const { geometry, previewGeometry, story, ...entry } = representative;
    const catalogMembers = sourceMembers.map((member) => ({
      id: member.id,
      name: member.name,
      region: member.region,
      summary: member.summary,
      distanceKm: member.distanceKm,
      previewGeometry: compactPreview(member.previewGeometry ?? member.geometry),
      ...(member.surfaceSummary === undefined ? {} : { surfaceSummary: member.surfaceSummary }),
      ...(member.curvatureSummary === undefined ? {} : { curvatureSummary: member.curvatureSummary }),
      ...(member.nameIsGenerated === undefined ? {} : { nameIsGenerated: member.nameIsGenerated }),
    }));
    return {
      ...entry,
      ...(story === undefined ? {} : { storyTeaser: storyTeaser(story) }),
      variantCount,
      exportCount: sourceMembers.length,
      catalogMembers,
      preview: previewGeometry ?? geometry,
    };
  });
  return respond(200, { count: routes.length, routes });
}

export function handleCatalogDetail(id: string, entries: readonly CatalogEntry[]): CatalogHttpResult {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return result(400, { error: "Invalid catalog route id." });
  const entry = entries.find((route) => route.id === id);
  if (entry === undefined) return result(404, { error: "Catalog route not found." });
  const group = entry.catalogGroupId === undefined
    ? [entry]
    : entries.filter((route) => route.catalogGroupId === entry.catalogGroupId);
  const trackGroups = new Map<string, CatalogEntry[]>();
  for (const track of group) {
    const key = track.trackGroupId ?? track.id;
    trackGroups.set(key, [...(trackGroups.get(key) ?? []), track]);
  }
  const variants = trackGroups.size < 2 && group.length < 2 ? undefined : [...trackGroups.values()]
    .map((tracks, index) => {
      const representative = [...tracks].sort(compareCatalogQuality)[0]!;
      return {
        id: representative.id,
        label: representative.trackLabel ?? (trackGroups.size > 1 ? `Track ${index + 1}` : ""),
        name: representative.name,
        distanceKm: representative.distanceKm,
        copyCount: tracks.length,
      };
    });
  return result(200, { route: entry, ...(variants === undefined ? {} : { variants }) });
}
