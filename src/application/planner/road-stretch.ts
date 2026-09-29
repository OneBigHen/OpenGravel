/**
 * "Avoid this road" from one tap (NV-14). A tap on the route names the stretch
 * of road under it: the run of turn-by-turn intervals that share the tapped
 * road's name, so tapping Route 309 anywhere selects all of Route 309 on this
 * ride. Without a name (or without instructions) it falls back to a short
 * window around the tap rather than guessing a road.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { RouteInstruction } from "@/domain/route/types";
import type { Coordinate } from "@/domain/ride/types";
import { nearestVertexIndex, type RoadSpanDraft } from "@/application/planner/road-span-draft";

export interface RoadStretch {
  readonly draft: RoadSpanDraft;
  /** The road's name as the router gave it, or null for an unnamed stretch. */
  readonly roadName: string | null;
}

/** Half the length of the unnamed fallback window, each side of the tap. */
export const UNNAMED_STRETCH_METERS = 400;

interface Interval {
  readonly from: number;
  readonly to: number;
  readonly name: string;
}

function intervalsOf(line: readonly Coordinate[], instructions: readonly RouteInstruction[]): Interval[] {
  const starts = instructions
    .filter((entry) => entry.geometryIndex !== undefined && entry.geometryIndex < line.length)
    .map((entry) => ({ from: entry.geometryIndex as number, name: entry.roadName?.trim() ?? "" }))
    .sort((a, b) => a.from - b.from);
  return starts.map((entry, index) => ({
    from: entry.from,
    to: index + 1 < starts.length ? (starts[index + 1] as { from: number }).from : line.length - 1,
    name: entry.name,
  }));
}

function sameRoad(a: string, b: string): boolean {
  return a.length > 0 && a.toLowerCase() === b.toLowerCase();
}

function windowAround(line: readonly Coordinate[], index: number, meters: number): { from: number; to: number } {
  let from = index;
  let walked = 0;
  while (from > 0 && walked < meters) {
    walked += haversine(line[from - 1] as Coordinate, line[from] as Coordinate);
    from -= 1;
  }
  let to = index;
  walked = 0;
  while (to < line.length - 1 && walked < meters) {
    walked += haversine(line[to] as Coordinate, line[to + 1] as Coordinate);
    to += 1;
  }
  return { from, to };
}

export function roadStretchAt(
  routeId: string,
  line: readonly Coordinate[],
  instructions: readonly RouteInstruction[] | undefined,
  coordinate: Coordinate,
): RoadStretch | null {
  if (line.length < 2) return null;
  const tap = nearestVertexIndex(line, coordinate);
  if (tap === null) return null;

  const intervals = intervalsOf(line, instructions ?? []);
  let at = -1;
  intervals.forEach((interval, index) => {
    if (interval.from <= tap) at = index;
  });
  const hit = at >= 0 ? intervals[at] : undefined;
  if (hit === undefined || hit.name.length === 0) {
    const { from, to } = windowAround(line, tap, UNNAMED_STRETCH_METERS);
    return to > from ? { draft: { routeId, startIndex: from, endIndex: to }, roadName: null } : null;
  }

  let first = at;
  while (first > 0 && sameRoad((intervals[first - 1] as Interval).name, hit.name)) first -= 1;
  let last = at;
  while (last + 1 < intervals.length && sameRoad((intervals[last + 1] as Interval).name, hit.name)) last += 1;
  const from = (intervals[first] as Interval).from;
  const to = Math.max((intervals[last] as Interval).to, from + 1);
  return { draft: { routeId, startIndex: from, endIndex: Math.min(to, line.length - 1) }, roadName: (intervals[first] as Interval).name };
}
