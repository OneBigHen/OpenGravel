/**
 * Discover's Wikimedia source: Wikipedia geosearch for geotagged articles,
 * Wikidata for what each one *is* (and a few facts), Commons for a licensed
 * image with its attribution. No key; an identifying User-Agent and
 * Api-User-Agent on every call, `maxlag`, few calls in flight, aggressive
 * caching (MediaWiki API etiquette).
 *
 * An article becomes a place only when Wikidata says it is a kind of place a
 * rider would stop for (by the English labels of its "instance of" classes)
 * or it is a listed heritage site. Towns, schools and companies are not
 * discoveries.
 */

import { createTtlCache } from "@/application/route-intelligence/cache-policy";
import type { InterestingPlaceSource, PlaceEnricher } from "@/application/discover/interesting-place-source";
import type { DiscoverCategory, InterestingPlace, PlaceFacts, PlaceImage } from "@/application/discover/types";
import type { Coordinate } from "@/domain/ride/types";

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const DAY_MS = 24 * 3_600_000;
const TIMEOUT_MS = 6_000;
const MAX_IN_FLIGHT = 2;
const BATCH = 50;
const EXTRACT_BATCH = 20;
/**
 * Circles still being searched after this are left to finish in the
 * background (they fill the cache for the next ask); the answer uses what has
 * arrived, inside the coordinator's deadline.
 */
const GEOSEARCH_BUDGET_MS = 2_000;
/** The whole search answers inside the coordinator's 4 s deadline. */
const SEARCH_BUDGET_MS = 3_400;

/** Resolves true when `work` settles in time, false when time runs out; `work` keeps running. */
function within(work: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    work.then(
      () => { clearTimeout(timer); resolve(true); },
      () => { clearTimeout(timer); resolve(true); },
    );
  });
}

/** Class label → category. First match wins; order matters. */
const CLASS_RULES: readonly (readonly [RegExp, readonly DiscoverCategory[]])[] = [
  [/waterfall|cascade/, ["waterfall", "nature", "scenic"]],
  [/covered bridge/, ["bridge", "history"]],
  [/\bbridge\b|viaduct|aqueduct/, ["bridge", "architecture"]],
  [/ghost town|abandoned|roadside attraction|oddity|folly|hoax|curiosit/, ["quirky"]],
  [/ruin|archaeological site/, ["ruins", "history"]],
  [/cave|cavern|rock formation|natural arch|boulder field|boulder|geological/, ["quirky", "nature"]],
  [/observation tower|scenic viewpoint|overlook|vista/, ["viewpoint", "scenic"]],
  [/lighthouse/, ["architecture", "scenic"]],
  [/mountain|summit|peak|\bhill\b|ridge|gorge|canyon|gap\b/, ["scenic", "nature"]],
  [/museum|gallery|planetarium|historic house museum/, ["museum"]],
  [/sculpture|statue|mural|public art|work of art/, ["public-art"]],
  [/battlefield|fort\b|fortification|historic site|historic district|monument|memorial|cemetery|canal|furnace|mill\b|tavern|covered|historic/, ["history"]],
  [/church|chapel|cathedral|mansion|house|castle|courthouse|train station|railway station|building|tower/, ["architecture", "history"]],
  [/campground|campsite/, ["camping", "recreation"]],
  [/state park|national park|park\b|forest|nature reserve|wildlife|preserve|recreation area|lake|reservoir|river|trail|gardens?\b/, ["nature", "recreation"]],
  [/amusement|zoo|aquarium/, ["recreation"]],
];

/** Things that are never a discovery, whatever else they are. */
const EXCLUDE = /\b(river|stream|creek|brook|tributary|watercourse)\b|borough|township|\bcity\b|\btown\b|village|hamlet|census-designated|unincorporated|county|school|university|college|company|business|corporation|hospital|airport|shopping|retail|restaurant|hotel|neighborhood|human settlement|residential|office|stadium|sports venue|road\b|highway|street|district of|political|organization|club|church congregation|diocese|parish/;

export function classify(classLabels: readonly string[], heritage: boolean): readonly DiscoverCategory[] | null {
  const labels = classLabels.map((label) => label.toLowerCase());
  if (labels.some((label) => EXCLUDE.test(label))) return null;
  for (const [pattern, categories] of CLASS_RULES) {
    if (labels.some((label) => pattern.test(label))) return heritage && !categories.includes("history") ? [...categories, "history"] : categories;
  }
  return heritage ? ["history"] : null;
}

interface WikiPage {
  readonly title: string;
  readonly url: string;
  readonly coordinate: Coordinate;
  readonly wikidataId: string | null;
  readonly imageFile: string | null;
}

interface WikidataFacts {
  readonly classes: readonly string[];
  readonly heritage: readonly string[];
  readonly facts: PlaceFacts;
  /** P18: the item's own Commons image. */
  readonly imageFile: string | null;
  /** The English Wikipedia article, when the item has one. */
  readonly enwikiTitle: string | null;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();
}

/** The first one or two sentences, never more than ~240 characters. */
export function shortExtract(text: string | undefined): string | null {
  if (text === undefined) return null;
  const clean = text.replace(/\s+/g, " ").replace(/\s*\([^)]*\)/g, "").trim();
  if (clean.length < 20) return null;
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [clean];
  let out = "";
  for (const sentence of sentences.slice(0, 2)) {
    if ((out + sentence).length > 240 && out.length > 0) break;
    out += sentence;
  }
  return out.trim().slice(0, 260);
}

type Json = Record<string, unknown>;

export interface WikimediaSourceOptions {
  readonly userAgent: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export function createWikimediaSource(options: WikimediaSourceOptions): InterestingPlaceSource & PlaceEnricher {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const geoCache = createTtlCache<string, readonly WikiPage[]>({ ttlMs: DAY_MS, serveStaleMs: 7 * DAY_MS, maxEntries: 2_000, now });
  const entityCache = createTtlCache<string, WikidataFacts | null>({ ttlMs: 7 * DAY_MS, serveStaleMs: 7 * DAY_MS, maxEntries: 20_000, now });
  const labelCache = createTtlCache<string, string>({ ttlMs: 30 * DAY_MS, serveStaleMs: 30 * DAY_MS, maxEntries: 20_000, now });
  const imageCache = createTtlCache<string, PlaceImage | null>({ ttlMs: 7 * DAY_MS, serveStaleMs: 7 * DAY_MS, maxEntries: 20_000, now });
  const extractCache = createTtlCache<string, string | null>({ ttlMs: 7 * DAY_MS, serveStaleMs: 7 * DAY_MS, maxEntries: 20_000, now });

  let inFlight = 0;
  const waiting: (() => void)[] = [];
  async function slot<T>(run: () => Promise<T>): Promise<T> {
    if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
    inFlight += 1;
    try {
      return await run();
    } finally {
      inFlight -= 1;
      waiting.shift()?.();
    }
  }

  async function api(base: string, params: Record<string, string>): Promise<Json> {
    const query = new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...params });
    const url = `${base}?${query.toString()}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await slot(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          return await doFetch(url, {
            signal: controller.signal,
            headers: { "user-agent": options.userAgent, "api-user-agent": options.userAgent, accept: "application/json" },
          });
        } finally {
          clearTimeout(timer);
        }
      });
      if (response.status === 429 || response.status === 503) {
        const wait = Math.min(5, Number(response.headers.get("retry-after")) || 1);
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, wait * 1_000));
          continue;
        }
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as Json;
      if (typeof body["error"] === "object" && body["error"] !== null) throw new Error("MediaWiki error");
      return body;
    }
    throw new Error("rate limited");
  }

  /**
   * Privacy: Wikipedia is told a centre rounded to ~1 km, with the radius
   * grown to still cover the asked circle, never a rider's precise position.
   * The coarse key also lets nearby riders share the cached answer.
   */
  async function geosearch(asked: Coordinate, radiusMeters: number): Promise<readonly WikiPage[]> {
    const center = { lat: Math.round(asked.lat * 100) / 100, lon: Math.round(asked.lon * 100) / 100 };
    const radius = Math.min(10_000, Math.max(1_000, Math.round(radiusMeters + 800)));
    const key = `${center.lat.toFixed(2)},${center.lon.toFixed(2)},${radius}`;
    const cached = geoCache.read(key);
    if (cached.state === "fresh") return cached.value;
    return geoCache.load(key, async () => {
      const body = await api(WIKIPEDIA_API, {
        action: "query",
        generator: "geosearch",
        ggscoord: `${center.lat}|${center.lon}`,
        ggsradius: String(radius),
        ggslimit: "50",
        ggsnamespace: "0",
        prop: "coordinates|pageprops|pageimages|info",
        ppprop: "wikibase_item",
        piprop: "name",
        inprop: "url",
        colimit: "50",
      });
      const pages = ((body["query"] as Json | undefined)?.["pages"] ?? []) as Json[];
      return pages.flatMap((page): WikiPage[] => {
        const coordinates = (page["coordinates"] as Json[] | undefined)?.[0];
        if (coordinates === undefined || typeof coordinates["lat"] !== "number" || typeof coordinates["lon"] !== "number") return [];
        const wikidata = (page["pageprops"] as Json | undefined)?.["wikibase_item"];
        return [{
          title: String(page["title"]),
          url: String(page["fullurl"] ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(String(page["title"]).replace(/ /g, "_"))}`),
          coordinate: { lat: coordinates["lat"], lon: coordinates["lon"] },
          wikidataId: typeof wikidata === "string" && /^Q\d+$/.test(wikidata) ? wikidata : null,
          imageFile: typeof page["pageimage"] === "string" ? page["pageimage"] : null,
        }];
      });
    });
  }

  function claimIds(entity: Json, property: string): string[] {
    const claims = ((entity["claims"] as Json | undefined)?.[property] ?? []) as Json[];
    return claims.flatMap((claim) => {
      const value = ((claim["mainsnak"] as Json | undefined)?.["datavalue"] as Json | undefined)?.["value"] as Json | undefined;
      return typeof value?.["id"] === "string" ? [value["id"]] : [];
    });
  }

  function claimYear(entity: Json, property: string): number | undefined {
    const claims = ((entity["claims"] as Json | undefined)?.[property] ?? []) as Json[];
    const time = (((claims[0]?.["mainsnak"] as Json | undefined)?.["datavalue"] as Json | undefined)?.["value"] as Json | undefined)?.["time"];
    const match = typeof time === "string" ? /^[+](\d{4})-/.exec(time) : null;
    return match === null ? undefined : Number(match[1]);
  }

  async function labels(ids: readonly string[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => labelCache.read(id).state === "miss");
    for (let index = 0; index < missing.length; index += BATCH) {
      const batch = missing.slice(index, index + BATCH);
      const body = await api(WIKIDATA_API, { action: "wbgetentities", ids: batch.join("|"), props: "labels", languages: "en" });
      const entities = (body["entities"] ?? {}) as Record<string, Json>;
      for (const id of batch) {
        const label = ((entities[id]?.["labels"] as Json | undefined)?.["en"] as Json | undefined)?.["value"];
        labelCache.write(id, typeof label === "string" ? label : id);
      }
    }
  }

  const labelOf = (id: string): string => {
    const read = labelCache.read(id);
    return read.state === "miss" ? id : read.value;
  };

  async function entities(ids: readonly string[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => entityCache.read(id).state === "miss");
    const pending: { id: string; classes: string[]; heritage: string[]; creator: string[]; built?: number; image: string | null; enwiki: string | null }[] = [];
    for (let index = 0; index < missing.length; index += BATCH) {
      const batch = missing.slice(index, index + BATCH);
      const body = await api(WIKIDATA_API, { action: "wbgetentities", ids: batch.join("|"), props: "claims|sitelinks", sitefilter: "enwiki", languages: "en" });
      const found = (body["entities"] ?? {}) as Record<string, Json>;
      for (const id of batch) {
        const entity = found[id];
        if (entity === undefined || "missing" in entity) {
          entityCache.write(id, null);
          continue;
        }
        const built = claimYear(entity, "P571");
        const p18 = ((((entity["claims"] as Json | undefined)?.["P18"] as Json[] | undefined)?.[0]?.["mainsnak"] as Json | undefined)?.["datavalue"] as Json | undefined)?.["value"];
        const enwiki = ((entity["sitelinks"] as Json | undefined)?.["enwiki"] as Json | undefined)?.["title"];
        pending.push({
          id,
          classes: claimIds(entity, "P31"),
          heritage: claimIds(entity, "P1435"),
          creator: [...claimIds(entity, "P84"), ...claimIds(entity, "P170")],
          ...(built === undefined ? {} : { built }),
          image: typeof p18 === "string" ? p18.replace(/ /g, "_") : null,
          enwiki: typeof enwiki === "string" ? enwiki : null,
        });
      }
    }
    await labels(pending.flatMap((entry) => [...entry.classes, ...entry.heritage, ...entry.creator.slice(0, 1)]));
    for (const entry of pending) {
      const heritage = entry.heritage.map(labelOf);
      const creator = entry.creator[0] === undefined ? undefined : labelOf(entry.creator[0]);
      entityCache.write(entry.id, {
        imageFile: entry.image,
        enwikiTitle: entry.enwiki,
        classes: entry.classes.map(labelOf),
        heritage,
        facts: {
          ...(entry.built === undefined ? {} : { builtYear: entry.built }),
          ...(heritage.length === 0 ? {} : { heritage }),
          ...(entry.classes.length === 0 ? {} : { instanceOf: entry.classes.map(labelOf).slice(0, 3) }),
          ...(creator === undefined ? {} : { creator }),
        },
      });
    }
  }

  async function extracts(titles: readonly string[]): Promise<void> {
    const missing = [...new Set(titles)].filter((title) => extractCache.read(title).state === "miss");
    for (let index = 0; index < missing.length; index += EXTRACT_BATCH) {
      const batch = missing.slice(index, index + EXTRACT_BATCH);
      const body = await api(WIKIPEDIA_API, {
        action: "query", titles: batch.join("|"), prop: "extracts", exintro: "1", explaintext: "1", exlimit: String(EXTRACT_BATCH), redirects: "1",
      });
      const pages = ((body["query"] as Json | undefined)?.["pages"] ?? []) as Json[];
      const byTitle = new Map(pages.map((page) => [String(page["title"]), typeof page["extract"] === "string" ? page["extract"] : undefined]));
      for (const title of batch) extractCache.write(title, shortExtract(byTitle.get(title)));
    }
  }

  /** Commons only: a local (non-free) enwiki image is never used. */
  async function images(files: readonly string[]): Promise<void> {
    const missing = [...new Set(files)].filter((file) => imageCache.read(file).state === "miss");
    for (let index = 0; index < missing.length; index += BATCH) {
      const batch = missing.slice(index, index + BATCH);
      const body = await api(COMMONS_API, {
        action: "query",
        titles: batch.map((file) => `File:${file}`).join("|"),
        prop: "imageinfo",
        iiprop: "url|extmetadata",
        iiurlwidth: "640",
        iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|AttributionRequired|UsageTerms",
      });
      const pages = ((body["query"] as Json | undefined)?.["pages"] ?? []) as Json[];
      const byFile = new Map<string, PlaceImage | null>();
      for (const page of pages) {
        const file = String(page["title"] ?? "").replace(/^File:/, "");
        const info = (page["imageinfo"] as Json[] | undefined)?.[0];
        const meta = (info?.["extmetadata"] ?? {}) as Record<string, Json>;
        const license = typeof meta["LicenseShortName"]?.["value"] === "string" ? stripHtml(String(meta["LicenseShortName"]["value"])) : null;
        const thumb = info?.["thumburl"] ?? info?.["url"];
        if (page["missing"] === true || info === undefined || license === null || typeof thumb !== "string") {
          byFile.set(file, null);
          continue;
        }
        const author = typeof meta["Artist"]?.["value"] === "string" ? stripHtml(String(meta["Artist"]["value"])).slice(0, 160) : null;
        byFile.set(file, {
          url: thumb,
          ...(typeof info["thumbwidth"] === "number" ? { width: info["thumbwidth"] } : {}),
          ...(typeof info["thumbheight"] === "number" ? { height: info["thumbheight"] } : {}),
          pageUrl: typeof info["descriptionurl"] === "string" ? info["descriptionurl"] : `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
          author: author === "" ? null : author,
          license,
          licenseUrl: typeof meta["LicenseUrl"]?.["value"] === "string" ? String(meta["LicenseUrl"]["value"]) : null,
          attributionRequired: String(meta["AttributionRequired"]?.["value"] ?? "true") !== "false",
        });
      }
      // MediaWiki normalizes titles ("_" → " "); match either way.
      for (const file of batch) {
        imageCache.write(file, byFile.get(file) ?? byFile.get(file.replace(/_/g, " ")) ?? null);
      }
    }
  }

  return {
    id: "wikimedia",
    label: "Wikipedia",
    async search(area) {
      const deadline = now() + SEARCH_BUDGET_MS;
      const left = (reserve = 0): number => Math.max(0, deadline - now() - reserve);
      try {
        const pages = new Map<string, WikiPage>();
        const searches = area.samples.map((sample) =>
          geosearch(sample.center, sample.radiusMeters).then((found) => {
            for (const page of found) pages.set(page.title, page);
            return true;
          }, () => false),
        );
        const allSearches = Promise.all(searches);
        const searched = await within(allSearches, GEOSEARCH_BUDGET_MS);
        if (searched && (await allSearches).every((ok) => !ok) && area.samples.length > 0) throw new Error("geosearch failed");
        if (!searched && pages.size === 0) {
          const late = await within(allSearches, 500);
          if (late && (await allSearches).every((ok) => !ok)) throw new Error("geosearch failed");
        }
        const withItems = [...pages.values()].filter((page) => page.wikidataId !== null);
        const classified = await within(entities(withItems.map((page) => page.wikidataId!)), left(700));
        const kept: { page: WikiPage; categories: readonly DiscoverCategory[]; data: WikidataFacts }[] = [];
        for (const page of withItems) {
          const read = entityCache.read(page.wikidataId!);
          const data = read.state === "miss" ? null : read.value;
          if (data === null) continue;
          const categories = classify(data.classes, data.heritage.length > 0);
          if (categories !== null) kept.push({ page, categories, data });
        }
        const detailed = await within(Promise.all([
          extracts(kept.map((entry) => entry.page.title)),
          images(kept.flatMap((entry) => {
            const file = entry.page.imageFile ?? entry.data.imageFile;
            return file === null ? [] : [file];
          })),
        ]), left(100));
        const retrievedAt = new Date(now()).toISOString();
        const places: InterestingPlace[] = kept.map(({ page, categories, data }) => {
          const extract = extractCache.read(page.title);
          const file = page.imageFile ?? data.imageFile;
          const image = file === null ? { state: "miss" as const } : imageCache.read(file);
          return {
            id: `wikipedia:en:${page.title.replace(/ /g, "_")}`,
            name: page.title.replace(/\s*\([^)]*\)$/, ""),
            category: categories[0]!,
            categories,
            coordinate: page.coordinate,
            description: extract.state === "miss" ? null : extract.value,
            image: image.state === "miss" ? null : image.value,
            wikidataId: page.wikidataId,
            facts: data.facts,
            tags: [],
            confidence: 0.85,
            provenance: [
              { sourceId: "wikimedia", sourceLabel: "Wikipedia", recordId: `wikipedia:en:${page.title}`, url: page.url, retrievedAt },
              { sourceId: "wikimedia", sourceLabel: "Wikidata", recordId: `wikidata:${page.wikidataId}`, url: `https://www.wikidata.org/wiki/${page.wikidataId}`, retrievedAt },
            ],
          };
        });
        const complete = searched && classified && detailed;
        return { status: "ok", reason: complete ? null : "Part of the area is still being searched.", places };
      } catch {
        return { status: "unavailable", reason: "Wikipedia is unavailable right now.", places: [] };
      }
    },

    /**
     * Wikidata enrichment for places another source found (OSM tags many
     * with `wikidata=`): what the item is, its facts, its own Commons image
     * and its Wikipedia summary. Bounded by `budgetMs`; unfinished work warms
     * the caches for the next ask.
     */
    async enrich(places, _signal, budgetMs) {
      const deadline = now() + budgetMs;
      const left = (reserve = 0): number => Math.max(0, deadline - now() - reserve);
      const ids = [...new Set(places.flatMap((place) => (place.wikidataId === null ? [] : [place.wikidataId])))].slice(0, 100);
      if (ids.length === 0) return places;
      try {
        await within(entities(ids), left(400));
        const data = new Map<string, WikidataFacts>();
        for (const id of ids) {
          const read = entityCache.read(id);
          if (read.state !== "miss" && read.value !== null) data.set(id, read.value);
        }
        await within(Promise.all([
          extracts([...data.values()].flatMap((entry) => (entry.enwikiTitle === null ? [] : [entry.enwikiTitle]))),
          images([...data.values()].flatMap((entry) => (entry.imageFile === null ? [] : [entry.imageFile]))),
        ]), left(50));
        const retrievedAt = new Date(now()).toISOString();
        return places.map((place) => {
          const entry = place.wikidataId === null ? undefined : data.get(place.wikidataId);
          if (entry === undefined) return place;
          const extract = entry.enwikiTitle === null ? null : extractCache.read(entry.enwikiTitle);
          const image = entry.imageFile === null ? null : imageCache.read(entry.imageFile);
          const categories = classify(entry.classes, entry.heritage.length > 0);
          const merged = categories === null ? place.categories : [...new Set([...categories, ...place.categories])];
          return {
            ...place,
            category: categories?.[0] ?? place.category,
            categories: merged,
            description: place.description ?? (extract === null || extract.state === "miss" ? null : extract.value),
            image: place.image ?? (image === null || image.state === "miss" ? null : image.value),
            facts: { ...entry.facts, ...place.facts },
            provenance: [
              ...place.provenance,
              { sourceId: "wikimedia", sourceLabel: "Wikidata", recordId: `wikidata:${place.wikidataId}`, url: `https://www.wikidata.org/wiki/${place.wikidataId}`, retrievedAt },
            ],
          };
        });
      } catch {
        return places;
      }
    },
  };
}
