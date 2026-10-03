import type { LngLat, MapLayerBounds } from "@/application/map-layers/types";

/** Liang–Barsky clipping preserves crossings whose two endpoints are outside. */
export function clipLineToBounds(line: readonly LngLat[], bounds: MapLayerBounds): readonly (readonly LngLat[])[] {
  const parts: LngLat[][] = [];
  let part: LngLat[] = [];
  for (let index = 1; index < line.length; index++) {
    const a = line[index - 1]!;
    const b = line[index]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const p = [-dx, dx, -dy, dy];
    const q = [a[0] - bounds.west, bounds.east - a[0], a[1] - bounds.south, bounds.north - a[1]];
    let start = 0;
    let end = 1;
    let visible = true;
    for (let edge = 0; edge < 4; edge++) {
      if (p[edge] === 0) { if (q[edge]! < 0) visible = false; }
      else if (p[edge]! < 0) start = Math.max(start, q[edge]! / p[edge]!);
      else end = Math.min(end, q[edge]! / p[edge]!);
    }
    if (!visible || start >= end) {
      if (part.length > 1) parts.push(part);
      part = [];
      continue;
    }
    const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
    const point = (fraction: number): LngLat => [clamp(a[0] + fraction * dx, bounds.west, bounds.east), clamp(a[1] + fraction * dy, bounds.south, bounds.north)];
    const first = point(start);
    const last = part.at(-1);
    if (last !== undefined && (last[0] !== first[0] || last[1] !== first[1])) { parts.push(part); part = []; }
    if (part.length === 0) part.push(first);
    part.push(point(end));
  }
  if (part.length > 1) parts.push(part);
  return parts;
}
