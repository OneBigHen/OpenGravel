import type { Coordinate } from "@/domain/ride/types";

export interface RoutePreviewProjection {
  readonly viewBox: "0 0 96 64";
  readonly points: readonly (readonly [number, number])[];
}

const VIEW_WIDTH = 96;
const VIEW_HEIGHT = 64;
const PADDING = 6;

/** Project geographic coordinates into a stable, static card-sized SVG view box. */
export function projectRouteGeometry(
  geometry: readonly Coordinate[],
): RoutePreviewProjection {
  if (geometry.length === 0) return { viewBox: "0 0 96 64", points: [] };
  const west = Math.min(...geometry.map((point) => point.lon));
  const east = Math.max(...geometry.map((point) => point.lon));
  const south = Math.min(...geometry.map((point) => point.lat));
  const north = Math.max(...geometry.map((point) => point.lat));
  const spanX = east - west;
  const spanY = north - south;
  const scale = Math.min(
    (VIEW_WIDTH - PADDING * 2) / (spanX || 1),
    (VIEW_HEIGHT - PADDING * 2) / (spanY || 1),
  );
  const drawnWidth = spanX * scale;
  const drawnHeight = spanY * scale;
  const offsetX = (VIEW_WIDTH - drawnWidth) / 2;
  const offsetY = (VIEW_HEIGHT - drawnHeight) / 2;
  return {
    viewBox: "0 0 96 64",
    points: geometry.map((point) => [
      offsetX + (point.lon - west) * scale,
      VIEW_HEIGHT - offsetY - (point.lat - south) * scale,
    ] as const),
  };
}

export function previewPointsAttribute(geometry: readonly Coordinate[]): string {
  return projectRouteGeometry(geometry).points
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
}
