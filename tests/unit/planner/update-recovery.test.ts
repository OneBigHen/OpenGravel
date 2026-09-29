/**
 * Failed-update recovery (04-PLANNER-AND-WORKSPACE-UX §9, §20, §21).
 *
 * A failure is only *recoverable* if the product can name the change that failed
 * and act on it, so this suite pins three things:
 *
 * - the selector refuses to claim a failure it cannot attribute — a failure whose
 *   revision does not match the document, a session with no last-good answer, or
 *   a stale attempt that a newer edit has already superseded;
 * - the rider copy comes from the §29 taxonomy, never from the diagnostics text a
 *   provider's failure carries;
 * - Discard is a guarded whole-ride undo: it moves only when the history entry the
 *   failed revision produced is still the entry the cursor is on, and it says why
 *   when it will not.
 */

import { describe, expect, it } from "vitest";

import {
  UNIDENTIFIED_CHANGE_LABEL,
  discardFailedUpdate,
  editFailedUpdate,
  selectUpdateRecovery,
  updateRecoveryActions,
  type UpdateRecoveryRefusalReason,
} from "@/application/planner/update-recovery";
import {
  emptyPlanningSession,
  emptyRouteRoles,
  type PlanningError,
  type PlanningPhase,
  type PlanningSessionSnapshot,
} from "@/application/planner/planning-session";
import { defaultRideIntent } from "@/domain/ride/create";
import {
  asGeometryRef,
  asSketchId,
  newHistoryEntryId,
  newRideId,
  newShapingId,
  type RideId,
  type StopId,
} from "@/domain/ride/ids";
import {
  SCHEMA_VERSION,
  type Coordinate,
  type RideDocument,
  type RideHistoryEntry,
  type RideIntent,
  type RidePoint,
  type StopPoint,
} from "@/domain/ride/types";
import { asRouteCandidateId } from "@/domain/route/ids";
import type { RouteBundle, RouteCandidate } from "@/domain/route/types";

const FIXED = "2026-09-17T00:00:00.000Z";
const RIDE_ID: RideId = newRideId();

const ORIGIN: Coordinate = { lon: -75.2, lat: 39.95 };
const DESTINATION: Coordinate = { lon: -74.8, lat: 40.2 };
const STOP_AT: Coordinate = { lon: -75.0, lat: 40.05 };
const STOP_MOVED: Coordinate = { lon: -75.05, lat: 40.08 };

function endpoint(id: string, kind: "start" | "finish", coordinate: Coordinate): RidePoint {
  return { id: id as RidePoint["id"], kind, coordinate, provenance: { type: "map", selectedAt: FIXED } };
}

function stop(id: string, coordinate: Coordinate): StopPoint {
  return {
    id: id as StopId,
    kind: "stop",
    coordinate,
    provenance: { type: "map", selectedAt: FIXED },
  };
}

/** The intent the ride had before the failed edit. */
function baseIntent(overrides: Partial<RideIntent> = {}): RideIntent {
  return {
    ...defaultRideIntent(),
    start: endpoint("pt_start", "start", ORIGIN),
    finish: endpoint("pt_finish", "finish", DESTINATION),
    stops: [stop("stop_1", STOP_AT)],
    ...overrides,
  };
}

function historyEntry(revision: number, label: string, intent: RideIntent): RideHistoryEntry {
  return { entryId: newHistoryEntryId(), label, revision, intent };
}

interface DocumentOptions {
  readonly revision?: number;
  readonly entries?: readonly RideHistoryEntry[];
  readonly cursor?: number;
  readonly baseIntent?: RideIntent;
}

function documentWith(intent: RideIntent, options: DocumentOptions = {}): RideDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    rideId: RIDE_ID,
    revision: options.revision ?? 2,
    createdAt: FIXED,
    updatedAt: FIXED,
    title: null,
    provenance: { type: "new" },
    intent,
    history: {
      entries: options.entries ?? [],
      cursor: options.cursor ?? -1,
      baseIntent: options.baseIntent ?? defaultRideIntent(),
      appliedProposalIds: [],
    },
  };
}

function unscoredComponents(): RouteCandidate["score"]["components"] {
  const component = (key: string): RouteCandidate["score"]["components"]["curvature"] => ({
    input: null,
    weight: 0,
    contribution: 0,
    explanationKey: key,
    evidenceStatus: "unknown",
  });
  return {
    curvature: component("curvature"),
    backroad: component("backroad"),
    surfaceFit: component("surfaceFit"),
    elevation: component("elevation"),
    traffic: component("traffic"),
    junctionFriction: component("junctionFriction"),
    novelty: component("novelty"),
    closureRisk: component("closureRisk"),
    timeCost: component("timeCost"),
    confidence: component("confidence"),
  };
}

function candidate(): RouteCandidate {
  return {
    id: asRouteCandidateId("route_best"),
    provider: { providerId: "graphhopper", profile: "motorcycle_adventure" },
    geometryRef: asGeometryRef("geo_best"),
    distanceMeters: 1_711,
    durationSeconds: 245,
    eligibility: { eligible: true, failures: [] },
    evidence: {},
    score: { policyVersion: "VNEXT_STUB_0", total: 0, components: unscoredComponents() },
    warnings: [],
    fingerprint: "fp_best",
  };
}

/** A last-good answer for `rideRevision` (the revision the failed edit moved past). */
function bundle(rideRevision: number): RouteBundle {
  const best = candidate();
  return {
    rideId: RIDE_ID,
    rideRevision,
    planningGeneration: 1,
    policyVersion: "VNEXT_STUB_0",
    graphVersion: "unknown",
    evidenceVersion: "unknown",
    candidates: [best],
    selectedRouteId: best.id,
    selectionSource: "automatic",
    roles: emptyRouteRoles(),
    createdAt: FIXED,
  };
}

interface SessionOptions {
  readonly rideRevision?: number;
  readonly lastGoodBundle?: RouteBundle | null;
  readonly error?: PlanningError | null;
}

function session(
  phase: PlanningPhase,
  options: SessionOptions = {},
): PlanningSessionSnapshot {
  return {
    ...emptyPlanningSession(RIDE_ID),
    identity: {
      rideId: RIDE_ID,
      rideRevision: options.rideRevision ?? 2,
      planningGeneration: 2,
    },
    phase,
    lastGoodBundle: options.lastGoodBundle === undefined ? bundle(1) : options.lastGoodBundle,
    error:
      options.error === undefined
        ? { code: "no-route", message: "no provider produced a usable route", recoverable: false }
        : options.error,
    ...(options.lastGoodBundle === null ? { lastGoodBundle: null } : {}),
  };
}

/** The document an edit of `baseIntent` produced, with its one history entry. */
function editedDocument(): RideDocument {
  const before = baseIntent();
  const after = baseIntent({ stops: [stop("stop_1", STOP_MOVED)] });
  return documentWith(after, {
    revision: 2,
    entries: [historyEntry(2, "Move stop", after)],
    cursor: 0,
    baseIntent: before,
  });
}

describe("selectUpdateRecovery — the failed edit, when it can be attributed", () => {
  it("reports the attempted change when the revision moved past the last answer", () => {
    const failure = selectUpdateRecovery(editedDocument(), session("failed"));

    expect(failure).toEqual({
      attemptedCommandLabel: "Move stop",
      code: "no-route",
      // Rider copy from the §29 taxonomy — never the diagnostics message, which
      // names what the provider did (OGV-D-151).
      message: "No legal route to this destination — try another point.",
      recoverable: false,
      rideRevision: 2,
    });
  });

  it("states the difference between a recoverable and a durable answer", () => {
    const transient = selectUpdateRecovery(
      editedDocument(),
      session("failed", {
        error: { code: "provider-unavailable", message: "no provider answered", recoverable: true },
      }),
    );
    expect(transient?.recoverable).toBe(true);
    expect(transient?.message).toBe("The routing service is unavailable right now.");

    const conflict = selectUpdateRecovery(
      editedDocument(),
      session("failed", {
        error: { code: "constraint-conflict", message: "no candidate satisfied", recoverable: true },
      }),
    );
    expect(conflict?.message).toBe("Your constraints leave no eligible route.");
  });

  it("uses the loop's destination-free copy for a no-route loop", () => {
    const before = baseIntent({ shape: "loop", finish: null });
    const after = baseIntent({
      shape: "loop",
      finish: null,
      stops: [stop("stop_1", STOP_MOVED)],
    });
    const document = documentWith(after, {
      revision: 2,
      entries: [historyEntry(2, "Move stop", after)],
      cursor: 0,
      baseIntent: before,
    });

    expect(selectUpdateRecovery(document, session("failed"))?.message).toBe(
      "No legal route for this ride — try another point.",
    );
  });

  it("claims nothing when the answer on screen already answers the revision", () => {
    const document = editedDocument();
    expect(
      selectUpdateRecovery(document, session("failed", { lastGoodBundle: bundle(2) })),
    ).toBeNull();
  });

  it("claims nothing without a last-good answer to keep showing", () => {
    expect(
      selectUpdateRecovery(editedDocument(), session("failed", { lastGoodBundle: null })),
    ).toBeNull();
  });

  it("claims nothing outside the failed phase", () => {
    for (const phase of ["idle", "ready", "cancelled", "routing-primary"] as const) {
      expect(selectUpdateRecovery(editedDocument(), session(phase))).toBeNull();
    }
  });

  it("does not attribute a stale failure to a newer edit", () => {
    // The attempt that failed answered revision 2; the document has since moved
    // to revision 3, so its failure describes a change the rider already left.
    const document = documentWith(baseIntent(), { revision: 3 });
    expect(selectUpdateRecovery(document, session("failed", { rideRevision: 2 }))).toBeNull();
  });

  it("falls back to an unnamed change when the history cannot name it", () => {
    const failure = selectUpdateRecovery(
      documentWith(baseIntent(), { revision: 2 }),
      session("failed"),
    );

    expect(failure?.attemptedCommandLabel).toBe(UNIDENTIFIED_CHANGE_LABEL);
    expect(updateRecoveryActions(documentWith(baseIntent(), { revision: 2 }), failure!)).toEqual({
      canRetry: true,
      canEdit: false,
      canDiscard: false,
      editTarget: null,
    });
  });
});

describe("editFailedUpdate — which editor the failed change needs", () => {
  it("points at the stop an edit moved", () => {
    const document = editedDocument();
    const failure = selectUpdateRecovery(document, session("failed"));

    expect(editFailedUpdate(document, failure!)).toEqual({
      kind: "map",
      ref: { kind: "stop", stopId: "stop_1" },
    });
  });

  it("points at an endpoint an edit moved", () => {
    const before = baseIntent();
    const after = baseIntent({ start: endpoint("pt_start", "start", { lon: -75.22, lat: 39.9 }) });
    const document = documentWith(after, {
      revision: 2,
      entries: [historyEntry(2, "Move start", after)],
      cursor: 0,
      baseIntent: before,
    });

    expect(
      editFailedUpdate(document, selectUpdateRecovery(document, session("failed"))!),
    ).toEqual({ kind: "map", ref: { kind: "point", pointId: "pt_start" } });
  });

  it("points at a shaping anchor a converted stop became", () => {
    const before = baseIntent();
    const anchor = newShapingId();
    const after: RideIntent = {
      ...baseIntent({ stops: [] }),
      shaping: [{ id: anchor, kind: "shape", coordinate: STOP_AT, source: "map-drag" }],
    };
    const document = documentWith(after, {
      revision: 2,
      entries: [historyEntry(2, "Convert point", after)],
      cursor: 0,
      baseIntent: before,
    });

    expect(
      editFailedUpdate(document, selectUpdateRecovery(document, session("failed"))!),
    ).toEqual({ kind: "map", ref: { kind: "point", pointId: anchor } });
  });

  it("points at the sketch when the drawing is what changed", () => {
    const before = baseIntent();
    const after: RideIntent = {
      ...baseIntent(),
      sketch: {
        id: asSketchId("sketch_1"),
        rawStrokeRefs: [asGeometryRef("geo_stroke")],
        corridorRef: asGeometryRef("geo_corridor"),
        topologyHints: [],
        endpointPolicy: "derive",
      },
    };
    const document = documentWith(after, {
      revision: 2,
      entries: [historyEntry(2, "Drew route", after)],
      cursor: 0,
      baseIntent: before,
    });

    expect(
      editFailedUpdate(document, selectUpdateRecovery(document, session("failed"))!),
    ).toEqual({ kind: "sketch" });
  });

  it("offers nothing to edit when the edit only removed an object", () => {
    const before = baseIntent();
    const after = baseIntent({ stops: [] });
    const document = documentWith(after, {
      revision: 2,
      entries: [historyEntry(2, "Remove stop", after)],
      cursor: 0,
      baseIntent: before,
    });

    expect(
      editFailedUpdate(document, selectUpdateRecovery(document, session("failed"))!),
    ).toBeNull();
  });
});

describe("discardFailedUpdate — one guarded whole-ride undo", () => {
  it("moves back to the pre-edit ride and names the crossed entry", () => {
    const document = editedDocument();
    const failure = selectUpdateRecovery(document, session("failed"));
    expect(updateRecoveryActions(document, failure!).canDiscard).toBe(true);

    const move = discardFailedUpdate(document, failure!);

    expect(move?.label).toBe("Move stop");
    expect(move?.document.revision).toBe(3);
    expect(move?.document.intent.stops[0]?.coordinate).toEqual(STOP_AT);
  });

  it("refuses when the cursor is no longer on the failed revision's entry", () => {
    const document = editedDocument();
    const failure = selectUpdateRecovery(document, session("failed"));
    const seen: UpdateRecoveryRefusalReason[] = [];
    // A later edit moved the cursor on: undoing now would cross the wrong unit.
    const movedOn: RideDocument = {
      ...document,
      revision: 4,
      history: {
        ...document.history,
        entries: [...document.history.entries, historyEntry(4, "Move stop", document.intent)],
        cursor: 1,
      },
    };

    expect(
      discardFailedUpdate(movedOn, failure!, { onRefused: (reason) => seen.push(reason) }),
    ).toBeNull();
    expect(seen).toEqual(["history-moved"]);
    // And the surface is told not to offer it at all.
    expect(updateRecoveryActions(movedOn, failure!).canDiscard).toBe(false);
  });

  it("refuses when there is no history to move through, and says so", () => {
    const document = documentWith(baseIntent(), { revision: 2, entries: [], cursor: -1 });
    const failure = selectUpdateRecovery(document, session("failed"));
    const seen: UpdateRecoveryRefusalReason[] = [];

    expect(
      discardFailedUpdate(document, failure!, { onRefused: (reason) => seen.push(reason) }),
    ).toBeNull();
    expect(seen).toEqual(["no-history"]);
  });

  it("refuses an entry whose label names a different change", () => {
    const document = editedDocument();
    const failure = selectUpdateRecovery(document, session("failed"));
    const relabelled: RideDocument = {
      ...document,
      history: {
        ...document.history,
        entries: [historyEntry(2, "Add stop", document.intent)],
      },
    };
    const seen: UpdateRecoveryRefusalReason[] = [];

    expect(
      discardFailedUpdate(relabelled, failure!, { onRefused: (reason) => seen.push(reason) }),
    ).toBeNull();
    expect(seen).toEqual(["history-moved"]);
  });

  it("carries the caller's clock into the undo it computes", () => {
    const document = editedDocument();
    const failure = selectUpdateRecovery(document, session("failed"));

    const move = discardFailedUpdate(document, failure!, { now: "2026-09-18T00:00:00.000Z" });

    expect(move?.document.updatedAt).toBe("2026-09-18T00:00:00.000Z");
  });
});
