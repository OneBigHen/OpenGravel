import type { MapExtent } from "@/application/map/build-map-scene";
import { STATE_CENTRES } from "@/application/route-library/state-centres";
import { countByState, type ViewBounds } from "@/application/route-library/client";
import type { IndexRow } from "@/application/route-library/types";
import { STATE_BUBBLE_MAX_ZOOM, LINE_MIN_ZOOM } from "@/ui/explore/routes-overlay";

/** The lower 48, for the first look at the whole country. */
export const COUNTRY_EXTENT: MapExtent = { minLon: -131, minLat: 22, maxLon: -61, maxLat: 51 };

const TILE = 512;

function worldX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * TILE * 2 ** zoom;
}

function worldY(lat: number, zoom: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE * 2 ** zoom;
}

function lonAt(x: number, zoom: number): number {
  return (x / (TILE * 2 ** zoom)) * 360 - 180;
}

function latAt(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** zoom);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** The box a map of `width` x `height` pixels shows when centred here at this zoom. */
export function extentFromCamera(lat: number, lon: number, zoom: number, width: number, height: number): MapExtent {
  const x = worldX(lon, zoom);
  const y = worldY(lat, zoom);
  return {
    minLon: lonAt(x - width / 2, zoom),
    maxLon: lonAt(x + width / 2, zoom),
    maxLat: latAt(y - height / 2, zoom),
    minLat: latAt(y + height / 2, zoom),
  };
}

export type Bubble = { readonly key: string; readonly kind: "state" | "group"; readonly count: number; readonly lat: number; readonly lon: number; readonly label: string; readonly state?: string };

const CLUSTER_PX = 56;

/** One neutral bubble per state with the number of rides in it. */
export function stateBubbles(rows: readonly IndexRow[]): readonly Bubble[] {
  const counts = countByState(rows);
  return Object.entries(counts).flatMap(([state, count]) => {
    const centre = STATE_CENTRES[state];
    if (centre === undefined || count === 0) return [];
    return [{ key: `s-${state}`, kind: "state" as const, count, lat: centre[0], lon: centre[1], label: `${state}, ${count} ${count === 1 ? "ride" : "rides"}`, state }];
  });
}

/** Rides that have a place, gathered into bubbles about one thumb wide at this zoom. */
export function groupBubbles(rows: readonly IndexRow[], zoom: number, bounds: ViewBounds): readonly Bubble[] {
  const padLon = (bounds.east - bounds.west) * 0.25;
  const padLat = (bounds.north - bounds.south) * 0.25;
  const cells = new Map<string, { n: number; lat: number; lon: number; cx: number; cy: number }>();
  for (const row of rows) {
    if (row.p === null) continue;
    const [lat, lon] = row.p;
    if (lat < bounds.south - padLat || lat > bounds.north + padLat || lon < bounds.west - padLon || lon > bounds.east + padLon) continue;
    const cx = Math.floor(worldX(lon, zoom) / CLUSTER_PX);
    const cy = Math.floor(worldY(lat, zoom) / CLUSTER_PX);
    const key = `${cx}:${cy}`;
    const cell = cells.get(key);
    if (cell === undefined) cells.set(key, { n: 1, lat, lon, cx, cy });
    else { cell.n += 1; cell.lat += lat; cell.lon += lon; }
  }
  return [...cells.entries()].map(([key, cell]) => {
    const lat = cell.lat / cell.n;
    const lon = cell.lon / cell.n;
    return { key: `g-${key}`, kind: "group" as const, count: cell.n, lat, lon, label: `${cell.n} ${cell.n === 1 ? "ride" : "rides"} here` };
  });
}

/** Which bubbles the map shows at this zoom: by state, then by group, then none (the rides draw). */
export function bubblesFor(rows: readonly IndexRow[], zoom: number, bounds: ViewBounds): readonly Bubble[] {
  if (zoom < STATE_BUBBLE_MAX_ZOOM) return stateBubbles(rows);
  if (zoom < LINE_MIN_ZOOM) return groupBubbles(rows, zoom, bounds);
  return [];
}

/** The states whose rides start or run inside (a margin around) the view: their line files are wanted. */
export function statesInView(rows: readonly IndexRow[], bounds: ViewBounds): readonly string[] {
  const padLon = (bounds.east - bounds.west) * 0.25;
  const padLat = (bounds.north - bounds.south) * 0.25;
  const wanted = new Set<string>();
  for (const row of rows) {
    const box = row.bb ?? (row.p === null ? null : [row.p[1], row.p[0], row.p[1], row.p[0]] as const);
    if (box === null) continue;
    const [west, south, east, north] = box;
    if (east < bounds.west - padLon || west > bounds.east + padLon || north < bounds.south - padLat || south > bounds.north + padLat) continue;
    for (const state of row.st) wanted.add(state);
  }
  return [...wanted];
}

/**
 * Pushes overlapping bubbles apart so every count stays readable where states
 * crowd together (the north-east on a phone-wide country). Each point moves at
 * most a few bubble widths from where it truly sits, and only the crowded ones move.
 * With `within` they also stay fully inside the map's frame.
 */
export function spreadBubbles(points: { x: number; y: number }[], gap = 42, rounds = 14, within?: { width: number; height: number; margin: number }): void {
  for (let round = 0; round < rounds; round += 1) {
    let moved = false;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < points.length; j += 1) {
        const b = points[j];
        if (b === undefined) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= gap) continue;
        if (distance < 0.01) { dx = 1; dy = 0; distance = 1; }
        const push = (gap - distance) / 2 + 0.5;
        const ux = dx / distance;
        const uy = dy / distance;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
        moved = true;
      }
    }
    if (within !== undefined) {
      for (const point of points) {
        point.x = Math.min(Math.max(point.x, within.margin), within.width - within.margin);
        point.y = Math.min(Math.max(point.y, within.margin), within.height - within.margin);
      }
    }
    if (!moved) return;
  }
}
