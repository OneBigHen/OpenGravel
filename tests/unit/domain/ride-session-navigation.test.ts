/**
 * Derived navigation state for the 8.2 matching engine
 * (08-RIDE-NAVIGATION-AND-FREE-RIDE §3, §4, §5, §9, §15, §28;
 * 17-IMPLEMENTATION-PLAN Task 8.1; OGV-RID-005, OGV-RID-008).
 *
 * The derivation is the only place freshness is decided, and it is decided at
 * read time against an injected clock — not at event time and never by a
 * field the caller can set:
 *
 * - a stale fix keeps its coordinate (a last-known position is useful) but
 *   loses speed and heading, so nothing stale is presented as current;
 * - an unknown accuracy is not a good fix;
 * - stale or unavailable GPS suspends ahead guidance (OGV-RID-005);
 * - a paused or completed session suspends it regardless of fix quality.
 */

import { describe, expect, it } from "vitest";

import { newRideId, type RideId, type StopId } from "@/domain/ride/ids";
import {
  asSessionInstructionId,
  newRideSessionId,
} from "@/domain/ride-session/ids";
import {
  POSITION_FRESH_GOOD_MAX_AGE_MS,
  POSITION_GOOD_ACCURACY_METERS,
  POSITION_STALE_AFTER_MS,
  deriveSessionNavigation,
} from "@/domain/ride-session/navigation";
import { reduce } from "@/domain/ride-session/reducer";
import type {
  RideSessionEvent,
  RideSessionState,
  SessionRouteBinding,
} from "@/domain/ride-session/types";
import { asRouteCandidateId } from "@/domain/route/ids";

const NOW = "2026-09-18T06:00:00.000Z";
const RIDE_ID: RideId = newRideId();
const SESSION_ID = newRideSessionId();
const ROUTE: SessionRouteBinding = {
  planningGeneration: 1,
  routeId: asRouteCandidateId("route_best"),
};

function at(seconds: number): string {
  return new Date(Date.parse(NOW) + seconds * 1000).toISOString();
}

function apply(state: RideSessionState | null, event: RideSessionEvent): RideSessionState {
  const outcome = reduce(state, event);
  if (outcome.outcome !== "applied") throw new Error(outcome.message);
  return outcome.state;
}

function start(
  activity: "guided" | "free" | "track" = "guided",
  itinerary: readonly StopId[] = [],
): RideSessionState {
  return apply(null, {
    type: "session.started",
    at: at(0),
    sessionId: SESSION_ID,
    activity,
    suggestions: "off",
    plan: { rideId: RIDE_ID, rideRevision: 1, route: activity === "guided" ? ROUTE : null },
    itinerary,
    recordingId: null,
  });
}

function withPosition(
  state: RideSessionState,
  options: { readonly observedAtSeconds: number; readonly accuracyMeters?: number | null; readonly atSeconds?: number },
): RideSessionState {
  const positioned = apply(state, {
    type: "position.updated",
    at: at(options.atSeconds ?? options.observedAtSeconds),
    position: {
      coordinate: { lon: -105.25, lat: 40.05 },
      observedAt: at(options.observedAtSeconds),
      accuracyMeters: options.accuracyMeters === undefined ? 6 : options.accuracyMeters,
      headingDegrees: 270,
      speedMps: 14.2,
    },
  });
  return positioned.activity === "guided" || positioned.activity === "track"
    ? apply(positioned, {
        type: "off-route.changed",
        at: at(options.atSeconds ?? options.observedAtSeconds),
        state: "on-route",
      })
    : positioned;
}

describe("deriveSessionNavigation position quality", () => {
  it("reports an unavailable position before the first fix, and suspends guidance", () => {
    const navigation = deriveSessionNavigation(start(), { now: at(5) });

    expect(navigation.position.quality).toBe("unavailable");
    expect(navigation.position.coordinate).toBeNull();
    expect(navigation.position.observedAt).toBeNull();
    expect(navigation.position.ageMs).toBeNull();
    expect(navigation.position.speedMps).toBeNull();
    expect(navigation.position.headingDegrees).toBeNull();
    expect(navigation.aheadGuidanceSuspended).toBe(true);
    expect(navigation.activity).toBe("guided");
  });

  it("keeps a recent precise fix fresh and good, with speed and heading", () => {
    const state = withPosition(start(), { observedAtSeconds: 1 });
    const navigation = deriveSessionNavigation(state, { now: at(4) });

    expect(navigation.position.quality).toBe("fresh-good");
    expect(navigation.position.ageMs).toBe(3_000);
    expect(navigation.position.coordinate).toEqual({ lon: -105.25, lat: 40.05 });
    expect(navigation.position.speedMps).toBe(14.2);
    expect(navigation.position.headingDegrees).toBe(270);
    expect(navigation.aheadGuidanceSuspended).toBe(false);
  });

  it("treats a fix with unknown accuracy as poor, never as good", () => {
    const state = withPosition(start(), { observedAtSeconds: 1, accuracyMeters: null });

    expect(deriveSessionNavigation(state, { now: at(2) }).position.quality).toBe(
      "fresh-poor",
    );
  });

  it("treats an accuracy above the good threshold as poor", () => {
    const state = withPosition(start(), {
      observedAtSeconds: 1,
      accuracyMeters: POSITION_GOOD_ACCURACY_METERS + 1,
    });

    expect(deriveSessionNavigation(state, { now: at(2) }).position.quality).toBe(
      "fresh-poor",
    );
  });

  it("keeps a fix just inside the fresh window good and degrades only past it", () => {
    const state = withPosition(start(), { observedAtSeconds: 0 });

    expect(
      deriveSessionNavigation(state, { now: at(POSITION_FRESH_GOOD_MAX_AGE_MS / 1000) }).position
        .quality,
    ).toBe("fresh-good");
    expect(
      deriveSessionNavigation(state, {
        now: at(POSITION_FRESH_GOOD_MAX_AGE_MS / 1000 + 1),
      }).position.quality,
    ).toBe("fresh-poor");
  });

  it("stales the fix past the stale threshold and hides stale speed and heading", () => {
    const state = withPosition(start(), { observedAtSeconds: 0 });
    const navigation = deriveSessionNavigation(state, {
      now: at(POSITION_STALE_AFTER_MS / 1000 + 1),
    });

    expect(navigation.position.quality).toBe("stale");
    expect(navigation.position.coordinate).toEqual({ lon: -105.25, lat: 40.05 });
    expect(navigation.position.speedMps).toBeNull();
    expect(navigation.position.headingDegrees).toBeNull();
    expect(navigation.position.ageMs).toBe(POSITION_STALE_AFTER_MS + 1_000);
    expect(navigation.aheadGuidanceSuspended).toBe(true);
  });

  it("carries a reported altitude like speed: shown while fresh, withheld when stale, absent when never reported", () => {
    const positioned = apply(start("free"), {
      type: "position.updated",
      at: at(0),
      position: {
        coordinate: { lon: -105.25, lat: 40.05 },
        observedAt: at(0),
        accuracyMeters: 6,
        headingDegrees: 270,
        speedMps: 14.2,
        speedDerived: true,
        altitudeMeters: 1_655.2,
        altitudeAccuracyMeters: 4,
      },
    });
    const fresh = deriveSessionNavigation(positioned, { now: at(1) });
    expect(fresh.position).toMatchObject({ altitudeMeters: 1_655.2, altitudeAccuracyMeters: 4 });
    const stale = deriveSessionNavigation(positioned, { now: at(POSITION_STALE_AFTER_MS / 1000 + 1) });
    expect(stale.position.altitudeMeters).toBeNull();
    const none = deriveSessionNavigation(withPosition(start(), { observedAtSeconds: 0 }), { now: at(1) });
    expect(none.position).not.toHaveProperty("altitudeMeters");
  });

  it("rejects a fix with an unreadable altitude or speed-derived flag", () => {
    const bad = reduce(start("free"), {
      type: "position.updated",
      at: at(0),
      position: {
        coordinate: { lon: -105.25, lat: 40.05 },
        observedAt: at(0),
        accuracyMeters: 6,
        headingDegrees: null,
        speedMps: null,
        altitudeMeters: Number.NaN,
        altitudeAccuracyMeters: -1,
        speedDerived: "yes" as unknown as boolean,
      },
    });
    expect(bad.outcome).toBe("rejected");
  });

  it("clamps a future-dated fix to age zero instead of reporting a negative age", () => {
    const state = withPosition(start(), { observedAtSeconds: 10, atSeconds: 10 });
    const navigation = deriveSessionNavigation(state, { now: at(5) });

    expect(navigation.position.ageMs).toBe(0);
    expect(navigation.position.quality).toBe("fresh-good");
  });
});

describe("deriveSessionNavigation guidance suspension", () => {
  it("suspends ahead guidance for a paused session even with a fresh fix", () => {
    const moving = withPosition(start(), { observedAtSeconds: 1 });
    const paused = apply(moving, { type: "session.paused", at: at(2), reason: "rider" });

    const navigation = deriveSessionNavigation(paused, { now: at(3) });
    expect(navigation.activity).toBe("paused");
    expect(navigation.position.quality).toBe("fresh-good");
    expect(navigation.aheadGuidanceSuspended).toBe(true);
  });

  it("suspends ahead guidance for a completed session", () => {
    const moving = withPosition(start(), { observedAtSeconds: 1 });
    const completed = apply(moving, { type: "session.completed", at: at(2) });

    const navigation = deriveSessionNavigation(completed, { now: at(3) });
    expect(navigation.activity).toBe("completed");
    expect(navigation.aheadGuidanceSuspended).toBe(true);
  });

  it("exposes the pending stop and the active instruction it knows about", () => {
    let state = start("guided", ["stop_a" as StopId]);
    state = apply(state, {
      type: "instruction.issued",
      at: at(1),
      instruction: {
        instructionId: asSessionInstructionId("instr_1"),
        kind: "turn",
        maneuver: "left",
        roadName: null,
        distanceMeters: 100,
        targetStopId: null,
      },
    });

    const navigation = deriveSessionNavigation(state, { now: at(2) });
    expect(navigation.nextStopId).toBe("stop_a");
    expect(navigation.remainingStopIds).toEqual(["stop_a"]);
    expect(navigation.instruction?.instructionId).toBe("instr_1");
  });

  it("never reports a stale fix as fresh while a session is paused across a reload", () => {
    const moving = withPosition(start(), { observedAtSeconds: 1 });
    const paused = apply(moving, { type: "session.paused", at: at(2), reason: "interruption" });
    const resumed = apply(paused, { type: "session.resumed", at: at(3) });

    // The pre-reload fix is retained (it is a fact) but it is 200 s old, so the
    // derivation reports it as stale guidance input, never as current.
    const navigation = deriveSessionNavigation(resumed, { now: at(201) });
    expect(resumed.position?.observedAt).toBe(at(1));
    expect(navigation.position.quality).toBe("stale");
    expect(navigation.position.speedMps).toBeNull();
    expect(navigation.aheadGuidanceSuspended).toBe(true);
  });
});
