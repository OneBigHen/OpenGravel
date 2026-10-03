/**
 * The road-authority coordinator (§6 lane A, wave RI-0/RI-1).
 *
 * Once per plan: ask every configured source for its snapshot of the corridor,
 * each inside a strict deadline. Then, per candidate, a pure evaluation over
 * those snapshots: which records the route really rides, what policy says
 * they do, and the `closures` / `access` evidence for scoring.
 *
 * The rule the whole module exists for: **unavailable is never clear**. A
 * source that timed out, failed, or does not cover part of the route leaves
 * closure evidence unknown and says so; only a complete answer from every
 * source that covers the route can read as "no closures".
 */

import { knownEvidence, unknownEvidence, type EvidenceSource, type EvidenceValue } from "@/domain/evidence/types";
import type { Coordinate } from "@/domain/ride/types";

import { dedupeRecords } from "./dedupe";
import { boxesIntersect, indexRoute, matchRecord } from "./match";
import { inSeason, roadAuthorityEffect } from "./policy";
import type { RoadAuthoritySource } from "./road-authority-source";
import type { BoundingBox, RoadAuthorityRecord, RoadAuthoritySnapshot, RoadAuthoritySourceInfo } from "./types";

/** Lane A's budget: a plan waits at most this long for road authority. */
export const ROAD_AUTHORITY_DEADLINE_MS = 2_500;

export type RoadAuthorityFailureCode = "road-closed" | "access-prohibited";
export type RoadAuthorityWarningCode =
  | "road-work-on-route"
  | "road-restriction-on-route"
  | "road-closure-reported"
  | "seasonal-access-unverified"
  | "road-authority-unavailable";

export interface RoadAuthorityVerdict {
  readonly failures: readonly { readonly code: RoadAuthorityFailureCode; readonly message: string }[];
  readonly warnings: readonly { readonly code: RoadAuthorityWarningCode; readonly message: string }[];
  readonly evidence: {
    /** 0 = checked and clear … 1 = closed; unknown unless every covering source answered. */
    readonly closures: EvidenceValue<number>;
    /** 1 = every designated road ridden is open to motorcycles; unknown when none was ridden. */
    readonly access: EvidenceValue<number>;
  };
}

export interface SourceOutcome {
  readonly info: RoadAuthoritySourceInfo;
  readonly snapshot: RoadAuthoritySnapshot;
}

export interface RoadAuthorityAssessment {
  readonly at: string;
  readonly sources: readonly SourceOutcome[];
  evaluate(geometry: readonly Coordinate[]): RoadAuthorityVerdict;
}

export interface RoadAuthorityCoordinator {
  /** Sources whose probe says they are configured. */
  readonly sources: readonly RoadAuthoritySource[];
  assess(corridor: BoundingBox, signal: AbortSignal): Promise<RoadAuthorityAssessment>;
}

function unavailable(reason: string): RoadAuthoritySnapshot {
  return { status: "unavailable", fetchedAt: null, reason, records: [], covered: [] };
}

function withDeadline(
  source: RoadAuthoritySource,
  corridor: BoundingBox,
  signal: AbortSignal,
  deadlineMs: number,
): Promise<RoadAuthoritySnapshot> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve(unavailable(`${source.info.label} did not answer within ${Math.round(deadlineMs / 100) / 10} s.`)),
      deadlineMs,
    );
    // The load keeps running past the deadline so its cache is warm for the
    // next plan; only the rider's own cancel stops it.
    source.snapshot(corridor, signal).then(
      (snapshot) => { clearTimeout(timer); resolve(snapshot); },
      () => { clearTimeout(timer); resolve(unavailable(`${source.info.label} failed.`)); },
    );
  });
}

function insideAny(point: Coordinate, boxes: readonly BoundingBox[]): boolean {
  return boxes.some((box) => point.lon >= box.west && point.lon <= box.east && point.lat >= box.south && point.lat <= box.north);
}

/** Route points about every kilometre: enough to test coverage, cheap to check. */
function coverageProbes(geometry: readonly Coordinate[]): readonly Coordinate[] {
  const step = Math.max(1, Math.floor(geometry.length / 200));
  const probes: Coordinate[] = [];
  for (let index = 0; index < geometry.length; index += step) probes.push(geometry[index]!);
  if (geometry.length > 0) probes.push(geometry.at(-1)!);
  return probes;
}

function evidenceSource(info: RoadAuthoritySourceInfo, fetchedAt: string | null, key: string): EvidenceSource {
  return {
    id: info.id,
    label: info.label,
    category: "other",
    authoritativeFor: [key],
    ...(fetchedAt === null ? {} : { observedAt: fetchedAt }),
  };
}

function designationOpenAt(record: RoadAuthorityRecord, at: string): boolean | null {
  const access = record.motorcycleAccess;
  if (access === undefined || access.status === "unknown") return null;
  if (access.status === "closed") return false;

  if (access.windows !== undefined) {
    const instant = Date.parse(at);
    if (!Number.isFinite(instant)) return null;
    const open = access.windows.some((window) => {
      const start = Date.parse(window.validFrom);
      const end = Date.parse(window.validUntil);
      return Number.isFinite(start) && Number.isFinite(end) && start <= instant && instant < end;
    });
    if (open) return true;
    return access.outsideWindowStatus === "closed" ? false : null;
  }

  if (access.seasons === null) return true;
  if (access.seasons.length === 0) return null;
  return inSeason(access.seasons, at);
}

function createAssessment(at: string, outcomes: readonly SourceOutcome[]): RoadAuthorityAssessment {
  const precedence = new Map(outcomes.map((outcome) => [outcome.info.id, outcome.info.precedence]));
  const authority = new Map(outcomes.map((outcome) => [outcome.info.id, outcome.info.authority]));
  const records: readonly RoadAuthorityRecord[] = dedupeRecords(
    outcomes.flatMap((outcome) => outcome.snapshot.records),
    (sourceId) => precedence.get(sourceId) ?? Number.MAX_SAFE_INTEGER,
  );

  return {
    at,
    sources: outcomes,
    evaluate(geometry) {
      const failures: { code: RoadAuthorityFailureCode; message: string }[] = [];
      const warnings: { code: RoadAuthorityWarningCode; message: string }[] = [];
      if (geometry.length < 2) {
        return {
          failures,
          warnings,
          evidence: { closures: unknownEvidence("The route has no line to check."), access: unknownEvidence("The route has no line to check.") },
        };
      }
      const route = indexRoute(geometry);
      const probes = coverageProbes(geometry);

      // Which sources speak for this route, and did each answer for all of it?
      const facet = (name: "closures" | "access") => {
        const scopeOf = (outcome: SourceOutcome): readonly BoundingBox[] => outcome.snapshot.scope ?? outcome.info.coverage;
        const covering = outcomes.filter((outcome) =>
          outcome.info.facet === name && scopeOf(outcome).some((box) => boxesIntersect(box, route.box)),
        );
        // Answered-for: inside what the answer covered and not in an area it
        // says it cannot speak for (a neighboring state with no feed).
        const answersFor = (outcome: SourceOutcome, point: Coordinate): boolean =>
          outcome.snapshot.status !== "unavailable" &&
          insideAny(point, outcome.snapshot.covered) &&
          !insideAny(point, outcome.snapshot.unknownAreas ?? []);
        // A gap is a source that should have answered here and did not: that
        // is worth a caveat. A place no source speaks for is only unknown.
        const gaps = covering.filter((outcome) => {
          if (outcome.snapshot.status === "unavailable") return true;
          return probes.some((point) =>
            insideAny(point, scopeOf(outcome)) &&
            !insideAny(point, outcome.snapshot.unknownAreas ?? []) &&
            !answersFor(outcome, point),
          );
        });
        // "No closures" needs every part of the route answered for by someone.
        const complete = covering.length > 0 && probes.every((point) => covering.some((outcome) => answersFor(outcome, point)));
        return { covering, gaps, complete };
      };
      const closures = facet("closures");
      const access = facet("access");

      let closureRisk = 0;
      let accessRidden = false;
      let accessUncertain = false;
      const seen = new Set<string>();
      const roadOf = new WeakMap<object, string>();
      for (const record of records) {
        const recordAuthority = authority.get(record.sourceId);
        if (recordAuthority === undefined) continue;
        const match = matchRecord(route, record.geometry);
        if (match.strength === "none") continue;
        if (record.kind === "motor-vehicle-designation" && match.strength === "traverses") {
          accessRidden = true;
          if (designationOpenAt(record, at) !== true) accessUncertain = true;
        }
        const effect = roadAuthorityEffect(record, recordAuthority, match, at);
        if (effect.effect === "none") continue;
        const key = `${effect.code}:${effect.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (effect.effect === "reject") {
          failures.push({ code: effect.code, message: effect.message });
          if (effect.code === "road-closed") closureRisk = 1;
        } else {
          const warning = { code: effect.code, message: effect.message };
          if (record.roadName !== null) roadOf.set(warning, record.roadName);
          warnings.push(warning);
          if (effect.code === "road-closure-reported") closureRisk = Math.max(closureRisk, 0.9);
          if (effect.code === "road-restriction-on-route") closureRisk = Math.max(closureRisk, 0.6);
          if (effect.code === "road-work-on-route") closureRisk = Math.max(closureRisk, 0.3);
        }
      }

      // One line per road and kind: a daily lane closure listed for each of
      // five days is one caveat, not five.
      const grouped = new Map<string, { code: RoadAuthorityWarningCode; message: string; more: number }>();
      for (const warning of warnings) {
        const road = roadOf.get(warning) ?? warning.message;
        const key = `${warning.code}|${road}`;
        const existing = grouped.get(key);
        if (existing === undefined) grouped.set(key, { ...warning, more: 0 });
        else existing.more += 1;
      }
      warnings.length = 0;
      for (const entry of grouped.values()) {
        warnings.push({
          code: entry.code,
          message: entry.more === 0 ? entry.message : `${entry.message} (+${entry.more} more on this road)`,
        });
      }

      if (closures.gaps.length > 0) {
        warnings.push({
          code: "road-authority-unavailable",
          message: `Closure check unavailable for part of this route (${closures.gaps.map((outcome) => outcome.info.label).join(", ")}).`,
        });
      }
      const closureEvidence: EvidenceValue<number> =
        closures.covering.length === 0
          ? unknownEvidence("No closure feed covers this route.")
          : (closures.gaps.length > 0 || !closures.complete) && closureRisk < 1
            ? unknownEvidence(closures.gaps.length > 0
              ? `Closure check incomplete: ${closures.gaps.map((outcome) => outcome.snapshot.reason ?? outcome.info.label).join(" ")}`
              : "No closure feed covers all of this route.")
            : {
                ...knownEvidence(closureRisk, evidenceSource(closures.covering[0]!.info, closures.covering[0]!.snapshot.fetchedAt, "closures")),
                provenance: closures.covering.map((outcome) => evidenceSource(outcome.info, outcome.snapshot.fetchedAt, "closures")),
                ...(closures.covering.some((outcome) => outcome.snapshot.status === "stale") ? { status: "stale" as const } : {}),
              };
      const accessRejected = failures.some((failure) => failure.code === "access-prohibited");
      const accessEvidence: EvidenceValue<number> =
        !accessRidden || access.covering.length === 0
          ? unknownEvidence("The route rides no road with a published motor-vehicle designation.")
          : accessRejected
            ? {
                ...knownEvidence(0, evidenceSource(access.covering[0]!.info, access.covering[0]!.snapshot.fetchedAt, "access")),
                provenance: access.covering.map((outcome) => evidenceSource(outcome.info, outcome.snapshot.fetchedAt, "access")),
              }
            : accessUncertain
              ? unknownEvidence("A motor-vehicle designation on this route does not establish motorcycle access for this date.")
              : access.gaps.length > 0 || !access.complete
                ? unknownEvidence("Motor-vehicle designations could not be checked for all of this route.")
                : {
                    ...knownEvidence(1, evidenceSource(access.covering[0]!.info, access.covering[0]!.snapshot.fetchedAt, "access")),
                    provenance: access.covering.map((outcome) => evidenceSource(outcome.info, outcome.snapshot.fetchedAt, "access")),
                  };
      return { failures, warnings, evidence: { closures: closureEvidence, access: accessEvidence } };
    },
  };
}

export function createRoadAuthorityCoordinator(deps: {
  readonly sources: readonly RoadAuthoritySource[];
  readonly deadlineMs?: number;
  readonly now?: () => string;
}): RoadAuthorityCoordinator {
  const sources = deps.sources.filter((source) => source.probe().available);
  const deadlineMs = deps.deadlineMs ?? ROAD_AUTHORITY_DEADLINE_MS;
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    sources,
    async assess(corridor, signal) {
      const at = now();
      const outcomes = await Promise.all(sources.map(async (source) => ({
        info: source.info,
        snapshot: signal.aborted ? unavailable("The plan was cancelled.") : await withDeadline(source, corridor, signal, deadlineMs),
      })));
      return createAssessment(at, outcomes);
    },
  };
}
