/**
 * Road-span status against the committed route (04-PLANNER-AND-WORKSPACE-UX §17,
 * 05-MAP-INTERACTION-AND-CARTOGRAPHY §20, 03-DOMAIN-MODEL §17).
 *
 * The inspector's whole job is honesty, so this module is a thin, pure adapter:
 * it resolves each authored span's stored line and hands the resolved span plus
 * the **returned** route to Task 4.3a's engine (`domain/road/spans.ts`). It
 * measures nothing itself and it decides nothing itself.
 *
 * Three consequences are deliberate:
 *
 * - a span whose stored line did not resolve reads `unavailable`, never a
 *   fabricated `conflict` and never a fabricated pass — "we cannot measure" is
 *   not "no" (03 §17);
 * - a committed route with no usable geometry makes every span `unavailable` for
 *   the same reason, rather than reporting a route-shaped verdict against a line
 *   that does not exist;
 * - the rows stay in author order, so the panel and the undo list agree about
 *   which span is which.
 */

import {
  evaluateRoadSpans,
  type ResolvedRoadSpan,
  type RoadSpanMode,
  type SpanDirection,
  type SpanSatisfaction,
} from "@/domain/road/spans";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { GeometryRef, RoadSpanId } from "@/domain/ride/ids";
import type { Coordinate, RoadSpanConstraint } from "@/domain/ride/types";

/** One span's measured row, exactly as the inspector renders it. */
export interface RoadSpanStatusRow {
  readonly id: RoadSpanId;
  readonly mode: RoadSpanMode;
  readonly direction: SpanDirection;
  readonly status: SpanSatisfaction;
  /** False when the stored line did not resolve or is not a usable line. */
  readonly geometryResolved: boolean;
  readonly coveredMeters: number;
  readonly totalMeters: number;
  /** Diagnostics for a non-satisfied verdict; never rider copy. */
  readonly note: string | null;
}

export interface RoadSpanStatusInput {
  readonly spans: readonly RoadSpanConstraint[];
  /** The committed candidate's returned line; empty when nothing was returned. */
  readonly routeGeometry: readonly Coordinate[];
  /** The surface's geometry reader: the store, injected like every other read. */
  readonly readGeometry: (ref: GeometryRef) => GeometryPayload | null;
}

/** The four verdicts as rider copy (04 §17). */
export const ROAD_SPAN_STATUS_LABELS: Readonly<Record<SpanSatisfaction, string>> = {
  satisfied: "Satisfied",
  "partially-satisfied": "Partially satisfied",
  conflict: "Conflict",
  unavailable: "Unavailable",
};

/**
 * The sentence a failed required span carries. 04 §17's copy for a span the
 * returned route does not honor; it names the road, never an engine detail or a
 * matching tolerance.
 */
export const ROAD_SPAN_CONFLICT_COPY = "Route does not satisfy this road";

/** Copy for a span that could not be checked at all (03 §17, 06 §19). */
export const ROAD_SPAN_UNAVAILABLE_COPY =
  "This road span could not be checked against the current route";

/**
 * True for a row the inspector marks as a problem: a required span that is not
 * satisfied, or an avoided span the route entered. A `prefer` span never warns —
 * it shapes ranking, never legality (03 §17).
 */
export function roadSpanStatusIsWarning(row: RoadSpanStatusRow): boolean {
  if (row.mode === "must") {
    return row.status === "conflict" || row.status === "unavailable";
  }
  return row.mode === "avoid" && row.status === "conflict";
}

/** The line one stored handle resolves to, or `null` when it is not a line. */
function resolvedLine(
  ref: GeometryRef,
  readGeometry: RoadSpanStatusInput["readGeometry"],
): readonly Coordinate[] | null {
  const payload = readGeometry(ref);
  if (payload === null || payload.kind !== "line") return null;
  return payload.coordinates;
}

/** The span as the domain engine measures it, with its resolved or missing line. */
function toResolved(
  span: RoadSpanConstraint,
  readGeometry: RoadSpanStatusInput["readGeometry"],
): ResolvedRoadSpan {
  const line = resolvedLine(span.geometryRef, readGeometry);
  return {
    id: span.id,
    mode: span.mode,
    direction: span.direction,
    anchorRefs: span.anchorRefs,
    geometry: line ?? [],
  };
}

/**
 * Measures every authored span against one returned route. Pure with respect to
 * the document: it reads geometry through the injected reader and mutates
 * nothing.
 */
export function buildRoadSpanStatusRows(
  input: RoadSpanStatusInput,
): readonly RoadSpanStatusRow[] {
  const resolved = input.spans.map((span) => toResolved(span, input.readGeometry));
  const evaluations = evaluateRoadSpans(resolved, { geometry: input.routeGeometry });
  return resolved.map((span, index) => {
    const evaluation = evaluations[index];
    return {
      id: span.id,
      mode: span.mode,
      direction: span.direction,
      status: evaluation?.status ?? "unavailable",
      geometryResolved: span.geometry.length >= 2,
      coveredMeters: evaluation?.coveredMeters ?? 0,
      totalMeters: evaluation?.totalMeters ?? 0,
      note: evaluation?.note ?? null,
    };
  });
}
