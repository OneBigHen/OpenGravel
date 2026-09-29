import { describe, expect, it } from "vitest";

import {
  EMPTY_SKETCH_DRAFT,
  appendSketchPoint,
  beginSketchStroke,
  cancelSketchStroke,
  clearSketchDraft,
  finishSketchStroke,
  MIN_SKETCH_POINT_SPACING_METERS,
  redoSketchStroke,
  sketchDraftCanCommit,
  sketchDraftPreview,
  sketchDraftStrokeCount,
  sketchDraftStrokes,
  sketchDraftVertexCount,
  undoSketchedStroke,
} from "@/application/planner/sketch-draft";
import type { Coordinate } from "@/domain/ride/types";

/**
 * The drawing draft (04 §19, 05 §18).
 *
 * Pure transitions, so every rule the product states is asserted without a
 * renderer: one gesture is one stroke, a tap is not a stroke, Undo crosses whole
 * strokes, and Escape keeps what was already drawn.
 */

const A: Coordinate = { lon: -75.44, lat: 40.14 };
const B: Coordinate = { lon: -75.4395, lat: 40.14 };
const C: Coordinate = { lon: -75.439, lat: 40.1405 };

describe("sketchDraft — stroke lifecycle", () => {
  it("turns one gesture into exactly one stroke", () => {
    let draft = beginSketchStroke(EMPTY_SKETCH_DRAFT, A);
    draft = appendSketchPoint(draft, B);
    draft = appendSketchPoint(draft, C);
    expect(sketchDraftStrokeCount(draft)).toBe(1);

    draft = finishSketchStroke(draft);
    expect(draft.strokes).toHaveLength(1);
    expect(draft.strokes[0]).toEqual([A, B, C]);
    expect(draft.active).toBeNull();
  });

  it("appends the release position when it travelled", () => {
    let draft = beginSketchStroke(EMPTY_SKETCH_DRAFT, A);
    draft = appendSketchPoint(draft, B);
    draft = finishSketchStroke(draft, C);
    expect(draft.strokes[0]).toEqual([A, B, C]);
  });

  it("drops a tap: one position is not a stroke", () => {
    const draft = finishSketchStroke(beginSketchStroke(EMPTY_SKETCH_DRAFT, A));
    expect(draft.strokes).toEqual([]);
    expect(draft.active).toBeNull();
    expect(sketchDraftCanCommit(draft)).toBe(false);
  });

  it("ignores positions that have not travelled the spacing", () => {
    let draft = beginSketchStroke(EMPTY_SKETCH_DRAFT, A);
    // ~1 m away: below the spacing, so the draft does not grow.
    draft = appendSketchPoint(draft, { lon: A.lon + 0.00001, lat: A.lat });
    expect(draft.active).toHaveLength(1);
    const travelled: Coordinate = {
      lon: A.lon + MIN_SKETCH_POINT_SPACING_METERS / 80_000,
      lat: A.lat,
    };
    expect(appendSketchPoint(draft, travelled).active).toHaveLength(2);
  });

  it("ignores an append with no stroke in flight", () => {
    expect(appendSketchPoint(EMPTY_SKETCH_DRAFT, A)).toBe(EMPTY_SKETCH_DRAFT);
  });

  it("keeps every stroke in authoring order across gestures", () => {
    let draft = beginSketchStroke(EMPTY_SKETCH_DRAFT, A);
    draft = finishSketchStroke(appendSketchPoint(draft, B));
    draft = beginSketchStroke(draft, C);
    draft = finishSketchStroke(draft, { lon: C.lon, lat: C.lat + 0.002 });
    expect(draft.strokes).toHaveLength(2);
    expect(draft.strokes[0]?.[0]).toEqual(A);
    expect(draft.strokes[1]?.[0]).toEqual(C);
  });
});

describe("sketchDraft — Escape, Undo, Redo, Clear", () => {
  it("Escape cancels only the stroke in flight", () => {
    let draft = beginSketchStroke(EMPTY_SKETCH_DRAFT, A);
    draft = finishSketchStroke(appendSketchPoint(draft, B));
    draft = beginSketchStroke(draft, C);
    draft = appendSketchPoint(draft, { lon: C.lon, lat: C.lat + 0.002 });

    const cancelled = cancelSketchStroke(draft);
    expect(cancelled.strokes).toHaveLength(1);
    expect(cancelled.active).toBeNull();
    expect(sketchDraftCanCommit(cancelled)).toBe(true);
  });

  it("Undo removes the last stroke whole and Redo restores it", () => {
    let draft = beginSketchStroke(EMPTY_SKETCH_DRAFT, A);
    draft = finishSketchStroke(appendSketchPoint(draft, B));
    draft = beginSketchStroke(draft, C);
    draft = finishSketchStroke(draft, { lon: C.lon, lat: C.lat + 0.002 });

    const undone = undoSketchedStroke(draft);
    expect(undone.strokes).toHaveLength(1);
    expect(undone.undone).toHaveLength(1);

    const redone = redoSketchStroke(undone);
    expect(redone.strokes).toHaveLength(2);
    expect(redone.strokes[1]?.[0]).toEqual(C);
    expect(redone.undone).toEqual([]);
  });

  it("Undo with nothing drawn is the same draft", () => {
    expect(undoSketchedStroke(EMPTY_SKETCH_DRAFT)).toBe(EMPTY_SKETCH_DRAFT);
    expect(redoSketchStroke(EMPTY_SKETCH_DRAFT)).toBe(EMPTY_SKETCH_DRAFT);
  });

  it("Clear empties the surface, redo stack included", () => {
    let draft = beginSketchStroke(EMPTY_SKETCH_DRAFT, A);
    draft = finishSketchStroke(appendSketchPoint(draft, B));
    const undone = undoSketchedStroke(draft);
    expect(undone.undone).toHaveLength(1);

    const cleared = clearSketchDraft();
    expect(cleared.strokes).toEqual([]);
    expect(cleared.undone).toEqual([]);
    expect(redoSketchStroke(cleared)).toBe(cleared);
  });
});

describe("sketchDraft — preview and commit shape", () => {
  it("projects the finished strokes and the open one for the renderer", () => {
    let draft = beginSketchStroke(EMPTY_SKETCH_DRAFT, A);
    draft = finishSketchStroke(appendSketchPoint(draft, B));
    draft = beginSketchStroke(draft, C);
    draft = appendSketchPoint(draft, { lon: C.lon, lat: C.lat + 0.002 });

    const preview = sketchDraftPreview(draft);
    expect(preview?.strokes).toHaveLength(1);
    expect(preview?.active).toHaveLength(2);
    expect(sketchDraftVertexCount(draft)).toBe(4);
  });

  it("has no preview when nothing is drawn", () => {
    expect(sketchDraftPreview(EMPTY_SKETCH_DRAFT)).toBeNull();
  });

  it("commits the open stroke only when it is a line", () => {
    const open = beginSketchStroke(EMPTY_SKETCH_DRAFT, A);
    expect(sketchDraftStrokes(open)).toEqual([]);
    const drawn = appendSketchPoint(open, B);
    expect(sketchDraftStrokes(drawn)).toHaveLength(1);
    expect(sketchDraftStrokes(drawn)[0]).toEqual([A, B]);
  });
});
