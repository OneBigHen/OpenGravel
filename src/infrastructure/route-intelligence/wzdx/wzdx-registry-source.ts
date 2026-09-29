/**
 * Every keyless state work-zone feed in the USDOT WZDx registry as one
 * road-authority source (ROUTE-INTELLIGENCE-PROVIDER-MESH §7.13, "WZDx as
 * multi-state normalization").
 *
 * The registry is read once a day; a plan fetches only the feeds whose state
 * its corridor touches (at most `MAX_FEEDS_PER_PLAN`), each cached for five
 * minutes. A state with no keyless feed is outside this source's scope, so a
 * route there stays "unknown", never "clear".
 */

import { createTtlCache } from "@/application/route-intelligence/cache-policy";
import type { RoadAuthoritySource } from "@/application/route-intelligence/road-authority-source";
import type {
  BoundingBox,
  RoadAuthorityRecord,
  RoadAuthoritySnapshot,
  RoadAuthoritySourceInfo,
  SourceBudget,
} from "@/application/route-intelligence/types";

import { stateBoxes, stateTimeZone, US_STATE_BOXES } from "../us-states";
import { decodeFeedBody, parseWzdxFeed } from "./wzdx-source";

export const WZDX_REGISTRY_URL = "https://datahub.transportation.gov/resource/69qe-yiui.json?$limit=500";

const BUDGET: SourceBudget = {
  maxRemoteCallsPerPlan: 4,
  maxRecords: 20_000,
  timeoutMs: 8_000,
  concurrency: 3,
  cacheTtlMs: 5 * 60_000,
  serveStaleMs: 20 * 60_000,
  retry: "none",
  cancellable: false,
};
const REGISTRY_TTL_MS = 24 * 3_600_000;
const MAX_FEEDS_PER_PLAN = 3;

export interface RegistryFeed {
  readonly id: string;
  readonly organization: string;
  readonly url: string;
  readonly boxes: readonly BoundingBox[];
  readonly timeZone: string;
}

function intersects(left: BoundingBox, right: BoundingBox): boolean {
  return left.west <= right.east && right.west <= left.east && left.south <= right.north && right.south <= left.north;
}

function truthy(value: unknown): boolean {
  return value === true || value === "true";
}

/** The registry rows OpenGravel can use: active, keyless, WZDx 4.x GeoJSON, a known US state. */
export function usableRegistryFeeds(rows: unknown): readonly RegistryFeed[] {
  if (!Array.isArray(rows)) throw new Error("not a registry listing");
  const feeds: RegistryFeed[] = [];
  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (!truthy(row["active"]) || truthy(row["needapikey"])) continue;
    const version = String(row["version"] ?? "");
    const format = String(row["format"] ?? "").toLowerCase();
    if (!version.startsWith("4") || (format !== "geojson" && format !== "json")) continue;
    const url = typeof row["url"] === "object" && row["url"] !== null ? (row["url"] as { url?: unknown }).url : row["url"];
    if (typeof url !== "string" || !url.startsWith("https://")) continue;
    const state = String(row["state"] ?? "");
    const boxes = stateBoxes(state);
    if (boxes.length === 0) continue;
    const name = String(row["feedname"] ?? row["issuingorganization"] ?? state).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    feeds.push({
      id: `wzdx-${name}`,
      organization: String(row["issuingorganization"] ?? state),
      url,
      boxes,
      timeZone: stateTimeZone(state),
    });
  }
  return feeds;
}

export interface WzdxRegistrySourceOptions {
  readonly registryUrl?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly userAgent?: string;
  /** Registry feeds to leave out, e.g. one already served by a dedicated source. */
  readonly exclude?: (feed: RegistryFeed) => boolean;
}

export function createWzdxRegistrySource(options: WzdxRegistrySourceOptions = {}): RoadAuthoritySource {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const info: RoadAuthoritySourceInfo = {
    id: "wzdx-states",
    label: "State DOT work zones (WZDx)",
    authority: "authoritative-operational",
    family: "road-authority",
    facet: "closures",
    // What the registry could speak for; each answer narrows it (`scope`).
    coverage: [{ west: -125, south: 24, east: -66, north: 50 }],
    precedence: 1,
  };
  const registry = createTtlCache<"registry", readonly RegistryFeed[]>({ ttlMs: REGISTRY_TTL_MS, serveStaleMs: 7 * REGISTRY_TTL_MS, now });
  type Feed = { readonly fetchedAt: string; readonly records: readonly RoadAuthorityRecord[] };
  const feeds = createTtlCache<string, Feed>({ ttlMs: BUDGET.cacheTtlMs, serveStaleMs: BUDGET.serveStaleMs, maxEntries: 64, now });
  const headers = { accept: "application/geo+json, application/json", ...(options.userAgent === undefined ? {} : { "user-agent": options.userAgent }) };

  async function getJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BUDGET.timeoutMs);
    try {
      const response = await doFetch(url, { signal: controller.signal, headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return decodeFeedBody(await response.json());
    } finally {
      clearTimeout(timer);
    }
  }

  async function listing(): Promise<readonly RegistryFeed[]> {
    const cached = registry.read("registry");
    if (cached.state === "fresh") return cached.value;
    try {
      const all = await registry.load("registry", async () => usableRegistryFeeds(await getJson(options.registryUrl ?? WZDX_REGISTRY_URL)));
      return options.exclude === undefined ? all : all.filter((feed) => !options.exclude!(feed));
    } catch (error) {
      if (cached.state === "stale") return cached.value;
      throw error;
    }
  }

  return {
    info,
    budget: BUDGET,
    probe: () => ({ available: true, reason: null }),
    async snapshot(corridor): Promise<RoadAuthoritySnapshot> {
      let available: readonly RegistryFeed[];
      try {
        available = (await listing()).filter((feed) => options.exclude === undefined || !options.exclude(feed));
      } catch {
        return { status: "unavailable", fetchedAt: null, reason: "The state work-zone registry is unavailable.", records: [], covered: [] };
      }
      const relevant = available.filter((feed) => feed.boxes.some((box) => intersects(box, corridor)));
      const scope = relevant.flatMap((feed) => feed.boxes).filter((box) => intersects(box, corridor));
      if (relevant.length === 0) {
        return { status: "fresh", fetchedAt: new Date(now()).toISOString(), reason: null, records: [], covered: [], scope: [] };
      }
      const asked = relevant.slice(0, MAX_FEEDS_PER_PLAN);
      const answers = await Promise.all(asked.map(async (feed) => {
        const cached = feeds.read(feed.id);
        if (cached.state === "fresh") return { feed, value: cached.value, stale: false };
        try {
          const value = await feeds.load(feed.id, async () => ({
            fetchedAt: new Date(now()).toISOString(),
            // Records belong to this source (its authority and precedence);
            // the state feed survives in the record id for diagnostics.
            records: parseWzdxFeed(await getJson(feed.url), info.id, feed.timeZone)
              .map((record) => ({ ...record, sourceRecordId: `${feed.id}:${record.sourceRecordId}` })),
          }));
          return { feed, value, stale: false };
        } catch {
          return cached.state === "stale" ? { feed, value: cached.value, stale: true } : null;
        }
      }));
      const answered = answers.filter((answer) => answer !== null);
      if (answered.length === 0) {
        return { status: "unavailable", fetchedAt: null, reason: "State work-zone feeds are unavailable right now.", records: [], covered: [], scope };
      }
      const inCorridor = (record: RoadAuthorityRecord): boolean => {
        const points = record.geometry.type === "point" ? [record.geometry.coordinate] : record.geometry.coordinates;
        return points.some((point) => point.lon >= corridor.west && point.lon <= corridor.east && point.lat >= corridor.south && point.lat <= corridor.north);
      };
      const missing = relevant.length - answered.length;
      const answeredBoxes = new Set(answered.flatMap((answer) => answer.feed.boxes));
      // Every state box in the corridor this answer does not speak for: it
      // keeps a covered neighbor's overlapping box from claiming its roads.
      const unknownAreas = Object.values(US_STATE_BOXES).filter((box) => intersects(box, corridor) && !answeredBoxes.has(box));
      return {
        status: answered.some((answer) => answer.stale) ? "stale" : "fresh",
        fetchedAt: new Date(answered.reduce((min, answer) => Math.min(min, Date.parse(answer.value.fetchedAt)), Number.POSITIVE_INFINITY)).toISOString(),
        reason: missing > 0 ? `${missing} state work-zone feed${missing === 1 ? "" : "s"} did not answer.` : null,
        records: answered.flatMap((answer) => answer.value.records.filter(inCorridor)),
        covered: answered.flatMap((answer) => answer.feed.boxes),
        scope,
        unknownAreas,
      };
    },
  };
}
