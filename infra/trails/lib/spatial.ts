import type { Coordinate } from "../../../src/domain/ride/types";
import { haversine } from "../../../src/domain/geometry/analysis";
export type Segment = readonly [Coordinate, Coordinate];
const CELL = 0.01;
export function cellKeys(a: Coordinate, b: Coordinate, pad = 0): string[] {
  const keys: string[] = [];
  for (let x = Math.floor((Math.min(a.lon, b.lon) - pad) / CELL); x <= Math.floor((Math.max(a.lon, b.lon) + pad) / CELL); x++) {
    for (let y = Math.floor((Math.min(a.lat, b.lat) - pad) / CELL); y <= Math.floor((Math.max(a.lat, b.lat) + pad) / CELL); y++) keys.push(`${x},${y}`);
  }
  return keys;
}
export class SegmentGrid<T> {
  private cells = new Map<string, { segment: Segment; value: T }[]>();
  add(segment: Segment, value: T) {
    for (const key of cellKeys(...segment)) {
      const bucket = this.cells.get(key) ?? [];
      bucket.push({ segment, value });
      this.cells.set(key, bucket);
    }
  }
  near(segment: Segment, radius = 100) {
    const found = new Set<{ segment: Segment; value: T }>();
    // Conservative longitude padding for the PA/NJ region.
    for (const key of cellKeys(...segment, radius / 75000)) for (const entry of this.cells.get(key) ?? []) found.add(entry);
    return found;
  }
}
function project(point: Coordinate, a: Coordinate, b: Coordinate): { coordinate: Coordinate; t: number; distance: number } {
  const scale = Math.cos(a.lat * Math.PI / 180);
  const dx = (b.lon - a.lon) * scale, dy = b.lat - a.lat;
  const t = Math.max(0, Math.min(1, ((point.lon - a.lon) * scale * dx + (point.lat - a.lat) * dy) / (dx * dx + dy * dy || 1)));
  const coordinate = { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t };
  return { coordinate, t, distance: haversine(point, coordinate) };
}
/** Closest points on two segments, including a crossing between their vertices. */
export function segmentMatch(trail: Segment, feature: Segment): { distance: number; t: number; coordinate: Coordinate } {
  const [a,b] = trail, [c,d] = feature;
  const rx = b.lon-a.lon, ry = b.lat-a.lat, sx = d.lon-c.lon, sy = d.lat-c.lat;
  const cross = rx*sy-ry*sx;
  if (cross !== 0) {
    const t = ((c.lon-a.lon)*sy-(c.lat-a.lat)*sx)/cross;
    const u = ((c.lon-a.lon)*ry-(c.lat-a.lat)*rx)/cross;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { distance: 0, t, coordinate: { lon: a.lon+t*rx, lat: a.lat+t*ry } };
  }
  const fromC = project(c,a,b), fromD = project(d,a,b), fromA = project(a,c,d), fromB = project(b,c,d);
  return [
    { distance: fromC.distance, t: fromC.t, coordinate: c },
    { distance: fromD.distance, t: fromD.t, coordinate: d },
    { distance: fromA.distance, t: 0, coordinate: fromA.coordinate },
    { distance: fromB.distance, t: 1, coordinate: fromB.coordinate },
  ].sort((x,y) => x.distance-y.distance || x.t-y.t)[0]!;
}
export function segments(lines: readonly (readonly Coordinate[])[]): Segment[] {
  return lines.flatMap(line => line.length === 1 ? [[line[0]!,line[0]!] as const] : line.slice(1).map((p,i) => [line[i]!,p] as const));
}
