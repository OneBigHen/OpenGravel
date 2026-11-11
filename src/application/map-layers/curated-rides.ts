/**
 * The curated catalog rides as a map layer (first-minute wow, W5).
 *
 * The rides Explore lists under "From PA Adventure Bike Rides" are drawn as
 * thin outline lines when the map is zoomed out, so a new rider sees real
 * rides near them before tapping anything. Two rules hold here:
 *
 * - every fact on the card is copied from the published route, never guessed:
 *   the distance is the route's own, and a surface the source does not state is
 *   `null` — which the card says as "Surface unknown", never as "paved";
 * - the line sent to the browser is simplified to a few hundred points. It is
 *   an outline at zoom 7–10, not the ride: tapping "Ride this" opens the route's
 *   own full line through the Explore handoff.
 */

import type { InfoFeature, LngLat, MapLayerBounds } from "./types";

/** The credit Explore shows for these rides; kept verbatim on the map card. */
export const CURATED_RIDES_SOURCE = "PA Adventure Bike Rides";

/**
 * How many points one outline keeps. A whole-state view is ~1.6° wide, so 320
 * points are finer than a pixel at the zooms this layer draws at.
 */
export const MAX_CURATED_ROUTE_POINTS = 320;

const METERS_PER_MILE = 1609.344;

/** What the card states about one route's surface. */
export interface CuratedRideSurface {
  /** Miles the source says are not paved; `0` means the source says "Paved". */
  readonly unpavedMiles: number;
  /** The source's own word for that surface, or `null` when it says "Paved". */
  readonly unpavedKind: "gravel" | "dirt" | "unpaved" | null;
}

/** The facts a tapped curated ride's card shows, in the rider's words. */
export interface CuratedRideFacts {
  /** The catalog route id, so "Ride this" opens the route that was tapped. */
  readonly routeId: string;
  readonly miles: number;
  /**
   * The source's non-paved mileage, or `null` when it states no surface. `null`
   * is "unknown", and nothing downstream may turn it into "paved".
   */
  readonly surface: CuratedRideSurface | null;
}

/** The shape `curatedRideFeature` needs; a `CatalogEntry` satisfies it. */
export interface CuratedRideSeed {
  readonly id: string;
  readonly name: string;
  readonly provenance: string;
  readonly distanceKm: number | null;
  readonly bounds: MapLayerBounds | null;
  readonly geometry: readonly { readonly lon: number; readonly lat: number }[];
  readonly surfaceSummary?: string | null;
}

/** One outline plus the box it covers, so a view filters without redrawing. */
export interface CuratedRideItem {
  readonly feature: InfoFeature;
  readonly bounds: MapLayerBounds;
}

/** Whether the catalog route came from the curated PA Adventure Bike Rides set. */
export function isCuratedRide(seed: Pick<CuratedRideSeed, "provenance">): boolean {
  return seed.provenance.trim().toLowerCase().startsWith(CURATED_RIDES_SOURCE.toLowerCase());
}

/**
 * Read the source's surface sentence. Anything the sentences do not cover is
 * `null`: an unrecognised summary is unknown, not paved.
 */
export function curatedRideSurface(summary: string | null | undefined): CuratedRideSurface | null {
  const text = summary?.trim() ?? "";
  if (text === "") return null;
  if (/^paved$/i.test(text)) return { unpavedMiles: 0, unpavedKind: null };
  const match = /·\s*([\d.]+)\s*mi\s+(gravel|dirt|unpaved)\b/i.exec(text);
  if (match === null) return null;
  const miles = Number(match[1]);
  if (!Number.isFinite(miles) || miles < 0) return null;
  return { unpavedMiles: miles, unpavedKind: match[2]!.toLowerCase() as "gravel" | "dirt" | "unpaved" };
}

/** `154 mi`, `8.2 mi`: the same rounding the road cards use. */
export function curatedRideMilesLabel(miles: number): string {
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

/**
 * The card's surface line. An unknown surface is stated as unknown; "Paved" is
 * the only sentence that may ever read as paved.
 */
export function curatedRideSurfaceLine(facts: Pick<CuratedRideFacts, "miles" | "surface">): string {
  const surface = facts.surface;
  if (surface === null) return "Surface unknown";
  if (surface.unpavedMiles <= 0) return "All paved";
  const share = facts.miles <= 0 ? 0 : Math.round((surface.unpavedMiles / facts.miles) * 100);
  const percent = Math.min(100, Math.max(1, share));
  const kind = surface.unpavedKind ?? "unpaved";
  return `${percent}% ${kind} · ${curatedRideMilesLabel(surface.unpavedMiles)}`;
}

/** The card's distance line. */
export function curatedRideDistanceLine(facts: Pick<CuratedRideFacts, "miles">): string {
  return curatedRideMilesLabel(facts.miles);
}

/** The box a route covers, from its published bounds or its own line. */
export function curatedRideBounds(seed: Pick<CuratedRideSeed, "bounds" | "geometry">): MapLayerBounds | null {
  if (seed.bounds !== null) return seed.bounds;
  if (seed.geometry.length === 0) return null;
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const point of seed.geometry) {
    west = Math.min(west, point.lon);
    south = Math.min(south, point.lat);
    east = Math.max(east, point.lon);
    north = Math.max(north, point.lat);
  }
  return { west, south, east, north };
}

/** Whether two boxes touch; a route that crosses a view without a vertex inside still shows. */
export function curatedRideIntersects(view: MapLayerBounds, bounds: MapLayerBounds): boolean {
  return bounds.west <= view.east && bounds.east >= view.west && bounds.south <= view.north && bounds.north >= view.south;
}

/**
 * Simplify one line to at most `maxPoints`, keeping both ends and the bends a
 * rider would notice (Ramer–Douglas–Peucker), then decimating if the tolerance
 * was too tight for the cap.
 */
export function simplifyCuratedLine(
  line: readonly LngLat[],
  maxPoints = MAX_CURATED_ROUTE_POINTS,
): readonly LngLat[] {
  if (line.length <= 2 || line.length <= maxPoints) return line;
  const cosLat = Math.cos(((line[0]![1] + line.at(-1)![1]) / 2) * (Math.PI / 180));
  const xy = line.map((point): readonly [number, number] => [point[0] * cosLat, point[1]]);
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const [x, y] of xy) {
    west = Math.min(west, x); east = Math.max(east, x);
    south = Math.min(south, y); north = Math.max(north, y);
  }
  const span = Math.max(east - west, north - south);
  const epsilon = span > 0 ? (span / (maxPoints * 2)) ** 2 : 0;
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let farthestDistance = epsilon;
    for (let index = first + 1; index < last; index += 1) {
      const distance = distanceToSegmentSquared(xy[index]!, xy[first]!, xy[last]!);
      if (distance > farthestDistance) {
        farthest = index;
        farthestDistance = distance;
      }
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    stack.push([first, farthest], [farthest, last]);
  }
  const simplified = line.filter((_, index) => keep[index] === 1);
  if (simplified.length <= maxPoints) return simplified;
  // A very wiggly line: keep the ends and an even sample between them.
  const step = (simplified.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => simplified[Math.round(index * step)]!);
}

function distanceToSegmentSquared(
  point: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return (point[0] - a[0]) ** 2 + (point[1] - a[1]) ** 2;
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  const x = a[0] + t * dx;
  const y = a[1] + t * dy;
  return (point[0] - x) ** 2 + (point[1] - y) ** 2;
}

/**
 * One curated ride as a map feature, or `null` when it cannot honestly answer
 * (not curated, no distance, or no line).
 */
export function curatedRideFeature(seed: CuratedRideSeed): CuratedRideItem | null {
  if (!isCuratedRide(seed)) return null;
  if (seed.distanceKm === null || !Number.isFinite(seed.distanceKm) || seed.distanceKm <= 0) return null;
  if (seed.geometry.length < 2) return null;
  const bounds = curatedRideBounds(seed);
  if (bounds === null) return null;
  const miles = seed.distanceKm * 1000 / METERS_PER_MILE;
  const facts: CuratedRideFacts = {
    routeId: seed.id,
    miles,
    surface: curatedRideSurface(seed.surfaceSummary),
  };
  const line = simplifyCuratedLine(seed.geometry.map((point): LngLat => [round(point.lon), round(point.lat)]));
  return {
    bounds,
    feature: {
      id: `catalog:${seed.id}`,
      layerId: "rider-picked",
      name: seed.name,
      detail: `${curatedRideDistanceLine(facts)} · ${curatedRideSurfaceLine(facts)}`,
      weight: null,
      catalogRide: facts,
      geometry: { type: "LineString", coordinates: line },
    },
  };
}

/** Every curated ride that can be drawn, in catalog order. */
export function curatedRideItems(seeds: readonly CuratedRideSeed[]): readonly CuratedRideItem[] {
  return seeds.flatMap((seed) => {
    const item = curatedRideFeature(seed);
    return item === null ? [] : [item];
  });
}

function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
