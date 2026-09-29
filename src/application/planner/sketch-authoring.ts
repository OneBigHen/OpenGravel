/**
 * Authoring a sketch: the one place a drawing becomes authored ride state
 * (03-DOMAIN-MODEL §13/§27, 04 §19–§20, 06 §18; Task 4.4).
 *
 * A sketch is an authored object whose *bytes* live in the GeometryStore and whose
 * *identity* lives in the ride document, exactly like an avoid area or a road span
 * (OGV-D-234). The order is not negotiable:
 *
 * ```text
 * validate the trace ─► build the corridor ─► store.put (raw strokes + corridor)
 *   ─► ONE sketch.commit command ─► dispatch
 * ```
 *
 * Three rules are why this module exists rather than a few lines in the workspace:
 *
 * 1. **One gesture, one command, one undo unit** (03 §27, 04 §20). A commit is
 *    exactly one `sketch.commit`, so "Undo · Drew route" removes the whole
 *    sketch — the trace, the corridor and every hint — in one step. There is no
 *    path here that dispatches twice, and the commit never authors `start.set` or
 *    `finish.set`: a derived endpoint travels *inside* the sketch's own endpoint
 *    policy, which is what keeps the undo unit whole (OGV-D-249).
 * 2. **Raw strokes are preserved** (04 §19). Every stroke is stored as its own
 *    `sketch-stroke` payload and referenced from `rawStrokeRefs`, so a retry
 *    re-derives the corridor and the endpoints from the original geographic trace
 *    rather than from screen pixels that were re-unprojected against a camera that
 *    has since moved.
 * 3. **The authoring path reclaims its own orphan.** The trace is validated
 *    *before* the first write, so an unusable drawing costs no payload; and when
 *    the command does not apply (a stale revision, a duplicated id) every ref this
 *    call minted is removed, because a payload nothing references is an
 *    unreclaimable byte cost hidden behind "the command failed". A *previous* ref
 *    is never removed: undo restores the document that names it.
 */

import type { GeometryStore } from "@/application/geometry/geometry-store";
import { buildSketchCorridor } from "@/application/planner/sketch-corridor";
import type { GeometryRef, SketchId } from "@/domain/ride/ids";
import { newCommandId, newSketchId } from "@/domain/ride/ids";
import type { RideCommand, RideCommandResult } from "@/domain/ride/commands";
import type { Coordinate, RideDocument, SketchIntent } from "@/domain/ride/types";
import type { SketchEndpointPolicy } from "@/domain/sketch/types";
import {
  MAX_SKETCH_STROKES,
  MAX_SKETCH_STROKE_POINTS,
  MAX_SKETCH_TOPOLOGY_HINTS,
} from "@/domain/sketch/types";

export type CommitSketchCommand = Extract<RideCommand, { type: "sketch.commit" }>;
export type ClearSketchCommand = Extract<RideCommand, { type: "sketch.clear" }>;

/** The history label a commit leaves (04 §20's undo vocabulary). */
export const SKETCH_COMMIT_LABEL = "Drew route";

/** The history label clearing a sketch leaves. */
export const SKETCH_CLEAR_LABEL = "Cleared sketch";

/** The one authoring source a drawing has (03 §25). */
const SOURCE = "drawing";

/** What an authoring attempt produced. */
export type SketchAuthoringResult =
  | {
      readonly outcome: "applied";
      readonly document: RideDocument;
      readonly sketchId: SketchId;
      readonly geometryRefs: readonly GeometryRef[];
      readonly label: string;
    }
  | { readonly outcome: "rejected"; readonly message: string }
  | { readonly outcome: "invalid"; readonly code: string; readonly message: string }
  | { readonly outcome: "stale"; readonly currentRevision: number };

export interface AuthorSketchInput {
  readonly document: RideDocument;
  /**
   * The raw strokes, in authoring order. Each one is a continuous pointer
   * gesture; the builder decides how they join.
   */
  readonly strokes: readonly (readonly Coordinate[])[];
  readonly endpointPolicy: SketchEndpointPolicy;
  readonly geometryStore: GeometryStore;
  /** The document store's one mutation entry; the caller owns the container. */
  readonly dispatch: (command: RideCommand) => RideCommandResult;
  readonly label?: string;
  readonly now?: () => string;
}

function copy(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

function isFiniteCoordinate(coordinate: Coordinate | undefined): coordinate is Coordinate {
  return (
    coordinate !== undefined &&
    Number.isFinite(coordinate.lon) &&
    Number.isFinite(coordinate.lat)
  );
}

/**
 * Why a trace cannot become a sketch, or `null` when it can.
 *
 * Checked before the first write, so a refused drawing never costs a payload. The
 * bounds are the product's, not the store's: a sketch that holds more strokes, or
 * more points in one stroke, than a rider can deliberately draw is treated as a
 * stuck pointer rather than as an intent.
 */
export function sketchTraceIssue(
  strokes: readonly (readonly Coordinate[])[],
): string | null {
  if (strokes.length === 0) return "Draw at least one stroke before committing a sketch.";
  if (strokes.length > MAX_SKETCH_STROKES) {
    return `A sketch holds at most ${MAX_SKETCH_STROKES} strokes.`;
  }
  for (let index = 0; index < strokes.length; index += 1) {
    const stroke = strokes[index];
    if (stroke === undefined || stroke.filter(isFiniteCoordinate).length < 2) {
      return "Every stroke needs at least two points before it can be a sketch.";
    }
    if (stroke.length > MAX_SKETCH_STROKE_POINTS) {
      return `A stroke holds at most ${MAX_SKETCH_STROKE_POINTS} points.`;
    }
  }
  return null;
}

/** One command plus the refs it would carry, before anything is written. */
interface SketchDraft {
  readonly strokes: readonly (readonly Coordinate[])[];
  readonly intent: Omit<SketchIntent, "rawStrokeRefs" | "corridorRef">;
  readonly corridor: readonly Coordinate[];
}

/**
 * Builds the derived half of the sketch: the corridor, its segments' hints and the
 * endpoint policy. Pure — nothing is written and nothing is dispatched here.
 */
export function buildSketchDraft(
  strokes: readonly (readonly Coordinate[])[],
  endpointPolicy: SketchEndpointPolicy,
): SketchDraft | null {
  const drawn = strokes
    .filter((stroke) => stroke.length >= 2)
    .map((stroke) => stroke.map(copy));
  if (drawn.length === 0) return null;
  const corridor = buildSketchCorridor(drawn);
  if (corridor.corridor.length < 2) return null;
  return {
    strokes: drawn,
    corridor: corridor.corridor,
    intent: {
      id: newSketchId(),
      topologyHints: corridor.topologyHints.slice(0, MAX_SKETCH_TOPOLOGY_HINTS),
      endpointPolicy,
    },
  };
}

/** The label a commit leaves, or the caller's own. */
function commitLabel(label: string | undefined): string {
  return label ?? SKETCH_COMMIT_LABEL;
}

/**
 * Stores the raw trace and the corridor, then dispatches exactly one
 * `sketch.commit`.
 *
 * The validation and the derivation both run before the first write, so a refused
 * drawing writes nothing at all, and the writing is sequential on purpose: each
 * payload is recorded so a failed command can reclaim exactly what this call
 * minted.
 */
export async function authorSketch(
  input: AuthorSketchInput,
): Promise<SketchAuthoringResult> {
  const issue = sketchTraceIssue(input.strokes);
  if (issue !== null) return { outcome: "rejected", message: issue };

  const draft = buildSketchDraft(input.strokes, input.endpointPolicy);
  if (draft === null) {
    return {
      outcome: "rejected",
      message: "A sketch needs a drawn line with at least two points.",
    };
  }

  const written: GeometryRef[] = [];
  const now = input.now;
  const putOptions = (kind: "sketch-stroke" | "sketch-corridor"): {
    readonly kind: "sketch-stroke" | "sketch-corridor";
    readonly now?: string;
  } => (now === undefined ? { kind } : { kind, now: now() });

  const strokeRefs: GeometryRef[] = [];
  for (const stroke of draft.strokes) {
    const record = await input.geometryStore.put(
      { kind: "line", coordinates: stroke.map(copy) },
      putOptions("sketch-stroke"),
    );
    strokeRefs.push(record.geometryRef);
    written.push(record.geometryRef);
  }
  const corridorRecord = await input.geometryStore.put(
    { kind: "line", coordinates: draft.corridor.map(copy) },
    putOptions("sketch-corridor"),
  );
  written.push(corridorRecord.geometryRef);

  const sketch: SketchIntent = {
    ...draft.intent,
    rawStrokeRefs: strokeRefs,
    corridorRef: corridorRecord.geometryRef,
  };
  const command: CommitSketchCommand = {
    commandId: newCommandId(),
    rideId: input.document.rideId,
    baseRevision: input.document.revision,
    source: SOURCE,
    label: commitLabel(input.label),
    type: "sketch.commit",
    sketch,
  };
  const result = input.dispatch(command);
  if (result.outcome === "applied") {
    return {
      outcome: "applied",
      document: result.document,
      sketchId: sketch.id,
      geometryRefs: written,
      label: command.label,
    };
  }

  // The command did not apply, so nothing references the payloads this call just
  // minted. Removing them is the difference between "the command failed" and "the
  // command failed and left bytes behind".
  for (const ref of written) {
    await input.geometryStore.remove(ref);
  }
  if (result.outcome === "stale") {
    return { outcome: "stale", currentRevision: result.currentRevision };
  }
  if (result.outcome === "invalid") {
    return { outcome: "invalid", code: result.code, message: result.message };
  }
  return { outcome: "invalid", code: "noop", message: "the sketch was not stored" };
}

/** `sketch.clear` — one command, one undo unit. */
export function clearSketchCommand(document: RideDocument): ClearSketchCommand {
  return {
    commandId: newCommandId(),
    rideId: document.rideId,
    baseRevision: document.revision,
    source: SOURCE,
    label: SKETCH_CLEAR_LABEL,
    type: "sketch.clear",
  };
}
