/**
 * Authoring and editing road-span constraints (04-PLANNER-AND-WORKSPACE-UX §17,
 * §20; 02-ARCHITECTURE-CONTRACT §4–§5; 03-DOMAIN-MODEL §12).
 *
 * A road span is an authored object whose *bytes* live in the GeometryStore and
 * whose *identity* lives in the ride document, exactly like an avoid area. The
 * order is not negotiable:
 *
 * ```text
 * validate the line ──► geometryStore.put ──► command carrying the returned handle ──► dispatch
 * ```
 *
 * ## Why the handle cannot be minted here
 *
 * Only the GeometryStore mints a `GeometryRef` (OGV-D-146/OGV-D-161), and the
 * store has no in-place update: a new geometry value is a new handle.
 *
 * ## The orphan
 *
 * The two steps can fail between each other: the payload is written and the
 * reducer then refuses the command (a stale revision, a duplicated id). A payload
 * nothing references is not harmless — it is an unreclaimable byte cost hidden
 * behind "the command failed" — so this module **removes the ref it just minted**
 * whenever the command does not apply. It never removes a *previous* ref: undo
 * restores the document that names it.
 *
 * ## One gesture, one command, one undo unit
 *
 * Every function here dispatches **at most one** command (03 §27): a commit, a
 * mode flip, an explicit mode set and a removal are each exactly one command.
 * The three action-bar actions (`Keep` / `Prefer` / `Avoid`) differ only in the
 * mode the one `roadSpan.create` carries.
 */

import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { RideCommand, RideCommandResult } from "@/domain/ride/commands";
import {
  newCommandId,
  newRoadSpanId,
  type GeometryRef,
  type RoadSpanId,
} from "@/domain/ride/ids";
import type {
  CommandSource,
  Coordinate,
  RideDocument,
  RoadSpanConstraint,
} from "@/domain/ride/types";

import type { RoadSpanMode, SpanDirection } from "@/domain/road/spans";

export type CreateRoadSpanCommand = Extract<RideCommand, { type: "roadSpan.create" }>;
export type UpdateRoadSpanCommand = Extract<RideCommand, { type: "roadSpan.update" }>;
export type RemoveRoadSpanCommand = Extract<RideCommand, { type: "roadSpan.remove" }>;

const SOURCE: CommandSource = "map";

/**
 * The three action-bar actions (04 §17) and the history label each one leaves.
 *
 * The mode is the product decision; the label is what the undo list would cross,
 * so it reads as the action the rider took ("Kept this road") rather than as a
 * bare noun. The vocabulary deliberately never mentions a matching tolerance
 * (04 §17 forbids exposing one to the rider).
 */
export const ROAD_SPAN_ACTIONS: Readonly<
  Record<"keep" | "prefer" | "avoid", { readonly mode: RoadSpanMode; readonly label: string }>
> = {
  keep: { mode: "must", label: "Kept this road" },
  prefer: { mode: "prefer", label: "Preferred this road" },
  avoid: { mode: "avoid", label: "Avoided this road" },
};

/** Rider-facing mode names for the panel's chips (04 §17). */
export const ROAD_SPAN_MODE_LABELS: Readonly<Record<RoadSpanMode, string>> = {
  must: "Keep",
  prefer: "Prefer",
  avoid: "Avoid",
};

/** The label a new span of `mode` leaves in history. */
export function roadSpanCreateLabel(mode: RoadSpanMode): string {
  switch (mode) {
    case "must":
      return ROAD_SPAN_ACTIONS.keep.label;
    case "prefer":
      return ROAD_SPAN_ACTIONS.prefer.label;
    case "avoid":
      return ROAD_SPAN_ACTIONS.avoid.label;
  }
}

function base(
  document: RideDocument,
  label: string,
): {
  readonly commandId: ReturnType<typeof newCommandId>;
  readonly rideId: RideDocument["rideId"];
  readonly baseRevision: number;
  readonly source: CommandSource;
  readonly label: string;
} {
  return {
    commandId: newCommandId(),
    rideId: document.rideId,
    baseRevision: document.revision,
    source: SOURCE,
    label,
  };
}

/** The span the command addresses, or `null` when the document has no such span. */
export function roadSpanById(
  document: RideDocument,
  spanId: RoadSpanId,
): RoadSpanConstraint | null {
  return document.intent.roadSpans.find((span) => span.id === spanId) ?? null;
}

function isFiniteCoordinate(coordinate: Coordinate): boolean {
  return Number.isFinite(coordinate.lon) && Number.isFinite(coordinate.lat);
}

/**
 * Why a draft cannot become a stored span, or `null` when it can.
 *
 * The line needs two positions (a one-point line is not a road) and the anchors
 * need an entry and an exit; both are re-checked here because the reducer's own
 * coordinate validation is the last line of defence, not the first.
 */
function spanGeometryIssue(
  geometry: readonly Coordinate[],
  anchors: readonly Coordinate[],
): string | null {
  if (geometry.length < 2) {
    return "A road span needs a line with at least two points.";
  }
  if (!geometry.every(isFiniteCoordinate)) {
    return "A road span line has an unusable coordinate.";
  }
  if (anchors.length < 2) {
    return "A road span needs an entry and an exit anchor.";
  }
  if (!anchors.every(isFiniteCoordinate)) {
    return "A road span anchor is not a usable coordinate.";
  }
  return null;
}

/** What an authoring attempt produced. */
export type RoadSpanAuthoringResult =
  | {
      readonly outcome: "applied";
      readonly document: RideDocument;
      readonly spanId: RoadSpanId;
      readonly geometryRef: GeometryRef;
      /** The history label the dispatched command carried. */
      readonly label: string;
    }
  | { readonly outcome: "rejected"; readonly message: string }
  | { readonly outcome: "invalid"; readonly code: string; readonly message: string }
  | { readonly outcome: "stale"; readonly currentRevision: number };

export interface AuthorRoadSpanInput {
  readonly document: RideDocument;
  /** The snapped span line, in the draft's own order. */
  readonly geometry: readonly Coordinate[];
  /** Entry then exit, in the draft's own order. */
  readonly anchors: readonly Coordinate[];
  readonly direction: SpanDirection;
  readonly mode: RoadSpanMode;
  readonly geometryStore: GeometryStore;
  /** The document store's one mutation entry; the caller owns the container. */
  readonly dispatch: (command: RideCommand) => RideCommandResult;
  readonly label?: string;
  readonly now?: () => string;
}

/**
 * Writes the span line, then dispatches exactly one `roadSpan.create`, and
 * reclaims the ref if the command does not apply.
 *
 * The line is validated **before** the write, so an unusable selection costs no
 * payload at all.
 */
export async function authorRoadSpan(
  input: AuthorRoadSpanInput,
): Promise<RoadSpanAuthoringResult> {
  const issue = spanGeometryIssue(input.geometry, input.anchors);
  if (issue !== null) return { outcome: "rejected", message: issue };

  const record = await input.geometryStore.put(
    { kind: "line", coordinates: input.geometry.map(copy) },
    { kind: "road-span", ...(input.now === undefined ? {} : { now: input.now() }) },
  );
  const command: CreateRoadSpanCommand = {
    ...base(input.document, input.label ?? roadSpanCreateLabel(input.mode)),
    type: "roadSpan.create",
    span: {
      id: newRoadSpanId(),
      mode: input.mode,
      direction: input.direction,
      geometryRef: record.geometryRef,
      anchorRefs: input.anchors.map(copy),
    },
  };
  const result = input.dispatch(command);
  if (result.outcome === "applied") {
    return {
      outcome: "applied",
      document: result.document,
      spanId: command.span.id,
      geometryRef: record.geometryRef,
      label: command.label,
    };
  }
  // The command did not apply, so nothing references the payload this call just
  // minted. Removing it is the difference between "the command failed" and "the
  // command failed and left bytes behind".
  await input.geometryStore.remove(record.geometryRef);
  if (result.outcome === "invalid") {
    return { outcome: "invalid", code: result.code, message: result.message };
  }
  if (result.outcome === "stale") {
    return { outcome: "stale", currentRevision: result.currentRevision };
  }
  return { outcome: "invalid", code: "noop", message: "the road span was not stored" };
}

/**
 * `roadSpan.update` carrying an explicit mode — the three action-bar actions.
 * A span the document does not hold is a caller bug and is refused by the
 * reducer; this returns the command either way so the caller owns the dispatch.
 */
export function setRoadSpanModeCommand(
  document: RideDocument,
  spanId: RoadSpanId,
  mode: RoadSpanMode,
): UpdateRoadSpanCommand {
  return {
    ...base(document, roadSpanCreateLabel(mode)),
    type: "roadSpan.update",
    spanId,
    mode,
  };
}

/**
 * The Keep↔Prefer flip (04 §17), or `null` when it does not apply.
 *
 * `Avoid` is deliberately not flippable: it is the opposite instruction, not a
 * softer version of Keep, and silently turning "do not ride this" into "prefer
 * this" would be a mode change the rider did not ask for. A missing span has
 * nothing to flip.
 */
export function flipRoadSpanModeCommand(
  document: RideDocument,
  spanId: RoadSpanId,
): UpdateRoadSpanCommand | null {
  const span = roadSpanById(document, spanId);
  if (span === null || span.mode === "avoid") return null;
  const flipped: RoadSpanMode = span.mode === "must" ? "prefer" : "must";
  return {
    ...base(document, roadSpanCreateLabel(flipped)),
    type: "roadSpan.update",
    spanId,
    mode: flipped,
  };
}

/** `roadSpan.remove` — one command, one undo unit. */
export function removeRoadSpanCommand(
  document: RideDocument,
  spanId: RoadSpanId,
): RemoveRoadSpanCommand {
  return {
    ...base(document, "Removed road span"),
    type: "roadSpan.remove",
    spanId,
  };
}

function copy(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}
