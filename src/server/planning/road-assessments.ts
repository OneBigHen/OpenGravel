import { unknownEvidence } from "@/domain/evidence/types";
import type { Coordinate } from "@/domain/ride/types";
import { ROAD_AUTHORITY_DEADLINE_MS, type RoadAuthorityAssessment, type RoadAuthorityCoordinator } from "@/application/route-intelligence/coordinator";
import { boundingBoxOf, padBox } from "@/application/route-intelligence/match";
import type { BoundingBox } from "@/application/route-intelligence/types";

function contains(outer: BoundingBox, inner: BoundingBox): boolean {
  return outer.west <= inner.west && outer.east >= inner.east && outer.south <= inner.south && outer.north >= inner.north;
}
function union(a: BoundingBox, b: BoundingBox): BoundingBox {
  return { west: Math.min(a.west, b.west), south: Math.min(a.south, b.south), east: Math.max(a.east, b.east), north: Math.max(a.north, b.north) };
}

/** Reuse covered corridors; genuinely new corridors share one optional deadline. */
export function requestRoadAssessments(authority: RoadAuthorityCoordinator | null, signal: AbortSignal) {
  let corridor: BoundingBox | null = null;
  let deadline: number | null = null;
  let latest: { box: BoundingBox; assessment: RoadAuthorityAssessment } | null = null;
  const unknown = (): RoadAuthorityAssessment => {
    const previous = latest;
    const reason = "Road authority did not answer within the plan's optional budget.";
    return {
      at: new Date().toISOString(), sources: previous?.assessment.sources ?? [],
      evaluate(line) {
        const prior = previous?.assessment.evaluate(line);
        // Retain already-known blockers, but never extend a clear verdict to
        // the part of a generated line whose corridor was not assessed.
        if (previous !== null && contains(previous.box, boundingBoxOf(line))) return prior!;
        return {
          failures: prior?.failures ?? [],
          warnings: [...(prior?.warnings ?? []), { code: "road-authority-unavailable", message: reason }],
          evidence: {
            closures: prior?.failures.some(failure => failure.code === "road-closed") ? prior.evidence.closures : unknownEvidence(reason),
            access: prior?.failures.some(failure => failure.code === "access-prohibited") ? prior.evidence.access : unknownEvidence(reason),
          },
        };
      },
    };
  };
  return async (from: readonly { readonly geometry: readonly Coordinate[] }[], runSignal = signal): Promise<RoadAuthorityAssessment | null> => {
    if (runSignal.aborted) throw runSignal.reason;
    if (authority === null || authority.sources.length === 0) return null;
    const points = from.flatMap(candidate => candidate.geometry).filter(point => Number.isFinite(point.lon) && Number.isFinite(point.lat));
    if (points.length === 0) return null;
    const box = padBox(boundingBoxOf(points), 500);
    if (latest !== null && contains(latest.box, box)) return latest.assessment;
    corridor = corridor === null ? box : union(corridor, box);
    deadline ??= Date.now() + ROAD_AUTHORITY_DEADLINE_MS;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return unknown();
    const controller = new AbortController();
    const assessmentSignal = AbortSignal.any([runSignal, controller.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => undefined;
    const fallback = new Promise<null>(resolve => {
      onAbort = () => resolve(null);
      assessmentSignal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => controller.abort(), remaining);
    });
    try {
      const assessment = await Promise.race([authority.assess(corridor, assessmentSignal).catch(() => null), fallback]);
      if (runSignal.aborted) throw runSignal.reason;
      if (assessment === null) return unknown();
      latest = { box: corridor, assessment };
      return assessment;
    } finally {
      clearTimeout(timer);
      assessmentSignal.removeEventListener("abort", onAbort);
    }
  };
}
