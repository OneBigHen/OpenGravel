import { createTtlCache } from "@/application/route-intelligence/cache-policy";
import type { RoadReconRecord, RoadReconSource } from "@/application/roads/road-recon-source";
import type { BoundingBox, SourceBudget } from "@/application/route-intelligence/types";
import type { Coordinate } from "@/domain/ride/types";

export const PENNDOT_LOCAL_ROADS_URL =
  "https://mapservices.pasda.psu.edu/server/rest/services/pasda/PennDOT/MapServer/3/query";

const PENNSYLVANIA: BoundingBox = { west: -80.6, south: 39.7, east: -74.6, north: 42.6 };
const BUDGET: SourceBudget = {
  maxRemoteCallsPerPlan: 2,
  maxRecords: 1_000,
  timeoutMs: 8_000,
  concurrency: 1,
  cacheTtlMs: 7 * 24 * 3_600_000,
  serveStaleMs: 30 * 24 * 3_600_000,
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

function hints(properties: Properties): RoadReconRecord["surfaceHints"] {
  const values: RoadReconRecord["surfaceHints"][number][] = [];
  if ((number(properties["GRAVEL_MIL"]) ?? 0) > 0) values.push("gravel-present");
  if ((number(properties["UNIMPROVED"]) ?? 0) > 0) values.push("unimproved-present");
  return values.length === 0 ? ["unknown"] : values;
}

function confidenceFor(properties: Properties): number {
  const gravel = number(properties["GRAVEL_MIL"]) ?? 0;
  const unimproved = number(properties["UNIMPROVED"]) ?? 0;
  if (gravel > 0 && unimproved > 0) return 0.95;
  if (gravel > 0 || unimproved > 0) return 0.9;
  return 0.5;
}

function notesFor(properties: Properties): readonly string[] {
  const notes: string[] = [];
  const gravel = number(properties["GRAVEL_MIL"]);
  const unimproved = number(properties["UNIMPROVED"]);
  if (gravel !== null && gravel > 0) notes.push(`${gravel.toFixed(2)} mi gravel reported on this local-road record`);
  if (unimproved !== null && unimproved > 0) notes.push(`${unimproved.toFixed(2)} mi unimproved reported on this local-road record`);
  const owner = text(properties["ROAD_OWNER"]);
  if (owner !== null) notes.push(`owner: ${owner}`);
  const traffic = number(properties["TRAFFIC_PA"]);
  if (traffic !== null && traffic > 0) notes.push(`traffic count: ${Math.round(traffic)}`);
  return notes;
}

export function parsePennDotLocalRoads(
  payload: unknown,
  sourceId = "pa-penndot-local-roads-2026",
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
    const surfaceHints = hints(properties);
    if (surfaceHints.length === 1 && surfaceHints[0] === "unknown") continue;
    const objectId = properties["OBJECTID"] ?? candidate.id ?? records.length;
    const name = text(properties["LR_NAME"]);
    const totalMiles = [
      "UNIMPROVED",
      "GRAVEL_MIL",
      "SEAL_COATE",
      "BITUMINOUS",
      "BRICK_MILE",
      "CONCRETE_M",
    ].reduce((sum, field) => sum + Math.max(0, number(properties[field]) ?? 0), 0);

    lines(candidate.geometry).forEach((geometry, index) => {
      records.push({
        sourceId,
        sourceRecordId: `${String(objectId)}${index === 0 ? "" : `#${index}`}`,
        name,
        geometry,
        surfaceHints,
        roadOwner: text(properties["ROAD_OWNER"]),
        trafficCount: number(properties["TRAFFIC_PA"]),
        lengthMiles: totalMiles > 0 ? Number(totalMiles.toFixed(3)) : null,
        confidence: confidenceFor(properties),
        notes: notesFor(properties),
      });
    });
  }

  return {
    records,
    truncated: collection.exceededTransferLimit === true,
  };
}

export interface PennDotLocalRoadsSourceOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export function createPennDotLocalRoadsSource(
  options: PennDotLocalRoadsSourceOptions = {},
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
    maxEntries: 256,
    now,
  });
  const info = {
    id: "pa-penndot-local-roads-2026",
    label: "PennDOT Local Roads 2026",
    coverage: [PENNSYLVANIA],
    authority: "recon" as const,
  };
  const keyOf = (box: BoundingBox): string =>
    [box.west, box.south, box.east, box.north].map((value) => value.toFixed(3)).join(":");

  async function load(
    corridor: BoundingBox,
    signal?: AbortSignal,
  ): Promise<{ readonly fetchedAt: string; readonly records: readonly RoadReconRecord[]; readonly truncated: boolean }> {
    const url = new URL(PENNDOT_LOCAL_ROADS_URL);
    url.searchParams.set("f", "geojson");
    url.searchParams.set("where", "(GRAVEL_MIL > 0 OR UNIMPROVED > 0)");
    url.searchParams.set("geometry", `${corridor.west},${corridor.south},${corridor.east},${corridor.north}`);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set(
      "outFields",
      "OBJECTID,LR_NAME,UNIMPROVED,GRAVEL_MIL,SEAL_COATE,BITUMINOUS,BRICK_MILE,CONCRETE_M,ROAD_OWNER,TRAFFIC_PA",
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
      const parsed = parsePennDotLocalRoads(payload, info.id);
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
          reason: cached.value.truncated ? "PennDOT returned a truncated road-recon result." : null,
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
          reason: value.truncated ? "PennDOT returned a truncated road-recon result." : null,
          truncated: value.truncated,
          records: value.records,
          covered: value.truncated ? [] : [corridor],
        };
      } catch {
        if (cached.state === "stale") {
          return {
            status: "stale",
            fetchedAt: cached.value.fetchedAt,
            reason: "PennDOT local-road recon could not be refreshed.",
            truncated: cached.value.truncated,
            records: cached.value.records,
            covered: cached.value.truncated ? [] : [corridor],
          };
        }
        return {
          status: "unavailable",
          fetchedAt: null,
          reason: "PennDOT local-road recon is unavailable right now.",
          truncated: false,
          records: [],
          covered: [],
        };
      }
    },
  };
}
