import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { indexRoute } from "@/application/route-intelligence/match";
import type { RoadAuthorityVerdict } from "@/application/route-intelligence/coordinator";
import type { ProviderCandidate } from "./route-provider";

type ApproachBlocks = Pick<RoadAuthorityVerdict, "failures" | "blockedRoads">;

// Match the authority corridor, with 10 m sampling so sparse router geometry
// cannot hide a short blocked road between vertices. Targets include clearance
// for both that sampling and router snapping; only rechecked router output ships.
const ON_ROAD_METERS = 20;
const SAMPLE_METERS = 10;
const CLEARANCES = [40, 100, 250] as const;

function interpolate(a: Coordinate, b: Coordinate, t: number): Coordinate {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

function distances(line: readonly Coordinate[]): number[] {
  const at = [0];
  for (let i = 1; i < line.length; i++) at.push(at[i - 1]! + haversine(line[i - 1]!, line[i]!));
  return at;
}

/** Conservative first contact with any road that actually rejected the original route. */
function firstBlockedMeter(line: readonly Coordinate[], verdict: ApproachBlocks): number | null {
  const roads = verdict.blockedRoads;
  if (roads === undefined || roads.length === 0 || roads.some(road => road.geometry.type !== "line")) return null;
  const indexes = roads.map(road => indexRoute(road.geometry.type === "line" ? road.geometry.coordinates : []));
  let traveled = 0;
  for (let i = 1; i < line.length; i++) {
    const start = line[i - 1]!;
    const end = line[i]!;
    const meters = haversine(start, end);
    const steps = Math.max(1, Math.ceil(meters / SAMPLE_METERS));
    for (let step = 0; step <= steps; step++) {
      const point = interpolate(start, end, step / steps);
      if (indexes.some(road => road.nearestMeters(point) <= ON_ROAD_METERS)) return traveled + meters * step / steps;
    }
    traveled += meters;
  }
  return null;
}

/** Never rely on the hard gate's minimum overlap to declare the shortened line usable. */
export function blockedRoadOverlap(line: readonly Coordinate[], verdict: ApproachBlocks): boolean {
  return firstBlockedMeter(line, verdict) !== null;
}

/** Retry endpoints only: the caller must obtain and fully validate fresh router output. */
export function finalApproachTargets(line: readonly Coordinate[], verdict: ApproachBlocks): readonly Coordinate[] {
  if (line.length < 2 || verdict.failures.length === 0) return [];
  const first = firstBlockedMeter(line, verdict);
  const at = distances(line);
  const total = at.at(-1)!;
  // Either the final 2 km or final 15%, but never trim a loop back to its start.
  if (first === null || first <= CLEARANCES.at(-1)! || total - first > Math.max(2000, total * 0.15)) return [];
  return CLEARANCES.map(clearance => {
    const target = first - clearance;
    const end = at.findIndex(meters => meters >= target);
    return interpolate(line[end - 1]!, line[end]!, (target - at[end - 1]!) / (at[end]! - at[end - 1]!));
  });
}

/** Locate explicit router access restrictions too, when a POI snaps to a prohibited road. */
export function approachBlocksFor(candidate: ProviderCandidate, authority: RoadAuthorityVerdict | null): ApproachBlocks | null {
  const runs = candidate.roadSummary?.roadRuns ?? [];
  // Sand is a rider surface rule, not evidence that a road is closed to motorcycles.
  if (runs.some(run => run.meters > 0 && run.surface === "sand")) return null;
  const blocked = runs.filter(run => run.meters > 0 && (run.carAccess === false || run.roadAccess === "private" || run.roadAccess === "no"));
  if (blocked.length === 0) return authority;
  const at = distances(candidate.geometry);
  const total = at.at(-1)!;
  // Ordered engine runs must describe this entire line before distances can locate a block.
  if (candidate.geometry.length < 2 || runs.some(run => !Number.isFinite(run.meters) || run.meters < 0)
    || Math.abs(runs.reduce((sum, run) => sum + run.meters, 0) - total) > 1) return null;
  const pointAt = (meters: number): Coordinate => {
    if (meters <= 0) return candidate.geometry[0]!;
    if (meters >= total) return candidate.geometry.at(-1)!;
    const i = at.findIndex(value => value > meters);
    return interpolate(candidate.geometry[i - 1]!, candidate.geometry[i]!, (meters - at[i - 1]!) / (at[i]! - at[i - 1]!));
  };
  const blockedRoads = [...(authority?.blockedRoads ?? [])];
  let traveled = 0;
  for (const run of runs) {
    const end = Math.min(total, traveled + run.meters);
    if (blocked.includes(run)) blockedRoads.push({ code: "access-prohibited", geometry: { type: "line", coordinates: [
      pointAt(traveled), ...candidate.geometry.filter((_point, i) => at[i]! > traveled && at[i]! < end), pointAt(end),
    ] } });
    traveled = end;
  }
  return { failures: [...(authority?.failures ?? []), { code: "access-prohibited", message: "The final road is not open to motorcycles." }], blockedRoads };
}

export function finalApproachMessage(end: Coordinate, destination: Coordinate, accessBlocked: boolean, label = "your destination"): string {
  const miles = Math.max(0.1, Math.round(haversine(end, destination) / 1609.344 * 10) / 10);
  return `Ends ${miles.toFixed(1)} mi before ${label} — ${accessBlocked ? "the last stretch isn't open to motorcycles" : "the last stretch is closed"}.`;
}
