/**
 * Where a route's name sits on the map (UX rework phase 9).
 *
 * Choices usually share their first and last miles, so a label at each line's
 * midpoint would stack three names on one road. Each label goes instead where
 * its line is farthest from every other choice, within the middle of the ride,
 * which is where a rider looks to tell the options apart.
 */

import type { Coordinate } from "@/domain/ride/types";

/** Samples per line: enough to find the spread, cheap enough for every render. */
const SAMPLES = 48;
/** Labels stay off the shared ends of the ride. */
const MIDDLE = { from: 0.15, to: 0.85 } as const;

function sample(line: readonly Coordinate[], count: number): readonly Coordinate[] {
  if (line.length <= count) return line;
  const step = (line.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => line[Math.round(index * step)]!);
}

/** Squared distance in a local equirectangular frame: only compared, never shown. */
function spread(a: Coordinate, b: Coordinate): number {
  const cosLat = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dx = (a.lon - b.lon) * cosLat;
  const dy = a.lat - b.lat;
  return dx * dx + dy * dy;
}

/**
 * The anchor for each line's label, in input order; `null` for a line too short
 * to carry one. Lines are compared by vertex position along them, which is
 * close enough for choosing a spot to write a name.
 */
export function routeLabelAnchors(
  lines: readonly (readonly Coordinate[])[],
  /** Marked points a name must not sit on: start, finish, stops (DV-09). */
  keepClear: readonly Coordinate[] = [],
): readonly (Coordinate | null)[] {
  const samples = lines.map((line) => sample(line, SAMPLES * 2));
  return lines.map((line, index) => {
    if (line.length < 2) return null;
    const first = Math.floor((line.length - 1) * MIDDLE.from);
    const last = Math.ceil((line.length - 1) * MIDDLE.to);
    const candidates = sample(line.slice(first, last + 1), SAMPLES);
    const others = samples.filter((_, other) => other !== index);
    if (keepClear.length > 0) others.push(keepClear);
    if (others.length === 0) return line[Math.floor((line.length - 1) / 2)]!;
    let best = candidates[Math.floor(candidates.length / 2)]!;
    let bestSpread = -1;
    for (const point of candidates) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const other of others) {
        for (const vertex of other) nearest = Math.min(nearest, spread(point, vertex));
      }
      if (nearest > bestSpread) {
        bestSpread = nearest;
        best = point;
      }
    }
    return { lat: best.lat, lon: best.lon };
  });
}
