import { findDeadEndSpurs, type DeadEndSpur } from "@/domain/geometry/dead-end-spurs";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteEligibility } from "@/domain/route/eligibility";
import type { ProviderCandidate, ProviderRouteRequest } from "./route-provider";

/**
 * Riders hate riding down a road for a quarter mile or more, turning around
 * and coming back the same way. A route that does it is not offered while a
 * route that does not exists; GraphHopper still draws every line, we only
 * decline the ones that retrace.
 *
 * The rule never applies to a ride the rider drew or pinned themselves
 * (stops, shaping points, a sketch, their own road spans): an out-and-back to a
 * viewpoint they chose is what they asked for.
 */
export function deadEndSpurRuleApplies(request: ProviderRouteRequest): boolean {
  return request.stops.length === 0 &&
    request.shaping.length === 0 &&
    request.sketch === undefined &&
    (request.roadSpans?.length ?? 0) === 0;
}

/**
 * Spurs of a candidate's own line. The planner ranks the same candidates many
 * times, so the answer is remembered by the line itself.
 */
const SPUR_CACHE = new Map<string, readonly DeadEndSpur[]>();
const SPUR_CACHE_LIMIT = 256;

function lineKey(line: readonly Coordinate[]): string {
  // FNV-1a over the coordinates: cheap, and the length is part of the key.
  let hash = 0x811c9dc5;
  for (const point of line) {
    hash = Math.imul(hash ^ Math.round(point.lat * 1e6), 0x01000193);
    hash = Math.imul(hash ^ Math.round(point.lon * 1e6), 0x01000193);
  }
  return `${line.length}:${hash >>> 0}`;
}

export function deadEndSpursOf(line: readonly Coordinate[]): readonly DeadEndSpur[] {
  const key = lineKey(line);
  const known = SPUR_CACHE.get(key);
  if (known !== undefined) return known;
  const found = findDeadEndSpurs(line);
  if (SPUR_CACHE.size >= SPUR_CACHE_LIMIT) SPUR_CACHE.delete(SPUR_CACHE.keys().next().value as string);
  SPUR_CACHE.set(key, found);
  return found;
}

function miles(meters: number): string {
  return (meters / 1609.344).toFixed(1);
}

/**
 * `reject`: a spur makes the route ineligible. `warn`: nothing better exists,
 * so the route is kept and the rider is told. A line with no spur is clear in
 * both modes; a request the rider authored is never judged.
 */
export function deadEndSpurEligibility(
  candidate: ProviderCandidate,
  request: ProviderRouteRequest,
  mode: "reject" | "warn",
): RouteEligibility {
  const clear: RouteEligibility = { eligible: true, failures: [], warnings: [] };
  if (!deadEndSpurRuleApplies(request) || candidate.hike !== undefined) return clear;
  const spurs = deadEndSpursOf(candidate.geometry);
  if (spurs.length === 0) return clear;
  const longest = Math.max(...spurs.map((spur) => spur.oneWayMeters));
  const message = spurs.length === 1
    ? `This route rides ${miles(longest)} mi down a dead-end road and back the same way.`
    : `This route rides down ${spurs.length} dead-end roads and back the same way (longest ${miles(longest)} mi).`;
  return mode === "reject"
    ? { eligible: false, failures: [{ code: "dead-end-spur", message }], warnings: [] }
    : { eligible: true, failures: [], warnings: [{ code: "dead-end-spur", message }] };
}
