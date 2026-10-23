/**
 * The one pure projection behind every drawn route line in the UI: a recorded
 * track's preview in My rides, and the ride screen's finish sketch. The line's
 * own extent is stretched into a viewBox, north up, with a fixed padding. No
 * map, no tiles, no token — geography never leaves the browser to be drawn.
 */

import type { Coordinate } from "@/domain/ride/types";

export interface TrackProjectionBox {
  readonly width: number;
  readonly height: number;
  readonly padding: number;
}

/** The library thumbnail's box: 160×52 with 6 px of breathing room. */
export const LIBRARY_TRACK_BOX: TrackProjectionBox = { width: 160, height: 52, padding: 6 };

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Projects `coordinates` into `box`, using `extent` for the bounds. Passing the
 * whole line as the extent and only part of it as the coordinates is how a
 * split line (ridden so far, still to ride) stays on one shared scale.
 */
export function projectTrackPoints(
  extent: readonly Coordinate[],
  coordinates: readonly Coordinate[],
  box: TrackProjectionBox,
): readonly ProjectedPoint[] {
  if (extent.length < 2) return [];
  const longitudes = extent.map((coordinate) => coordinate.lon);
  const latitudes = extent.map((coordinate) => coordinate.lat);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const width = maxLon - minLon || 1;
  const height = maxLat - minLat || 1;
  const innerWidth = box.width - box.padding * 2;
  const innerHeight = box.height - box.padding * 2;
  return coordinates.map((coordinate) => ({
    x: box.padding + ((coordinate.lon - minLon) / width) * innerWidth,
    y: box.padding + ((maxLat - coordinate.lat) / height) * innerHeight,
  }));
}

/** The projected points as SVG `polyline` data, one decimal as the box is drawn. */
export function toPolylinePoints(points: readonly ProjectedPoint[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}
