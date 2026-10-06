/**
 * The failed-update recovery model (04-PLANNER-AND-WORKSPACE-UX §9, §20, §21;
 * 05-MAP-INTERACTION-AND-CARTOGRAPHY §11).
 *
 * An update that fails must never fabricate a success, and it must never cost the
 * rider the route they had. The controller already guarantees the second half —
 * `lastGoodBundle` survives a failure (OGV-D-168) and 04 §9 keeps drawing it — so
 * what is left is the *first* half, stated as three questions the surface cannot
 * answer from the session alone:
 *
 * 1. **Did an update actually fail?** A failure is only an *update* failure when
 *    there is a last-good answer to keep, the document has moved past the revision
 *    that answer addresses, and the attempt that failed is the attempt for the
 *    document's own revision. Anything else is a first plan, a stale attempt, or a
 *    cancellation, and it is deliberately not this model's business.
 * 2. **What was the attempted change?** One history unit, named. The edit that
 *    moved the revision past the answer is the entry the cursor is on, so the name
 *    comes from the same place the Undo control reads it (04 §20) — never invented.
 * 3. **What can the rider do about it?** Retry (04 §21's first action), Edit (open
 *    the editor of the object the attempt changed) and Discard (one whole-ride
 *    undo of exactly that unit — 04 §20's "returns prior RideDocument, not merely
 *    prior points").
 *
 * ## Why Discard is guarded
 *
 * Undo moves through *whole-ride* history, so a Discard that fires while the cursor
 * has moved on would silently undo something else — the rider's last edit would be
 * undone for a failure that no longer describes it. The guard is therefore strict:
 * the cursor's entry must be the failed revision's entry *and* carry the attempted
 * change's own label. When it is not, the model offers nothing (`canDiscard` is
 * false) and reports why through `onRefused`, which is what keeps a refusal an
 * observable decision rather than a disabled button nobody can explain.
 *
 * ## What is deliberately not here
 *
 * No store, no controller, no React: this module derives values and decides, and
 * the workspace performs the commands through the containers that own them
 * (02-ARCHITECTURE-CONTRACT §7–§8). `message` is the §29 rider copy — never the
 * provider diagnostics text a `PlanningError` also carries (OGV-D-151/OGV-D-162).
 */

import { planningErrorCopy } from "@/application/planner/planner-view-model";
import type { MapObjectRef } from "@/application/map/types";
import type {
  PlanningErrorCode,
  PlanningSessionSnapshot,
} from "@/application/planner/planning-session";
import { undoRide, type HistoryMove } from "@/domain/ride/history";
import type {
  AvoidArea,
  RideDocument,
  RideIntent,
  RidePoint,
  RoadSpanConstraint,
} from "@/domain/ride/types";

/**
 * What the banner shows when the history cannot name the failed change.
 *
 * A failure whose entry is no longer the cursor's entry cannot be attributed, and
 * inventing a label from the document would claim knowledge the product does not
 * have. The banner says "your last change" instead, and both Edit and Discard are
 * withheld (see {@link updateRecoveryActions}).
 */
export const UNIDENTIFIED_CHANGE_LABEL = "Your last change";

/** One failed update the rider can act on. */
export interface UpdateFailure {
  /** The history entry's own label for the attempted change (04 §20). */
  readonly attemptedCommandLabel: string;
  /** The §29 error class, which the surface maps to rider copy. */
  readonly code: PlanningErrorCode;
  /** Rider copy from the §29 taxonomy; never `${error.message}`. */
  readonly message: string;
  /** Whether asking again could change the answer (session's own verdict). */
  readonly recoverable: boolean;
  /** The revision the failed attempt was asking about (the document's own). */
  readonly rideRevision: number;
}

/**
 * What the Edit action opens.
 *
 * A map object is the common case, and the workspace resolves it the same way a
 * list tap does (`selectObject` plus the object's own editor). A sketch has no
 * `MapObjectRef` — it is not a selectable map object — so it gets its own member
 * instead of a fabricated ref.
 */
export type UpdateRecoveryEditTarget =
  | { readonly kind: "map"; readonly ref: MapObjectRef }
  | { readonly kind: "sketch" };

/** Which of the three §21 actions can be offered for one failure. */
export interface UpdateRecoveryActions {
  /**
   * Always true while a failure is on screen. 04 §21 lists Retry without a
   * precondition: a durable `no-route` is still worth asking again after the rider
   * changes a point, and a control that disappears is a control the rider has to
   * guess about.
   */
  readonly canRetry: boolean;
  readonly canEdit: boolean;
  readonly canDiscard: boolean;
  /** The editor Edit would open, or `null` when the change cannot be attributed. */
  readonly editTarget: UpdateRecoveryEditTarget | null;
}

/** Why Discard withheld itself; reported through {@link DiscardFailedUpdateOptions}. */
export type UpdateRecoveryRefusalReason = "no-history" | "history-moved";

export interface DiscardFailedUpdateOptions {
  /** Injected clock for the undo it computes (tests, SSR). */
  readonly now?: string;
  /** Called with the reason when the guard refuses; the surface offers nothing. */
  readonly onRefused?: (reason: UpdateRecoveryRefusalReason) => void;
}

/**
 * The history entry the failed revision produced, or `null`.
 *
 * Only the entry the cursor is on can be undone, so only that entry can name — or
 * be — the attempted change. `entries[cursor]` with a matching revision is exactly
 * "the unit this revision came from".
 */
function failedEntry(
  document: RideDocument,
  rideRevision: number,
): RideDocument["history"]["entries"][number] | null {
  const { entries, cursor } = document.history;
  const entry = entries[cursor];
  if (entry === undefined || entry.revision !== rideRevision) return null;
  return entry;
}

/** The authored intent the attempted change started from. */
function intentBefore(document: RideDocument, cursor: number): RideIntent {
  const prior = document.history.entries[cursor - 1];
  return prior === undefined ? document.history.baseIntent : prior.intent;
}

function samePoint(before: RidePoint | null, after: RidePoint | null): boolean {
  if (before === null || after === null) return before === after;
  return (
    before.id === after.id &&
    before.label === after.label &&
    before.coordinate.lon === after.coordinate.lon &&
    before.coordinate.lat === after.coordinate.lat
  );
}

function sameArea(before: AvoidArea, after: AvoidArea): boolean {
  return (
    before.geometryRef === after.geometryRef &&
    before.name === after.name &&
    before.enabled === after.enabled
  );
}

function sameSpan(before: RoadSpanConstraint, after: RoadSpanConstraint): boolean {
  return (
    before.geometryRef === after.geometryRef &&
    before.mode === after.mode &&
    before.direction === after.direction
  );
}

/**
 * The object the attempted change touched, derived by comparing the intent the
 * change produced with the intent it started from.
 *
 * Deriving from the intents rather than from the label's words is deliberate: a
 * label is rider-facing copy that may be reworded at any time, while the intent
 * difference *is* the change. Only objects the current intent still holds can be
 * pointed at — a removal has no editor to open, so it yields nothing rather than an
 * affordance pointing at an object that no longer exists.
 */
function changedObject(before: RideIntent, after: RideIntent): UpdateRecoveryEditTarget | null {
  for (const area of after.avoidAreas) {
    const previous = before.avoidAreas.find((candidate) => candidate.id === area.id);
    if (previous === undefined || !sameArea(previous, area)) {
      return { kind: "map", ref: { kind: "avoid-area", avoidAreaId: area.id } };
    }
  }
  for (const span of after.roadSpans) {
    const previous = before.roadSpans.find((candidate) => candidate.id === span.id);
    if (previous === undefined || !sameSpan(previous, span)) {
      return { kind: "map", ref: { kind: "road-span", roadSpanId: span.id } };
    }
  }
  for (const stop of after.stops) {
    const previous = before.stops.find((candidate) => candidate.id === stop.id);
    if (previous === undefined) return { kind: "map", ref: { kind: "stop", stopId: stop.id } };
    if (
      previous.coordinate.lon !== stop.coordinate.lon ||
      previous.coordinate.lat !== stop.coordinate.lat ||
      previous.label !== stop.label ||
      previous.arrivalIntent !== stop.arrivalIntent
    ) {
      return { kind: "map", ref: { kind: "stop", stopId: stop.id } };
    }
  }
  if (after.start !== null && !samePoint(before.start, after.start)) {
    return { kind: "map", ref: { kind: "point", pointId: after.start.id } };
  }
  if (after.finish !== null && !samePoint(before.finish, after.finish)) {
    return { kind: "map", ref: { kind: "point", pointId: after.finish.id } };
  }
  for (const anchor of after.shaping) {
    const previous = before.shaping.find((candidate) => candidate.id === anchor.id);
    if (
      previous === undefined ||
      previous.coordinate.lon !== anchor.coordinate.lon ||
      previous.coordinate.lat !== anchor.coordinate.lat
    ) {
      return { kind: "map", ref: { kind: "point", pointId: anchor.id } };
    }
  }
  if (after.sketch !== before.sketch) return { kind: "sketch" };
  return null;
}

/**
 * The failed update this session and document describe, or `null`.
 *
 * Pure and total: every "not an update failure" answers `null` rather than
 * guessing, and the returned failure is a plain value the surface can render.
 */
export function selectUpdateRecovery(
  document: RideDocument,
  session: PlanningSessionSnapshot,
): UpdateFailure | null {
  if (session.phase !== "failed") return null;
  const answer = session.lastGoodBundle;
  if (answer === null) return null;
  // The answer on screen must be *behind* the document: a bundle that already
  // addresses this revision is not a failed update, whatever the phase says.
  if (document.revision <= answer.rideRevision) return null;
  // A failure describes the attempt for its own revision. Once the rider has moved
  // on, the state on screen belongs to a newer attempt and this one is history.
  if (session.identity.rideRevision !== document.revision) return null;
  const error = session.error;
  if (error === null) return null;
  const entry = failedEntry(document, session.identity.rideRevision);
  return {
    attemptedCommandLabel: entry?.label ?? UNIDENTIFIED_CHANGE_LABEL,
    code: error.code,
    message: planningErrorCopy(error.code, document, error.riderMessage),
    recoverable: error.recoverable,
    rideRevision: document.revision,
  };
}

/**
 * The editor the attempted change needs, or `null` when it cannot be named.
 *
 * `null` covers a removal (there is nothing left to edit) and an unattributable
 * failure (no entry, so no intent to compare against) — in both cases Edit is
 * withheld rather than pointed at the wrong object.
 */
export function editFailedUpdate(
  document: RideDocument,
  failure: UpdateFailure,
): UpdateRecoveryEditTarget | null {
  const entry = failedEntry(document, failure.rideRevision);
  if (entry === null) return null;
  return changedObject(intentBefore(document, document.history.cursor), document.intent);
}

/**
 * The Discard move for this failure, or `null` when it must not be offered.
 *
 * The returned move is {@link undoRide} — one history unit, the whole ride as it
 * was before the attempted change (04 §20). The workspace applies it through the
 * document store so persistence, dirty-marking and checkpointing stay in one place;
 * what this function owns is the *decision* (and the label a surface can show).
 */
export function discardFailedUpdate(
  document: RideDocument,
  failure: UpdateFailure,
  options: DiscardFailedUpdateOptions = {},
): HistoryMove | null {
  const entry = failedEntry(document, failure.rideRevision);
  if (entry === null || entry.label !== failure.attemptedCommandLabel) {
    options.onRefused?.(document.history.cursor < 0 ? "no-history" : "history-moved");
    return null;
  }
  return undoRide(document, options.now === undefined ? {} : { now: options.now });
}

/** What the banner can offer for one failure (04 §21). */
export function updateRecoveryActions(
  document: RideDocument,
  failure: UpdateFailure,
): UpdateRecoveryActions {
  const editTarget = editFailedUpdate(document, failure);
  return {
    canRetry: true,
    canEdit: editTarget !== null,
    // The guard runs without a reporter here: a caller that needs the reason asks
    // `discardFailedUpdate` for it directly.
    canDiscard: discardFailedUpdate(document, failure) !== null,
    editTarget,
  };
}
