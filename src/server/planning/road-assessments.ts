import { unknownEvidence } from "@/domain/evidence/types";
import type { Coordinate } from "@/domain/ride/types";
import {
  ROAD_AUTHORITY_DEADLINE_MS,
  ROAD_AUTHORITY_SETTLE_MS,
  type RoadAuthorityAssessment,
  type RoadAuthorityCoordinator,
} from "@/application/route-intelligence/coordinator";
import { boundingBoxOf, boxesIntersect, padBox } from "@/application/route-intelligence/match";
import type { BoundingBox } from "@/application/route-intelligence/types";

type Lines = readonly { readonly geometry: readonly Coordinate[] }[];

function contains(outer: BoundingBox, inner: BoundingBox): boolean {
  return outer.west <= inner.west && outer.east >= inner.east && outer.south <= inner.south && outer.north >= inner.north;
}
function union(a: BoundingBox, b: BoundingBox): BoundingBox {
  return { west: Math.min(a.west, b.west), south: Math.min(a.south, b.south), east: Math.max(a.east, b.east), north: Math.max(a.north, b.north) };
}
function corridorOf(from: Lines): BoundingBox | null {
  const points = from.flatMap(candidate => candidate.geometry).filter(point => Number.isFinite(point.lon) && Number.isFinite(point.lat));
  return points.length === 0 ? null : padBox(boundingBoxOf(points), 500);
}

export interface RoadAssessments {
  /** Reuse covered corridors; genuinely new corridors share one optional deadline. */
  (from: Lines, runSignal?: AbortSignal): Promise<RoadAuthorityAssessment | null>;
  /**
   * True when one of these lines' closure/access check is still loading rather
   * than answered (or answered "down"): the plan's deadline ran out first, so
   * the verdict says "unknown" where a moment's wait might say "closed".
   */
  pending(from: Lines): boolean;
  /**
   * Finish the check for these lines, once, inside a bounded wait. Joins the
   * load already in flight when it covers them. Returns the assessment to
   * use from now on (answered lines from the new answer, everything else as
   * before), or `null` when the check still did not answer.
   */
  settle(from: Lines, waitMs?: number, runSignal?: AbortSignal): Promise<RoadAuthorityAssessment | null>;
}

export function requestRoadAssessments(authority: RoadAuthorityCoordinator | null, signal: AbortSignal): RoadAssessments {
  let corridor: BoundingBox | null = null;
  /** The last corridor actually sent to the sources: their loads for it keep running. */
  let attempted: BoundingBox | null = null;
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
          ...(prior?.blockedRoads === undefined ? {} : { blockedRoads: prior.blockedRoads }),
          warnings: [...(prior?.warnings ?? []), { code: "road-authority-unavailable", message: reason }],
          evidence: {
            closures: prior?.failures.some(failure => failure.code === "road-closed") ? prior.evidence.closures : unknownEvidence(reason),
            access: prior?.failures.some(failure => failure.code === "access-prohibited") ? prior.evidence.access : unknownEvidence(reason),
          },
        };
      },
    };
  };
  /** One bounded wait on the coordinator; `null` when it did not answer in time. */
  const ask = async (box: BoundingBox, waitMs: number, runSignal: AbortSignal, deadlineMs?: number): Promise<RoadAuthorityAssessment | null> => {
    attempted = box;
    const controller = new AbortController();
    const assessmentSignal = AbortSignal.any([runSignal, controller.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => undefined;
    const fallback = new Promise<null>(resolve => {
      onAbort = () => resolve(null);
      assessmentSignal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => controller.abort(), waitMs);
    });
    try {
      const pending = deadlineMs === undefined ? authority!.assess(box, assessmentSignal) : authority!.assess(box, assessmentSignal, { deadlineMs });
      const assessment = await Promise.race([pending.catch(() => null), fallback]);
      if (runSignal.aborted) throw runSignal.reason;
      return assessment;
    } finally {
      clearTimeout(timer);
      assessmentSignal.removeEventListener("abort", onAbort);
    }
  };
  const assess = async (from: Lines, runSignal = signal): Promise<RoadAuthorityAssessment | null> => {
    if (runSignal.aborted) throw runSignal.reason;
    if (authority === null || authority.sources.length === 0) return null;
    const box = corridorOf(from);
    if (box === null) return null;
    if (latest !== null && contains(latest.box, box)) return latest.assessment;
    corridor = corridor === null ? box : union(corridor, box);
    deadline ??= Date.now() + ROAD_AUTHORITY_DEADLINE_MS;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return unknown();
    const assessment = await ask(corridor, remaining, runSignal);
    if (assessment === null) return unknown();
    latest = { box: corridor, assessment };
    return assessment;
  };
  const pending = (from: Lines): boolean => {
    if (authority === null || authority.sources.length === 0) return false;
    return from.some(candidate => {
      const box = corridorOf([candidate]);
      if (box === null) return false;
      // Never answered for this area: the deadline ran out first.
      if (latest === null || !contains(latest.box, box)) return true;
      // Answered, but a source covering it was still loading at the deadline
      // and the verdict for this line is "unavailable" because of it.
      const slow = latest.assessment.sources.some(outcome =>
        outcome.snapshot.timedOut === true &&
        (outcome.snapshot.scope ?? outcome.info.coverage).some(scope => boxesIntersect(scope, box)));
      return slow && latest.assessment.evaluate(candidate.geometry).warnings.some(warning => warning.code === "road-authority-unavailable");
    });
  };
  const settle = async (from: Lines, waitMs = ROAD_AUTHORITY_SETTLE_MS, runSignal = signal): Promise<RoadAuthorityAssessment | null> => {
    if (runSignal.aborted) throw runSignal.reason;
    if (authority === null || authority.sources.length === 0) return null;
    const box = corridorOf(from);
    if (box === null) return null;
    // The same corridor joins the sources' load still in flight (and their
    // cache); a corridor never sent starts its own.
    const target = attempted !== null && contains(attempted, box) ? attempted : union(corridor ?? box, box);
    corridor = corridor === null ? target : union(corridor, target);
    const answer = await ask(target, waitMs, runSignal, waitMs);
    if (answer === null) return null;
    const previous = latest === null ? null : unknown();
    const settled: RoadAuthorityAssessment = previous === null ? answer : {
      at: answer.at,
      sources: answer.sources,
      evaluate: line => (contains(target, boundingBoxOf(line)) ? answer : previous).evaluate(line),
    };
    latest = { box: target, assessment: settled };
    return settled;
  };
  return Object.assign(assess, { pending, settle });
}
