/**
 * RideSession durability: the checkpoint, the journal and crash-safe resume
 * (02-ARCHITECTURE-CONTRACT §14–§15; 08-RIDE-NAVIGATION-AND-FREE-RIDE §11–§13;
 * 17-IMPLEMENTATION-PLAN Task 8.1; OGV-RID-001/002/005/008).
 *
 * The durable story under test is the standard journal/checkpoint pair:
 *
 * - every applied event is appended as one journal row;
 * - a *bounded batch* of events is folded into one checkpoint row, which also
 *   compacts the rows it folded, so the journal tail is bounded by the
 *   checkpoint interval;
 * - a crash therefore leaves at most the tail un-checkpointed, and resume
 *   restores the last **valid** state (checkpoint + the readable prefix) while
 *   listing every dropped or partial event instead of inventing one;
 * - a reload restores the session paused and requires an explicit resume
 *   (8 §13) — the retained pre-reload fix can never be presented as current,
 *   because freshness is derived from its age.
 *
 * The suite runs against the real Dexie schema with `fake-indexeddb` and the
 * real 5.1 database class, so the atomicity and the schema version are proven,
 * not described.
 */

import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { createRideSessionController } from "@/application/ride-session/ride-session-controller";
import { reconstructRideSession } from "@/application/ride-session/ride-session-recovery";
import type { DroppedSessionEvent } from "@/application/persistence/ride-session-repository";
import { newCommandId, newRideId, newStopId, type RideId, type StopId } from "@/domain/ride/ids";
import type { RideCommand } from "@/domain/ride/commands";
import { createRideDocument } from "@/domain/ride/create";
import { applyRideCommand } from "@/domain/ride/reducer";
import type { RideDocument } from "@/domain/ride/types";
import { asRideSessionId, type RideSessionId } from "@/domain/ride-session/ids";
import { asRecordingId } from "@/domain/recording/ids";
import { reduce } from "@/domain/ride-session/reducer";
import { SESSION_CHECKPOINT_EVENT_INTERVAL } from "@/application/ride-session/ride-session-controller";
import type {
  RideSessionEvent,
  RideSessionState,
  SessionRouteBinding,
} from "@/domain/ride-session/types";
import { asRouteCandidateId } from "@/domain/route/ids";
import { VNextDatabase } from "@/infrastructure/storage/db";
import {
  createRideSessionRepository,
  journalRecordId,
} from "@/infrastructure/storage/ride-session-repository";

const NOW = "2026-09-18T06:00:00.000Z";

function at(seconds: number): string {
  return new Date(Date.parse(NOW) + seconds * 1000).toISOString();
}

let sequence = 0;

function databaseName(): string {
  sequence += 1;
  return `opengravel-vnext-ride-session-${sequence}`;
}

const RIDE_ID: RideId = newRideId();
const SESSION_ID: RideSessionId = asRideSessionId("sess_durable_1");
const ROUTE: SessionRouteBinding = {
  planningGeneration: 2,
  routeId: asRouteCandidateId("route_best"),
};

function startedEvent(seconds: number, rideId: RideId = RIDE_ID): RideSessionEvent {
  return {
    type: "session.started",
    at: at(seconds),
    sessionId: SESSION_ID,
    activity: "guided",
    suggestions: "off",
    plan: { rideId, rideRevision: 4, route: ROUTE },
    itinerary: [],
    recordingId: asRecordingId("rec_1"),
  };
}

function positionEvent(seconds: number, lat = 40.1): RideSessionEvent {
  return {
    type: "position.updated",
    at: at(seconds),
    position: {
      coordinate: { lon: -105.2, lat },
      observedAt: at(seconds),
      accuracyMeters: 5,
      headingDegrees: 90,
      speedMps: 11,
    },
  };
}

function applied(state: RideSessionState | null, event: RideSessionEvent): RideSessionState {
  const outcome = reduce(state, event);
  if (outcome.outcome !== "applied") throw new Error(outcome.message);
  return outcome.state;
}

function rejected(state: RideSessionState | null, event: RideSessionEvent) {
  const outcome = reduce(state, event);
  if (outcome.outcome !== "rejected") throw new Error("expected a rejection");
  return outcome;
}

/** A real authored ride with two stops, built through the command engine. */
function rideWithStops(): { readonly document: RideDocument; readonly stopIds: readonly StopId[] } {
  let document = createRideDocument({ now: NOW });
  for (const [index, lat] of [40.01, 40.02].entries()) {
    const command: RideCommand = {
      type: "stop.insert",
      commandId: newCommandId(),
      rideId: document.rideId,
      baseRevision: document.revision,
      source: "rider",
      label: `Add stop ${index + 1}`,
      stop: {
        id: newStopId(),
        kind: "stop",
        coordinate: { lon: -105.2, lat },
        provenance: { type: "map", selectedAt: NOW },
      },
    };
    const result = applyRideCommand(document, command, { now: at(1) });
    if (result.outcome !== "applied") throw new Error(`stop.insert: ${result.outcome}`);
    document = result.document;
  }
  return { document, stopIds: document.intent.stops.map((stop) => stop.id) };
}

describe("RideSession repository", () => {
  it("migrates a legacy paused checkpoint's pause start from updatedAt", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideSessionRepository({ database });
    const paused = applied(
      applied(null, startedEvent(0)),
      { type: "session.paused", at: at(5), reason: "rider" },
    );
    const legacyState = { ...paused } as unknown as Record<string, unknown>;
    delete legacyState.pausedAt;
    await database.rideSessions.put({
      sessionId: SESSION_ID,
      checkpointSeq: 1,
      revision: 1,
      writerToken: "tab-a",
      updatedAt: at(5),
      state: legacyState,
    } as never);

    const loaded = await repository.loadSession(SESSION_ID);

    expect(loaded?.dropped).toEqual([]);
    expect(
      (loaded?.checkpoint?.state as unknown as { readonly pausedAt: string | null }).pausedAt,
    ).toBe(at(5));
  });

  it("migrates a legacy checkpoint's session-start location from its last known fix", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideSessionRepository({ database });
    const withPosition = applied(applied(null, startedEvent(0)), positionEvent(1, 40.4));
    const legacyState = { ...withPosition } as unknown as Record<string, unknown>;
    delete legacyState.sessionStartPosition;
    await database.rideSessions.put({
      sessionId: SESSION_ID,
      checkpointSeq: 2,
      revision: 1,
      writerToken: "tab-a",
      updatedAt: at(1),
      state: legacyState,
    } as never);

    const loaded = await repository.loadSession(SESSION_ID);

    expect(loaded?.dropped).toEqual([]);
    expect(loaded?.checkpoint?.state.sessionStartPosition).toEqual({ lon: -105.2, lat: 40.4 });
  });

  it("folds a bounded batch into one checkpoint and compacts the folded rows", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideSessionRepository({ database });
    let state = applied(null, startedEvent(0));
    state = applied(state, positionEvent(1));

    expect(
      await repository.appendEvents(SESSION_ID, [
        { seq: 1, event: startedEvent(0) },
        { seq: 2, event: positionEvent(1) },
      ]),
    ).toEqual({ ok: true });
    expect(
      await repository.checkpoint({ state, checkpointSeq: 2, writerToken: "tab-a" }),
    ).toEqual({ ok: true });

    const loaded = await repository.loadSession(SESSION_ID);
    expect(loaded?.checkpoint?.checkpointSeq).toBe(2);
    expect(loaded?.checkpoint?.state).toEqual(state);
    expect(loaded?.events).toEqual([]);
    expect(loaded?.dropped).toEqual([]);
  });

  it("keeps the un-checkpointed tail readable and reconstructs the live state byte for byte", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideSessionRepository({ database });
    const events: RideSessionEvent[] = [startedEvent(0), positionEvent(1), positionEvent(2)];
    const checkpointState = applied(null, startedEvent(0));

    await repository.appendEvents(SESSION_ID, [{ seq: 1, event: events[0] as RideSessionEvent }]);
    await repository.checkpoint({ state: checkpointState, checkpointSeq: 1, writerToken: "tab-a" });
    await repository.appendEvents(SESSION_ID, [
      { seq: 2, event: events[1] as RideSessionEvent },
      { seq: 3, event: events[2] as RideSessionEvent },
    ]);

    const live = applied(
      applied(checkpointState, events[1] as RideSessionEvent),
      events[2] as RideSessionEvent,
    );
    const loaded = await repository.loadSession(SESSION_ID);
    const reconstruction = reconstructRideSession(loaded, SESSION_ID);

    expect(loaded?.events.map((entry) => entry.seq)).toEqual([2, 3]);
    expect(reconstruction.appliedEventCount).toBe(2);
    expect(reconstruction.droppedEvents).toEqual([]);
    expect(JSON.stringify(reconstruction.state)).toBe(JSON.stringify(live));
  });

  it("drops a truncated journal row, lists it, and restores the last valid state", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideSessionRepository({ database });
    await repository.appendEvents(SESSION_ID, [{ seq: 1, event: startedEvent(0) }]);
    let state = applied(null, startedEvent(0));
    await repository.checkpoint({ state, checkpointSeq: 1, writerToken: "tab-a" });

    await repository.appendEvents(SESSION_ID, [
      { seq: 2, event: positionEvent(1, 40.2) },
      { seq: 3, event: positionEvent(2, 40.3) },
      { seq: 4, event: positionEvent(3, 40.4) },
    ]);
    state = applied(state, positionEvent(1, 40.2));
    state = applied(state, positionEvent(2, 40.3));

    // The crash writes a partial record: the row is there, the event never
    // finished serializing.
    await database.rideSessionJournal.put({
      id: journalRecordId(SESSION_ID, 4),
      sessionId: SESSION_ID,
      seq: 4,
    } as never);

    const loaded = await repository.loadSession(SESSION_ID);
    const reconstruction = reconstructRideSession(loaded, SESSION_ID);

    expect(reconstruction.droppedEvents).toEqual<DroppedSessionEvent[]>([
      expect.objectContaining({ seq: 4, reason: "missing-event" }),
    ]);
    expect(reconstruction.appliedEventCount).toBe(2);
    expect(JSON.stringify(reconstruction.state)).toBe(JSON.stringify(state));
    // The dropped fix never landed: the restored position is the seq-3 one.
    expect(reconstruction.state?.position?.coordinate.lat).toBe(40.3);
  });

  it("drops an unreadable record and everything after it", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideSessionRepository({ database });
    await repository.appendEvents(SESSION_ID, [{ seq: 1, event: startedEvent(0) }]);
    await repository.checkpoint({
      state: applied(null, startedEvent(0)),
      checkpointSeq: 1,
      writerToken: "tab-a",
    });
    await repository.appendEvents(SESSION_ID, [{ seq: 2, event: positionEvent(1) }]);
    await database.rideSessionJournal.put({
      id: journalRecordId(SESSION_ID, 3),
      sessionId: SESSION_ID,
      seq: 3,
      event: { type: "position.updated", at: "not-an-instant", position: {} },
    } as never);

    const reconstruction = reconstructRideSession(
      await repository.loadSession(SESSION_ID),
      SESSION_ID,
    );

    expect(reconstruction.appliedEventCount).toBe(1);
    expect(reconstruction.droppedEvents.map((entry) => entry.reason)).toEqual([
      "unreadable-record",
    ]);
  });

  it("refuses a journal row that rewrites an already folded sequence", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideSessionRepository({ database });
    await repository.appendEvents(SESSION_ID, [{ seq: 1, event: startedEvent(0) }]);
    await repository.checkpoint({
      state: applied(null, startedEvent(0)),
      checkpointSeq: 1,
      writerToken: "tab-a",
    });

    const result = await repository.appendEvents(SESSION_ID, [
      { seq: 1, event: positionEvent(9) },
    ]);

    expect(result).toMatchObject({ ok: false, reason: "stale-sequence" });
  });

  it("never lets a late checkpoint rewind a newer durable checkpoint", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideSessionRepository({ database });
    const state = applied(null, startedEvent(0));

    expect(await repository.checkpoint({ state, checkpointSeq: 4, writerToken: "tab-a" })).toEqual({
      ok: true,
    });
    expect(await repository.checkpoint({ state, checkpointSeq: 3, writerToken: "tab-b" })).toMatchObject(
      { ok: false, reason: "stale-checkpoint", storedCheckpointSeq: 4 },
    );
  });

  it("lists and deletes sessions", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideSessionRepository({ database });
    await repository.appendEvents(SESSION_ID, [{ seq: 1, event: startedEvent(0) }]);
    await repository.checkpoint({
      state: applied(null, startedEvent(0)),
      checkpointSeq: 1,
      writerToken: "tab-a",
    });

    const sessions = await repository.listSessions();
    expect(sessions).toEqual([
      expect.objectContaining({ sessionId: SESSION_ID, activity: "guided", startedAt: at(0) }),
    ]);

    await repository.deleteSession(SESSION_ID);
    expect(await repository.loadSession(SESSION_ID)).toBeNull();
    expect(await repository.listSessions()).toEqual([]);
  });
});

describe("RideSessionController", () => {
  interface Harness {
    readonly database: VNextDatabase;
    readonly repository: ReturnType<typeof createRideSessionRepository>;
    readonly controller: ReturnType<typeof createRideSessionController>;
    readonly advance: (seconds: number) => void;
  }

  function harness(name = databaseName()): Harness {
    const database = new VNextDatabase(name);
    const repository = createRideSessionRepository({ database });
    let nowSeconds = 0;
    const controller = createRideSessionController({
      repository,
      writerToken: "tab-a",
      now: () => at(nowSeconds),
    });
    return {
      database,
      repository,
      controller,
      advance: (seconds: number) => {
        nowSeconds = seconds;
      },
    };
  }

  it("runs a guided session from a real planned ride: start → positions → arrive → complete", async () => {
    const { controller, repository, advance } = harness();
    const ride = rideWithStops();

    advance(0);
    const started = await controller.start({
      activity: "guided",
      rideId: ride.document.rideId,
      rideRevision: ride.document.revision,
      route: ROUTE,
      itinerary: ride.stopIds,
      recordingId: asRecordingId("rec_guided"),
      sessionId: SESSION_ID,
    });
    expect(started.outcome).toBe("applied");
    expect(started.persistence).toBe("durable");
    expect(started.state?.remainingStopIds).toEqual(ride.stopIds);
    expect(started.state?.plan.rideRevision).toBe(ride.document.revision);

    advance(1);
    await controller.dispatch(positionEvent(1));
    advance(2);
    await controller.dispatch({ type: "waypoint.arrived", at: at(2) });
    expect(controller.snapshot()?.completedStopIds).toEqual([ride.stopIds[0]]);

    advance(3);
    await controller.dispatch({
      type: "ride.revised",
      at: at(3),
      rideRevision: ride.document.revision + 1,
      route: ROUTE,
      remainingStopIds: [ride.stopIds[1] as StopId],
    });
    advance(4);
    await controller.dispatch({ type: "session.completed", at: at(4) });

    const live = controller.snapshot();
    expect(live?.activity).toBe("completed");
    expect(live?.endReason).toBe("completed");
    // The durable half agrees with the live half after a real reload.
    const reconstruction = reconstructRideSession(
      await repository.loadSession(SESSION_ID),
      SESSION_ID,
    );
    expect(JSON.stringify(reconstruction.state)).toBe(JSON.stringify(live));
  });

  it("accepts a Free Ride suggestion as a mode change: same session, same recording (OGV-RID-002)", async () => {
    const { controller, repository, advance } = harness();
    advance(0);
    const started = await controller.start({
      activity: "free",
      rideId: RIDE_ID,
      rideRevision: 2,
      route: null,
      recordingId: asRecordingId("rec_free"),
      sessionId: SESSION_ID,
    });
    const sessionId = started.state?.sessionId;

    advance(1);
    const accepted = await controller.dispatch({
      type: "mode.changed",
      at: at(1),
      activity: "guided",
      route: ROUTE,
    });

    expect(accepted.outcome).toBe("applied");
    expect(accepted.state?.sessionId).toBe(sessionId);
    expect(accepted.state?.activity).toBe("guided");
    expect(accepted.state?.recordingId).toBe("rec_free");
    expect(accepted.state?.endedAt).toBeNull();

    const loaded = await repository.loadSession(SESSION_ID);
    const reconstruction = reconstructRideSession(loaded, SESSION_ID);
    expect(reconstruction.state?.activity).toBe("guided");
    expect(JSON.stringify(reconstruction.state)).toBe(JSON.stringify(controller.snapshot()));
  });

  it("checkpoints in bounded batches and compacts the journal tail", async () => {
    const { controller, repository, advance } = harness();
    advance(0);
    await controller.start({
      activity: "guided",
      rideId: RIDE_ID,
      rideRevision: 1,
      route: ROUTE,
      itinerary: [],
      sessionId: SESSION_ID,
    });

    const overflow = SESSION_CHECKPOINT_EVENT_INTERVAL + 3;
    for (let index = 1; index <= overflow; index += 1) {
      advance(index);
      await controller.dispatch(positionEvent(index, 40 + index / 100));
    }

    const loaded = await repository.loadSession(SESSION_ID);
    expect(loaded?.checkpoint?.checkpointSeq).toBe(SESSION_CHECKPOINT_EVENT_INTERVAL + 1);
    expect(loaded?.events).toHaveLength(3);
    expect(reconstructRideSession(loaded, SESSION_ID).state).toEqual(controller.snapshot());
  });

  it("restores a crashed session paused, last valid state intact, and requires explicit resume", async () => {
    const { controller, repository, database, advance } = harness();
    advance(0);
    await controller.start({
      activity: "guided",
      rideId: RIDE_ID,
      rideRevision: 1,
      route: ROUTE,
      itinerary: [],
      recordingId: asRecordingId("rec_crash"),
      sessionId: SESSION_ID,
    });
    advance(1);
    await controller.dispatch(positionEvent(1, 40.2));
    advance(2);
    await controller.dispatch(positionEvent(2, 40.3));
    advance(3);
    await controller.dispatch(positionEvent(3, 40.4));
    advance(4);
    await controller.dispatch(positionEvent(4, 40.9));
    await controller.flush();

    // The checkpoint is still the started event; the fix at t=4 is the last
    // un-checkpointed row, and the crash truncated it.
    const tailSeq = 5;
    await database.rideSessionJournal.put({
      id: journalRecordId(SESSION_ID, tailSeq),
      sessionId: SESSION_ID,
      seq: tailSeq,
    } as never);

    const reloaded = createRideSessionController({
      repository,
      writerToken: "tab-b",
      now: () => at(10),
    });
    const report = await reloaded.resume(SESSION_ID);

    expect(report.status).toBe("restored");
    if (report.status !== "restored") return;
    expect(report.droppedEvents).toEqual([expect.objectContaining({ seq: tailSeq })]);
    expect(report.pausedByRecovery).toBe(true);
    expect(report.state.activity).toBe("paused");
    expect(report.state.resumeActivity).toBe("guided");
    // The truncated fix (lat 40.9) never landed; the last valid one did.
    expect(report.state.position?.coordinate.lat).toBe(40.4);

    // Positions stay frozen until the rider resumes explicitly.
    advance(11);
    expect(rejected(report.state, positionEvent(11)).code).toBe("position-while-paused");
    const resumed = await reloaded.dispatch({ type: "session.resumed", at: at(11) });
    expect(resumed.outcome).toBe("applied");
    expect(resumed.state?.activity).toBe("guided");
    expect(reloaded.recovery()?.status).toBe("restored");
  });

  it("reports an absent session and refuses a rejected transition without writing", async () => {
    const { controller, repository } = harness();

    expect((await controller.resume(asRideSessionId("sess_missing"))).status).toBe("absent");

    const rejectedResult = await controller.dispatch(positionEvent(1));
    expect(rejectedResult.outcome).toBe("rejected");
    expect(rejectedResult.code).toBe("no-session");
    expect(await repository.listSessions()).toEqual([]);
  });
});
