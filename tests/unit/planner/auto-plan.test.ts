/**
 * When the planner plans by itself (04-PLANNER-AND-WORKSPACE-UX §8, §21).
 *
 * The rule is "a pick that completes a ride asks the router immediately". These
 * tests pin the triggers *and* the silences, because each silence is a case where
 * planning by itself would be wrong: a reload is not an authoring act, a loop is
 * the rider's tap, a half-authored ride has nothing to ask for, and a swap is an
 * edit the settle window already answers.
 */

import { describe, expect, it } from "vitest";

import {
  autoPlanEndpointKey,
  autoPlanSnapshot,
  autoPlanTrigger,
  type AutoPlanSnapshot,
} from "@/application/planner/auto-plan";
import type { Coordinate } from "@/domain/ride/types";

const ORIGIN: Coordinate = { lon: -75.2, lat: 39.95 };
const DESTINATION: Coordinate = { lon: -74.8, lat: 40.2 };

function point(id: string, coordinate: Coordinate): { id: string; coordinate: Coordinate } {
  return { id, coordinate };
}

function snapshot(overrides: Partial<{
  start: ReturnType<typeof point> | null;
  finish: ReturnType<typeof point> | null;
  shape: AutoPlanSnapshot["shape"];
  plannable: boolean;
}> = {}): AutoPlanSnapshot {
  return autoPlanSnapshot({
    start: overrides.start ?? null,
    finish: overrides.finish ?? null,
    shape: overrides.shape ?? "destination",
    plannable: overrides.plannable ?? false,
  });
}

const START = point("pt_start", ORIGIN);
const FINISH = point("pt_finish", DESTINATION);

describe("autoPlanTrigger — a pick plans at once", () => {
  it("plans the moment a destination completes the ride", () => {
    // A start is already authored; the destination is the pick.
    const before = snapshot({ start: START, plannable: false });
    const after = snapshot({ start: START, finish: FINISH, plannable: true });
    expect(autoPlanTrigger(before, after)).toBe("endpoint-picked");
  });

  it("plans when a start completes a ride that already has a destination", () => {
    const before = snapshot({ finish: FINISH, plannable: false });
    const after = snapshot({ start: START, finish: FINISH, plannable: true });
    expect(autoPlanTrigger(before, after)).toBe("endpoint-picked");
  });

  it("plans a changed destination on a ride that already has an answer", () => {
    const before = snapshot({ start: START, finish: FINISH, plannable: true });
    const after = snapshot({
      start: START,
      finish: point("pt_finish", { lon: -74.9, lat: 40.1 }),
      plannable: true,
    });
    expect(autoPlanTrigger(before, after)).toBe("endpoint-picked");
  });

  it("plans once for the pair: the first half of an empty ride asks nothing", () => {
    const empty = snapshot();
    const half = snapshot({ start: START, plannable: false });
    expect(autoPlanTrigger(empty, half)).toBeNull();
  });
});

describe("autoPlanTrigger — the silences", () => {
  it("never plans on the first observation (mount, or a restored draft)", () => {
    // A reload brings back a complete ride. Nothing has changed while the rider
    // watched, so nothing plans: the restore rule that asks once is separate and
    // unchanged.
    expect(autoPlanTrigger(null, snapshot({ start: START, finish: FINISH, plannable: true }))).toBeNull();
  });

  it("never plans while the ride is still missing a point", () => {
    const before = snapshot({ start: START, plannable: false });
    const moved = snapshot({ start: point("pt_start", { lon: -75.1, lat: 40 }), plannable: false });
    expect(autoPlanTrigger(before, moved)).toBeNull();
  });

  it("never plans a loop: its shape and ride time are the rider's tap", () => {
    const before = snapshot({ shape: "loop", start: START, plannable: true });
    const after = snapshot({
      shape: "loop",
      start: point("pt_start", { lon: -75.1, lat: 40 }),
      plannable: true,
    });
    expect(autoPlanTrigger(before, after)).toBeNull();
  });

  it("never plans a swap, which the settle window answers once the rider stops", () => {
    const before = snapshot({ start: START, finish: FINISH, plannable: true });
    const after = snapshot({ start: FINISH, finish: START, plannable: true });
    expect(autoPlanTrigger(before, after)).toBeNull();
  });

  it("never plans a change that is not an endpoint — typing or a style tap", () => {
    // Typing in a search field and tapping a style control are both *not* a pick:
    // the first authors nothing, and the second is a revision the answer
    // lifecycle replans after its settle window.
    const before = snapshot({ start: START, finish: FINISH, plannable: true });
    expect(autoPlanTrigger(before, before)).toBeNull();
  });

  it("never plans an undo that clears the ride", () => {
    const before = snapshot({ start: START, finish: FINISH, plannable: true });
    expect(autoPlanTrigger(before, snapshot())).toBeNull();
  });
});

describe("autoPlanEndpointKey", () => {
  it("separates an empty end, a placed end, and the same end moved", () => {
    expect(autoPlanEndpointKey(null)).toBeNull();
    expect(autoPlanEndpointKey(START)).not.toBe(autoPlanEndpointKey(point("pt_start", { lon: -75.1, lat: 40 })));
    // The identity travels with the key, so a swap of two existing points reads as
    // a change of both ends rather than of one.
    expect(autoPlanEndpointKey(START)).toBe(autoPlanEndpointKey(point("pt_start", ORIGIN)));
  });
});
