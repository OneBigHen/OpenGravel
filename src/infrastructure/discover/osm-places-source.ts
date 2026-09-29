/**
 * Discover's OSM source: the regional index `infra/discover/build-osm-places.sh`
 * builds from our own extract. Loaded once, answered from memory through a
 * coarse grid; there is no Overpass call at runtime.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { InterestingPlaceSource } from "@/application/discover/interesting-place-source";
import {
  DISCOVER_CATEGORIES,
  type DiscoverCategory,
  type InterestingPlace,
  type PlaceFacts,
} from "@/application/discover/types";

const CELL_DEGREES = 0.1;
const MAX_PER_SEARCH = 2_000;

/** The compact on-disk shape (see build-osm-places.mjs). */
interface IndexedPlace {
  readonly id: string;
  readonly name: string;
  readonly c: readonly string[];
  readonly at: readonly [number, number];
  readonly wd?: string;
  readonly wp?: string;
  readonly d?: string;
  readonly f?: PlaceFacts;
}

const CATEGORY_SET: ReadonlySet<string> = new Set(DISCOVER_CATEGORIES);

function osmUrl(id: string): string | null {
  const match = /^osm:([nwr])(\d+)$/.exec(id);
  if (match === null) return null;
  const type = match[1] === "n" ? "node" : match[1] === "w" ? "way" : "relation";
  return `https://www.openstreetmap.org/${type}/${match[2]}`;
}

function wikipediaUrl(tag: string | undefined): string | null {
  if (tag === undefined) return null;
  const match = /^([a-z-]{2,12}):(.+)$/.exec(tag);
  return match === null ? null : `https://${match[1]}.wikipedia.org/wiki/${encodeURIComponent(match[2]!.replace(/ /g, "_"))}`;
}

export function toInterestingPlace(entry: IndexedPlace, builtAt: string): InterestingPlace | null {
  const categories = entry.c.filter((category): category is DiscoverCategory => CATEGORY_SET.has(category));
  if (categories.length === 0 || entry.name.trim().length === 0) return null;
  const [lon, lat] = entry.at;
  const tags = [...(entry.wp === undefined ? [] : [`wikipedia=${entry.wp}`])];
  return {
    id: entry.id,
    name: entry.name,
    category: categories[0]!,
    categories,
    coordinate: { lon, lat },
    description: entry.d ?? null,
    image: null,
    wikidataId: entry.wd !== undefined && /^Q\d+$/.test(entry.wd) ? entry.wd : null,
    facts: entry.f ?? {},
    tags,
    // Mapped by someone on the ground; notability (a wiki link) adds weight.
    confidence: entry.wd !== undefined || entry.wp !== undefined ? 0.8 : 0.6,
    provenance: [{
      sourceId: "osm",
      sourceLabel: "OpenStreetMap",
      recordId: entry.id,
      url: osmUrl(entry.id) ?? wikipediaUrl(entry.wp),
      retrievedAt: builtAt,
    }],
  };
}

export interface OsmPlacesIndex {
  readonly builtAt: string;
  readonly places: readonly IndexedPlace[];
}

export function createOsmPlacesSource(options: {
  /** Loads the index; called once, lazily. `null` means not built on this server. */
  readonly load: () => Promise<OsmPlacesIndex | null>;
}): InterestingPlaceSource {
  let ready: Promise<{ readonly builtAt: string; readonly grid: Map<string, InterestingPlace[]> } | null> | null = null;

  function index() {
    ready ??= options.load().then((loaded) => {
      if (loaded === null) return null;
      const grid = new Map<string, InterestingPlace[]>();
      for (const entry of loaded.places) {
        const place = toInterestingPlace(entry, loaded.builtAt);
        if (place === null) continue;
        const key = `${Math.floor(place.coordinate.lon / CELL_DEGREES)}:${Math.floor(place.coordinate.lat / CELL_DEGREES)}`;
        const cell = grid.get(key);
        if (cell === undefined) grid.set(key, [place]);
        else cell.push(place);
      }
      return { builtAt: loaded.builtAt, grid };
    }, () => {
      ready = null;
      return null;
    });
    return ready;
  }

  return {
    id: "osm",
    label: "OpenStreetMap",
    async search(area) {
      const loaded = await index();
      if (loaded === null) return { status: "unavailable", reason: "The OpenStreetMap places index is not built on this server.", places: [] };
      const found = new Map<string, InterestingPlace>();
      for (const sample of area.samples) {
        const latSpan = sample.radiusMeters / 111_320;
        const lonSpan = sample.radiusMeters / (111_320 * Math.max(0.2, Math.cos((sample.center.lat * Math.PI) / 180)));
        for (let x = Math.floor((sample.center.lon - lonSpan) / CELL_DEGREES); x <= Math.floor((sample.center.lon + lonSpan) / CELL_DEGREES); x += 1) {
          for (let y = Math.floor((sample.center.lat - latSpan) / CELL_DEGREES); y <= Math.floor((sample.center.lat + latSpan) / CELL_DEGREES); y += 1) {
            for (const place of loaded.grid.get(`${x}:${y}`) ?? []) {
              if (found.size >= MAX_PER_SEARCH) break;
              if (!found.has(place.id) && haversine(sample.center, place.coordinate) <= sample.radiusMeters) found.set(place.id, place);
            }
          }
        }
      }
      return { status: "ok", reason: null, places: [...found.values()] };
    },
  };
}
