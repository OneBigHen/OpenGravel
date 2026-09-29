/**
 * A Free Ride opportunity's lifetime and words (FREE-RIDE-COPILOT §2, §5, §6).
 *
 * A live suggestion is found by a query, but it lives by the road: it stays up
 * until the rider takes it, passes its decision point, or it grows old. A
 * polling tick never erases it (FR-03). The copy is ear-first: one short
 * sentence, said once.
 */

import { isUsableEvidence } from "@/domain/evidence/types";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { formatManeuverDistance } from "@/application/ride-session/ride-focus-view-model";

import type { LiveSuggestionCandidate, LiveSuggestionEvidence } from "./live-suggestions";

/** An opportunity nobody took is gone after this long, even if never passed. */
export const OPPORTUNITY_TTL_MS = 5 * 60_000;

/** Within this of the decision point the rider is "at" it. */
const AT_DECISION_METERS = 40;

export interface ShownOpportunity {
  readonly suggestion: LiveSuggestionCandidate;
  readonly shownAt: string;
  /** Straight-line rider → decision distance when it was shown. */
  readonly straightMetersAtShow: number;
}

export type OpportunityProgress =
  | { readonly status: "active"; readonly distanceToDecisionMeters: number }
  | { readonly status: "expired"; readonly reason: "passed" | "ttl" };

export function showOpportunity(
  suggestion: LiveSuggestionCandidate,
  rider: Coordinate,
  at: string,
): ShownOpportunity {
  return { suggestion, shownAt: at, straightMetersAtShow: haversine(rider, suggestion.entry) };
}

function bearing(from: Coordinate, to: Coordinate): number {
  const startLat = from.lat * Math.PI / 180;
  const endLat = to.lat * Math.PI / 180;
  const deltaLon = (to.lon - from.lon) * Math.PI / 180;
  return (Math.atan2(
    Math.sin(deltaLon) * Math.cos(endLat),
    Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLon),
  ) * 180 / Math.PI + 360) % 360;
}

function angleBetween(left: number, right: number): number {
  return Math.abs(((left - right + 540) % 360) - 180);
}

/**
 * Where the rider stands against the decision point. The along-road distance
 * the query measured is scaled by how much of the straight-line gap is left,
 * which keeps "left in 0.7 mi" honest without re-routing every second.
 */
export function opportunityProgress(
  shown: ShownOpportunity,
  rider: Coordinate,
  headingDegrees: number | null,
  at: string,
): OpportunityProgress {
  const age = Date.parse(at) - Date.parse(shown.shownAt);
  if (Number.isFinite(age) && age > OPPORTUNITY_TTL_MS) return { status: "expired", reason: "ttl" };
  const straight = haversine(rider, shown.suggestion.entry);
  // Behind the rider and not right beside them: the turn has gone by.
  if (
    headingDegrees !== null && Number.isFinite(headingDegrees) && straight > AT_DECISION_METERS &&
    angleBetween(bearing(rider, shown.suggestion.entry), headingDegrees) > 100
  ) {
    return { status: "expired", reason: "passed" };
  }
  // Riding away from it by a clear margin: another road was chosen.
  if (straight > shown.straightMetersAtShow + 250) return { status: "expired", reason: "passed" };
  const scale = shown.straightMetersAtShow < 1 ? 0 : Math.min(1, straight / shown.straightMetersAtShow);
  return { status: "active", distanceToDecisionMeters: shown.suggestion.distanceToDecisionMeters * scale };
}

/** `left`, `right`, `slight left`… from the turn the rider would make. */
export function opportunityDirection(headingDeltaDegrees: number): string {
  const magnitude = Math.abs(headingDeltaDegrees);
  if (!Number.isFinite(magnitude) || magnitude < 20) return "ahead";
  const side = headingDeltaDegrees < 0 ? "left" : "right";
  return magnitude < 45 ? `slight ${side}` : side;
}

function strong(value: LiveSuggestionEvidence[keyof LiveSuggestionEvidence] | undefined): boolean {
  return value !== undefined && isUsableEvidence(value) && typeof value.value === "number" && value.value >= 0.6;
}

/** Why it is worth it, from evidence the route scorer already produced; unknown says nothing. */
export function opportunityReasons(suggestion: LiveSuggestionCandidate): readonly string[] {
  const evidence = suggestion.evidence;
  if (evidence === undefined) return [];
  const reasons: string[] = [];
  if (strong(evidence.roadCharacterFit)) reasons.push("Curvier");
  if (strong(evidence.surfaceFit)) reasons.push("More gravel");
  if (strong(evidence.novelty)) reasons.push("New to you");
  return reasons;
}

function spokenDistance(meters: number): string {
  if (meters >= 700 && meters < 900) return "half a mile";
  const formatted = formatManeuverDistance(meters);
  if (formatted === "now") return "now";
  return formatted
    .replace(/^1 mi$/, "1 mile")
    .replace(/ mi$/, " miles")
    .replace(/ ft$/, " feet");
}

/** "Oak Hollow Road, left in half a mile. Curvier, about 5 minutes." */
export function spokenOpportunity(suggestion: LiveSuggestionCandidate, distanceToDecisionMeters: number): string {
  const direction = opportunityDirection(suggestion.headingDeltaDegrees);
  const distance = spokenDistance(distanceToDecisionMeters);
  const where = distance === "now" ? `${direction} now` : `${direction} in ${distance}`;
  const details = [...opportunityReasons(suggestion)];
  if (suggestion.durationSeconds !== undefined && Number.isFinite(suggestion.durationSeconds)) {
    const minutes = Math.max(1, Math.round(suggestion.durationSeconds / 60));
    details.push(`about ${minutes} minute${minutes === 1 ? "" : "s"}`);
  }
  const spoken = details.map((detail, index) => (index === 0 ? detail : detail.charAt(0).toLowerCase() + detail.slice(1)));
  const tail = spoken.length === 0 ? "" : ` ${spoken.join(", ")}.`;
  return `${suggestion.label}, ${where}.${tail}`;
}
