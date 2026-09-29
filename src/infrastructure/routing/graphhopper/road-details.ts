/**
 * GraphHopper path details → the port's `ProviderRoadSummary` (M3, OGV-D-263).
 *
 * The engine answers `details` as `[fromPoint, toPoint, value]` intervals over
 * the returned line. This walks the line once, measures each point-to-point
 * step, and credits its metres to the surface, road class, curvature and toll
 * value in force there. Nothing is interpreted: `"missing"` stays `"missing"`
 * and the application layer decides what an untagged secondary road means.
 */

import type { ProviderRoadSummary } from "@/application/planner/route-provider";
import { haversine } from "@/domain/geometry/analysis";
import { bendMeters } from "@/domain/geometry/bends";
import type { Coordinate } from "@/domain/ride/types";
import { MAX_SPEED_LIMIT_SPANS, type SpeedLimitSpan } from "@/domain/route/types";

import type { GraphHopperDetailInterval } from "./response-parser";

type DetailMap = Readonly<Record<string, readonly GraphHopperDetailInterval[] | undefined>>;

const MISSING = "missing";

/** The value of one detail for every step `i → i + 1` of the line. */
function valuesPerStep(
  intervals: readonly GraphHopperDetailInterval[] | undefined,
  steps: number,
): (string | number | boolean | null)[] {
  const values: (string | number | boolean | null)[] = new Array(steps).fill(null);
  for (const [from, to, value] of intervals ?? []) {
    const start = Math.max(0, Math.floor(from));
    const end = Math.min(steps, Math.floor(to));
    for (let step = start; step < end; step += 1) values[step] = value;
  }
  return values;
}

function label(value: string | number | boolean | null): string {
  if (value === null || value === "") return MISSING;
  return String(value).toLowerCase();
}

function add(map: Record<string, number>, key: string, meters: number): void {
  map[key] = (map[key] ?? 0) + meters;
}

/**
 * `null` when the engine sent no details at all (a degraded retry or an older
 * graph): "not described" is a different fact from "all missing".
 */
export function summarizeRoadDetails(
  geometry: readonly Coordinate[],
  details: DetailMap | undefined,
): ProviderRoadSummary | null {
  if (details === undefined || geometry.length < 2) return null;
  if (details["surface"] === undefined && details["road_class"] === undefined) return null;
  const steps = geometry.length - 1;
  const surface = valuesPerStep(details["surface"], steps);
  const roadClass = valuesPerStep(details["road_class"], steps);
  const curvature = valuesPerStep(details["curvature"], steps);
  const toll = valuesPerStep(details["toll"], steps);

  const surfaceByRoadClassMeters: Record<string, number> = {};
  const curvatureMeters: Record<string, number> = {};
  const surfaceRuns: [number, string][] = [];
  let tollMeters = 0;
  let totalMeters = 0;
  for (let step = 0; step < steps; step += 1) {
    const from = geometry[step];
    const to = geometry[step + 1];
    if (from === undefined || to === undefined) continue;
    const meters = haversine(from, to);
    if (!(meters > 0)) continue;
    totalMeters += meters;
    const surfaceKey = `${label(surface[step] ?? null)}|${label(roadClass[step] ?? null)}`;
    add(surfaceByRoadClassMeters, surfaceKey, meters);
    const run = surfaceRuns[surfaceRuns.length - 1];
    if (run !== undefined && run[1] === surfaceKey) run[0] += meters;
    else surfaceRuns.push([meters, surfaceKey]);
    const ratio = curvature[step];
    add(curvatureMeters, typeof ratio === "number" && Number.isFinite(ratio) ? ratio.toFixed(2) : MISSING, meters);
    const tollValue = label(toll[step] ?? null);
    if (tollValue !== "no" && tollValue !== MISSING) tollMeters += meters;
  }
  return {
    totalMeters,
    surfaceByRoadClassMeters,
    curvatureMeters,
    tollMeters,
    surfaceRuns,
    bendMeters: bendMeters(geometry),
  };
}

/**
 * Posted speed limits (NV-04) as runs over the *returned* line. `indexMap`
 * maps each engine point to its index in the de-duplicated geometry. A step
 * whose limit the engine estimated (no OSM `maxspeed` tag), or whose estimate
 * flag is absent (the hosted graph does not say), carries no limit.
 */
export function speedLimitSpans(
  pointCount: number,
  details: DetailMap | undefined,
  indexMap: readonly number[],
): SpeedLimitSpan[] {
  if (details === undefined || pointCount < 2) return [];
  const maxSpeed = details["max_speed"];
  const estimated = details["max_speed_estimated"];
  if (maxSpeed === undefined || estimated === undefined) return [];
  const steps = pointCount - 1;
  const limits = valuesPerStep(maxSpeed, steps);
  const guesses = valuesPerStep(estimated, steps);
  const spans: SpeedLimitSpan[] = [];
  for (let step = 0; step < steps; step += 1) {
    const kmh = limits[step];
    const from = indexMap[step];
    const to = indexMap[step + 1];
    if (from === undefined || to === undefined || to <= from) continue;
    if (typeof kmh !== "number" || !(kmh > 0) || kmh > 200 || guesses[step] !== false) continue;
    const last = spans[spans.length - 1];
    if (last !== undefined && last.kmh === kmh && last.toIndex === from) {
      spans[spans.length - 1] = { ...last, toIndex: to };
    } else {
      spans.push({ fromIndex: from, toIndex: to, kmh });
    }
  }
  return spans.length > MAX_SPEED_LIMIT_SPANS ? [] : spans;
}
