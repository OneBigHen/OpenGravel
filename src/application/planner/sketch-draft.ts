/**
 * The drawing draft: the strokes a rider has drawn but not committed
 * (04 §19, 05 §18; Task 4.4).
 *
 * This module is the sketch's analogue of `avoid-area-draft.ts` and
 * `road-span-draft.ts`: pure state transitions over presentation state that the
 * workspace owns, with **no domain object and no command** in sight. A pointer
 * down begins a stroke, a pointer move appends a position, a pointer up finishes
 * it, and only `Done` turns the accumulated trace into authored ride state.
 *
 * Three rules make the draft behave the way the product needs:
 *
 * - **A gesture is a stroke, a tap is not.** A gesture that never produced two
 *   positions is dropped rather than stored as a zero-length line, so a stray
 *   tap while the tool is armed cannot become a stroke.
 * - **Sampling is bounded on the hot path.** A position within
 *   {@link MIN_SKETCH_POINT_SPACING_METERS} of the previous one is ignored, which
 *   is what a free-hand pointer stream produces by the dozen — the renderer only
 *   redraws when the finger has actually travelled (05 §18).
 * - **Undo crosses strokes, not vertices.** 04 §19's Undo step is "the last vertex
 *   batch", and one gesture *is* a batch: Undo removes the last stroke whole and
 *   Redo restores it, so the two controls are exact inverses.
 */

import type { Coordinate } from "@/domain/ride/types";
import type { PreviewSketchScene } from "@/application/map/types";
import { haversine } from "@/domain/geometry/analysis";

/** Two sampled positions closer than this are one position. */
export const MIN_SKETCH_POINT_SPACING_METERS = 2;

/** The least positions a finished stroke needs to be a stroke. */
export const MIN_SKETCH_STROKE_POINTS = 2;

/**
 * The draft's whole state. `undone` is a stack of whole strokes, so Redo can put
 * back exactly what Undo removed; any new stroke clears it (the same "a new edit
 * cuts redo" rule the ride document's own history follows).
 */
export interface SketchDraftState {
  /** Finished strokes, in authoring order. */
  readonly strokes: readonly (readonly Coordinate[])[];
  /** The stroke under the pointer, or `null` between gestures. */
  readonly active: readonly Coordinate[] | null;
  readonly undone: readonly (readonly Coordinate[])[];
}

/** The resting draft: nothing drawn, nothing undone. */
export const EMPTY_SKETCH_DRAFT: SketchDraftState = {
  strokes: [],
  active: null,
  undone: [],
};

function copy(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

function isUsable(coordinate: Coordinate): boolean {
  return Number.isFinite(coordinate.lon) && Number.isFinite(coordinate.lat);
}

/** A new stroke starts: the previous one is finished if it was still open. */
export function beginSketchStroke(
  draft: SketchDraftState,
  coordinate: Coordinate,
): SketchDraftState {
  if (!isUsable(coordinate)) return draft;
  const finished = finishSketchStroke(draft);
  return { strokes: finished.strokes, active: [copy(coordinate)], undone: [] };
}

/** One pointer position from the drag, or the draft unchanged when it is noise. */
export function appendSketchPoint(
  draft: SketchDraftState,
  coordinate: Coordinate,
): SketchDraftState {
  const active = draft.active;
  if (active === null || !isUsable(coordinate)) return draft;
  const last = active[active.length - 1];
  if (last !== undefined && haversine(last, coordinate) < MIN_SKETCH_POINT_SPACING_METERS) {
    return draft;
  }
  return { ...draft, active: [...active, copy(coordinate)] };
}

/**
 * The release. A stroke with two or more positions becomes one; anything shorter
 * is dropped, because a tap is not a stroke and a one-position line is not a line.
 * `undone` is cleared by a finished stroke: it is a new edit.
 */
export function finishSketchStroke(
  draft: SketchDraftState,
  release?: Coordinate,
): SketchDraftState {
  const appended =
    release === undefined ? draft : appendSketchPoint(draft, release);
  const active = appended.active;
  if (active === null) return appended;
  if (active.length < MIN_SKETCH_STROKE_POINTS) {
    return { strokes: appended.strokes, active: null, undone: appended.undone };
  }
  return { strokes: [...appended.strokes, active], active: null, undone: [] };
}

/**
 * Escape (04 §19): the stroke in flight is dropped and every stroke already drawn
 * stays. Cancelling the whole drawing is `Clear`, a different action.
 */
export function cancelSketchStroke(draft: SketchDraftState): SketchDraftState {
  if (draft.active === null) return draft;
  return { ...draft, active: null };
}

/**
 * Undo: the last vertex batch. An open stroke is the batch being drawn, so it goes
 * first; otherwise the last finished stroke moves to the redo stack.
 */
export function undoSketchedStroke(draft: SketchDraftState): SketchDraftState {
  if (draft.active !== null) return { ...draft, active: null };
  const last = draft.strokes[draft.strokes.length - 1];
  if (last === undefined) return draft;
  return {
    strokes: draft.strokes.slice(0, -1),
    active: null,
    undone: [...draft.undone, last],
  };
}

/** Redo: restores the stroke the last Undo removed, or nothing. */
export function redoSketchStroke(draft: SketchDraftState): SketchDraftState {
  const last = draft.undone[draft.undone.length - 1];
  if (last === undefined) return draft;
  return {
    strokes: [...draft.strokes, last],
    active: draft.active,
    undone: draft.undone.slice(0, -1),
  };
}

/** Clear: the drawing surface is empty again. */
export function clearSketchDraft(): SketchDraftState {
  return EMPTY_SKETCH_DRAFT;
}

/** How many strokes the draft would commit, including the open one. */
export function sketchDraftStrokeCount(draft: SketchDraftState): number {
  return draft.strokes.length + (draft.active === null ? 0 : 1);
}

/** How many positions the draft has sampled, including the open stroke's. */
export function sketchDraftVertexCount(draft: SketchDraftState): number {
  const finished = draft.strokes.reduce((total, stroke) => total + stroke.length, 0);
  return finished + (draft.active?.length ?? 0);
}

/** True when the draft has nothing to commit and nothing to undo. */
export function sketchDraftIsEmpty(draft: SketchDraftState): boolean {
  return draft.strokes.length === 0 && draft.active === null;
}

/** The strokes a commit would carry: the finished ones plus a usable open stroke. */
export function sketchDraftStrokes(
  draft: SketchDraftState,
): readonly (readonly Coordinate[])[] {
  if (draft.active === null || draft.active.length < MIN_SKETCH_STROKE_POINTS) {
    return draft.strokes;
  }
  return [...draft.strokes, draft.active];
}

/** True when the draft can be committed as a sketch at all. */
export function sketchDraftCanCommit(draft: SketchDraftState): boolean {
  return sketchDraftStrokes(draft).length > 0;
}

/** The scene member the renderer draws this draft from (05 §18). */
export function sketchDraftPreview(draft: SketchDraftState): PreviewSketchScene | null {
  if (sketchDraftIsEmpty(draft)) return null;
  return {
    strokes: draft.strokes.map((stroke) => stroke.map(copy)),
    active: draft.active === null ? null : draft.active.map(copy),
  };
}
