import { describe, expect, it, vi } from "vitest";

import { createRideNavigationEngine } from "@/application/ride-session/navigation-engine";
import type {
  PositionSource,
  PositionSourceObserver,
  RawPosition,
} from "@/application/ride-session/position-pipeline";
import { createRideSessionController } from "@/application/ride-session/ride-session-controller";
import {
  buildRideFocusViewModel,
  liveManeuverOf,
  type RideFocusGuidance,
} from "@/application/ride-session/ride-focus-view-model";
import type { SpeechCue } from "@/application/ride-session/speech";
import type { RideFocusEnvironmentSnapshot } from "@/application/ride-session/ports/ride-focus-environment";
import { deriveSessionNavigation } from "@/domain/ride-session/navigation";
import { newRideId } from "@/domain/ride/ids";
import { asSessionInstructionId } from "@/domain/ride-session/ids";
import { sessionPausedEvent } from "@/domain/ride-session/create";
import { asRouteCandidateId } from "@/domain/route/ids";

/**
 * The fixture line runs due east at 40.14° latitude from -75.48°. 85 000 m per
 * degree is the local scale to within 0.2%, which is all a distance band needs.
 */
const METERS_PER_DEGREE_LON = 85_000;
const LINE_START_LON = -75.48;

/** Longitude `meters` east of the fixture line's start. */
function lonAt(meters: number): number {
  return LINE_START_LON + meters / METERS_PER_DEGREE_LON;
}

const ENVIRONMENT: RideFocusEnvironmentSnapshot = {
  locationPermission: "granted",
  wakeLock: "active",
  speech: "ready",
};

function fakePositionSource(): {
  readonly source: PositionSource;
  readonly permission: ReturnType<typeof vi.fn>;
  readonly watch: ReturnType<typeof vi.fn>;
  position(position: RawPosition): void;
  error(): void;
  readonly stop: ReturnType<typeof vi.fn>;
} {
  let observer: PositionSourceObserver | null = null;
  const stop = vi.fn();
  const permission = vi.fn(async (): Promise<"granted"> => "granted");
  const watch = vi.fn((next: PositionSourceObserver) => {
    observer = next;
    return { stop };
  });
  return {
    source: { permission, watch },
    permission,
    watch,
    position(position) {
      observer?.position(position);
    },
    error() {
      observer?.error({ code: "position-unavailable" });
    },
    stop,
  };
}

function position(lon: number, observedAt: string): RawPosition {
  return {
    coordinate: { lon, lat: 40.14 },
    observedAt,
    accuracyMeters: 8,
    headingDegrees: 90,
    speedMps: 10,
  };
}

/** A receipt clock that advances one second per engine event. */
function tickingClock(): () => string {
  let seconds = 0;
  return () => new Date(Date.UTC(2026, 8, 21, 12, 0, seconds++)).toISOString();
}

/** ISO observation instant `seconds` after 12:00:00 on the fixture day. */
function observedAt(seconds: number): string {
  return new Date(Date.UTC(2026, 8, 21, 12, 0, seconds)).toISOString();
}

describe("RideSession navigation engine", () => {
  it("dispatches fixes and one routed instruction through the existing controller", async () => {
    const routeId = asRouteCandidateId("route_navigation");
    const binding = { planningGeneration: 7, routeId };
    const controller = createRideSessionController({
      now: () => "2026-09-21T12:00:00.000Z",
    });
    await controller.start({
      activity: "guided",
      rideId: newRideId(),
      rideRevision: 4,
      route: binding,
      at: "2026-09-21T11:59:59.000Z",
    });
    const positions = fakePositionSource();
    const speak = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const engine = createRideNavigationEngine({
      session: controller,
      route: {
        mode: "guided",
        binding,
        geometry: [
          { lon: -75.44, lat: 40.14 },
          { lon: -75.43, lat: 40.14 },
        ],
        maneuvers: [
          {
            instructionId: asSessionInstructionId("instr_route_navigation_0"),
            kind: "turn",
            maneuver: "right",
            roadName: "Ridge Road",
            targetStopId: null,
            atDistanceMeters: 500,
          },
        ],
      },
      positionSource: positions.source,
      speech: { speak },
      wakeLock: { request: vi.fn(async () => ({ release })) },
      now: (() => {
        let seconds = 0;
        return () =>
          new Date(Date.UTC(2026, 8, 21, 12, 0, seconds++)).toISOString();
      })(),
    });

    await engine.start();
    positions.position(position(-75.439, "2026-09-21T12:00:00.000Z"));
    await engine.flush();
    positions.position(position(-75.4389, "2026-09-21T12:00:01.000Z"));
    await engine.flush();

    expect(controller.snapshot()?.position?.coordinate.lon).toBeGreaterThan(-75.439);
    expect(controller.snapshot()?.activeInstruction?.instructionId).toBe(
      "instr_route_navigation_0",
    );
    expect(controller.snapshot()?.offRouteState).toBe("on-route");
    expect(engine.snapshot().frame?.distanceAlongMeters).toBeGreaterThan(0);
    expect(speak).toHaveBeenCalledOnce();
    expect(engine.snapshot().wakeLock.status).toBe("active");
    positions.error();
    expect(engine.snapshot().aheadGuidanceSuspended).toBe(true);

    await controller.dispatch(sessionPausedEvent("2026-09-21T12:00:02.000Z"));
    await engine.syncLifecycle();
    expect(positions.stop).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(controller.snapshot()?.activity).toBe("paused");
  });

  it("keeps the card's distance to the next turn counting down as the rider closes on it", async () => {
    const routeId = asRouteCandidateId("route_live_distance");
    const binding = { planningGeneration: 7, routeId };
    const controller = createRideSessionController({
      now: () => observedAt(0),
    });
    await controller.start({
      activity: "guided",
      rideId: newRideId(),
      rideRevision: 4,
      route: binding,
      at: "2026-09-21T11:59:59.000Z",
    });
    const positions = fakePositionSource();
    const engine = createRideNavigationEngine({
      session: controller,
      route: {
        mode: "guided",
        binding,
        geometry: [
          { lon: lonAt(0), lat: 40.14 },
          { lon: lonAt(2_000), lat: 40.14 },
        ],
        maneuvers: [
          {
            instructionId: asSessionInstructionId("instr_live_0"),
            kind: "turn",
            maneuver: "right",
            roadName: "Ridge Road",
            targetStopId: null,
            atDistanceMeters: 1_500,
          },
        ],
      },
      positionSource: positions.source,
      now: tickingClock(),
    });

    await engine.start();
    const rendered: number[] = [];
    let lastFrameMeters: number | null = null;
    for (const [index, meters] of [0, 300, 600, 900, 1_200, 1_400].entries()) {
      positions.position(position(lonAt(meters), observedAt(index)));
      await engine.flush();
      const state = controller.snapshot();
      if (state === null) throw new Error("the ride session is missing");
      const frame = engine.snapshot().frame;
      lastFrameMeters = frame?.distanceToManeuverMeters ?? null;
      const guidance: RideFocusGuidance = buildRideFocusViewModel({
        navigation: deriveSessionNavigation(state, { now: observedAt(index) }),
        environment: ENVIRONMENT,
        telemetry: {
          routeProgress: frame?.routeProgress ?? null,
          remainingDistanceMeters: frame?.distanceRemainingMeters ?? null,
          remainingDurationSeconds: null,
          etaIso: null,
          liveManeuver: liveManeuverOf(frame),
        },
        now: observedAt(index),
      }).guidance;
      if (guidance.kind !== "maneuver") throw new Error(`expected a maneuver, got ${guidance.kind}`);
      rendered.push(guidance.maneuver.distanceMeters);
    }

    // The card counts down instead of repeating the distance it was issued at.
    expect(rendered).toHaveLength(6);
    for (let index = 1; index < rendered.length; index += 1) {
      expect(rendered[index]).toBeLessThan(rendered[index - 1] as number);
    }
    expect(rendered[0]).toBeGreaterThan(1_400);
    expect(lastFrameMeters).not.toBeNull();
    expect(Math.abs((rendered.at(-1) as number) - (lastFrameMeters as number))).toBeLessThanOrEqual(50);
    // The session's own stored value stays the distance at issue time (8 §6).
    expect(controller.snapshot()?.activeInstruction?.distanceMeters).toBeGreaterThan(1_400);
  });

  it("re-announces one turn as the rider crosses each distance band, and never after passing it", async () => {
    const routeId = asRouteCandidateId("route_staged_speech");
    const binding = { planningGeneration: 3, routeId };
    const controller = createRideSessionController({ now: () => observedAt(0) });
    await controller.start({
      activity: "guided",
      rideId: newRideId(),
      rideRevision: 2,
      route: binding,
      at: "2026-09-21T11:59:59.000Z",
    });
    const positions = fakePositionSource();
    const speak = vi.fn(async (cue: SpeechCue) => {
      void cue;
    });
    const engine = createRideNavigationEngine({
      session: controller,
      route: {
        mode: "guided",
        binding,
        geometry: [
          { lon: lonAt(0), lat: 40.14 },
          { lon: lonAt(4_000), lat: 40.14 },
        ],
        maneuvers: [
          {
            instructionId: asSessionInstructionId("instr_staged_0"),
            kind: "turn",
            maneuver: "left",
            roadName: "Ridge Road",
            targetStopId: null,
            atDistanceMeters: 3_000,
          },
        ],
      },
      positionSource: positions.source,
      speech: { speak },
      now: tickingClock(),
    });

    await engine.start();
    for (const [index, meters] of [0, 425, 850, 1_275, 1_700, 2_125, 2_550, 2_975, 3_400, 3_825].entries()) {
      positions.position(position(lonAt(meters), observedAt(index)));
      await engine.flush();
    }

    const spoken = speak.mock.calls.map(([cue]) => cue.distanceMeters);
    expect(spoken).toHaveLength(3);
    // One announcement per band, in the order the rider crosses them.
    expect(spoken[0]).toBeGreaterThan(2_500);
    expect(spoken[1]).toBeGreaterThan(200);
    expect(spoken[1]).toBeLessThan(900);
    expect(spoken[2]).toBeLessThan(100);
    for (let index = 1; index < spoken.length; index += 1) {
      expect(spoken[index]).toBeLessThan(spoken[index - 1] as number);
    }
    // Exactly one cue named the instruction, not one per fix and none after it.
    expect(new Set(speak.mock.calls.map(([cue]) => cue.instructionId)).size).toBe(1);
  });

  it("starts tracking a guided ride whose route line did not resolve, and says guidance is off", async () => {
    const controller = createRideSessionController({ now: () => observedAt(0) });
    await controller.start({
      activity: "guided",
      rideId: newRideId(),
      rideRevision: 4,
      route: { planningGeneration: 7, routeId: asRouteCandidateId("route_no_line") },
      at: "2026-09-21T11:59:59.000Z",
    });
    const positions = fakePositionSource();
    const speak = vi.fn(async () => undefined);
    const engine = createRideNavigationEngine({
      session: controller,
      // The line store answered nothing: there is no route to match against.
      route: null,
      positionSource: positions.source,
      speech: { speak },
      wakeLock: null,
      now: tickingClock(),
    });

    await expect(engine.start()).resolves.toBe(true);
    expect(positions.permission).toHaveBeenCalledOnce();
    expect(positions.watch).toHaveBeenCalledOnce();
    expect(engine.snapshot()).toMatchObject({ status: "active", message: null });
    expect(engine.snapshot().guidanceAvailable).toBe(false);
    expect(engine.snapshot().guidanceMessage).toMatch(/guidance is off/i);

    positions.position(position(lonAt(10), observedAt(1)));
    await engine.flush();
    expect(controller.snapshot()?.position?.coordinate.lon).toBeCloseTo(lonAt(10), 6);
    expect(controller.snapshot()?.activeInstruction).toBeNull();
    expect(speak).not.toHaveBeenCalled();

    // "Retry location" now has an active source to restart.
    await engine.retryPosition?.();
    expect(positions.permission).toHaveBeenCalledTimes(2);
    expect(positions.watch).toHaveBeenCalledTimes(2);
  });

  it("tracks without guidance when the resolved route is not the session's bound answer", async () => {
    const controller = createRideSessionController({
      now: () => "2026-09-21T12:00:00.000Z",
    });
    await controller.start({
      activity: "guided",
      rideId: newRideId(),
      rideRevision: 4,
      route: {
        planningGeneration: 7,
        routeId: asRouteCandidateId("route_bound"),
      },
      at: "2026-09-21T11:59:59.000Z",
    });
    const positions = fakePositionSource();
    const engine = createRideNavigationEngine({
      session: controller,
      route: {
        mode: "guided",
        binding: {
          planningGeneration: 7,
          routeId: asRouteCandidateId("route_other"),
        },
        geometry: [
          { lon: -75.44, lat: 40.14 },
          { lon: -75.43, lat: 40.14 },
        ],
      },
      positionSource: positions.source,
    });

    await expect(engine.start()).resolves.toBe(true);
    expect(engine.snapshot()).toMatchObject({ status: "active", message: null, guidanceAvailable: false });
    expect(engine.snapshot().guidanceMessage).toMatch(/does not match the RideSession binding/);
    // A route the session did not bind is never matched against: no instruction.
    positions.position(position(-75.439, observedAt(1)));
    await engine.flush();
    expect(controller.snapshot()?.activeInstruction).toBeNull();
    expect(positions.stop).not.toHaveBeenCalled();
  });

  it("hands every applied Free Ride fix to the session observer, and a failing observer never stops navigation", async () => {
    const controller = createRideSessionController({ now: () => "2026-09-21T12:00:00.000Z" });
    await controller.start({ activity: "free", rideId: newRideId(), rideRevision: 1, at: "2026-09-21T11:59:59.000Z" });
    const positions = fakePositionSource();
    const seen: string[] = [];
    const onAcceptedFix = vi.fn();
    const engine = createRideNavigationEngine({
      session: controller,
      route: null,
      positionSource: positions.source,
      wakeLock: null,
      onAcceptedFix,
      onSessionFix: (fix, state) => {
        seen.push(`${fix.observedAt} ${state.activity} ${state.recordingId ?? "none"}`);
        if (seen.length === 1) throw new Error("observer failed");
      },
      now: (() => {
        let seconds = 0;
        return () => new Date(Date.UTC(2026, 8, 21, 12, 0, seconds++)).toISOString();
      })(),
    });
    await engine.start();
    positions.position(position(-75.439, "2026-09-21T12:00:00.000Z"));
    await engine.flush();
    positions.position(position(-75.4389, "2026-09-21T12:00:01.000Z"));
    await engine.flush();
    expect(seen).toEqual(["2026-09-21T12:00:00.000Z free none", "2026-09-21T12:00:01.000Z free none"]);
    expect(controller.snapshot()?.position?.observedAt).toBe("2026-09-21T12:00:01.000Z");
    // The recording hand-off still sees only a recording session.
    expect(onAcceptedFix).not.toHaveBeenCalled();
  });
});
