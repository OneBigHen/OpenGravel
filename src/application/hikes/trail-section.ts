import type { Coordinate } from "@/domain/ride/types";
import { haversine } from "@/domain/geometry/analysis";

/** Longer than this, a trail opens as the section nearest the hiker, not whole. */
export const LONG_TRAIL_METERS = 40_000;
/** How much of a long trail opens: about 5 mi either side of the nearest point. */
export const SECTION_HALF_METERS = 8_000;

export function lineMeters(line: readonly Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) total += haversine(line[i - 1]!, line[i]!);
  return total;
}

function nearestIndex(line: readonly Coordinate[], point: Coordinate): number {
  let best = 0;
  let bestMeters = Number.POSITIVE_INFINITY;
  line.forEach((vertex, index) => {
    const meters = haversine(vertex, point);
    if (meters < bestMeters) { bestMeters = meters; best = index; }
  });
  return best;
}

/**
 * The piece of a mapped trail to open as a plan, chosen near `origin`:
 * - several disconnected pieces: the piece nearest the hiker, never joined;
 * - a long trail: the mapped vertices within about `halfMeters` of the nearest
 *   point, either way along the line (real vertices, no invented endpoints).
 * `whole` is false whenever the result is less than the full mapped trail.
 */
export function trailSection(lines: readonly (readonly Coordinate[])[], origin: Coordinate | null, halfMeters = SECTION_HALF_METERS): { line: Coordinate[]; whole: boolean; pieces: number } | null {
  const usable = lines.filter((line) => line.length >= 2);
  if (usable.length === 0) return null;
  const anchor = origin ?? usable[0]![0]!;
  const piece = usable.length === 1 ? usable[0]! : usable.reduce((best, line) => (haversine(line[nearestIndex(line, anchor)]!, anchor) < haversine(best[nearestIndex(best, anchor)]!, anchor) ? line : best));
  if (lineMeters(piece) <= LONG_TRAIL_METERS) return { line: [...piece], whole: usable.length === 1, pieces: usable.length };
  const center = nearestIndex(piece, anchor);
  let start = center;
  for (let walked = 0; start > 0 && walked < halfMeters; start -= 1) walked += haversine(piece[start]!, piece[start - 1]!);
  let end = center;
  for (let walked = 0; end < piece.length - 1 && walked < halfMeters; end += 1) walked += haversine(piece[end]!, piece[end + 1]!);
  return { line: piece.slice(start, end + 1), whole: false, pieces: usable.length };
}
