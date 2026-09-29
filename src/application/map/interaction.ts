/**
 * The pointer interaction state machine (05-MAP-INTERACTION-AND-CARTOGRAPHY §4).
 *
 * Exactly one pointer tool owns interaction, and this module is the single
 * authority that says which one and what a release means. It is a pure reducer:
 * a host feeds it pointer events and the workspace feeds it the non-pointer ones
 * (tool change, ride-revision change, Escape), and it answers with the next
 * state plus the *effects* the caller may act on.
 *
 * Three decisions are deliberate, and they are the ones the product rules in
 * 05 §4 exist for:
 *
 * - **A release has exactly one outcome.** A pan press that never moved is a tap;
 *   a pan drag is nothing (a camera gesture is not a placement click); a drawing
 *   gesture that moved commits; a drawing gesture that never moved is nothing.
 *   No path produces two effects, so a commit can never also fire a background
 *   click.
 * - **Only the owning pointer ends a gesture.** A release from a different
 *   pointer id is ignored, and a release with no pointer-down at all emits
 *   nothing: the machine never invents a click out of a stray `pointerup`.
 * - **Cancellation is explicit and silent.** Cancel, lost capture, Escape, a tool
 *   change and a ride-revision change all drop the in-flight gesture without a
 *   commit — an incomplete gesture must not be guessed at.
 *
 * The gesture buffer is deliberately two points. The state machine's job is
 * pointer *ownership*; a tool that needs the full path samples it itself (the
 * sketch and sculpt waves own their stroke buffers), and an unbounded buffer in
 * a reducer that every pointer move re-enters is exactly the kind of hidden
 * growth 05 §18 warns about.
 */

import type { Coordinate } from "@/domain/ride/types";

/** The pointer tools of 05 §4. `pan` is the neutral, non-drawing tool. */
export type PointerTool =
  | "pan"
  | "point-drag"
  | "route-sculpt"
  | "sketch"
  | "avoid-area"
  | "road-span-select"
  | "polygon-edit";

/**
 * The one threshold that separates a tap from a drag, in **CSS pixels**.
 *
 * 05 §4 requires the machine to tell "the rider tapped" from "the rider dragged"
 * and 04 §15/§31 make a tap author a point, so the unit matters: geography is the
 * wrong one (two positions can round to the same coordinate and still be a
 * deliberate drag; a two-degree camera move makes one pixel a kilometre), and a
 * per-axis test is the wrong shape (a 6px-by-6px tremor is 8.5px of travel, not
 * two small numbers). Client CSS pixels and the straight-line distance are the
 * honest pair.
 *
 * The value follows the platforms' own touch slop: Android's
 * `ViewConfiguration.getScaledTouchSlop()` is 8dp and iOS gesture recognizers
 * begin at roughly 10pt. Ten is the larger of the two documented values, so a
 * tremor that either platform's own controls would have forgiven can never be
 * re-read as a drag — which is what keeps a tap on a 44×44 target (12 §10)
 * reliable on a phone, in a glove, on a bar mount.
 */
export const TAP_DRAG_THRESHOLD_PX = 10;

/** A pointer position in CSS pixels, as the DOM reports it. */
export interface PointerPixel {
  readonly x: number;
  readonly y: number;
}

/** The straight-line distance between two pointer positions, in CSS pixels. */
export function pixelDistance(a: PointerPixel, b: PointerPixel): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** True when a gesture travelled far enough to be a drag (05 §4). */
export function exceedsTapThreshold(
  origin: PointerPixel,
  current: PointerPixel,
): boolean {
  return pixelDistance(origin, current) >= TAP_DRAG_THRESHOLD_PX;
}

/** Declaration order, and the order the tool pickers present. */
export const POINTER_TOOLS: readonly PointerTool[] = [
  "pan",
  "point-drag",
  "route-sculpt",
  "sketch",
  "avoid-area",
  "road-span-select",
  "polygon-edit",
];

/** True for the tools that draw or move something, i.e. everything but `pan`. */
export function isDrawingTool(tool: PointerTool): boolean {
  return tool !== "pan";
}

/** The gesture in flight. Non-null means this pointer id owns the pointer. */
export interface PointerOwnership {
  readonly tool: PointerTool;
  readonly pointerId: number;
  readonly origin: Coordinate;
  readonly current: Coordinate;
  /** Where the press landed, in CSS pixels — the tap/drag threshold's origin. */
  readonly originPixel: PointerPixel;
  /** Where the pointer is now, in CSS pixels. */
  readonly currentPixel: PointerPixel;
  /**
   * True once the gesture has travelled past {@link TAP_DRAG_THRESHOLD_PX}: an
   * unmoved release is not a drag, and a tremor is not movement.
   */
  readonly moved: boolean;
}

/** Why a gesture ended without committing. */
export type CancelReason =
  | "pointer-cancel"
  | "lost-capture"
  | "escape"
  | "tool-change"
  | "route-revision-change";

export interface InteractionState {
  readonly activeTool: PointerTool;
  /** The pointer that owns the pointer stream, or `null` between gestures. */
  readonly ownership: PointerOwnership | null;
  /** Why the most recent transition cancelled a gesture; `null` otherwise. */
  readonly lastCancel: CancelReason | null;
  /** The ride revision the machine is bound to (05 §4, task 4.0). */
  readonly rideRevision: number;
}

export type InteractionEvent =
  | {
      readonly type: "pointer-down";
      readonly pointerId: number;
      readonly coordinate: Coordinate;
      readonly pixel: PointerPixel;
    }
  | {
      readonly type: "pointer-move";
      readonly pointerId: number;
      readonly coordinate: Coordinate;
      readonly pixel: PointerPixel;
    }
  | {
      readonly type: "pointer-up";
      readonly pointerId: number;
      readonly coordinate: Coordinate;
      readonly pixel: PointerPixel;
    }
  | { readonly type: "pointer-cancel"; readonly pointerId: number }
  | { readonly type: "lost-capture"; readonly pointerId: number }
  | { readonly type: "escape" }
  | { readonly type: "tool-change"; readonly tool: PointerTool }
  | { readonly type: "ride-revision-change"; readonly revision: number };

/**
 * What the caller may do as a result of one event.
 *
 * `tap` is the ambiguous click: the host hit-tests it and emits `map-click`,
 * `object-click` or `overlap-click`. `commit-gesture` is a completed drawing
 * gesture, with the two points the machine retained.
 */
export type InteractionEffect =
  | { readonly type: "tap"; readonly pointerId: number; readonly coordinate: Coordinate }
  | {
      readonly type: "commit-gesture";
      readonly tool: PointerTool;
      readonly pointerId: number;
      readonly geometry: readonly Coordinate[];
    };

export interface InteractionResult {
  readonly state: InteractionState;
  readonly effects: readonly InteractionEffect[];
}

/** The resting state: the neutral tool, nothing in flight. */
export function initialInteractionState(
  tool: PointerTool = "pan",
  rideRevision = 0,
): InteractionState {
  return { activeTool: tool, ownership: null, lastCancel: null, rideRevision };
}

/** True while a drawing tool owns the pointer, i.e. while a stream is running. */
export function gestureControlsPointer(state: InteractionState): boolean {
  return state.ownership !== null && isDrawingTool(state.ownership.tool);
}

function cancelled(state: InteractionState, reason: CancelReason): InteractionResult {
  return { state: { ...state, ownership: null, lastCancel: reason }, effects: [] };
}

function released(state: InteractionState): InteractionState {
  return { ...state, ownership: null };
}

/**
 * The gesture with its latest observation folded in: the release position and the
 * drag classification are recorded on the gesture itself, so exactly one place
 * decides whether the pointer travelled (05 §4).
 */
function observed(
  ownership: PointerOwnership,
  coordinate: Coordinate,
  pixel: PointerPixel,
): PointerOwnership {
  return {
    ...ownership,
    current: coordinate,
    currentPixel: pixel,
    // Sticky: once the pointer has travelled past the threshold the gesture is a
    // drag even if it comes back toward the press, because the camera has already
    // moved with it.
    moved: ownership.moved || exceedsTapThreshold(ownership.originPixel, pixel),
  };
}

/**
 * Ends the gesture: `pan` without a real drag is a tap, a drawing tool with a real
 * drag commits, and every other combination is nothing.
 *
 * The classification is the gesture's own `moved` (CSS-pixel displacement against
 * the documented threshold), never a comparison of the two geographic coordinates:
 * a release that rounds to the press's coordinate has still travelled, and the
 * geography can move under the pointer.
 */
function finishGesture(
  ownership: PointerOwnership,
  release: Coordinate,
  pointerId: number,
): readonly InteractionEffect[] {
  const { moved } = ownership;
  if (ownership.tool === "pan") {
    return moved ? [] : [{ type: "tap", pointerId, coordinate: release }];
  }
  if (!moved) return [];
  return [
    {
      type: "commit-gesture",
      tool: ownership.tool,
      pointerId,
      geometry: [ownership.origin, release],
    },
  ];
}

/**
 * One transition. Total: every event is accepted, and an event that cannot apply
 * (a second pointer, a foreign release) leaves the state untouched instead of
 * raising or guessing.
 */
export function reduceInteraction(
  state: InteractionState,
  event: InteractionEvent,
): InteractionResult {
  const ownership = state.ownership;

  switch (event.type) {
    case "pointer-down": {
      if (ownership !== null) return { state, effects: [] };
      return {
        state: {
          ...state,
          lastCancel: null,
          ownership: {
            tool: state.activeTool,
            pointerId: event.pointerId,
            origin: event.coordinate,
            current: event.coordinate,
            originPixel: event.pixel,
            currentPixel: event.pixel,
            moved: false,
          },
        },
        effects: [],
      };
    }

    case "pointer-move": {
      if (ownership === null || ownership.pointerId !== event.pointerId) {
        return { state, effects: [] };
      }
      return {
        state: {
          ...state,
          ownership: observed(ownership, event.coordinate, event.pixel),
        },
        effects: [],
      };
    }

    case "pointer-up": {
      if (ownership === null || ownership.pointerId !== event.pointerId) {
        return { state, effects: [] };
      }
      // The release is folded in first: a release that moved without ever firing a
      // `pointer-move` is still a drag (05 §4).
      const effects = finishGesture(
        observed(ownership, event.coordinate, event.pixel),
        event.coordinate,
        event.pointerId,
      );
      return { state: released(state), effects };
    }

    case "pointer-cancel": {
      if (ownership === null || ownership.pointerId !== event.pointerId) {
        return { state, effects: [] };
      }
      return cancelled(state, "pointer-cancel");
    }

    case "lost-capture": {
      if (ownership === null || ownership.pointerId !== event.pointerId) {
        return { state, effects: [] };
      }
      return cancelled(state, "lost-capture");
    }

    case "escape": {
      if (ownership !== null) return cancelled(state, "escape");
      if (state.activeTool === "pan") return { state, effects: [] };
      // No gesture to drop: Escape releases the armed tool, because a tool the
      // rider escaped from must not keep owning the next tap.
      return {
        state: { ...state, activeTool: "pan", lastCancel: "escape" },
        effects: [],
      };
    }

    case "tool-change": {
      if (state.activeTool === event.tool) return { state, effects: [] };
      if (ownership !== null) {
        return {
          state: {
            ...state,
            activeTool: event.tool,
            ownership: null,
            lastCancel: "tool-change",
          },
          effects: [],
        };
      }
      return {
        state: { ...state, activeTool: event.tool, lastCancel: null },
        effects: [],
      };
    }

    case "ride-revision-change": {
      if (event.revision === state.rideRevision) return { state, effects: [] };
      if (ownership !== null) {
        return {
          state: {
            ...state,
            rideRevision: event.revision,
            ownership: null,
            lastCancel: "route-revision-change",
          },
          effects: [],
        };
      }
      return {
        state: { ...state, rideRevision: event.revision, lastCancel: null },
        effects: [],
      };
    }
  }
}
