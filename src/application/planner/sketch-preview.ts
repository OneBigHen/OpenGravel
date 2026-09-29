/**
 * Snap-as-you-go (04 §19, OGV-D-285).
 *
 * When the rider lifts a finger mid-drawing, the strokes so far are planned as
 * if they were the ride's sketch, so the route snaps onto the roads while the pen
 * is still armed. Nothing is authored: the preview plans a copy of the ride's
 * intent with the draft as its sketch, the ride document is untouched, and
 * only `Done` commits.
 *
 * A preview answer is recognised by the planning generation it ran under. It
 * is shown only while the pen is armed and can never be ridden: the ride does
 * not contain the drawing until `Done`.
 */

import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { GeometryRef } from "@/domain/ride/ids";
import type { Coordinate, RideDocument, RideIntent, SketchIntent } from "@/domain/ride/types";
import type { SketchEndpointPolicy } from "@/domain/sketch/types";
import type { RouteBundle } from "@/domain/route/types";
import { buildSketchDraft, sketchTraceIssue } from "./sketch-authoring";

/** How long the pen rests after a lift before the draft is snapped. */
export const SKETCH_PREVIEW_SETTLE_MS = 700;

/** Why a preview route cannot be started. */
export const SKETCH_PREVIEW_RIDE_REFUSAL = "Tap Done to keep your drawing before you ride it.";

/** A preview intent and the payloads it minted, so they can be removed later. */
export interface SketchPreview {
  readonly intent: RideIntent;
  readonly geometryRefs: readonly GeometryRef[];
}

/**
 * The ride's intent with the draft as its sketch, or `null` when the draft is
 * not a sketch yet. Stores the strokes and the corridor so the planner can
 * resolve them exactly as it resolves a committed sketch.
 */
export async function previewSketchIntent(input: {
  readonly document: RideDocument;
  readonly strokes: readonly (readonly Coordinate[])[];
  readonly endpointPolicy: SketchEndpointPolicy;
  readonly geometryStore: GeometryStore;
}): Promise<SketchPreview | null> {
  if (sketchTraceIssue(input.strokes) !== null) return null;
  const draft = buildSketchDraft(input.strokes, input.endpointPolicy);
  if (draft === null) return null;
  const refs: GeometryRef[] = [];
  for (const stroke of draft.strokes) {
    const record = await input.geometryStore.put(
      { kind: "line", coordinates: [...stroke] },
      { kind: "sketch-stroke" },
    );
    refs.push(record.geometryRef);
  }
  const corridor = await input.geometryStore.put(
    { kind: "line", coordinates: [...draft.corridor] },
    { kind: "sketch-corridor" },
  );
  const sketch: SketchIntent = {
    ...draft.intent,
    rawStrokeRefs: refs.slice(),
    corridorRef: corridor.geometryRef,
  };
  return {
    intent: { ...input.document.intent, sketch },
    geometryRefs: [...refs, corridor.geometryRef],
  };
}

/** Whether a bundle is a snap-as-you-go preview. */
export function isSketchPreviewBundle(
  bundle: Pick<RouteBundle, "planningGeneration"> | null,
  previewGenerations: readonly number[],
): boolean {
  return bundle !== null && previewGenerations.includes(bundle.planningGeneration);
}
