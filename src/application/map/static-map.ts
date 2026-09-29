/**
 * A real map behind a route thumbnail (owner, 2026-09-26: "people will need to
 * see bearings like towns"). The Mapbox Static Images API renders the same
 * Outdoors style the live map uses, with the route drawn on it, as one cached
 * image — a hundred cards cannot each hold a live WebGL map.
 *
 * The line is thinned to a bounded number of points so the URL stays well
 * under the API's length limit whatever the route.
 */

import type { Coordinate } from "@/domain/ride/types";

const STYLE = "mapbox/outdoors-v12";
const MAX_POINTS = 80;
const ROUTE_COLOR = "d65a36";

function thin(line: readonly Coordinate[]): readonly Coordinate[] {
  if (line.length <= MAX_POINTS) return line;
  const step = (line.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, (_, index) => line[Math.round(index * step)]!);
}

/** Google's encoded polyline, precision 5, as the Static Images API reads it. */
export function encodePolyline(line: readonly Coordinate[]): string {
  let lastLat = 0;
  let lastLon = 0;
  let out = "";
  const encode = (value: number): void => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const point of line) {
    const lat = Math.round(point.lat * 1e5);
    const lon = Math.round(point.lon * 1e5);
    encode(lat - lastLat);
    encode(lon - lastLon);
    lastLat = lat;
    lastLon = lon;
  }
  return out;
}

export interface StaticRouteMapOptions {
  readonly token: string;
  /** CSS pixels; the image is requested at 2x. */
  readonly width: number;
  readonly height: number;
}

/** The image URL, or `null` when the line cannot be drawn. */
export function staticRouteMapUrl(line: readonly Coordinate[], options: StaticRouteMapOptions): string | null {
  if (line.length < 2) return null;
  const encoded = encodeURIComponent(encodePolyline(thin(line)));
  // A white casing under the ember line, so the route reads over any terrain.
  const overlay = `path-6+ffffff-0.9(${encoded}),path-3+${ROUTE_COLOR}-1(${encoded})`;
  const width = Math.max(64, Math.min(1280, Math.round(options.width)));
  const height = Math.max(64, Math.min(1280, Math.round(options.height)));
  const padding = Math.round(Math.min(width, height) * 0.12);
  return `https://api.mapbox.com/styles/v1/${STYLE}/static/${overlay}/auto/${width}x${height}@2x`
    + `?padding=${padding}&logo=false&attribution=false&access_token=${encodeURIComponent(options.token)}`;
}

/**
 * A map with the ride's authored points pinned (a planned ride keeps no line):
 * start in Signal Blue, stops in Golden Hour, finish in Ember.
 */
export function staticPointsMapUrl(points: readonly Coordinate[], options: StaticRouteMapOptions): string | null {
  if (points.length === 0) return null;
  const pins = points.slice(0, 12).map((point, index) => {
    const color = index === 0 ? "397c96" : index === points.length - 1 ? ROUTE_COLOR : "c99a46";
    return `pin-s+${color}(${point.lon.toFixed(5)},${point.lat.toFixed(5)})`;
  });
  const width = Math.max(64, Math.min(1280, Math.round(options.width)));
  const height = Math.max(64, Math.min(1280, Math.round(options.height)));
  const padding = Math.round(Math.min(width, height) * 0.2);
  // One point has no extent to fit: frame it at a town-level zoom instead.
  const view = points.length === 1 ? `${points[0]!.lon.toFixed(5)},${points[0]!.lat.toFixed(5)},11` : "auto";
  return `https://api.mapbox.com/styles/v1/${STYLE}/static/${pins.join(",")}/${view}/${width}x${height}@2x`
    + `?${view === "auto" ? `padding=${padding}&` : ""}logo=false&attribution=false&access_token=${encodeURIComponent(options.token)}`;
}
