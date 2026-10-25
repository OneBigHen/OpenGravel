/**
 * Every keyless state work-zone feed in the USDOT WZDx registry as one
 * road-authority source (ROUTE-INTELLIGENCE-PROVIDER-MESH §7.13, "WZDx as
 * multi-state normalization").
 *
 * The registry is read once a day; a plan fetches only the feeds whose state
 * its corridor touches (at most `MAX_FEEDS_PER_PLAN`), each cached for five
 * minutes. A state with no keyless feed is outside this source's scope, so a
 * route there stays "unknown", never "clear".
 *
 * The state boxes are coarse and overlap borders, so the feed of a *neighbour*
 * can be asked for a view that is not really its own (New York's box reaches
 * across Pennsylvania). That neighbour is best effort: only a failing feed of
 * the view's own state makes this source unavailable, and a view whose state
 * publishes no keyless feed is answered as "no records, gaps unknown".
 */

import { createTtlCache } from "@/application/route-intelligence/cache-policy";
import type { RoadAuthoritySource } from "@/application/route-intelligence/road-authority-source";
import type {
  AuthorityFeedSnapshot,
  BoundingBox,
  RoadAuthorityRecord,
  RoadAuthoritySnapshot,
  RoadAuthoritySourceInfo,
  SourceBudget,
} from "@/application/route-intelligence/types";

import { homeStateOf, stateBoxes, stateNames, stateTimeZone, US_STATE_BOXES } from "../us-states";
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
const REGISTRY_STALE_MS = 7 * REGISTRY_TTL_MS;
const MAX_FEEDS_PER_PLAN = 3;

export interface RegistryFeed {
  readonly id: string;
  readonly organization: string;
  /** The states this feed's rows name, lower-cased (`["new jersey"]`). */
  readonly states: readonly string[];
  readonly url: string;
  readonly boxes: readonly BoundingBox[];
  readonly timeZone: string;
}

/** The registry listing as persisted between restarts: which feeds to ask, not what they report. */
export interface WzdxRegistryListing {
  readonly fetchedAt: string;
  readonly feeds: readonly RegistryFeed[];
}

export interface WzdxRegistryStore {
  readRegistry(): Promise<WzdxRegistryListing | null>;
  writeRegistry(value: WzdxRegistryListing): Promise<void>;
  readFeed(id: string): Promise<AuthorityFeedSnapshot | null>;
  writeFeed(id: string, value: AuthorityFeedSnapshot): Promise<void>;
}

function intersects(left: BoundingBox, right: BoundingBox): boolean {
  return left.west <= right.east && right.west <= left.east && left.south <= right.north && right.south <= left.north;
}

function centreOf(box: BoundingBox): { readonly lon: number; readonly lat: number } {
  return { lon: (box.west + box.east) / 2, lat: (box.south + box.north) / 2 };
}

function stateLabel(name: string): string {
  return name.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** State boxes a corridor touches: the areas an answer either covers or leaves unknown. */
function stateBoxesIn(corridor: BoundingBox): readonly BoundingBox[] {
  return Object.values(US_STATE_BOXES).filter((box) => intersects(box, corridor));
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
    const states = stateNames(state);
    if (states.length === 0) continue;
    const name = String(row["feedname"] ?? row["issuingorganization"] ?? state).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    feeds.push({
      id: `wzdx-${name}`,
      organization: String(row["issuingorganization"] ?? state),
      states,
      url,
      boxes: stateBoxes(state),
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
  /** Optional persistence so a restart does not re-read the registry to answer. */
  readonly store?: WzdxRegistryStore;
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
  const registry = createTtlCache<"registry", WzdxRegistryListing>({ ttlMs: REGISTRY_TTL_MS, serveStaleMs: REGISTRY_STALE_MS, now });
  const feeds = createTtlCache<string, AuthorityFeedSnapshot>({ ttlMs: BUDGET.cacheTtlMs, serveStaleMs: BUDGET.serveStaleMs, maxEntries: 64, now });
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

  async function loadRegistry(): Promise<WzdxRegistryListing> {
    const value = {
      fetchedAt: new Date(now()).toISOString(),
      feeds: usableRegistryFeeds(await getJson(options.registryUrl ?? WZDX_REGISTRY_URL)),
    };
    await options.store?.writeRegistry(value).catch(() => undefined);
    return value;
  }

  async function listing(): Promise<readonly RegistryFeed[]> {
    const cached = registry.read("registry");
    if (cached.state === "fresh") return cached.value.feeds;
    try {
      return (await registry.load("registry", loadRegistry)).feeds;
    } catch (error) {
      if (cached.state === "stale") return cached.value.feeds;
      // The listing is configuration, not closure truth: a persisted copy names
      // the feeds to ask and each of those is still fetched live.
      const persisted = await options.store?.readRegistry().catch(() => null) ?? null;
      if (persisted !== null && now() - Date.parse(persisted.fetchedAt) <= REGISTRY_TTL_MS + REGISTRY_STALE_MS) {
        registry.write("registry", persisted);
        return persisted.feeds;
      }
      throw error;
    }
  }

  async function loadFeed(feed: RegistryFeed): Promise<AuthorityFeedSnapshot> {
    // A persisted feed snapshot inside its freshness window answers for a
    // restart; past it, a closure feed is fetched again (never served stale
    // from disk).
    const persisted = await options.store?.readFeed(feed.id).catch(() => null) ?? null;
    if (persisted !== null && now() - Date.parse(persisted.fetchedAt) <= BUDGET.cacheTtlMs) return persisted;
    const value: AuthorityFeedSnapshot = {
      fetchedAt: new Date(now()).toISOString(),
      // Records belong to this source (its authority and precedence); the
      // state feed survives in the record id for diagnostics.
      records: parseWzdxFeed(await getJson(feed.url), info.id, feed.timeZone)
        .map((record) => ({ ...record, sourceRecordId: `${feed.id}:${record.sourceRecordId}` })),
    };
    await options.store?.writeFeed(feed.id, value).catch(() => undefined);
    return value;
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
      const home = homeStateOf(centreOf(corridor));
      const isHomeFeed = (feed: RegistryFeed): boolean => home !== null && feed.states.includes(home);
      const relevant = available.filter((feed) => feed.boxes.some((box) => intersects(box, corridor)));
      // The view's own state's feeds go first: the per-plan cap must never drop
      // them in favour of neighbours whose coarse boxes only reach across the
      // border.
      const asked = [...relevant]
        .sort((left, right) => Number(isHomeFeed(right)) - Number(isHomeFeed(left)))
        .slice(0, MAX_FEEDS_PER_PLAN);
      const required = asked.filter(isHomeFeed);
      const scope = asked.flatMap((feed) => feed.boxes).filter((box) => intersects(box, corridor));
      const noHomeFeed = required.length === 0 && home !== null
        ? `No keyless work-zone feed is registered for ${stateLabel(home)}; its reports are unknown.`
        : null;
      if (asked.length === 0) {
        return {
          status: "fresh", fetchedAt: new Date(now()).toISOString(), reason: noHomeFeed,
          records: [], covered: [], scope: [], unknownAreas: stateBoxesIn(corridor),
        };
      }
      const answers = await Promise.all(asked.map(async (feed) => {
        const cached = feeds.read(feed.id);
        if (cached.state === "fresh") return { feed, value: cached.value, stale: false };
        try {
          return { feed, value: await feeds.load(feed.id, () => loadFeed(feed)), stale: false };
        } catch {
          return cached.state === "stale" ? { feed, value: cached.value, stale: true } : null;
        }
      }));
      const answered = answers.filter((answer) => answer !== null);
      // Only the view's own state's feeds are the authority for this view; a
      // neighbour that merely shares a coarse box is best effort, and its gap
      // is reported as an unknown area instead of failing the whole layer.
      if (required.length > 0 && !answered.some((answer) => isHomeFeed(answer.feed))) {
        return {
          status: "unavailable", fetchedAt: null,
          reason: `${stateLabel(home!)} work-zone feeds are unavailable right now.`,
          records: [], covered: [], scope,
        };
      }
      const inCorridor = (record: RoadAuthorityRecord): boolean => {
        const points = record.geometry.type === "point" ? [record.geometry.coordinate] : record.geometry.coordinates;
        return points.some((point) => point.lon >= corridor.west && point.lon <= corridor.east && point.lat >= corridor.south && point.lat <= corridor.north);
      };
      const missing = asked.length - answered.length;
      const notes = [
        missing > 0 ? `${missing} state work-zone feed${missing === 1 ? "" : "s"} did not answer.` : null,
        noHomeFeed,
      ].filter((note): note is string => note !== null);
      const answeredBoxes = new Set(answered.flatMap((answer) => answer.feed.boxes));
      // Every state box in the corridor this answer does not speak for: it
      // keeps a covered neighbor's overlapping box from claiming its roads.
      const unknownAreas = stateBoxesIn(corridor).filter((box) => !answeredBoxes.has(box));
      return {
        status: answered.some((answer) => answer.stale) ? "stale" : "fresh",
        fetchedAt: answered.length === 0
          ? new Date(now()).toISOString()
          : new Date(answered.reduce((min, answer) => Math.min(min, Date.parse(answer.value.fetchedAt)), Number.POSITIVE_INFINITY)).toISOString(),
        reason: notes.length === 0 ? null : notes.join(" "),
        records: answered.flatMap((answer) => answer.value.records.filter(inCorridor)),
        covered: answered.flatMap((answer) => answer.feed.boxes),
        scope,
        unknownAreas,
      };
    },
  };
}
