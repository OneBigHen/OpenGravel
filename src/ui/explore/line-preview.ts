/**
 * The shape of a ride, drawn from its own line.
 *
 * A card leads with a picture of the ride. When the device has no map token
 * there is no basemap image to lead with, and the old card said so in words
 * ("Map preview unavailable") in the space where the ride should be. The line
 * the route already carries is still a real picture of it — its length, its
 * bends, whether it loops — so it is drawn into the same frame. No geography is
 * invented: this is the route's shape, not a map.
 */

import type { Coordinate } from "@/domain/ride/types";

/** The card frame the line is drawn into: 16:9, as a basemap image would be. */
export const PREVIEW_WIDTH = 400;
export const PREVIEW_HEIGHT = 225;

/** Room for the line's casing so an edge never touches the frame. */
const PADDING = 16;

/** A card never needs more vertices than this to read as a shape. */
const MAX_VERTICES = 120;

interface Box {
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
}

function boxOf(line: readonly Coordinate[]): Box {
  return line.reduce<Box>(
    (box, point) => ({
      west: Math.min(box.west, point.lon),
      east: Math.max(box.east, point.lon),
      south: Math.min(box.south, point.lat),
      north: Math.max(box.north, point.lat),
    }),
    { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity },
  );
}

/** Long routes lose vertices, never their ends. */
function thin(line: readonly Coordinate[]): readonly Coordinate[] {
  if (line.length <= MAX_VERTICES) return line;
  const step = (line.length - 1) / (MAX_VERTICES - 1);
  return Array.from({ length: MAX_VERTICES }, (_, index) => line[Math.round(index * step)]!);
}

/**
 * The line fitted into the frame as `"x,y x,y …"`, keeping its true proportions
 * so a long thin route still reads as long and thin. Empty when there is no
 * line to draw.
 */
export function linePreviewPoints(
  line: readonly Coordinate[],
  width: number = PREVIEW_WIDTH,
  height: number = PREVIEW_HEIGHT,
  padding: number = PADDING,
): string {
  if (line.length < 2) return "";
  const box = boxOf(line);
  const lonSpan = box.east - box.west;
  const latSpan = box.north - box.south;
  if (!Number.isFinite(lonSpan) || !Number.isFinite(latSpan)) return "";
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);
  // One scale for both axes, so the shape is not stretched into the frame.
  const scale = Math.min(
    lonSpan > 0 ? usableWidth / lonSpan : Infinity,
    latSpan > 0 ? usableHeight / latSpan : Infinity,
  );
  const dx = lonSpan > 0 && Number.isFinite(scale) ? (usableWidth - lonSpan * scale) / 2 : usableWidth / 2;
  const dy = latSpan > 0 && Number.isFinite(scale) ? (usableHeight - latSpan * scale) / 2 : usableHeight / 2;
  return thin(line)
    .map((point) => {
      const x = lonSpan > 0 && Number.isFinite(scale) ? padding + dx + (point.lon - box.west) * scale : width / 2;
      // North is up: latitude grows away from the bottom of the frame.
      const y = latSpan > 0 && Number.isFinite(scale) ? padding + dy + (box.north - point.lat) * scale : height / 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
