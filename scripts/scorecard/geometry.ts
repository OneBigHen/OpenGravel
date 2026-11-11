import { haversine } from '../../src/domain/geometry/analysis';
import { countDeadEndSpurs } from '../../src/domain/geometry/dead-end-spurs';
import type { Coordinate } from '../../src/domain/ride/types';
import type { ProviderInstruction } from '../../src/application/planner/route-provider';

/** Resample by travelled distance so dense GPX vertices do not bias overlap. */
export function sampleLine(line: readonly Coordinate[], spacing = 25): Coordinate[] {
  if (line.length === 0) return [];
  const points: Coordinate[] = [line[0]!];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!; const b = line[i]!;
    const length = haversine(a, b);
    for (let at = spacing - carry; at <= length; at += spacing) {
      const t = at / length;
      points.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
    }
    carry = (carry + length) % spacing;
  }
  return points;
}

/** Count maximal out-and-back branches, one-way length strictly over 300 m.
 * Geometry proves retracing, not the absence of a physical onward road.
 * A turnaround at the requested A-to-B destination is not part of a route.
 * The detection lives in src/ so the planner refuses exactly what this counts.
 */
export function deadEndSpurs(line: readonly Coordinate[], threshold = 300): number {
  return countDeadEndSpurs(line, threshold);
}

/** Explicit router maneuvers only: hairpin geometry is not a U-turn. */
export function uTurns(instructions: readonly Pick<ProviderInstruction, 'maneuver'>[]): number {
  return instructions.filter(instruction => instruction.maneuver === 'uturn').length;
}

/** Fraction of equally spaced rider-track samples within 50 m of the route.
 * Route samples are <=25 m apart, hence this is a conservative proximity match.
 * Direction is intentionally ignored; shown only, never used by the scorer.
 */
export function riderMatch(track: readonly Coordinate[], route: readonly Coordinate[]): number | null {
  const reference = sampleLine(track, 50);
  const actual = sampleLine(route, 25);
  if (reference.length === 0 || actual.length === 0) return null;
  const cells = new Map<string, Coordinate[]>();
  const key = (p: Coordinate) => [Math.floor(p.lon * 1600), Math.floor(p.lat * 2200)] as const;
  for (const point of actual) { const [x, y] = key(point); const k = `${x},${y}`; cells.set(k, [...(cells.get(k) ?? []), point]); }
  let matched = 0;
  for (const point of reference) {
    const [x, y] = key(point);
    let found = false;
    for (let dx = -2; dx <= 2 && !found; dx++) for (let dy = -2; dy <= 2 && !found; dy++) found = (cells.get(`${x + dx},${y + dy}`) ?? []).some(other => haversine(point, other) <= 50);
    if (found) matched++;
  }
  return matched / reference.length;
}
