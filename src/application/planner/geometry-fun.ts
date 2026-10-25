import { analyzeGeometryFun, type GeometryFun } from "@/domain/geometry/heading-fun";
import type { ProviderCandidate } from "./route-provider";

const cache = new WeakMap<ProviderCandidate, GeometryFun | null>();
/** Repeated canonical screens/ranks reuse a candidate's immutable geometry facts. */
export function candidateGeometryFun(candidate: ProviderCandidate): GeometryFun | null {
  if (cache.has(candidate)) return cache.get(candidate)!;
  const junctions = candidate.instructions?.flatMap(instruction =>
    instruction.geometryIndex !== undefined && instruction.type !== "finish" &&
    ((instruction.maneuver !== undefined && instruction.maneuver !== "straight") || instruction.type === "roundabout")
      ? [instruction.geometryIndex] : []) ?? [];
  const fun = analyzeGeometryFun(candidate.geometry, candidate.roadSummary?.roadRuns ?? [], junctions);
  cache.set(candidate, fun);
  return fun;
}

/** Modest real ETA cost: about one bend kilometre per 17 additional minutes. */
export function geometryFunUtility(fun: GeometryFun, seconds: number, fastestSeconds: number): number {
  return fun.funScore - Math.max(0, seconds - fastestSeconds) / 60 * 0.06;
}

/** Monotone 0..100 adapter for canonical MMR's recommendation-value contract. */
export function geometryFunRecommendation(candidate: ProviderCandidate, fastestSeconds: number, reference?: ProviderCandidate, protectBusy = true): number | null {
  const fun = candidateGeometryFun(candidate);
  return fun === null || (reference !== undefined && !geometryFunExposureAllowed(fun, candidateGeometryFun(reference), protectBusy)) ? null : 50 + 40 * Math.tanh(geometryFunUtility(fun, candidate.durationSeconds, fastestSeconds) / 20);
}

/**
 * An unmeasured reference cannot authorize extra exposure. Its conservative
 * allowance is just the existing slack (10 busy / 3 residential points),
 * never a claim that the reference measured zero traffic or residential km.
 */
export function geometryFunExposureAllowed(fun: GeometryFun, reference: GeometryFun | null, protectBusy: boolean): boolean {
  return (!protectBusy || fun.busyShare <= (reference?.busyShare ?? 0) + 0.1 + 1e-9) &&
    fun.residentialShare <= (reference?.residentialShare ?? 0) + 0.03 + 1e-9;
}
