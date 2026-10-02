import { createTtlCache } from "@/application/route-intelligence/cache-policy";
import type { RoadAuthoritySource } from "@/application/route-intelligence/road-authority-source";
import type {
  AccessWindow,
  BoundingBox,
  RoadAuthorityRecord,
  RoadAuthoritySourceInfo,
  SourceBudget,
} from "@/application/route-intelligence/types";
import type { Coordinate } from "@/domain/ride/types";

export const DCNR_SEASONAL_ROADS_URL =
  "https://maps.dcnr.pa.gov/agsprod/rest/services/BOF/HuntStateForest/MapServer/9/query";

const PENNSYLVANIA: BoundingBox = { west: -80.6, south: 39.7, east: -74.6, north: 42.6 };
const BUDGET: SourceBudget = {
  maxRemoteCallsPerPlan: 1,
  maxRecords: 1_000,
  timeoutMs: 8_000,
  concurrency: 1,
  cacheTtlMs: 6 * 3_600_000,
  serveStaleMs: 48 * 3_600_000,
  retry: "none",
  cancellable: true,
};

type Properties = Readonly<Record<string, unknown>>;

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

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function instant(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return null;
}

function window(from: unknown, until: unknown): AccessWindow | null {
  const validFrom = instant(from);
  const validUntil = instant(until);
  if (validFrom === null || validUntil === null || Date.parse(validFrom) >= Date.parse(validUntil)) return null;
  return { validFrom, validUntil };
}

function accessWindows(properties: Properties): readonly AccessWindow[] {
  return [
    window(properties["Date_Opened"], properties["Date_Closed"]),
    window(properties["Date_ReOpened"], properties["Date_ReClosed"]),
  ].filter((value): value is AccessWindow => value !== null);
}

export function parseDcnrSeasonalRoads(payload: unknown, sourceId = "pa-dcnr-seasonal-roads"): readonly RoadAuthorityRecord[] {
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
    const windows = accessWindows(properties);
    const notes = text(properties["Notes"]);
    const district = typeof properties["DistrictNumber"] === "number" ? `District ${properties["DistrictNumber"]}` : null;
    const roadName = text(properties["Name"]);
    const objectId = properties["OBJECTID"] ?? candidate.id ?? records.length;
    const description = [district, "Normally closed state-forest road with seasonal vehicle access.", notes]
      .filter((value): value is string => value !== null)
      .join(" · ");

    lines(candidate.geometry).forEach((geometry, index) => {
      records.push({
        sourceId,
        sourceRecordId: `${String(objectId)}${index === 0 ? "" : `#${index}`}`,
        kind: "motor-vehicle-designation",
        geometry: { type: "line", coordinates: geometry },
        roadName,
        description,
        validFrom: null,
        validUntil: null,
        motorcycleAccess: windows.length > 0
          ? { status: "open", seasons: null, windows, outsideWindowStatus: "closed" }
          : { status: "open", seasons: [] },
      });
    });
  }
  return records;
}

export interface DcnrSeasonalRoadsSourceOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export function createDcnrSeasonalRoadsSource(options: DcnrSeasonalRoadsSourceOptions = {}): RoadAuthoritySource {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const info: RoadAuthoritySourceInfo = {
    id: "pa-dcnr-seasonal-roads",
    label: "Pennsylvania DCNR seasonal forest roads",
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
    const url = new URL(DCNR_SEASONAL_ROADS_URL);
    url.searchParams.set("f", "geojson");
    url.searchParams.set("where", "1=1");
    url.searchParams.set("geometry", `${corridor.west},${corridor.south},${corridor.east},${corridor.north}`);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("outFields", "OBJECTID,Name,DistrictNumber,Date_Opened,Date_Closed,Date_ReOpened,Date_ReClosed,Notes,Miles");
    url.searchParams.set("resultRecordCount", String(BUDGET.maxRecords));
    url.searchParams.set("returnGeometry", "true");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BUDGET.timeoutMs);
    try {
      const response = await doFetch(url, { signal: controller.signal, headers: { accept: "application/geo+json, application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      return { fetchedAt: new Date(now()).toISOString(), records: parseDcnrSeasonalRoads(payload, info.id) };
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
