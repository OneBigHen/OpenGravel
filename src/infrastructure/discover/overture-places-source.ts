/**
 * Overture Places regional index for Discover.
 *
 * The expensive global GeoParquet scan happens at build time. Runtime is the
 * same cheap coarse-grid lookup pattern as the OSM index. The build deliberately
 * keeps only rider-destination categories; ordinary businesses/food are left to
 * the Places service where rating/popularity/time evidence can exist.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { InterestingPlaceSource } from "@/application/discover/interesting-place-source";
import type { DiscoverCategory, InterestingPlace } from "@/application/discover/types";

const CELL_DEGREES = 0.1;
const MAX_PER_SEARCH = 2_000;

export interface OvertureIndexedPlace {
  readonly id: string;
  readonly name: string;
  readonly c: readonly DiscoverCategory[];
  readonly at: readonly [number, number];
  readonly confidence: number;
  readonly website?: string;
}

export interface OverturePlacesIndex {
  readonly version: 1;
  readonly release: string;
  readonly schema: string;
  readonly builtAt: string;
  readonly places: readonly OvertureIndexedPlace[];
}

function safeHttps(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function overtureInterestingPlace(
  entry: OvertureIndexedPlace,
  builtAt: string,
): InterestingPlace | null {
  if (entry.name.trim() === "" || entry.c.length === 0) return null;
  const [lon, lat] = entry.at;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  const confidence = Number.isFinite(entry.confidence)
    ? Math.max(0, Math.min(1, entry.confidence))
    : 0.5;
  return {
    id: `overture:${entry.id}`,
    name: entry.name,
    category: entry.c[0]!,
    categories: entry.c,
    coordinate: { lon, lat },
    description: null,
    image: null,
    wikidataId: null,
    facts: {},
    tags: [],
    confidence,
    provenance: [{
      sourceId: "overture",
      sourceLabel: "Overture Maps",
      recordId: `overture:${entry.id}`,
      url: safeHttps(entry.website),
      retrievedAt: builtAt,
    }],
  };
}

export function createOverturePlacesSource(options: {
  readonly load: () => Promise<OverturePlacesIndex | null>;
}): InterestingPlaceSource {
  let ready: Promise<{ readonly grid: Map<string, InterestingPlace[]> } | null> | null = null;

  function index() {
    ready ??= options.load().then((loaded) => {
      if (loaded === null || loaded.version !== 1) return null;
      const grid = new Map<string, InterestingPlace[]>();
      for (const entry of loaded.places) {
        const place = overtureInterestingPlace(entry, loaded.builtAt);
        if (place === null) continue;
        const key = `${Math.floor(place.coordinate.lon / CELL_DEGREES)}:${Math.floor(place.coordinate.lat / CELL_DEGREES)}`;
        const cell = grid.get(key);
        if (cell === undefined) grid.set(key, [place]);
        else cell.push(place);
      }
      return { grid };
    }, () => {
      ready = null;
      return null;
    });
    return ready;
  }

  return {
    id: "overture",
    label: "Overture Maps",
    async search(area) {
      const loaded = await index();
      if (loaded === null) {
        return { status: "unavailable", reason: "The Overture rider-places index is not built on this server.", places: [] };
      }
      const found = new Map<string, InterestingPlace>();
      for (const sample of area.samples) {
        const latSpan = sample.radiusMeters / 111_320;
        const lonSpan = sample.radiusMeters / (111_320 * Math.max(0.2, Math.cos(sample.center.lat * Math.PI / 180)));
        for (let x = Math.floor((sample.center.lon - lonSpan) / CELL_DEGREES); x <= Math.floor((sample.center.lon + lonSpan) / CELL_DEGREES); x += 1) {
          for (let y = Math.floor((sample.center.lat - latSpan) / CELL_DEGREES); y <= Math.floor((sample.center.lat + latSpan) / CELL_DEGREES); y += 1) {
            for (const place of loaded.grid.get(`${x}:${y}`) ?? []) {
              if (found.size >= MAX_PER_SEARCH) break;
              if (!found.has(place.id) && haversine(sample.center, place.coordinate) <= sample.radiusMeters) {
                found.set(place.id, place);
              }
            }
          }
        }
      }
      return { status: "ok", reason: null, places: [...found.values()] };
    },
  };
}
