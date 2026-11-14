import type { MapExtent } from "@/application/map/build-map-scene";
import { STATE_BBOXES, STATE_CENTRES } from "@/application/route-library/state-centres";
import { countByState, type ViewBounds } from "@/application/route-library/client";
import type { IndexRow } from "@/application/route-library/types";
import { STATE_BUBBLE_MAX_ZOOM, LINE_MIN_ZOOM } from "@/ui/explore/routes-overlay";

/** The lower 48, for the first look at the whole country. */
export const COUNTRY_EXTENT: MapExtent = { minLon: -125, minLat: 24.5, maxLon: -66.9, maxLat: 49.4 };

/** Room the country frame keeps for the chip row above and the List pill below, and a little at the sides. */
export const COUNTRY_INSETS = { top: 84, right: 8, bottom: 112, left: 8 } as const;

/**
 * The opening frame: the lower 48 where the rides are, not the whole lower 48
 * by default. A library that sits in a smaller part of the country (or a phone
 * whose height lets the frame come closer) opens already framed on the rides,
 * so the map is not a thin band in the middle of empty space. Never closer than
 * `COUNTRY_MAX_BOOST` steps of zoom, and never cutting a ride off.
 */
export const COUNTRY_MAX_BOOST = 1.2;

export function countryFrame(rows: readonly IndexRow[]): MapExtent {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const row of rows) {
    if (row.p === null || row.st.every((state) => INSET_STATES.includes(state))) continue;
    const [lat, lon] = row.p;
    if (lon < COUNTRY_EXTENT.minLon || lon > COUNTRY_EXTENT.maxLon || lat < COUNTRY_EXTENT.minLat || lat > COUNTRY_EXTENT.maxLat) continue;
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  if (minLon > maxLon) return COUNTRY_EXTENT;
  const whole = COUNTRY_EXTENT.maxLon - COUNTRY_EXTENT.minLon;
  const lonPad = 4;
  const latPad = 2;
  const minSpan = whole / 2 ** COUNTRY_MAX_BOOST;
  const midLon = (minLon + maxLon) / 2;
  const midLat = (minLat + maxLat) / 2;
  const halfLon = Math.max((maxLon - minLon) / 2 + lonPad, minSpan / 2);
  const halfLat = Math.max((maxLat - minLat) / 2 + latPad, (COUNTRY_EXTENT.maxLat - COUNTRY_EXTENT.minLat) / 2 / 2 ** COUNTRY_MAX_BOOST);
  return {
    minLon: Math.max(midLon - halfLon, COUNTRY_EXTENT.minLon), maxLon: Math.min(midLon + halfLon, COUNTRY_EXTENT.maxLon),
    minLat: Math.max(midLat - halfLat, COUNTRY_EXTENT.minLat), maxLat: Math.min(midLat + halfLat, COUNTRY_EXTENT.maxLat),
  };
}

/** States far from the lower 48 get one small labelled bubble at the edge of the map instead of a place on it. */
export const INSET_STATES: readonly string[] = ["AK", "HI"];

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

export type Bubble = {
  readonly key: string;
  readonly kind: "state" | "group";
  readonly count: number;
  readonly lat: number;
  readonly lon: number;
  readonly label: string;
  /** One state's bubble. */
  readonly state?: string;
  /** Several nearby states merged into one bubble: who they are and the box they cover. */
  readonly states?: readonly string[];
  readonly bounds?: readonly [number, number, number, number];
  /** Diameter in CSS pixels; bigger counts get bigger bubbles. */
  readonly size?: number;
  /** Drawn at the edge of the map (Alaska, Hawaii), not at a place on it. */
  readonly inset?: boolean;
};

const CLUSTER_PX = 56;

/** A state's count bubble is a little bigger for more rides, but always small enough to leave room. */
export function bubbleSize(count: number): number {
  return Math.round(Math.min(40, 20 + 6 * Math.log10(Math.max(count, 1))));
}

type Cluster = { states: string[]; count: number; x: number; y: number; size: number; box: [number, number, number, number] };

const WORD_GAP_PX = 1;

function clampInto(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * One neutral bubble per state with the number of rides in it. Where bubbles
 * would collide at this zoom, the states merge into one bubble for the group
 * (the number is the sum); a bubble never leaves the box of the states it counts.
 * Alaska and Hawaii get a small labelled bubble at the map's edge.
 */
export function stateBubbles(rows: readonly IndexRow[], zoom = 3): readonly Bubble[] {
  const counts = countByState(rows);
  const clusters: Cluster[] = [];
  const insets: Bubble[] = [];
  for (const [state, count] of Object.entries(counts)) {
    const centre = STATE_CENTRES[state];
    const box = STATE_BBOXES[state];
    if (centre === undefined || box === undefined || count === 0) continue;
    if (INSET_STATES.includes(state)) {
      insets.push({ key: `s-${state}`, kind: "state", count, lat: centre[0], lon: centre[1], label: `${state}, ${count} ${count === 1 ? "ride" : "rides"}`, state, size: bubbleSize(count), inset: true });
      continue;
    }
    clusters.push({ states: [state], count, x: worldX(centre[1], zoom), y: worldY(centre[0], zoom), size: bubbleSize(count), box: [...box] });
  }
  for (;;) {
    let best: [number, number] | null = null;
    let bestGap = 0;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const a = clusters[i]!;
        const b = clusters[j]!;
        const gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.size + b.size) / 2 - WORD_GAP_PX;
        if (gap < 0 && (best === null || gap < bestGap)) { best = [i, j]; bestGap = gap; }
      }
    }
    if (best === null) break;
    const a = clusters[best[0]]!;
    const b = clusters[best[1]]!;
    const count = a.count + b.count;
    const box: [number, number, number, number] = [Math.min(a.box[0], b.box[0]), Math.min(a.box[1], b.box[1]), Math.max(a.box[2], b.box[2]), Math.max(a.box[3], b.box[3])];
    // Stay inside the union box: it is where these states actually are.
    const x = clampInto((a.x * a.count + b.x * b.count) / count, worldX(box[0], zoom), worldX(box[2], zoom));
    const y = clampInto((a.y * a.count + b.y * b.count) / count, worldY(box[3], zoom), worldY(box[1], zoom));
    clusters.splice(best[1], 1);
    clusters[best[0]] = { states: [...a.states, ...b.states], count, x, y, size: bubbleSize(count), box };
  }
  const placed = clusters.map((cluster): Bubble => {
    const lat = latAt(cluster.y, zoom);
    const lon = lonAt(cluster.x, zoom);
    const rides = `${cluster.count} ${cluster.count === 1 ? "ride" : "rides"}`;
    if (cluster.states.length === 1) {
      const state = cluster.states[0]!;
      return { key: `s-${state}`, kind: "state", count: cluster.count, lat, lon, label: `${state}, ${rides}`, state, size: cluster.size };
    }
    const states = [...cluster.states].sort();
    return { key: `m-${states.join("")}`, kind: "state", count: cluster.count, lat, lon, label: `${rides} in ${states.join(", ")}`, states, bounds: cluster.box, size: cluster.size };
  });
  return [...placed, ...insets];
}

/** The zoom at which a box just fits a map of this many pixels (never past `max`). */
export function zoomForBounds(box: readonly [number, number, number, number], width: number, height: number, max = 12): number {
  const spanX = worldX(box[2], 0) - worldX(box[0], 0);
  const spanY = worldY(box[1], 0) - worldY(box[3], 0);
  const zoom = Math.min(Math.log2(width / Math.max(spanX, 1e-6)), Math.log2(height / Math.max(spanY, 1e-6)));
  return Math.min(zoom, max);
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
  if (zoom < STATE_BUBBLE_MAX_ZOOM) return stateBubbles(rows, zoom);
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

