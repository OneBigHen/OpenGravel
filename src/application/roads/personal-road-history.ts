/**
 * Local personal-road-history evidence.
 *
 * This module deliberately knows nothing about accounts or a server. A caller
 * supplies previously saved ride traces from local storage and receives an
 * estimated novelty measurement for a candidate geometry. The same evidence can
 * feed Planner, Free Ride, post-ride summaries and map styling without uploading
 * the rider's history.
 */

import { unknownEvidence, type EvidenceSource, type EvidenceValue } from "@/domain/evidence/types";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { LibraryExploreRide } from "@/application/library/library-service";
import { indexRoute, type RouteIndex } from "./route-overlap";

export const PERSONAL_HISTORY_MATCH_TOLERANCE_METERS = 35;
export const PERSONAL_HISTORY_RECENT_DAYS = 30;

const PERSONAL_HISTORY_SOURCE: EvidenceSource = {
  id: "local-ride-history",
  label: "Your saved OpenGravel ride history",
  category: "rider",
  authoritativeFor: ["personal-history"],
};

export interface PersonalRideTrace {
  readonly geometry: readonly Coordinate[];
  /** End/save time of this trace when known. Invalid/absent stays non-recent. */
  readonly riddenAt?: string;
}

/** Only observed recordings can establish personal riding history. */
export function personalRideHistory(entries: readonly Pick<LibraryExploreRide, "geometry" | "riddenAt">[]): readonly PersonalRideTrace[] {
  return entries
    .filter((entry) => entry.riddenAt !== undefined && Number.isFinite(Date.parse(entry.riddenAt)) && validLine(entry.geometry))
    .map((entry) => ({ geometry: entry.geometry, ...(entry.riddenAt === undefined ? {} : { riddenAt: entry.riddenAt }) }));
}

export interface PersonalRoadHistoryAssessment {
  readonly totalMeters: number;
  readonly newMeters: number;
  readonly familiarMeters: number;
  readonly recentMeters: number;
  readonly newShare: number;
  readonly familiarShare: number;
  readonly recentShare: number;
}

interface IndexedTrace {
  readonly index: RouteIndex;
  readonly recent: boolean;
}

export interface PersonalRoadHistoryMatchOptions {
  readonly now?: string;
  readonly toleranceMeters?: number;
  readonly recentDays?: number;
}

/**
 * Read-only, prepared local-history evidence. Callers can reuse this matcher
 * for several candidate edges without rebuilding a spatial index per edge.
 */
export interface PreparedPersonalRoadHistory {
  readonly available: boolean;
  readonly edgeSeen: (from: Coordinate, to: Coordinate) => boolean;
  readonly recentEdgeSeen: (from: Coordinate, to: Coordinate) => boolean;
}

function validLine(line: readonly Coordinate[]): boolean {
  return line.length >= 2 && line.every((point) =>
    Number.isFinite(point.lon) && Math.abs(point.lon) <= 180 &&
    Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
  );
}

function recent(riddenAt: string | undefined, nowMs: number, recentDays: number): boolean {
  if (riddenAt === undefined) return false;
  const at = Date.parse(riddenAt);
  if (!Number.isFinite(at) || at > nowMs) return false;
  return nowMs - at <= recentDays * 86_400_000;
}

function segmentSeen(
  from: Coordinate,
  to: Coordinate,
  traces: readonly IndexedTrace[],
  toleranceMeters: number,
  recentOnly = false,
): { readonly familiar: boolean; readonly recent: boolean } {
  let familiar = false;
  let recently = false;
  for (const trace of traces) {
    // Requiring both ends to be near the same prior trace avoids counting a
    // simple junction crossing as "ridden".
    if (trace.index.probe(from) <= toleranceMeters && trace.index.probe(to) <= toleranceMeters) {
      familiar = true;
      if (trace.recent) recently = true;
      if (recently) break;
    }
  }
  return {
    familiar: recentOnly ? recently : familiar,
    recent: recently,
  };
}

/** Builds one reusable spatial matcher for local recorded-road evidence. */
export function preparePersonalRoadHistory(
  history: readonly PersonalRideTrace[],
  options: PersonalRoadHistoryMatchOptions = {},
): PreparedPersonalRoadHistory | null {
  const nowMs = Date.parse(options.now ?? new Date().toISOString());
  const toleranceMeters = options.toleranceMeters ?? PERSONAL_HISTORY_MATCH_TOLERANCE_METERS;
  const recentDays = options.recentDays ?? PERSONAL_HISTORY_RECENT_DAYS;
  if (!Number.isFinite(nowMs) || !Number.isFinite(toleranceMeters) || toleranceMeters <= 0 || !Number.isFinite(recentDays) || recentDays < 0) {
    return null;
  }

  const traces: IndexedTrace[] = history
    .filter((trace) => validLine(trace.geometry))
    .map((trace) => ({
      index: indexRoute(trace.geometry),
      recent: recent(trace.riddenAt, nowMs, recentDays),
    }));
  return {
    available: traces.length > 0,
    edgeSeen(from, to) {
      return segmentSeen(from, to, traces, toleranceMeters).familiar;
    },
    recentEdgeSeen(from, to) {
      return segmentSeen(from, to, traces, toleranceMeters, true).recent;
    },
  };
}

/**
 * Measures candidate-route distance against local saved ride traces.
 *
 * Returns null when either side has no usable geometry. No history is not
 * silently interpreted as "100% new": the app may simply not know the rider's
 * pre-OpenGravel history.
 */
export function assessPersonalRoadHistory(
  route: readonly Coordinate[],
  history: readonly PersonalRideTrace[],
  options: PersonalRoadHistoryMatchOptions = {},
): PersonalRoadHistoryAssessment | null {
  if (!validLine(route)) return null;
  const prepared = preparePersonalRoadHistory(history, options);
  if (prepared === null || !prepared.available) return null;

  let totalMeters = 0;
  let familiarMeters = 0;
  let recentMeters = 0;
  for (let index = 0; index + 1 < route.length; index += 1) {
    const from = route[index];
    const to = route[index + 1];
    if (from === undefined || to === undefined) continue;
    const meters = haversine(from, to);
    if (!Number.isFinite(meters) || meters <= 0) continue;
    totalMeters += meters;
    if (prepared.edgeSeen(from, to)) familiarMeters += meters;
    if (prepared.recentEdgeSeen(from, to)) recentMeters += meters;
  }
  if (!(totalMeters > 0)) return null;

  const newMeters = Math.max(0, totalMeters - familiarMeters);
  return {
    totalMeters,
    newMeters,
    familiarMeters,
    recentMeters,
    newShare: newMeters / totalMeters,
    familiarShare: familiarMeters / totalMeters,
    recentShare: recentMeters / totalMeters,
  };
}

/** Numeric evidence shape the existing route scorer already consumes. */
export function personalNoveltyEvidence(
  route: readonly Coordinate[],
  history: readonly PersonalRideTrace[],
  options: Parameters<typeof assessPersonalRoadHistory>[2] = {},
): EvidenceValue<number> {
  const assessment = assessPersonalRoadHistory(route, history, options);
  if (assessment === null) {
    return unknownEvidence("Saved ride history is not sufficient to estimate road familiarity.");
  }
  return {
    value: Number(assessment.newShare.toFixed(4)),
    status: "estimated",
    confidence: 0.7,
    coverage: 1,
    provenance: [PERSONAL_HISTORY_SOURCE],
  };
}
