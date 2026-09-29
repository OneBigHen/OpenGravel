/**
 * A WZDx 4.x work-zone feed as a road-authority source (ROUTE-INTELLIGENCE-
 * PROVIDER-MESH §7.13). One feed fetch per TTL serves every plan; the feed is
 * never asked per waypoint. WZDx payloads stay inside this file.
 *
 * `all-lanes-closed` becomes a closure record (a hard gate when the route
 * rides a line geometry); anything else is a work zone, which only warns.
 */

import { createTtlCache, type CacheRead } from "@/application/route-intelligence/cache-policy";
import type { RoadAuthoritySource } from "@/application/route-intelligence/road-authority-source";
import type {
  BoundingBox,
  RoadAuthorityGeometry,
  RoadAuthorityRecord,
  RoadAuthoritySnapshot,
  RoadAuthoritySourceInfo,
  SourceBudget,
} from "@/application/route-intelligence/types";
import type { Coordinate } from "@/domain/ride/types";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WHEN = String.raw`(?:[A-Za-z]+day\s+)?([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)`;
const DAY_WINDOW = new RegExp(`${WHEN}\\s+thru\\s+(\\d{1,2}):(\\d{2})\\s*([AP]M)(?!\\s+on)`, "i");
const RANGE = new RegExp(`${WHEN}\\s+thru\\s+${WHEN}`, "i");

/** A wall-clock time in `timeZone` as an ISO instant. */
function zonedIso(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): string | null {
  if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const guess = Date.UTC(year, month, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const shown = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
  return new Date(guess - (shown - guess)).toISOString();
}

function clock(hour: string, minute: string, meridiem: string): [number, number] {
  const base = Number(hour) % 12;
  return [meridiem.toUpperCase() === "PM" ? base + 12 : base, Number(minute)];
}

/**
 * The work window a description states, e.g. "Friday October 2, 2026 09:00 AM
 * thru 03:00 PM" or "Continuous Friday September 25, 2026 08:00 PM thru
 * Saturday October 3, 2026 06:00 AM". NJDOT's feed marks its start dates
 * unverified and puts the real schedule here; without it, next week's lane
 * closure would read as active today.
 */
export function scheduleFromDescription(
  description: string,
  timeZone: string,
): { readonly validFrom: string; readonly validUntil: string } | null {
  const range = RANGE.exec(description);
  if (range !== null) {
    const [, m1, d1, y1, h1, n1, a1, m2, d2, y2, h2, n2, a2] = range as unknown as string[];
    const from = zonedIso(Number(y1), MONTHS.indexOf(m1!.toLowerCase()), Number(d1), ...clock(h1!, n1!, a1!), timeZone);
    const until = zonedIso(Number(y2), MONTHS.indexOf(m2!.toLowerCase()), Number(d2), ...clock(h2!, n2!, a2!), timeZone);
    return from === null || until === null ? null : { validFrom: from, validUntil: until };
  }
  const window = DAY_WINDOW.exec(description);
  if (window !== null) {
    const [, m, d, y, h1, n1, a1, h2, n2, a2] = window as unknown as string[];
    const month = MONTHS.indexOf(m!.toLowerCase());
    const from = zonedIso(Number(y), month, Number(d), ...clock(h1!, n1!, a1!), timeZone);
    let until = zonedIso(Number(y), month, Number(d), ...clock(h2!, n2!, a2!), timeZone);
    // "08:00 PM thru 05:00 AM": the window ends the next morning.
    if (from !== null && until !== null && Date.parse(until) <= Date.parse(from)) {
      until = new Date(Date.parse(until) + 24 * 3_600_000).toISOString();
    }
    return from === null || until === null ? null : { validFrom: from, validUntil: until };
  }
  return null;
}

/** "Roadwork on US 22 Eastbound…" → "US 22". Cross streets are not the road. */
export function roadFromDescription(description: string): string | null {
  const match = /\bon\s+((?:I|US|NJ|PA|NY|DE|MD|CR|SR|Route|Rt\.?)[- ]?\d+[A-Z]?)\b/i.exec(description);
  return match?.[1] ?? null;
}

export interface WzdxSourceOptions {
  readonly info: Omit<RoadAuthoritySourceInfo, "family" | "facet">;
  /** The feed URL; `null` means not configured (e.g. a keyed feed with no key). */
  readonly url: string | null;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly userAgent?: string;
  /** The feed's local time zone, for schedules stated in its descriptions. */
  readonly timeZone?: string;
}

const BUDGET: SourceBudget = {
  maxRemoteCallsPerPlan: 1,
  maxRecords: 5_000,
  timeoutMs: 6_000,
  concurrency: 1,
  cacheTtlMs: 60_000,
  // A closure older than this is not served: it may have reopened.
  serveStaleMs: 10 * 60_000,
  retry: "none",
  cancellable: false,
};

const MAX_DESCRIPTION = 200;

interface Feed {
  readonly fetchedAt: string;
  readonly records: readonly RoadAuthorityRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coordinate(value: unknown): Coordinate | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [lon, lat] = value;
  return typeof lon === "number" && typeof lat === "number" && Number.isFinite(lon) && Number.isFinite(lat) &&
    Math.abs(lon) <= 180 && Math.abs(lat) <= 90
    ? { lon, lat }
    : null;
}

function geometriesOf(value: unknown): readonly RoadAuthorityGeometry[] {
  if (!isRecord(value) || !Array.isArray(value["coordinates"])) return [];
  const coordinates = value["coordinates"] as unknown[];
  switch (value["type"]) {
    case "LineString": {
      const line = coordinates.map(coordinate).filter((point): point is Coordinate => point !== null);
      return line.length >= 2 ? [{ type: "line", coordinates: line }] : [];
    }
    case "MultiLineString":
      return coordinates.flatMap((part) => geometriesOf({ type: "LineString", coordinates: part }));
    case "Point": {
      const point = coordinate(coordinates);
      return point === null ? [] : [{ type: "point", coordinate: point }];
    }
    case "MultiPoint":
      // A sign-method start/end pair: two places, not a straight road between them.
      return coordinates.flatMap((part) => geometriesOf({ type: "Point", coordinates: part }));
    default:
      return [];
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isoOrNull(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Some feeds answer an `application/json` request with the collection
 * JSON-encoded a second time (NJIT's NJ feed, seen live 2026-09-27): a string
 * holding the JSON. Unwrap once; anything else is left for the parser to refuse.
 */
export function decodeFeedBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

/** Parses a WZDx 4.x FeatureCollection; malformed features are skipped, never guessed. */
export function parseWzdxFeed(
  payload: unknown,
  sourceId: string,
  timeZone = "America/New_York",
): readonly RoadAuthorityRecord[] {
  if (!isRecord(payload) || !Array.isArray(payload["features"])) throw new Error("not a WZDx feature collection");
  const records: RoadAuthorityRecord[] = [];
  for (const feature of payload["features"] as unknown[]) {
    if (!isRecord(feature) || !isRecord(feature["properties"])) continue;
    const properties = feature["properties"];
    const core = isRecord(properties["core_details"]) ? properties["core_details"] : {};
    const eventType = text(core["event_type"]);
    if (eventType !== "work-zone" && eventType !== "detour" && eventType !== "restriction") continue;
    const impact = text(properties["vehicle_impact"]);
    const allLanesClosed = impact === "all-lanes-closed";
    const roadNames = Array.isArray(core["road_names"]) ? (core["road_names"] as unknown[]).map(text).filter((name) => name !== null) : [];
    const fullDescription = text(core["description"]) ?? (allLanesClosed ? "Road closed." : "Road work.");
    const description = fullDescription.slice(0, MAX_DESCRIPTION);
    // Unverified dates: prefer the schedule the description states.
    const schedule = properties["is_start_date_verified"] === false
      ? scheduleFromDescription(fullDescription, timeZone)
      : null;
    const id = text(feature["id"]) ?? text(core["id"]) ?? `${records.length}`;
    geometriesOf(feature["geometry"]).forEach((geometry, index) => {
      records.push({
        sourceId,
        sourceRecordId: index === 0 ? id : `${id}#${index}`,
        kind: eventType === "restriction" ? "restriction" : allLanesClosed ? "closure" : "work-zone",
        geometry,
        roadName: roadFromDescription(fullDescription) ?? roadNames[0] ?? null,
        description,
        validFrom: schedule?.validFrom ?? isoOrNull(properties["start_date"]),
        validUntil: schedule?.validUntil ?? isoOrNull(properties["end_date"]),
        allLanesClosed,
      });
    });
    if (records.length >= BUDGET.maxRecords) break;
  }
  return records;
}

function inBox(geometry: RoadAuthorityGeometry, box: BoundingBox): boolean {
  const points = geometry.type === "point" ? [geometry.coordinate] : geometry.coordinates;
  return points.some((point) => point.lon >= box.west && point.lon <= box.east && point.lat >= box.south && point.lat <= box.north);
}

export function createWzdxSource(options: WzdxSourceOptions): RoadAuthoritySource {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const info: RoadAuthoritySourceInfo = { ...options.info, family: "road-authority", facet: "closures" };
  const cache = createTtlCache<"feed", Feed>({ ttlMs: BUDGET.cacheTtlMs, serveStaleMs: BUDGET.serveStaleMs, now });

  async function load(): Promise<Feed> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BUDGET.timeoutMs);
    try {
      const response = await doFetch(options.url!, {
        signal: controller.signal,
        headers: { accept: "application/geo+json, application/json", ...(options.userAgent === undefined ? {} : { "user-agent": options.userAgent }) },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { fetchedAt: new Date(now()).toISOString(), records: parseWzdxFeed(decodeFeedBody(await response.json()), info.id, options.timeZone) };
    } finally {
      clearTimeout(timer);
    }
  }

  function answer(read: Exclude<CacheRead<Feed>, { state: "miss" }>, corridor: BoundingBox, reason: string | null): RoadAuthoritySnapshot {
    return {
      status: read.state,
      fetchedAt: read.value.fetchedAt,
      reason,
      records: read.value.records.filter((record) => inBox(record.geometry, corridor)),
      covered: info.coverage,
    };
  }

  return {
    info,
    budget: BUDGET,
    probe: () => options.url === null
      ? { available: false, reason: `${info.label} is not configured.` }
      : { available: true, reason: null },
    async snapshot(corridor) {
      if (options.url === null) return { status: "unavailable", fetchedAt: null, reason: `${info.label} is not configured.`, records: [], covered: [] };
      const cached = cache.read("feed");
      if (cached.state === "fresh") return answer(cached, corridor, null);
      try {
        await cache.load("feed", load);
        const fresh = cache.read("feed");
        if (fresh.state !== "miss") return answer(fresh, corridor, null);
      } catch {
        if (cached.state === "stale") return answer(cached, corridor, `${info.label} could not be refreshed; showing its last answer.`);
      }
      return { status: "unavailable", fetchedAt: null, reason: `${info.label} is unavailable right now.`, records: [], covered: [] };
    },
  };
}
