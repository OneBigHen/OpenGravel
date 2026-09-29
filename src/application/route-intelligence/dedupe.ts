/**
 * One event, one contribution (§9, §15 "duplicate RCRS/WZDx events contribute
 * once"). Two sources describing the same closure or work zone (same kind of
 * event, the same place, overlapping time) collapse to the record from the
 * source with the better precedence: the road owner's own feed first.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

import type { RoadAuthorityRecord } from "./types";

const SAME_PLACE_METERS = 60;

const EVENT_KINDS: ReadonlySet<RoadAuthorityRecord["kind"]> = new Set([
  "closure",
  "restriction",
  "work-zone",
  "incident",
  "winter-condition",
]);

function anchor(record: RoadAuthorityRecord): readonly Coordinate[] {
  return record.geometry.type === "point"
    ? [record.geometry.coordinate]
    : [record.geometry.coordinates[0]!, record.geometry.coordinates.at(-1)!];
}

function timesOverlap(left: RoadAuthorityRecord, right: RoadAuthorityRecord): boolean {
  const leftStart = left.validFrom === null ? Number.NEGATIVE_INFINITY : Date.parse(left.validFrom);
  const leftEnd = left.validUntil === null ? Number.POSITIVE_INFINITY : Date.parse(left.validUntil);
  const rightStart = right.validFrom === null ? Number.NEGATIVE_INFINITY : Date.parse(right.validFrom);
  const rightEnd = right.validUntil === null ? Number.POSITIVE_INFINITY : Date.parse(right.validUntil);
  return leftStart < rightEnd && rightStart < leftEnd;
}

function samePlace(left: RoadAuthorityRecord, right: RoadAuthorityRecord): boolean {
  const leftPoints = anchor(left);
  const rightPoints = anchor(right);
  return leftPoints.some((point) => rightPoints.some((other) => haversine(point, other) <= SAME_PLACE_METERS));
}

function sameEvent(left: RoadAuthorityRecord, right: RoadAuthorityRecord): boolean {
  const closureLike = (record: RoadAuthorityRecord): boolean => record.kind === "closure" || record.allLanesClosed === true;
  const kindsAgree = left.kind === right.kind || (closureLike(left) && closureLike(right));
  return kindsAgree && samePlace(left, right) && timesOverlap(left, right);
}

/**
 * Keeps one record per event. `precedenceOf(sourceId)` is lower-is-better;
 * designations are legal facts, not events, and always pass through.
 */
export function dedupeRecords(
  records: readonly RoadAuthorityRecord[],
  precedenceOf: (sourceId: string) => number,
): readonly RoadAuthorityRecord[] {
  const ordered = [...records].sort((left, right) => precedenceOf(left.sourceId) - precedenceOf(right.sourceId));
  const kept: RoadAuthorityRecord[] = [];
  for (const record of ordered) {
    if (!EVENT_KINDS.has(record.kind)) {
      kept.push(record);
      continue;
    }
    const duplicate = kept.some((other) =>
      other.sourceId !== record.sourceId && EVENT_KINDS.has(other.kind) && sameEvent(other, record),
    );
    if (!duplicate) kept.push(record);
  }
  return kept;
}
