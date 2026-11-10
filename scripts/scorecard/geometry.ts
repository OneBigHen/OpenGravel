import { haversine } from '../../src/domain/geometry/analysis';
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
 */
export function deadEndSpurs(line: readonly Coordinate[], threshold = 300): number {
  if (line.length < 3) return 0;
  const cumulative = [0];
  for (let i = 1; i < line.length; i++) cumulative.push(cumulative[i - 1]! + haversine(line[i - 1]!, line[i]!));
  const at = (meters: number): Coordinate => {
    let low = 0; let high = cumulative.length - 1;
    while (low + 1 < high) { const mid = (low + high) >> 1; if (cumulative[mid]! < meters) low = mid; else high = mid; }
    const length = cumulative[high]! - cumulative[low]!;
    const t = length > 0 ? (meters - cumulative[low]!) / length : 0;
    return { lat: line[low]!.lat + (line[high]!.lat - line[low]!.lat) * t, lon: line[low]!.lon + (line[high]!.lon - line[low]!.lon) * t };
  };
  let count = 0; let coveredUntil = -1;
  for (let pivot = 1; pivot < line.length - 1; pivot++) {
    const center = cumulative[pivot]!;
    if (center <= coveredUntil) continue;
    const maximum = Math.min(center, cumulative.at(-1)! - center);
    if (maximum <= threshold) continue;
    const matches = (d: number) => haversine(at(center - d), at(center + d)) <= 15;
    // A genuine reversal must retrace immediately, not merely join a nearby
    // parallel road later. Check the exact endpoint as well as 25 m samples.
    if (!matches(Math.min(25, maximum))) continue;
    let matched = 0;
    for (let d = 25; d <= maximum; d += 25) { if (!matches(d)) break; matched = d; }
    if (maximum - matched < 25 && matches(maximum)) matched = maximum;
    if (matched > threshold) { count++; coveredUntil = center + matched; }
  }
  return count;
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
