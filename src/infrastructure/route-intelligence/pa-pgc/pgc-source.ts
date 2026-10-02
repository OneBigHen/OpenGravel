import { createTtlCache } from "@/application/route-intelligence/cache-policy";
import type { RoadAuthoritySource } from "@/application/route-intelligence/road-authority-source";
import type {
  BoundingBox,
  MotorcycleAccess,
  RoadAuthorityRecord,
  RoadAuthoritySourceInfo,
  SourceBudget,
} from "@/application/route-intelligence/types";
import type { Coordinate } from "@/domain/ride/types";

export const PGC_SEASONAL_ROADS_URL =
  "https://pgcmaps.pa.gov/arcgis/rest/services/PGC/Seasonal_Roads/MapServer/0/query";

const PENNSYLVANIA: BoundingBox = { west: -80.6, south: 39.7, east: -74.6, north: 42.6 };
const BUDGET: SourceBudget = {
  maxRemoteCallsPerPlan: 1,
  maxRecords: 1_000,
  timeoutMs: 8_000,
  concurrency: 1,
  cacheTtlMs: 24 * 3_600_000,
  serveStaleMs: 7 * 24 * 3_600_000,
  retry: "none",
  cancellable: true,
};

type Properties = Readonly<Record<string, unknown>>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

function accessOf(useType: unknown): MotorcycleAccess {
  switch (text(useType)?.toUpperCase()) {
    case "A": return { status: "closed", seasons: null };
    case "G":
    case "P": return { status: "open", seasons: null };
    case "S": return { status: "open", seasons: [] };
    default: return { status: "unknown", seasons: null };
  }
}

function descriptionOf(properties: Properties): string {
  const parts: string[] = [];
  const sgl = typeof properties["SGL"] === "number" ? `SGL ${properties["SGL"]}` : null;
  if (sgl !== null) parts.push(sgl);
  const surface = text(properties["SURFACE"]);
  if (surface !== null) {
    const label = surface.toUpperCase() === "D" ? "dirt"
      : surface.toUpperCase() === "P" ? "paved"
        : surface.toUpperCase() === "G" ? "grass"
          : null;
    if (label !== null) parts.push(label);
  }
  if (text(properties["MAINTENANC"])?.toUpperCase() === "N") parts.push("not maintained");
  const notes = text(properties["NOTES"]);
  if (notes !== null) parts.push(notes.slice(0, 180));
  return parts.length > 0 ? parts.join(" · ") : "Pennsylvania Game Commission road access designation.";
}

export function parsePgcSeasonalRoads(payload: unknown, sourceId = "pa-pgc-seasonal-roads"): readonly RoadAuthorityRecord[] {
  if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { readonly features?: unknown }).features)) {
    throw new Error("not an ArcGIS GeoJSON feature collection");
  }

  const records: RoadAuthorityRecord[] = [];
  for (const feature of (payload as { readonly features: unknown[] }).features) {
    if (typeof feature !== "object" || feature === null) continue;
    const candidate = feature as { readonly id?: unknown; readonly properties?: unknown; readonly geometry?: unknown };
    const properties = typeof candidate.properties === "object" && candidate.properties !== null
      ? candidate.properties as Properties
      : {};
    if (text(properties["CURRENT_"])?.toUpperCase() === "N") continue;
    const objectId = properties["OBJECTID"] ?? candidate.id ?? records.length;
    const roadName = text(properties["STNAME"])
      ?? (typeof properties["SGL"] === "number" ? `SGL ${properties["SGL"]} road` : null);
    const motorcycleAccess = accessOf(properties["USE_TYPE"]);

    lines(candidate.geometry).forEach((geometry, index) => {
      records.push({
        sourceId,
        sourceRecordId: `${String(objectId)}${index === 0 ? "" : `#${index}`}`,
        kind: "motor-vehicle-designation",
        geometry: { type: "line", coordinates: geometry },
        roadName,
        description: descriptionOf(properties),
        validFrom: null,
        validUntil: null,
        motorcycleAccess,
      });
    });
  }
  return records;
}

export interface PgcSeasonalRoadsSourceOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export function createPgcSeasonalRoadsSource(options: PgcSeasonalRoadsSourceOptions = {}): RoadAuthoritySource {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const info: RoadAuthoritySourceInfo = {
    id: "pa-pgc-seasonal-roads",
    label: "Pennsylvania Game Commission seasonal roads",
    authority: "authoritative-operational",
    family: "road-authority",
    facet: "access",
    coverage: [PENNSYLVANIA],
    precedence: 0,
  };
  const cache = createTtlCache<string, { readonly fetchedAt: string; readonly records: readonly RoadAuthorityRecord[] }>({
    ttlMs: BUDGET.cacheTtlMs,
    serveStaleMs: BUDGET.serveStaleMs,
    maxEntries: 128,
    now,
  });

  const keyOf = (box: BoundingBox): string =>
    [box.west, box.south, box.east, box.north].map((value) => value.toFixed(2)).join(":");

  async function load(corridor: BoundingBox): Promise<{ readonly fetchedAt: string; readonly records: readonly RoadAuthorityRecord[] }> {
    const url = new URL(PGC_SEASONAL_ROADS_URL);
    url.searchParams.set("f", "geojson");
    url.searchParams.set("where", "CURRENT_ = 'Y'");
    url.searchParams.set("geometry", `${corridor.west},${corridor.south},${corridor.east},${corridor.north}`);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("outFields", "OBJECTID,SGL,STNAME,USE_TYPE,SURFACE,CONDITION,MAINTENANC,OWNER,MOD_DATE,NOTES,CURRENT_");
    url.searchParams.set("resultRecordCount", String(BUDGET.maxRecords));
    url.searchParams.set("returnGeometry", "true");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BUDGET.timeoutMs);
    try {
      const response = await doFetch(url, { signal: controller.signal, headers: { accept: "application/geo+json, application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      return { fetchedAt: new Date(now()).toISOString(), records: parsePgcSeasonalRoads(payload, info.id) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    info,
    budget: BUDGET,
    probe: () => ({ available: true, reason: null }),
    async snapshot(corridor) {
      const key = keyOf(corridor);
      const cached = cache.read(key);
      if (cached.state === "fresh") {
        return { status: "fresh", fetchedAt: cached.value.fetchedAt, reason: null, records: cached.value.records, covered: [corridor] };
      }
      try {
        const value = await cache.load(key, () => load(corridor));
        return { status: "fresh", fetchedAt: value.fetchedAt, reason: null, records: value.records, covered: [corridor] };
      } catch {
        if (cached.state === "stale") {
          return { status: "stale", fetchedAt: cached.value.fetchedAt, reason: `${info.label} could not be refreshed.`, records: cached.value.records, covered: [corridor] };
        }
        return { status: "unavailable", fetchedAt: null, reason: `${info.label} are unavailable right now.`, records: [], covered: [] };
      }
    },
  };
}
