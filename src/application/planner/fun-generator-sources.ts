/**
 * Corridor library windows for the fun-route generators.
 *
 * The library is caller-approved riding geometry (today: the curated route
 * library's rides). A whole ride is far too long to be one probe, so it is cut
 * into overlapping ~12 km windows, and only windows a rider could plausibly use
 * on *this* trip are kept. Priority is the window's own measured bend unit,
 * quantized so the straight-line detour still decides between similar windows.
 * Nothing here says a window is legal, open or good today: that is decided on
 * the routed answer by canonical eligibility.
 */

import type { Coordinate } from "@/domain/ride/types";
import { sourceCurvatureUnit } from "./fun-generator-strategies";
import { straightMeters } from "./fun-generators";
import type { LibraryCorridorSource } from "./library-corridor-probes";
import type { ProviderRouteRequest } from "./route-provider";

export interface LibraryRide {
  readonly id: string;
  readonly geometry: readonly Coordinate[];
}

/** Window length for trips long enough to carry it, and for loops. */
export const CORRIDOR_WINDOW_METERS = 12_000;
const WINDOW_STEP_METERS = 6_000;
const MIN_WINDOW_METERS = 4_000;
/** Windows handed to the generators; pairs and beams grow fast. */
export const MAX_CORRIDOR_SOURCES = 24;
/** Allocation-only speed proxy, as the strategies use (≈ 34 mph). */
const PROXY_METERS_PER_SECOND = 15;
const CONNECTOR_STRETCH = 1.35;
const PRIORITY_STEP = 0.25;

function windows(ride: LibraryRide, targetMeters: number): { readonly id: string; readonly line: readonly Coordinate[]; readonly meters: number }[] {
  const line = ride.geometry;
  if (line.length < 2) return [];
  const cumulative = [0];
  for (let index = 1; index < line.length; index += 1) {
    cumulative.push(cumulative[index - 1]! + straightMeters(line[index - 1]!, line[index]!));
  }
  const total = cumulative.at(-1) ?? 0;
  const out: { id: string; line: readonly Coordinate[]; meters: number }[] = [];
  const step = Math.max(MIN_WINDOW_METERS / 2, (targetMeters * WINDOW_STEP_METERS) / CORRIDOR_WINDOW_METERS);
  for (let start = 0, k = 0; start + MIN_WINDOW_METERS <= total && k < 256; start += step, k += 1) {
    const from = cumulative.findIndex((value) => value >= start);
    let to = cumulative.findIndex((value) => value >= start + targetMeters);
    if (to < 0) to = line.length - 1;
    if (from < 0 || to <= from) break;
    const meters = cumulative[to]! - cumulative[from]!;
    if (meters < MIN_WINDOW_METERS) break;
    out.push({ id: `${ride.id}#${k}`, line: line.slice(from, to + 1), meters });
    if (to === line.length - 1) break;
  }
  return out;
}

/** Straight-line extra distance of riding `line` (best orientation) on the way. */
function detourProxyMeters(request: ProviderRouteRequest, line: readonly Coordinate[], meters: number): number {
  const first = line[0]!;
  const last = line.at(-1)!;
  const forward = straightMeters(request.origin, first) + straightMeters(last, request.destination);
  const reverse = straightMeters(request.origin, last) + straightMeters(first, request.destination);
  return Math.min(forward, reverse) + meters - straightMeters(request.origin, request.destination);
}

/**
 * The library windows worth a probe for this request, best first. A
 * point-to-point ride keeps windows whose detour stays within a bounded share
 * of the trip; a timeboxed loop keeps windows reachable inside its radius.
 */
export function libraryCorridorSources(
  request: ProviderRouteRequest,
  rides: readonly LibraryRide[],
): readonly LibraryCorridorSource[] {
  const direct = straightMeters(request.origin, request.destination);
  const loopMinutes = request.discovery?.targetMinutes;
  const loopRadius = loopMinutes === undefined
    ? null
    : (loopMinutes * 60 * PROXY_METERS_PER_SECOND) / (2 * CONNECTOR_STRETCH);
  const maxDetour = Math.max(10_000, 0.6 * direct);
  // A short trip has no room for a 12 km corridor: scale the window to the trip.
  const target = loopRadius !== null
    ? CORRIDOR_WINDOW_METERS
    : Math.max(MIN_WINDOW_METERS, Math.min(CORRIDOR_WINDOW_METERS, 0.6 * direct));
  const scored: { source: LibraryCorridorSource; cost: number }[] = [];
  for (const ride of rides) {
    for (const window of windows(ride, target)) {
      const unit = sourceCurvatureUnit(window.line);
      if (unit === null) continue;
      let cost: number;
      if (loopRadius !== null) {
        const reach = Math.max(straightMeters(request.origin, window.line[0]!), straightMeters(request.origin, window.line.at(-1)!));
        if (reach > loopRadius * 0.8) continue;
        cost = reach;
      } else {
        cost = detourProxyMeters(request, window.line, window.meters);
        if (cost > maxDetour) continue;
      }
      scored.push({
        source: { id: window.id, geometry: window.line, priority: Math.round(unit / PRIORITY_STEP) * PRIORITY_STEP },
        cost,
      });
    }
  }
  scored.sort((left, right) =>
    (right.source.priority ?? 0) - (left.source.priority ?? 0) ||
    left.cost - right.cost ||
    left.source.id.localeCompare(right.source.id),
  );
  // One window per ride first, so a single long ride cannot fill every slot.
  const firstPass: LibraryCorridorSource[] = [];
  const rest: LibraryCorridorSource[] = [];
  const seen = new Set<string>();
  for (const { source } of scored) {
    const ride = source.id.split("#")[0] ?? source.id;
    if (seen.has(ride)) rest.push(source);
    else {
      seen.add(ride);
      firstPass.push(source);
    }
  }
  return [...firstPass, ...rest].slice(0, MAX_CORRIDOR_SOURCES);
}
