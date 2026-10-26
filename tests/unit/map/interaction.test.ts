/**
 * The pointer interaction state machine (05-MAP-INTERACTION-AND-CARTOGRAPHY §4).
 *
 * Four product rules are what this file exists for:
 *
 * - **Exactly one tool owns the pointer.** A second pointer-down while a gesture
 *   is in flight is ignored, and a pointer-up from a different pointer id does
 *   not end somebody else's gesture.
 * - **A release has exactly one outcome.** It either commits the gesture it was
 *   part of, or it is a tap, or it is nothing at all — never two of those.
 * - **An incomplete gesture cancels without committing.** Cancel, lost pointer
 *   capture, Escape, a tool change and a ride-revision change all drop the
 *   in-flight gesture, and none of them invents a commit.
 * - **A pan drag is not a click.** Dragging the map must never place a point,
 *   including when the rider is mid-placement (OGV-D-213).
 */

import { describe, expect, it } from "vitest";

import {
  POINTER_TOOLS,
  TAP_DRAG_THRESHOLD_PX,
  type InteractionEvent,
  type InteractionState,
  type PointerTool,
  initialInteractionState,
  reduceInteraction,
} from "@/application/map/interaction";

const DOWN: InteractionEvent = {
  type: "pointer-down",
  pointerId: 1,
  coordinate: { lon: -75.2, lat: 39.95 },
  pixel: { x: 100, y: 100 },
};

function apply(
  events: readonly InteractionEvent[],
  tool: PointerTool = "pan",
): InteractionState {
  return events.reduce<InteractionState>(
    (state, event) => reduceInteraction(state, event).state,
    initialInteractionState(tool, 7),
  );
}

function effects(events: readonly InteractionEvent[], tool: PointerTool = "pan") {
  return events.reduce<{ state: InteractionState; effects: readonly unknown[] }>(
    (acc, event) => {
      const result = reduceInteraction(acc.state, event);
      return { state: result.state, effects: [...acc.effects, ...result.effects] };
    },
    { state: initialInteractionState(tool, 7), effects: [] },
  );
}

const MOVE: InteractionEvent = {
  type: "pointer-move",
  pointerId: 1,
  coordinate: { lon: -75.1, lat: 39.96 },
  pixel: { x: 140, y: 150 },
};
const UP_AT_ORIGIN: InteractionEvent = {
  type: "pointer-up",
  pointerId: 1,
  coordinate: { lon: -75.2, lat: 39.95 },
  pixel: { x: 100, y: 100 },
};
const UP_AFTER_MOVE: InteractionEvent = {
  type: "pointer-up",
  pointerId: 1,
  coordinate: { lon: -75.1, lat: 39.96 },
  pixel: { x: 140, y: 150 },
};

const DRAWING_TOOLS = POINTER_TOOLS.filter((tool) => tool !== "pan");

describe("the pointer tool set", () => {
  it("is exactly the seven tools of 05 §4", () => {
    expect([...POINTER_TOOLS]).toEqual([
      "pan",
      "point-drag",
      "route-sculpt",
      "sketch",
      "avoid-area",
      "road-span-select",
      "polygon-edit",
    ]);
  });

  it("starts on pan with nothing in flight", () => {
    const state = initialInteractionState();
    expect(state.activeTool).toBe("pan");
    expect(state.ownership).toBeNull();
    expect(state.rideRevision).toBe(0);
  });
});

describe("one tool owns the pointer", () => {
  it("records the gesture under the active tool on pointer-down", () => {
    const { state, effects: out } = reduceInteraction(
      initialInteractionState("sketch", 1),
      DOWN,
    );

    expect(out).toEqual([]);
    expect(state.ownership).toEqual({
      tool: "sketch",
      pointerId: 1,
      origin: { lon: -75.2, lat: 39.95 },
      current: { lon: -75.2, lat: 39.95 },
      // The press records both the geography (for a committed geometry) and the
      // CSS pixel (for the tap/drag threshold, 05 §4).
      originPixel: { x: 100, y: 100 },
      currentPixel: { x: 100, y: 100 },
      moved: false,
    });
  });

  it("ignores a second pointer while one is already in flight", () => {
    const first = reduceInteraction(initialInteractionState("polygon-edit", 1), DOWN);
    const second = reduceInteraction(first.state, {
      type: "pointer-down",
      pointerId: 2,
      coordinate: { lon: -75.0, lat: 40.0 },
      pixel: { x: 400, y: 400 },
    });

    expect(second.effects).toEqual([]);
    expect(second.state.ownership?.pointerId).toBe(1);
    expect(second.state.ownership?.origin).toEqual({ lon: -75.2, lat: 39.95 });
  });

  it("does not end a gesture from another pointer's release", () => {
    const first = reduceInteraction(initialInteractionState("point-drag", 1), DOWN);
    const foreign = reduceInteraction(first.state, {
      type: "pointer-up",
      pointerId: 2,
      coordinate: { lon: -75.0, lat: 40.0 },
      pixel: { x: 400, y: 400 },
    });

    expect(foreign.effects).toEqual([]);
    expect(foreign.state.ownership?.pointerId).toBe(1);
  });

  it("ignores movement with no gesture in flight", () => {
    const result = reduceInteraction(initialInteractionState("sketch", 1), MOVE);
    expect(result.effects).toEqual([]);
    expect(result.state.ownership).toBeNull();
  });

  it("ignores a release that never had a pointer-down", () => {
    const result = reduceInteraction(initialInteractionState("pan", 1), UP_AT_ORIGIN);
    expect(result.effects).toEqual([]);
    expect(result.state.ownership).toBeNull();
  });
});

describe("a release has exactly one outcome", () => {
  it("turns an unmoved pan release into one tap", () => {
    const { effects: out, state } = effects([DOWN, UP_AT_ORIGIN]);

    expect(out).toEqual([
      { type: "tap", pointerId: 1, coordinate: { lon: -75.2, lat: 39.95 } },
    ]);
    expect(state.ownership).toBeNull();
  });

  it("never fires a tap for a pan drag", () => {
    // 05 §4: dragging the map is a camera gesture, not a placement click.
    const moved = effects([DOWN, MOVE, UP_AFTER_MOVE]);
    expect(moved.effects).toEqual([]);
    expect(moved.state.ownership).toBeNull();
  });

  it("treats any release position that differs from the press as movement", () => {
    // A drag that never fired a move event is still a drag: a release away from
    // the press must not place a point under the rider's finger.
    const { effects: out } = effects([DOWN, UP_AFTER_MOVE]);
    expect(out).toEqual([]);
  });

  it("records the release pixel when no move event arrived", () => {
    const released = apply([DOWN, UP_AFTER_MOVE]);
    // Nothing in flight afterwards, and the pixels are the ones the machine saw.
    expect(released.ownership).toBeNull();
    const moved = reduceInteraction(initialInteractionState("pan", 1), UP_AFTER_MOVE);
    expect(moved.state.ownership).toBeNull();
  });
});

/**
 * The threshold is what stops a finger tremor from swallowing a tap (05 §4).
 *
 * Geographic equality is *not* the test: two positions can round to the same
 * coordinate and still be a deliberate drag, and a two-degree camera move can
 * make two pixels two kilometres apart. Client CSS pixels are the only honest
 * unit for "did the rider move their finger", so displacement in those pixels is
 * what the machine measures.
 */
describe("tap vs drag is decided by CSS-pixel displacement (05 §4, §18)", () => {
  it("documents one threshold for every platform", () => {
    // Android's `ViewConfiguration` touch slop is 8dp and iOS gesture
    // recognizers begin at ~10pt; the constant is the larger of the two, so a
    // tremor either platform would forgive is never re-read as a drag.
    expect(TAP_DRAG_THRESHOLD_PX).toBe(10);
  });

  it("still turns a sub-threshold tremor into a pan tap", () => {
    // A 3px finger tremor over a 44px hit target (12 §10) is a tap.
    const tremor: InteractionEvent = {
      type: "pointer-move",
      pointerId: 1,
      coordinate: { lon: -75.2, lat: 39.95 },
      pixel: { x: 103, y: 102 },
    };
    const up: InteractionEvent = {
      type: "pointer-up",
      pointerId: 1,
      coordinate: { lon: -75.2, lat: 39.95 },
      pixel: { x: 103, y: 102 },
    };

    const { effects: out } = effects([DOWN, tremor, up]);

    expect(out).toEqual([
      { type: "tap", pointerId: 1, coordinate: { lon: -75.2, lat: 39.95 } },
    ]);
  });

  it("commits a drag whose geography rounds to the same coordinate", () => {
    // The renderer rounds to 1e-7 and the screen rounds to a pixel: a move that
    // reports the same coordinate must still count as movement when the pointer
    // travelled past the threshold — otherwise a same-pixel drawing gesture
    // commits and a same-coordinate pan tap fires.
    const move: InteractionEvent = {
      type: "pointer-move",
      pointerId: 1,
      coordinate: DOWN.coordinate,
      pixel: { x: 140, y: 150 },
    };
    const up: InteractionEvent = {
      type: "pointer-up",
      pointerId: 1,
      coordinate: DOWN.coordinate,
      pixel: { x: 140, y: 150 },
    };

    const dragged = effects([DOWN, move, up]);
    expect(dragged.effects).toEqual([]);

    const drawn = effects([DOWN, move, up], "point-drag");
    expect(drawn.effects).toEqual([
      {
        type: "commit-gesture",
        tool: "point-drag",
        pointerId: 1,
        geometry: [DOWN.coordinate, DOWN.coordinate],
      },
    ]);
  });

  it("measures a diagonal displacement as the straight-line distance", () => {
    // 6px right and 6px down is 8.49px: below the 10px threshold. 8px and 8px is
    // 11.3px: past it. A per-axis test would call both of them drags.
    const up = (pixel: { readonly x: number; readonly y: number }): InteractionEvent => ({
      type: "pointer-up",
      pointerId: 1,
      coordinate: DOWN.coordinate,
      pixel,
    });

    expect(effects([DOWN, up({ x: 106, y: 106 })]).effects).toEqual([
      { type: "tap", pointerId: 1, coordinate: DOWN.coordinate },
    ]);
    expect(effects([DOWN, up({ x: 108, y: 108 })]).effects).toEqual([]);
  });

  it("emits exactly one commit for every drawing tool", () => {
    for (const tool of DRAWING_TOOLS) {
      const { effects: out, state } = effects([DOWN, MOVE, UP_AFTER_MOVE], tool);
      expect(out, tool).toEqual([
        {
          type: "commit-gesture",
          tool,
          pointerId: 1,
          geometry: [
            { lon: -75.2, lat: 39.95 },
            { lon: -75.1, lat: 39.96 },
          ],
        },
      ]);
      expect(state.ownership, tool).toBeNull();
    }
  });

  it("cancels an unmoved drawing-tool release instead of committing", () => {
    for (const tool of DRAWING_TOOLS) {
      const { effects: out, state } = effects([DOWN, UP_AT_ORIGIN], tool);
      expect(out, tool).toEqual([]);
      expect(state.ownership, tool).toBeNull();
    }
  });

  it("never lets one release both commit a gesture and tap", () => {
    for (const tool of POINTER_TOOLS) {
      for (const up of [UP_AT_ORIGIN, UP_AFTER_MOVE]) {
        const { effects: out } = effects([DOWN, MOVE, up], tool);
        expect(out.length, `${tool}`).toBeLessThanOrEqual(1);
        if (out.length === 1) {
          expect(["tap", "commit-gesture"]).toContain(
            (out[0] as { type: string }).type,
          );
        }
      }
    }
  });

  it("does not allow a second release to commit anything", () => {
    const { effects: out } = effects(
      [DOWN, MOVE, UP_AFTER_MOVE, UP_AFTER_MOVE],
      "point-drag",
    );
    expect(out).toHaveLength(1);
  });
});

describe("an incomplete gesture cancels without commit", () => {
  it("cancels on pointer-cancel", () => {
    const cancelled = apply([
      DOWN,
      MOVE,
      { type: "pointer-cancel", pointerId: 1 },
    ]);

    expect(cancelled.ownership).toBeNull();
    expect(cancelled.lastCancel).toBe("pointer-cancel");
  });

  it("cancels on lost pointer capture", () => {
    const cancelled = apply([DOWN, MOVE, { type: "lost-capture", pointerId: 1 }]);
    expect(cancelled.ownership).toBeNull();
    expect(cancelled.lastCancel).toBe("lost-capture");
  });

  it("cancels on Escape and keeps the armed tool", () => {
    const cancelled = apply([DOWN, MOVE, { type: "escape" }], "avoid-area");
    expect(cancelled.ownership).toBeNull();
    expect(cancelled.lastCancel).toBe("escape");
    expect(cancelled.activeTool).toBe("avoid-area");
  });

  it("returns to pan on Escape with no gesture in flight", () => {
    const escaped = apply([{ type: "escape" }], "route-sculpt");
    expect(escaped.activeTool).toBe("pan");
    expect(escaped.lastCancel).toBe("escape");
  });

  it("cancels the gesture when the tool changes", () => {
    const changed = apply([DOWN, MOVE, { type: "tool-change", tool: "sketch" }]);

    expect(changed.activeTool).toBe("sketch");
    expect(changed.ownership).toBeNull();
    expect(changed.lastCancel).toBe("tool-change");
  });

  it("stays a drag when the pointer comes back to the press", () => {
    // A pan that travelled and returned is still a camera gesture: the ride the
    // rider dragged away from must not be re-read as a tap and author a point.
    // Movement past the threshold is therefore sticky for the gesture.
    const out: InteractionEvent = {
      type: "pointer-up",
      pointerId: 1,
      coordinate: DOWN.coordinate,
      pixel: { x: 100, y: 100 },
    };

    expect(effects([DOWN, MOVE, out]).effects).toEqual([]);
    expect(effects([DOWN, MOVE, out], "point-drag").effects).toEqual([
      {
        type: "commit-gesture",
        tool: "point-drag",
        pointerId: 1,
        geometry: [DOWN.coordinate, DOWN.coordinate],
      },
    ]);
  });

  it("does not report a cancel when the tool is re-selected", () => {
    const first = apply([DOWN, MOVE, { type: "tool-change", tool: "pan" }]);
    const again = apply(
      [{ type: "tool-change", tool: "pan" }],
      first.activeTool,
    );
    expect(again.lastCancel).toBeNull();
    expect(again.ownership).toBeNull();
  });

  it("cancels the gesture when the ride revision changes", () => {
    const changed = apply([
      DOWN,
      MOVE,
      { type: "ride-revision-change", revision: 9 },
    ]);

    expect(changed.ownership).toBeNull();
    expect(changed.lastCancel).toBe("route-revision-change");
    expect(changed.rideRevision).toBe(9);
  });

  it("keeps an in-flight gesture when the revision is unchanged", () => {
    const down = reduceInteraction(initialInteractionState("sketch", 7), DOWN);
    const same = reduceInteraction(down.state, {
      type: "ride-revision-change",
      revision: 7,
    });

    expect(same.effects).toEqual([]);
    expect(same.state.ownership?.pointerId).toBe(1);
    expect(same.state.lastCancel).toBeNull();
  });

  it("clears the recorded cancel reason on the next successful gesture", () => {
    const afterCancel = apply([DOWN, { type: "escape" }]);
    expect(afterCancel.lastCancel).toBe("escape");

    const nextDown = reduceInteraction(afterCancel, DOWN);
    expect(nextDown.state.ownership?.pointerId).toBe(1);
    expect(nextDown.state.lastCancel).toBeNull();
  });
});

describe("long press arbitration", () => {
  const hold: InteractionEvent = { type: "hold-timeout", pointerId: 1, elapsedMs: 450 };

  it("fires once at 450 ms, keeps the press coordinate, and consumes release", () => {
    expect(effects([DOWN, { ...hold, elapsedMs: 449 }]).effects).toEqual([]);
    const result = effects([DOWN, hold, hold, UP_AT_ORIGIN]);
    expect(result.effects).toEqual([{
      type: "long-press", coordinate: DOWN.coordinate, pixel: DOWN.pixel,
    }]);
  });

  it("never fires after a drag, even when the pointer returns", () => {
    expect(effects([DOWN, MOVE, { ...MOVE, pixel: DOWN.pixel }, hold, UP_AT_ORIGIN]).effects).toEqual([]);
  });
});


describe("long press cancellation paths", () => {
  const hold: InteractionEvent = { type: "hold-timeout", pointerId: 1, elapsedMs: 450 };
  const cancellations: InteractionEvent[] = [
    { type: "pointer-cancel", pointerId: 1 },
    { type: "lost-capture", pointerId: 1 },
    { type: "escape" },
    { type: "tool-change", tool: "sketch" },
    { type: "ride-revision-change", revision: 8 },
    { type: "long-press-enabled", enabled: false },
  ];
  it.each(cancellations)("never fires after $type", (cancel) => {
    expect(effects([DOWN, cancel, hold, UP_AT_ORIGIN, { type: "context-menu", coordinate: DOWN.coordinate, pixel: DOWN.pixel }]).effects).toEqual([]);
  });
  it.each(DRAWING_TOOLS)("never holds with %s armed", (tool) => {
    expect(effects([DOWN, hold, UP_AT_ORIGIN], tool).effects).toEqual([]);
  });
  it("allows a sub-threshold tremor, but cancels at exactly 10 px", () => {
    const move = { ...MOVE, pixel: { x: 109, y: 100 } };
    expect(effects([DOWN, move, hold]).effects).toHaveLength(1);
    expect(effects([DOWN, { ...move, pixel: { x: 110, y: 100 } }, hold, UP_AT_ORIGIN]).effects).toEqual([]);
  });
  it("consumes a pinch without either a hold or a release tap", () => {
    expect(effects([DOWN, { ...DOWN, pointerId: 2 }, hold, UP_AT_ORIGIN]).effects).toEqual([]);
  });
  it("ignores a foreign timeout and a timeout after release", () => {
    expect(effects([DOWN, { ...hold, pointerId: 2 }]).effects).toEqual([]);
    expect(effects([DOWN, UP_AT_ORIGIN, hold]).effects).toEqual([
      { type: "tap", pointerId: 1, coordinate: DOWN.coordinate },
    ]);
  });
  it("never holds while a placement is armed, even after enabling it again", () => {
    expect(effects([{ type: "long-press-enabled", enabled: false }, DOWN, hold]).effects).toEqual([]);
    expect(effects([DOWN, { type: "long-press-enabled", enabled: false }, { type: "long-press-enabled", enabled: true }, hold]).effects).toEqual([]);
  });
  it("routes right click through the same effect and respects tool and placement arbitration", () => {
    const context: InteractionEvent = { type: "context-menu", coordinate: DOWN.coordinate, pixel: DOWN.pixel };
    expect(effects([context]).effects).toEqual([{ type: "long-press", coordinate: DOWN.coordinate, pixel: DOWN.pixel }]);
    for (const tool of DRAWING_TOOLS) expect(effects([context], tool).effects).toEqual([]);
    expect(effects([{ type: "long-press-enabled", enabled: false }, context]).effects).toEqual([]);
    expect(effects([DOWN, MOVE, context]).effects).toEqual([]);
    expect(effects([DOWN, hold, context, UP_AT_ORIGIN]).effects).toHaveLength(1);
  });
});


it("keeps a pinch consumed until all fingers have lifted", () => {
  const hold: InteractionEvent = { type: "hold-timeout", pointerId: 3, elapsedMs: 450 };
  expect(effects([
    DOWN, { ...DOWN, pointerId: 2 }, UP_AT_ORIGIN,
    { ...DOWN, pointerId: 3 }, hold, { ...UP_AT_ORIGIN, pointerId: 2 },
    { ...UP_AT_ORIGIN, pointerId: 3 },
  ]).effects).toEqual([]);
  expect(effects([
    DOWN, { ...DOWN, pointerId: 2 }, UP_AT_ORIGIN, { ...UP_AT_ORIGIN, pointerId: 2 },
    { ...DOWN, pointerId: 3 }, hold,
  ]).effects).toHaveLength(1);
});


it("cancels a temporarily grabbed route on pinch without committing a stop", () => {
  const down = { ...DOWN, routePress: true };
  expect(effects([down, { ...DOWN, pointerId: 2 }, UP_AT_ORIGIN], "point-drag").effects).toEqual([]);
});


it("consumes right-button release and accepts a fresh right-click after cancellation", () => {
  const context: InteractionEvent = { type: "context-menu", coordinate: DOWN.coordinate, pixel: DOWN.pixel };
  expect(effects([{ ...DOWN, button: 2 }, UP_AT_ORIGIN]).effects).toEqual([]);
  expect(effects([DOWN, { type: "escape" }, UP_AT_ORIGIN, context]).effects).toEqual([]);
  expect(effects([DOWN, { type: "escape" }, UP_AT_ORIGIN, { ...DOWN, button: 2 }, UP_AT_ORIGIN, context]).effects).toEqual([
    { type: "long-press", coordinate: DOWN.coordinate, pixel: DOWN.pixel },
  ]);
  const down = reduceInteraction(initialInteractionState(), DOWN);
  expect(reduceInteraction(down.state, { type: "long-press-enabled", enabled: false }).state.lastCancel).toBe("placement-change");
});


describe("tap duration and pinch release safety", () => {
  it.each([350, 351, 400])("bounds a pan tap at %i ms", (elapsedMs) => {
    const result = effects([{ ...DOWN, timeMs: 100 }, { ...UP_AT_ORIGIN, timeMs: 100 + elapsedMs }]);
    expect(result.effects).toHaveLength(elapsedMs <= 350 ? 1 : 0);
  });

  it.each([true, false])("consumes a stationary pinch with owner lifting first: %s", (ownerFirst) => {
    const otherDown: InteractionEvent = { ...DOWN, pointerId: 2 };
    const otherUp: InteractionEvent = { ...UP_AT_ORIGIN, pointerId: 2 };
    const result = effects([DOWN, otherDown, ...(ownerFirst ? [UP_AT_ORIGIN, otherUp] : [otherUp, UP_AT_ORIGIN])]);
    expect(result.effects).toEqual([]);
    expect(result.state.activePointers).toEqual([]);
  });
});


describe("client-pixel gesture classification on an offset map", () => {
  it.each(["mouse", "pen", "touch"])("keeps %s taps, pan-and-return and point drags distinct", (pointerType) => {
    const down = { ...DOWN, pointerType, timeMs: 100, pixel: { x: 164, y: 196 } };
    const move = { ...MOVE, pixel: { x: 204, y: 246 } };
    const up = { ...UP_AT_ORIGIN, timeMs: 200, pixel: down.pixel };
    expect(effects([down, up]).effects).toEqual([{ type: "tap", pointerId: 1, coordinate: DOWN.coordinate }]);
    expect(effects([down, move, up]).effects).toEqual([]);
    expect(effects([down, up], "point-drag").effects).toEqual([]);
    expect(effects([down, move, up], "point-drag").effects).toEqual([{
      type: "commit-gesture", tool: "point-drag", pointerId: 1,
      geometry: [DOWN.coordinate, DOWN.coordinate],
    }]);
  });
});
