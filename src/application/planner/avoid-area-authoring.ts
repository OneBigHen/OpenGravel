/**
 * Authoring and editing avoid areas (04-PLANNER-AND-WORKSPACE-UX §18, §20;
 * 02-ARCHITECTURE-CONTRACT §4–§5; 03-DOMAIN-MODEL §11, §27).
 *
 * An avoid area is an authored object whose *bytes* live in the GeometryStore and
 * whose *identity* lives in the ride document. Authoring one is therefore two
 * steps, and the order is not negotiable:
 *
 * ```text
 * validate the ring ──► geometryStore.put ──► command carrying the returned handle ──► dispatch
 * ```
 *
 * ## Why the handle cannot be minted here
 *
 * Only the GeometryStore mints a `GeometryRef` (OGV-D-146/OGV-D-161), and the
 * store has no in-place update: a new geometry value is a new handle. So the
 * command carries the handle `put` returned, and nothing in this module invents
 * one.
 *
 * ## The orphan (OGV-D-234)
 *
 * The two steps can fail between each other: the payload is written and the
 * reducer then refuses the command (a stale revision, a duplicated id). A payload
 * nothing references is not harmless — it is an unreclaimable byte cost hidden
 * behind "the command failed" — so this module **removes the ref it just minted**
 * whenever the command does not apply. It never removes a *previous* ref: undo
 * restores the document that names it, and the store's immutability contract is
 * exactly what makes that old handle still resolve.
 *
 * ## One gesture, one command, one undo unit
 *
 * Every function here dispatches **at most one** command (03 §27): a whole-area
 * drag and a single-vertex drag differ only in the rings they hand to
 * {@link updateAvoidAreaGeometry}, and rename/enable/remove are one narrow update
 * each. Nothing here composes two commands into one rider action.
 */

import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { RideCommand, RideCommandResult } from "@/domain/ride/commands";
import { newAvoidAreaId, newCommandId, type AvoidAreaId, type GeometryRef } from "@/domain/ride/ids";
import type { AvoidArea, CommandSource, Coordinate, RideDocument } from "@/domain/ride/types";

import { validateAvoidAreaRings, type AvoidAreaRingValidationOptions } from "./avoid-area-geometry";

/** The area ids and handles this module mints and reads. */
export type CreateAvoidAreaCommand = Extract<RideCommand, { type: "avoidArea.create" }>;
export type UpdateAvoidAreaCommand = Extract<RideCommand, { type: "avoidArea.update" }>;
export type RemoveAvoidAreaCommand = Extract<RideCommand, { type: "avoidArea.remove" }>;

const SOURCE: CommandSource = "map";

/** The default history labels (04 §20's vocabulary: what the press would cross). */
export const AVOID_AREA_LABELS = {
  create: "Drew avoid area",
  update: "Moved avoid area",
  rename: "Renamed avoid area",
  enable: "Enabled avoid area",
  disable: "Disabled avoid area",
  remove: "Removed avoid area",
} as const;

/**
 * The label for an area the rider named, so the undo list is readable (04 §20 uses
 * "Avoided Route 206" — the verb plus the rider's own name, never a bare noun).
 */
export function namedLabel(verb: string, fallback: string, name: string | null): string {
  return name === null || name.trim().length === 0 ? fallback : `${verb} ${name}`;
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

/** The area the command addresses, or `null` when the document has no such area. */
export function avoidAreaById(
  document: RideDocument,
  areaId: AvoidAreaId,
): AvoidArea | null {
  return document.intent.avoidAreas.find((area) => area.id === areaId) ?? null;
}

/** `avoidArea.create`: a new area addressed by a handle the store already holds. */
export function createAvoidAreaCommand(
  document: RideDocument,
  geometryRef: GeometryRef,
  options: { readonly name?: string | null; readonly label?: string } = {},
): CreateAvoidAreaCommand {
  const name = options.name ?? null;
  return {
    ...base(
      document,
      options.label ?? namedLabel("Avoided", AVOID_AREA_LABELS.create, name),
    ),
    type: "avoidArea.create",
    area: { id: newAvoidAreaId(), name, geometryRef, enabled: true, createdBy: SOURCE },
  };
}

/** `avoidArea.update` carrying only a new geometry handle. */
export function updateAvoidAreaGeometryCommand(
  document: RideDocument,
  areaId: AvoidAreaId,
  geometryRef: GeometryRef,
  label?: string,
): UpdateAvoidAreaCommand {
  return {
    ...base(
      document,
      label ??
        namedLabel(
          "Moved",
          AVOID_AREA_LABELS.update,
          avoidAreaById(document, areaId)?.name ?? null,
        ),
    ),
    type: "avoidArea.update",
    areaId,
    geometryRef,
  };
}

/**
 * `avoidArea.update` carrying only a name — the one edit that cannot move
 * geometry, and therefore cannot reroute (`reroute: false` in the reducer).
 */
export function renameAvoidAreaCommand(
  document: RideDocument,
  areaId: AvoidAreaId,
  name: string | null,
): UpdateAvoidAreaCommand {
  return {
    ...base(document, AVOID_AREA_LABELS.rename),
    type: "avoidArea.update",
    areaId,
    name,
  };
}

/** `avoidArea.update` carrying only enablement; enabling and disabling can reroute. */
export function setAvoidAreaEnabledCommand(
  document: RideDocument,
  areaId: AvoidAreaId,
  enabled: boolean,
): UpdateAvoidAreaCommand {
  const label = enabled ? AVOID_AREA_LABELS.enable : AVOID_AREA_LABELS.disable;
  const verb = enabled ? "Enabled" : "Disabled";
  return {
    ...base(document, namedLabel(verb, label, avoidAreaById(document, areaId)?.name ?? null)),
    type: "avoidArea.update",
    areaId,
    enabled,
  };
}

/** `avoidArea.remove`. */
export function removeAvoidAreaCommand(
  document: RideDocument,
  areaId: AvoidAreaId,
): RemoveAvoidAreaCommand {
  return {
    ...base(
      document,
      namedLabel(
        "Removed",
        AVOID_AREA_LABELS.remove,
        avoidAreaById(document, areaId)?.name ?? null,
      ),
    ),
    type: "avoidArea.remove",
    areaId,
  };
}

/** What an authoring attempt produced. */
export type AvoidAreaAuthoringResult =
  | {
      readonly outcome: "applied";
      readonly document: RideDocument;
      readonly areaId: AvoidAreaId;
      readonly geometryRef: GeometryRef;
      /** The history label the dispatched command carried. */
      readonly label: string;
    }
  | {
      /** The rings are not a storable area; nothing was written. */
      readonly outcome: "rejected";
      readonly message: string;
    }
  | { readonly outcome: "invalid"; readonly code: string; readonly message: string }
  | { readonly outcome: "stale"; readonly currentRevision: number };

export interface AuthorAvoidAreaInput {
  readonly document: RideDocument;
  readonly rings: readonly (readonly Coordinate[])[];
  readonly geometryStore: GeometryStore;
  /** The document store's one mutation entry; the caller owns the container. */
  readonly dispatch: (command: RideCommand) => RideCommandResult;
  readonly name?: string | null;
  readonly label?: string;
  /** Ring validation options; the rectangle tool passes its own span rule. */
  readonly validation?: AvoidAreaRingValidationOptions;
  readonly now?: () => string;
}

/**
 * Writes the polygon, then dispatches `avoidArea.create`, and reclaims the ref if
 * the command does not apply.
 *
 * The ring is validated **before** the write, so an unusable gesture costs no
 * payload at all; the two-step sequence itself is what the orphan rule exists for.
 */
export async function authorAvoidArea(
  input: AuthorAvoidAreaInput,
): Promise<AvoidAreaAuthoringResult> {
  const issue = validateAvoidAreaRings(input.rings, input.validation);
  if (issue !== null) return { outcome: "rejected", message: issue };

  const record = await input.geometryStore.put(
    { kind: "polygon", rings: input.rings.map((ring) => ring.map(copy)) },
    { kind: "avoid-area", ...(input.now === undefined ? {} : { now: input.now() }) },
  );
  const command = createAvoidAreaCommand(input.document, record.geometryRef, {
    name: input.name ?? null,
    ...(input.label === undefined ? {} : { label: input.label }),
  });
  const result = input.dispatch(command);
  if (result.outcome === "applied") {
    return {
      outcome: "applied",
      document: result.document,
      areaId: command.area.id,
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
  // `noop`: the reducer found the change immaterial. With a freshly minted id that
  // cannot happen for a create, but the honest answer is still "not applied".
  return { outcome: "invalid", code: "noop", message: "the avoid area was not stored" };
}

export interface UpdateAvoidAreaGeometryInput {
  readonly document: RideDocument;
  readonly areaId: AvoidAreaId;
  /** The area's **full** rings after the edit: a move and a vertex drag differ only here. */
  readonly rings: readonly (readonly Coordinate[])[];
  readonly geometryStore: GeometryStore;
  readonly dispatch: (command: RideCommand) => RideCommandResult;
  readonly label?: string;
  readonly validation?: AvoidAreaRingValidationOptions;
  readonly now?: () => string;
}

/**
 * Writes the edited polygon, then dispatches `avoidArea.update` carrying the new
 * handle — one command for one gesture, whatever the gesture was (03 §27).
 *
 * The previous handle is deliberately left resolvable: undo restores the document
 * that names it.
 */
export async function updateAvoidAreaGeometry(
  input: UpdateAvoidAreaGeometryInput,
): Promise<AvoidAreaAuthoringResult> {
  const issue = validateAvoidAreaRings(input.rings, input.validation);
  if (issue !== null) return { outcome: "rejected", message: issue };

  const record = await input.geometryStore.put(
    { kind: "polygon", rings: input.rings.map((ring) => ring.map(copy)) },
    { kind: "avoid-area", ...(input.now === undefined ? {} : { now: input.now() }) },
  );
  const command = updateAvoidAreaGeometryCommand(
    input.document,
    input.areaId,
    record.geometryRef,
    input.label,
  );
  const result = input.dispatch(command);
  if (result.outcome === "applied") {
    return {
      outcome: "applied",
      document: result.document,
      areaId: input.areaId,
      geometryRef: record.geometryRef,
      label: command.label,
    };
  }
  await input.geometryStore.remove(record.geometryRef);
  if (result.outcome === "invalid") {
    return { outcome: "invalid", code: result.code, message: result.message };
  }
  if (result.outcome === "stale") {
    return { outcome: "stale", currentRevision: result.currentRevision };
  }
  return { outcome: "invalid", code: "noop", message: "the avoid area was not updated" };
}

function copy(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}
