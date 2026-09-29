/**
 * Stop insertion and stop ordering (04-PLANNER-AND-WORKSPACE-UX §15).
 *
 * 04 §15 gives every object "reorder" and the stop list "add stop", and 03 §27
 * makes each of those exactly one history unit. Which neighbour a gesture aims at
 * is therefore a decision with a right answer, not a detail of a component's
 * render: it lives here, pure, so a list button and a future drag-to-reorder
 * affordance share one rule and a test can pin it.
 *
 * The command's `beforeStopId` is the *insert-before* anchor the reducer expects
 * (`stop.insert`, `stop.reorder`). `undefined` means "at the end", which is both
 * the append case and the last-position case of a move down.
 */

import { describe, expect, it } from "vitest";

import {
  canMoveStopDown,
  canMoveStopUp,
  moveDownBeforeId,
  moveUpBeforeId,
  nextStopInsertionBeforeId,
} from "@/application/planner/stop-insertion";
import { newStopId, type StopId } from "@/domain/ride/ids";
import type { Coordinate, StopPoint } from "@/domain/ride/types";

const COORD: Coordinate = { lon: -75.4, lat: 40.1 };

function stop(label: string): StopPoint {
  return {
    id: newStopId(),
    kind: "stop",
    coordinate: COORD,
    label,
    provenance: { type: "map", selectedAt: "2026-09-17T00:00:00.000Z" },
  };
}

function labels(stops: readonly StopPoint[]): readonly string[] {
  return stops.map((entry) => entry.label ?? "");
}

/** Applies the reducer's own insert-before semantics, for the rule's assertion. */
function withInserted(
  stops: readonly StopPoint[],
  inserted: StopPoint,
  beforeStopId: StopId | undefined,
): readonly StopPoint[] {
  if (beforeStopId === undefined) return [...stops, inserted];
  const index = stops.findIndex((entry) => entry.id === beforeStopId);
  return [...stops.slice(0, index), inserted, ...stops.slice(index)];
}

/** Applies the reducer's own reorder semantics. */
function reordered(
  stops: readonly StopPoint[],
  stopId: StopId,
  beforeStopId: StopId | undefined,
): readonly StopPoint[] {
  const target = stops.find((entry) => entry.id === stopId);
  if (target === undefined) throw new Error("the fixture stop must exist");
  const others = stops.filter((entry) => entry.id !== stopId);
  if (beforeStopId === undefined) return [...others, target];
  const index = others.findIndex((entry) => entry.id === beforeStopId);
  return [...others.slice(0, index), target, ...others.slice(index)];
}

describe("nextStopInsertionBeforeId", () => {
  it("appends when nothing is selected", () => {
    const [a, b] = [stop("A"), stop("B")];
    expect(nextStopInsertionBeforeId([a, b], null)).toBeUndefined();
    expect(nextStopInsertionBeforeId([a, b], undefined)).toBeUndefined();
    expect(nextStopInsertionBeforeId([], null)).toBeUndefined();
  });

  it("inserts directly after the selected stop", () => {
    const [a, b, c] = [stop("A"), stop("B"), stop("C")];
    const stops = [a, b, c];
    if (a === undefined || b === undefined || c === undefined) throw new Error("fixture");
    // After A means before B.
    expect(nextStopInsertionBeforeId(stops, a.id)).toBe(b.id);
    // After the middle stop means before the last one.
    expect(nextStopInsertionBeforeId(stops, b.id)).toBe(c.id);
  });

  it("appends when the selected stop is the last one", () => {
    const [a, b] = [stop("A"), stop("B")];
    if (a === undefined || b === undefined) throw new Error("fixture");
    expect(nextStopInsertionBeforeId([a, b], b.id)).toBeUndefined();
  });

  it("appends when the selected stop no longer exists", () => {
    const [a] = [stop("A")];
    if (a === undefined) throw new Error("fixture");
    // A stale selection (a removed stop, a stale render) must never fail: the
    // rule falls back to the append every rider can predict.
    expect(nextStopInsertionBeforeId([a], newStopId())).toBeUndefined();
  });

  it("lands the new stop after the selected one in a three-stop ride", () => {
    const [a, b, c] = [stop("A"), stop("B"), stop("C")];
    if (a === undefined || b === undefined || c === undefined) throw new Error("fixture");
    const stops = [a, b, c];
    const inserted = stop("New");
    const result = withInserted(stops, inserted, nextStopInsertionBeforeId(stops, a.id));
    expect(labels(result)).toEqual(["A", "New", "B", "C"]);
  });
});

describe("move up / move down anchors", () => {
  it("aims a move up at the previous stop", () => {
    const [a, b, c] = [stop("A"), stop("B"), stop("C")];
    if (a === undefined || b === undefined || c === undefined) throw new Error("fixture");
    const stops = [a, b, c];
    expect(moveUpBeforeId(stops, 2)).toBe(b.id);
    const result = reordered(stops, c.id, moveUpBeforeId(stops, 2));
    expect(labels(result)).toEqual(["A", "C", "B"]);
  });

  it("aims a move down at the stop after the next one", () => {
    const [a, b, c] = [stop("A"), stop("B"), stop("C")];
    if (a === undefined || b === undefined || c === undefined) throw new Error("fixture");
    const stops = [a, b, c];
    // Moving the first one down puts it between B and C, i.e. before C.
    expect(moveDownBeforeId(stops, 0)).toBe(c.id);
    expect(labels(reordered(stops, a.id, moveDownBeforeId(stops, 0)))).toEqual([
      "B",
      "A",
      "C",
    ]);
  });

  it("appends when a stop at the second-to-last position moves down", () => {
    const [a, b] = [stop("A"), stop("B")];
    if (a === undefined || b === undefined) throw new Error("fixture");
    const stops = [a, b];
    expect(moveDownBeforeId(stops, 0)).toBeUndefined();
    expect(labels(reordered(stops, a.id, moveDownBeforeId(stops, 0)))).toEqual(["B", "A"]);
  });

  it("reports the ends truthfully, so the buttons can be disabled", () => {
    expect(canMoveStopUp(0)).toBe(false);
    expect(canMoveStopUp(1)).toBe(true);
    expect(canMoveStopDown(0, 1)).toBe(false);
    expect(canMoveStopDown(0, 2)).toBe(true);
    expect(canMoveStopDown(1, 3)).toBe(true);
    expect(canMoveStopDown(2, 3)).toBe(false);
    // A single stop cannot move anywhere.
    expect(canMoveStopDown(0, 1)).toBe(false);
    expect(canMoveStopUp(0)).toBe(false);
  });
});
