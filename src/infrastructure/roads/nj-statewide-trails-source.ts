import { createTtlCache } from "@/application/route-intelligence/cache-policy";
import type { RoadReconRecord, RoadReconSource } from "@/application/roads/road-recon-source";
import type { BoundingBox, SourceBudget } from "@/application/route-intelligence/types";
import type { Coordinate } from "@/domain/ride/types";

export const NJ_STATEWIDE_TRAILS_URL =
  "https://mapsdep.nj.gov/arcgis/rest/services/Features/Land_lu/MapServer/121/query";

const NEW_JERSEY: BoundingBox = { west: -75.7, south: 38.8, east: -73.8, north: 41.4 };
const BUDGET: SourceBudget = {
  maxRemoteCallsPerPlan: 2,
  maxRecords: 1_500,
  timeoutMs: 8_000,
  concurrency: 1,
  cacheTtlMs: 14 * 24 * 3_600_000,
  serveStaleMs: 60 * 24 * 3_600_000,
  retry: "none",
  cancellable: true,
};

type Properties = Readonly<Record<string, unknown>>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function line(value: unknown): readonly Coordinate[] | null {
  if (!Array.isArray(value)) return null;
  const coordinates = value.flatMap((point) =>
    Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number"
      ? [{ lon: point[0], lat: point[1] }]
      : []);
  return coordinates.length >= 2 ? coordinates : null;
}

function lines(geometry: unknown): readonly (readonly Coordinate[])[] {
  if (typeof geometry !== "object" || geometry === null) return [];
  const candidate = geometry as { readonly type?: unknown; readonly coordinates?: unknown };
  if (candidate.type === "LineString") {
    const parsed = line(candidate.coordinates);
    return parsed === null ? [] : [parsed];
  }
  if (candidate.type !== "MultiLineString" || !Array.isArray(candidate.coordinates)) return [];
  return candidate.coordinates.flatMap((value) => {
    const parsed = line(value);
    return parsed === null ? [] : [parsed];
  });
}

function notesFor(properties: Properties): readonly string[] {
  const notes: string[] = ["NJ statewide trail compilation reports motorized use; motorcycle legality is not established."];
  const difficulty = text(properties["TRAIL_DIFFICULTY"]);
  if (difficulty !== null) notes.push(`difficulty: ${difficulty}`);
  const park = text(properties["PARK_NAME"]);
  if (park !== null) notes.push(`park: ${park}`);
  const manager = text(properties["MANAGING_AGENCY"]);
  if (manager !== null) notes.push(`manager: ${manager}`);
  const source = text(properties["DATA_SOURCE"]);
  if (source !== null) notes.push(`source: ${source}`);
  const sourceNotes = text(properties["SOURCE_NOTES"]);
  if (sourceNotes !== null) notes.push(sourceNotes.slice(0, 180));
  return notes;
}

export function parseNjStatewideTrails(
  payload: unknown,
  sourceId = "nj-statewide-trails-recon",
): { readonly records: readonly RoadReconRecord[]; readonly truncated: boolean } {
  if (typeof payload !== "object" || payload === null) throw new Error("not an ArcGIS response");
  const collection = payload as { readonly features?: unknown; readonly exceededTransferLimit?: unknown };
  if (!Array.isArray(collection.features)) throw new Error("not an ArcGIS GeoJSON feature collection");

  const records: RoadReconRecord[] = [];
  for (const feature of collection.features) {
    if (typeof feature !== "object" || feature === null) continue;
    const candidate = feature as { readonly id?: unknown; readonly properties?: unknown; readonly geometry?: unknown };
    const properties = typeof candidate.properties === "object" && candidate.properties !== null
      ? candidate.properties as Properties
      : {};
    if (text(properties["MOTORIZED_USE_ALLOWED"])?.toUpperCase() !== "Y") continue;

    const surface = text(properties["SURFACE"]);
    const surfaceHints: RoadReconRecord["surfaceHints"] =
      surface?.toLowerCase() === "unpaved" ? ["unpaved"] : ["unknown"];
    const objectId = properties["OBJECTID"] ?? candidate.id ?? records.length;
    const name = text(properties["TRAIL_NAME_SEGMENT"]) ?? text(properties["TRAIL_NAME_LONG"]);
    const lengthMiles = number(properties["GIS_SEGMENT_LENGTH_MI"]);

    lines(candidate.geometry).forEach((geometry, index) => {
      records.push({
        sourceId,
        sourceRecordId: `${String(objectId)}${index === 0 ? "" : `#${index}`}`,
        name,
        geometry,
        surfaceHints,
        roadOwner: text(properties["MANAGING_AGENCY"]),
        trafficCount: null,
        lengthMiles,
        // The state itself says this compilation was accepted as-is and not field
        // checked. Useful lead, deliberately weaker than a road authority record.
        confidence: surfaceHints[0] === "unpaved" ? 0.65 : 0.5,
        notes: notesFor(properties),
      });
    });
  }

  return { records, truncated: collection.exceededTransferLimit === true };
}

export interface NjStatewideTrailsSourceOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export function createNjStatewideTrailsSource(
  options: NjStatewideTrailsSourceOptions = {},
): RoadReconSource {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache = createTtlCache<string, {
    readonly fetchedAt: string;
    readonly records: readonly RoadReconRecord[];
    readonly truncated: boolean;
  }>({
    ttlMs: BUDGET.cacheTtlMs,
    serveStaleMs: BUDGET.serveStaleMs,
    maxEntries: 128,
    now,
  });
  const info = {
    id: "nj-statewide-trails-recon",
    label: "NJ Statewide Trails (motorized-use recon)",
    coverage: [NEW_JERSEY],
    authority: "recon" as const,
  };
  const keyOf = (box: BoundingBox): string =>
    [box.west, box.south, box.east, box.north].map((value) => value.toFixed(3)).join(":");

  async function load(
    corridor: BoundingBox,
    signal?: AbortSignal,
  ): Promise<{ readonly fetchedAt: string; readonly records: readonly RoadReconRecord[]; readonly truncated: boolean }> {
    const url = new URL(NJ_STATEWIDE_TRAILS_URL);
    url.searchParams.set("f", "geojson");
    url.searchParams.set("where", "MOTORIZED_USE_ALLOWED = 'Y'");
    url.searchParams.set("geometry", `${corridor.west},${corridor.south},${corridor.east},${corridor.north}`);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set(
      "outFields",
      "OBJECTID,TRAIL_NAME_SEGMENT,TRAIL_NAME_LONG,MOTORIZED_USE_ALLOWED,SURFACE,TRAIL_DIFFICULTY,GIS_SEGMENT_LENGTH_MI,PARK_NAME,PARK_WEBSITE,MANAGING_AGENCY,DATA_SOURCE,SOURCE_METHOD,SOURCE_NOTES,LAST_EDITED",
    );
    url.searchParams.set("resultRecordCount", String(BUDGET.maxRecords));
    url.searchParams.set("returnGeometry", "true");

    const controller = new AbortController();
    const relay = (): void => controller.abort();
    signal?.addEventListener("abort", relay, { once: true });
    const timer = setTimeout(() => controller.abort(), BUDGET.timeoutMs);
    try {
      const response = await doFetch(url, {
        signal: controller.signal,
        headers: { accept: "application/geo+json, application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      const parsed = parseNjStatewideTrails(payload, info.id);
      return { fetchedAt: new Date(now()).toISOString(), ...parsed };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", relay);
    }
  }

  return {
    info,
    budget: BUDGET,
    async snapshot(corridor, signal) {
      const key = keyOf(corridor);
      const cached = cache.read(key);
      if (cached.state === "fresh") {
        return {
          status: "fresh",
          fetchedAt: cached.value.fetchedAt,
          reason: cached.value.truncated ? "NJ trail recon result was truncated." : null,
          truncated: cached.value.truncated,
          records: cached.value.records,
          covered: cached.value.truncated ? [] : [corridor],
        };
      }
      try {
        const value = await cache.load(key, () => load(corridor, signal));
        return {
          status: "fresh",
          fetchedAt: value.fetchedAt,
          reason: value.truncated ? "NJ trail recon result was truncated." : null,
          truncated: value.truncated,
          records: value.records,
          covered: value.truncated ? [] : [corridor],
        };
      } catch {
        if (cached.state === "stale") {
          return {
            status: "stale",
            fetchedAt: cached.value.fetchedAt,
            reason: "NJ trail recon could not be refreshed.",
            truncated: cached.value.truncated,
            records: cached.value.records,
            covered: cached.value.truncated ? [] : [corridor],
          };
        }
        return {
          status: "unavailable",
          fetchedAt: null,
          reason: "NJ trail recon is unavailable right now.",
          truncated: false,
          records: [],
          covered: [],
        };
      }
    },
  };
}
