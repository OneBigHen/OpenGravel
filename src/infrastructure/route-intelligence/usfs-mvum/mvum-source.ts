/**
 * USFS Motor Vehicle Use Map designations as a road-authority source
 * (ROUTE-INTELLIGENCE-PROVIDER-MESH §7.2). The public EDW ArcGIS service is
 * ingested by one-degree cell and cached for a week, never queried per plan
 * point. MVUM payloads stay inside this file.
 *
 * A street-legal motorcycle may ride a designated road open to passenger or
 * high-clearance vehicles, or one open to motorcycles; on a trail it needs the
 * motorcycle class. A designation that opens the road only to other classes
 * shuts it to motorcycles. One that names no open class at all is unknown:
 * missing MVUM coverage is unknown, never prohibited.
 */

import { createTtlCache } from "@/application/route-intelligence/cache-policy";
import type { RoadAuthoritySource } from "@/application/route-intelligence/road-authority-source";
import type {
  BoundingBox,
  MotorcycleAccess,
  RoadAuthorityRecord,
  RoadAuthoritySourceInfo,
  SeasonWindow,
  SourceBudget,
} from "@/application/route-intelligence/types";
import type { Coordinate } from "@/domain/ride/types";

export const MVUM_SERVICE_URL = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer";
const ROADS_LAYER = 1;
const TRAILS_LAYER = 2;
const CELL_DEGREES = 1;
const PAGE = 2_000;

const BUDGET: SourceBudget = {
  maxRemoteCallsPerPlan: 24,
  maxRecords: 20_000,
  timeoutMs: 15_000,
  concurrency: 4,
  cacheTtlMs: 7 * 24 * 3_600_000,
  serveStaleMs: 7 * 24 * 3_600_000,
  retry: "none",
  cancellable: false,
};

/** At most this many cells per plan; a longer corridor is covered only in part. */
const MAX_CELLS_PER_PLAN = 12;

const HIGHWAY_LEGAL = ["passengervehicle", "highclearancevehicle", "motorcycle"] as const;
const OTHER_CLASSES = [
  "truck", "bus", "motorhome", "fourwd_gt50inches", "twowd_gt50inches", "tracked_ohv_gt50inches",
  "other_ohv_gt50inches", "atv", "otherwheeled_ohv", "tracked_ohv_lt50inches", "other_ohv_lt50inches",
] as const;
const OUT_FIELDS = [
  "objectid", "id", "name", "seasonal", "forestname",
  ...HIGHWAY_LEGAL.flatMap((field) => [field, `${field}_datesopen`]),
  ...OTHER_CLASSES,
].join(",");

type Attributes = Readonly<Record<string, unknown>>;

function isOpen(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "open";
}

/** "05/15-12/15" (several may be joined by "," or ";"); unparseable text yields nothing. */
export function parseMvumDates(value: unknown): readonly SeasonWindow[] {
  if (typeof value !== "string") return [];
  const windows: SeasonWindow[] = [];
  for (const part of value.split(/[,;]/)) {
    const match = /^\s*(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})\s*$/.exec(part);
    if (match === null) continue;
    const [startMonth, startDay, endMonth, endDay] = match.slice(1).map(Number) as [number, number, number, number];
    if ([startMonth, endMonth].some((month) => month < 1 || month > 12) || [startDay, endDay].some((day) => day < 1 || day > 31)) continue;
    windows.push({ startMonth, startDay, endMonth, endDay });
  }
  return windows;
}

function yearRound(windows: readonly SeasonWindow[]): boolean {
  return windows.some((window) => window.startMonth === 1 && window.startDay === 1 && window.endMonth === 12 && window.endDay === 31);
}

export function motorcycleAccessOf(attributes: Attributes, layer: "road" | "trail"): MotorcycleAccess {
  const classes = layer === "road" ? HIGHWAY_LEGAL : (["motorcycle"] as const);
  const open = classes.filter((field) => isOpen(attributes[field]));
  if (open.length === 0) {
    const anyOpen = [...HIGHWAY_LEGAL, ...OTHER_CLASSES].some((field) => isOpen(attributes[field]));
    return { status: anyOpen ? "closed" : "unknown", seasons: null };
  }
  const windows = open.flatMap((field) => parseMvumDates(attributes[`${field}_datesopen`]));
  if (yearRound(windows)) return { status: "open", seasons: null };
  if (windows.length > 0) return { status: "open", seasons: windows };
  const seasonal = typeof attributes["seasonal"] === "string" && attributes["seasonal"].toLowerCase() === "seasonal";
  return { status: "open", seasons: seasonal ? [] : null };
}

function pathsOf(geometry: unknown): readonly (readonly Coordinate[])[] {
  if (typeof geometry !== "object" || geometry === null || !Array.isArray((geometry as { paths?: unknown }).paths)) return [];
  return ((geometry as { paths: unknown[] }).paths).map((path) =>
    Array.isArray(path)
      ? path.flatMap((point: unknown) =>
          Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number"
            ? [{ lon: point[0], lat: point[1] }]
            : [])
      : [],
  ).filter((path) => path.length >= 2);
}

export function parseMvumFeatures(payload: unknown, layer: "road" | "trail", sourceId: string): readonly RoadAuthorityRecord[] {
  if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { features?: unknown }).features)) {
    throw new Error("not an ArcGIS feature set");
  }
  const records: RoadAuthorityRecord[] = [];
  for (const feature of (payload as { features: unknown[] }).features) {
    if (typeof feature !== "object" || feature === null) continue;
    const attributes = ((feature as { attributes?: Attributes }).attributes ?? {}) as Attributes;
    const access = motorcycleAccessOf(attributes, layer);
    const name = typeof attributes["name"] === "string" && attributes["name"].trim().length > 0 ? attributes["name"].trim() : null;
    const number = typeof attributes["id"] === "string" ? attributes["id"].trim() : null;
    const roadName = name === null
      ? number === null ? null : `Forest ${layer === "road" ? "Road" : "Trail"} ${number}`
      : `${name.replace(/\b\w+/g, (word) => word.charAt(0) + word.slice(1).toLowerCase())} (FS ${number ?? "?"})`;
    const forest = typeof attributes["forestname"] === "string" ? attributes["forestname"] : "a national forest";
    pathsOf((feature as { geometry?: unknown }).geometry).forEach((path, index) => {
      records.push({
        sourceId,
        sourceRecordId: `${layer}:${String(attributes["objectid"] ?? records.length)}${index === 0 ? "" : `#${index}`}`,
        kind: "motor-vehicle-designation",
        geometry: { type: "line", coordinates: path },
        roadName,
        description: `Motor vehicle use designation, ${forest}.`,
        validFrom: null,
        validUntil: null,
        motorcycleAccess: access,
      });
    });
  }
  return records;
}

export function cellsFor(corridor: BoundingBox): readonly BoundingBox[] {
  const cells: BoundingBox[] = [];
  for (let x = Math.floor(corridor.west / CELL_DEGREES); x <= Math.floor(corridor.east / CELL_DEGREES); x += 1) {
    for (let y = Math.floor(corridor.south / CELL_DEGREES); y <= Math.floor(corridor.north / CELL_DEGREES); y += 1) {
      cells.push({ west: x * CELL_DEGREES, south: y * CELL_DEGREES, east: (x + 1) * CELL_DEGREES, north: (y + 1) * CELL_DEGREES });
    }
  }
  return cells;
}

export interface MvumSourceOptions {
  readonly serviceUrl?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly userAgent?: string;
  /** Optional persistence so a restart does not re-ingest (a JSON file per cell). */
  readonly store?: {
    read(key: string): Promise<{ readonly fetchedAt: string; readonly records: readonly RoadAuthorityRecord[] } | null>;
    write(key: string, value: { readonly fetchedAt: string; readonly records: readonly RoadAuthorityRecord[] }): Promise<void>;
  };
}

export function createMvumSource(options: MvumSourceOptions = {}): RoadAuthoritySource {
  const serviceUrl = options.serviceUrl ?? MVUM_SERVICE_URL;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const info: RoadAuthoritySourceInfo = {
    id: "usfs-mvum",
    label: "USFS Motor Vehicle Use Maps",
    authority: "authoritative-regulatory",
    family: "road-authority",
    facet: "access",
    // The continental US; MVUM only has records inside national forests.
    coverage: [{ west: -125, south: 24, east: -66, north: 50 }],
    precedence: 0,
  };
  type Cell = { readonly fetchedAt: string; readonly records: readonly RoadAuthorityRecord[] };
  const cache = createTtlCache<string, Cell>({ ttlMs: BUDGET.cacheTtlMs, serveStaleMs: BUDGET.serveStaleMs, maxEntries: 400, now });

  async function queryLayer(layer: number, cell: BoundingBox): Promise<readonly RoadAuthorityRecord[]> {
    const records: RoadAuthorityRecord[] = [];
    for (let offset = 0; offset < BUDGET.maxRecords; offset += PAGE) {
      const params = new URLSearchParams({
        where: "1=1",
        geometry: `${cell.west},${cell.south},${cell.east},${cell.north}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        outSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: OUT_FIELDS,
        resultOffset: String(offset),
        resultRecordCount: String(PAGE),
        f: "json",
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), BUDGET.timeoutMs);
      let payload: unknown;
      try {
        const response = await doFetch(`${serviceUrl}/${layer}/query?${params.toString()}`, {
          signal: controller.signal,
          headers: options.userAgent === undefined ? {} : { "user-agent": options.userAgent },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        payload = await response.json();
      } finally {
        clearTimeout(timer);
      }
      if (typeof payload === "object" && payload !== null && "error" in payload) throw new Error("ArcGIS error");
      const page = parseMvumFeatures(payload, layer === ROADS_LAYER ? "road" : "trail", info.id);
      records.push(...page);
      const exceeded = (payload as { exceededTransferLimit?: unknown }).exceededTransferLimit === true;
      if (!exceeded) break;
    }
    return records;
  }

  async function loadCell(key: string, cell: BoundingBox): Promise<Cell> {
    const persisted = await options.store?.read(key).catch(() => null);
    if (persisted !== null && persisted !== undefined && now() - Date.parse(persisted.fetchedAt) < BUDGET.cacheTtlMs) return persisted;
    const [roads, trails] = await Promise.all([queryLayer(ROADS_LAYER, cell), queryLayer(TRAILS_LAYER, cell)]);
    const value: Cell = { fetchedAt: new Date(now()).toISOString(), records: [...roads, ...trails] };
    await options.store?.write(key, value).catch(() => undefined);
    return value;
  }

  return {
    info,
    budget: BUDGET,
    probe: () => ({ available: true, reason: null }),
    async snapshot(corridor) {
      const cells = cellsFor(corridor).slice(0, MAX_CELLS_PER_PLAN);
      const answered: { cell: BoundingBox; value: Cell; stale: boolean }[] = [];
      let failed = 0;
      // Four at a time (the declared concurrency), each cell once per week.
      for (let index = 0; index < cells.length; index += BUDGET.concurrency) {
        const batch = cells.slice(index, index + BUDGET.concurrency);
        await Promise.all(batch.map(async (cell) => {
          const key = `${cell.west}:${cell.south}`;
          const cached = cache.read(key);
          if (cached.state === "fresh") {
            answered.push({ cell, value: cached.value, stale: false });
            return;
          }
          try {
            answered.push({ cell, value: await cache.load(key, () => loadCell(key, cell)), stale: false });
          } catch {
            if (cached.state === "stale") answered.push({ cell, value: cached.value, stale: true });
            else failed += 1;
          }
        }));
      }
      if (answered.length === 0) {
        return { status: "unavailable", fetchedAt: null, reason: `${info.label} are unavailable right now.`, records: [], covered: [] };
      }
      const oldest = answered.reduce((min, entry) => Math.min(min, Date.parse(entry.value.fetchedAt)), Number.POSITIVE_INFINITY);
      const partial = failed > 0 || cellsFor(corridor).length > cells.length;
      return {
        status: answered.some((entry) => entry.stale) ? "stale" : "fresh",
        fetchedAt: new Date(oldest).toISOString(),
        reason: partial ? `${info.label} could be checked for only part of this corridor.` : null,
        records: answered.flatMap((entry) => entry.value.records),
        covered: answered.map((entry) => entry.cell),
      };
    },
  };
}
