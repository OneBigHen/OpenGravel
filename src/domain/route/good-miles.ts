import type { Coordinate } from "@/domain/ride/types";
import { analyzeGeometryFun, type FunRoadRun, type GeometryFun } from "@/domain/geometry/heading-fun";
import type { RouteInstruction } from "./types";

/**
 * Good miles: the one number the planner's pick, the route card and the
 * scorecard all spend. Dirt metres in gravel modes; road-bends-v1 `bendMeters`
 * (sustained same-direction bends on roads that earn) in curvy and balanced.
 * Unknown road details earn nothing: a line without ordered road runs is never
 * credited with dirt or bends it cannot show.
 */
export type GoodMilesMode = "dirt" | "curvy";

/** Surfaces that count as dirt. Sand, mud and grass are not good miles. */
export const DIRT_SURFACES: ReadonlySet<string> = new Set(["gravel", "fine_gravel", "compacted", "dirt", "ground", "unpaved", "earth"]);

export interface GoodMilesRun extends FunRoadRun {
  readonly surface: string;
}

/** The facts of one candidate line this measure reads. */
export interface GoodMilesLine {
  readonly geometry: readonly Coordinate[];
  readonly distanceMeters: number;
  readonly instructions?: readonly Pick<RouteInstruction, "type" | "maneuver" | "geometryIndex">[];
  readonly roadSummary?: { readonly totalMeters: number; readonly roadRuns?: readonly GoodMilesRun[] };
}

/** Travelled metres on dirt surfaces, from the ordered road runs. */
export function dirtMeters(runs: readonly Pick<GoodMilesRun, "meters" | "surface">[]): number {
  return runs.reduce((sum, run) => sum + (run.meters > 0 && DIRT_SURFACES.has(run.surface.toLowerCase()) ? run.meters : 0), 0);
}

/** Bend measure of a line; junction turns never count as bends. Null when road details are missing or inconsistent. */
export function lineGeometryFun(line: GoodMilesLine): GeometryFun | null {
  const junctions = line.instructions?.flatMap(instruction =>
    instruction.geometryIndex !== undefined && instruction.type !== "finish" &&
    ((instruction.maneuver !== undefined && instruction.maneuver !== "straight") || instruction.type === "roundabout")
      ? [instruction.geometryIndex] : []) ?? [];
  return analyzeGeometryFun(line.geometry, line.roadSummary?.roadRuns ?? [], junctions);
}

/** Good metres of a line in a mode, never more than the line is long. */
export function goodMeters(line: GoodMilesLine, mode: GoodMilesMode, fun: GeometryFun | null = mode === "curvy" ? lineGeometryFun(line) : null): number {
  const total = Math.max(line.distanceMeters, line.roadSummary?.totalMeters ?? 0);
  const meters = mode === "dirt" ? dirtMeters(line.roadSummary?.roadRuns ?? []) : fun?.bendMeters ?? 0;
  return Math.min(total, meters);
}
