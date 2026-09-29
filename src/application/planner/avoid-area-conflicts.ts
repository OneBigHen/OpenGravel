/**
 * Endpoint-in-avoid-area conflicts (04-PLANNER-AND-WORKSPACE-UX §18, 03-DOMAIN-MODEL §11).
 *
 * An avoid area the rider authored and a required point the rider placed can
 * contradict each other: the plan cannot pass through the area, and it cannot
 * skip a stop. 04 §18 names the answer — **no silent connector** — and this
 * module is the half of it that decides *whether* the contradiction exists.
 *
 * It is pure, total and read-only: it answers with the conflicts it found and
 * never moves a point, drops an area, or picks the area over the point. The three
 * explicit actions (move the endpoint, edit the area, remove the area) belong to
 * the surface, because only the rider knows which of the two objects they meant.
 *
 * ## Determinism
 *
 * Areas are visited in authored order and, within one area, the required points
 * in itinerary order (start, then the stops, then the finish). The same document
 * and the same geometry therefore always produce the same conflict list in the
 * same order, which is what lets the panel be a stable list rather than a
 * reshuffling one (03 §19).
 *
 * ## Which points are "required"
 *
 * Start, finish and stops — the points the route must serve. Shaping anchors are
 * deliberately excluded (and cannot be expressed: the endpoint union has no
 * variant for them): an anchor is a hint about *how* to get somewhere, so
 * treating it as a hard requirement would invent a constraint the rider never
 * authored.
 */

import { pointInRings } from "./avoid-area-geometry";
import type { AvoidAreaId, PointId, StopId } from "@/domain/ride/ids";
import type { Coordinate, RideIntent } from "@/domain/ride/types";

/** The required point an area can contain. */
export interface AvoidAreaConflictEndpoint {
  readonly kind: "start" | "finish" | "stop";
  readonly id: PointId | StopId;
}

/** One required point inside one enabled area. */
export interface AvoidAreaConflict {
  readonly areaId: AvoidAreaId;
  readonly endpoint: AvoidAreaConflictEndpoint;
}

export interface AvoidAreaConflictInput {
  readonly intent: RideIntent;
  /**
   * Each enabled area's resolved rings. An area whose handle did not resolve is
   * absent, and absence is never a conflict: nothing can be *inside* a ring that
   * does not exist, and `buildProviderRequest` reports the unresolved ref
   * separately rather than pretending the area was honored.
   */
  readonly ringsByAreaId: ReadonlyMap<AvoidAreaId, readonly (readonly Coordinate[])[]>;
}

/** A required point with the coordinate the containment test reads. */
interface RequiredPoint {
  readonly kind: AvoidAreaConflictEndpoint["kind"];
  readonly id: PointId | StopId;
  readonly coordinate: Coordinate;
}

/** Every required point of the ride, in itinerary order. */
function requiredPoints(intent: RideIntent): readonly RequiredPoint[] {
  const points: RequiredPoint[] = [];
  if (intent.start !== null) {
    points.push({ kind: "start", id: intent.start.id, coordinate: intent.start.coordinate });
  }
  for (const stop of intent.stops) {
    points.push({ kind: "stop", id: stop.id, coordinate: stop.coordinate });
  }
  if (intent.finish !== null) {
    points.push({ kind: "finish", id: intent.finish.id, coordinate: intent.finish.coordinate });
  }
  return points;
}

/**
 * Every conflict in the ride, deterministically ordered.
 *
 * A point inside two areas is two conflicts, because they are two separate
 * authored objects the rider can remove or edit independently — collapsing them
 * would hide one of the choices.
 */
export function detectAvoidAreaConflicts(
  input: AvoidAreaConflictInput,
): readonly AvoidAreaConflict[] {
  const points = requiredPoints(input.intent);
  if (points.length === 0) return [];

  const conflicts: AvoidAreaConflict[] = [];
  for (const area of input.intent.avoidAreas) {
    if (!area.enabled) continue;
    const rings = input.ringsByAreaId.get(area.id);
    if (rings === undefined || rings.length === 0) continue;
    for (const point of points) {
      if (!pointInRings(point.coordinate, rings)) continue;
      conflicts.push({
        areaId: area.id,
        endpoint: { kind: point.kind, id: point.id },
      });
    }
  }
  return conflicts;
}

/** The rider-facing sentence for one conflict (04 §18's non-blocking notice). */
export function avoidAreaConflictMessage(): string {
  return "Route cannot pass through this area";
}
