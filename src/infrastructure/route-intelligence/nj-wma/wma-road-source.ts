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

export const NJ_WMA_ROADS_URL =
  "https://mapsdep.nj.gov/arcgis/rest/services/Features/Transportation/MapServer/23/query";

const NEW_JERSEY: BoundingBox = { west: -75.7, south: 38.8, east: -73.8, north: 41.4 };
const BUDGET: SourceBudget = {
  maxRemoteCallsPerPlan: 1,
  maxRecords: 2_000,
  timeoutMs: 8_000,
  concurrency: 1,
  cacheTtlMs: 24 * 3_600_000,
  serveStaleMs: 7 * 24 * 3_600_000,
  retry: "none",
  cancellable: false,
};

type Properties = Readonly<Record<string, unknown>>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function line(value: unknown): readonly Coordinate[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.flatMap((point) =>
    Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number"
      ? [{ lon: point[0], lat: point[1] }]
      : []);
  return parsed.length >= 2 ? parsed : null;
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

function accessOf(value: unknown): MotorcycleAccess {
  switch (text(value)?.toUpperCase()) {
    case "PUB":
    case "PUBLIC": return { status: "open", seasons: null };
    case "CLOSED": return { status: "closed", seasons: null };
    default: return { status: "unknown", seasons: null };
  }
}

export function parseNjWmaRoads(payload: unknown, sourceId = "nj-wma-roads"): readonly RoadAuthorityRecord[] {
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
    if (text(properties["DFW_TYPE"])?.toLowerCase() !== "road") continue;
    if (text(properties["MAP_DISPLAY"])?.toUpperCase() === "N") continue;
    const objectId = properties["OBJECTID"] ?? candidate.id ?? records.length;
    const roadName = text(properties["PRIMENAME"]) ?? text(properties["L1_NAME"]);
    const description = [
      text(properties["WMA_NAME"]),
      text(properties["SURFACE"]),
      text(properties["DFW_ACCESS"]) === "R" ? "restricted access" : null,
      text(properties["DFW_NOTES"]),
    ].filter((value): value is string => value !== null).join(" · ");

    lines(candidate.geometry).forEach((geometry, index) => {
      records.push({
        sourceId,
        sourceRecordId: `${String(objectId)}${index === 0 ? "" : `#${index}`}`,
        kind: "motor-vehicle-designation",
        geometry: { type: "line", coordinates: geometry },
        roadName,
        description: description || "New Jersey Fish & Wildlife WMA road designation.",
        validFrom: null,
        validUntil: null,
        motorcycleAccess: accessOf(properties["DFW_ACCESS"]),
      });
    });
  }
  return records;
}

export interface NjWmaRoadsSourceOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export function createNjWmaRoadsSource(options: NjWmaRoadsSourceOptions = {}): RoadAuthoritySource {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const info: RoadAuthoritySourceInfo = {
    id: "nj-wma-roads",
    label: "New Jersey Fish & Wildlife WMA roads",
    authority: "authoritative-operational",
    family: "road-authority",
    facet: "access",
    coverage: [NEW_JERSEY],
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
    const url = new URL(NJ_WMA_ROADS_URL);
    url.searchParams.set("f", "geojson");
    url.searchParams.set("where", "DFW_TYPE = 'Road'");
    url.searchParams.set("geometry", `${corridor.west},${corridor.south},${corridor.east},${corridor.north}`);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("outFields", "OBJECTID,PRIMENAME,L1_NAME,WMA_NAME,SURFACE,DFW_ACCESS,DFW_TYPE,DFW_NOTES,MAP_DISPLAY,UPDATEDATE");
    url.searchParams.set("resultRecordCount", String(BUDGET.maxRecords));
    url.searchParams.set("returnGeometry", "true");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BUDGET.timeoutMs);
    try {
      const response = await doFetch(url, { signal: controller.signal, headers: { accept: "application/geo+json, application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (
        typeof payload === "object" && payload !== null
        && ((payload as { exceededTransferLimit?: unknown }).exceededTransferLimit === true
          || (payload as { properties?: { exceededTransferLimit?: unknown } }).properties?.exceededTransferLimit === true)
      ) {
        throw new Error("ArcGIS transfer limit exceeded");
      }
      return { fetchedAt: new Date(now()).toISOString(), records: parseNjWmaRoads(payload, info.id) };
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
