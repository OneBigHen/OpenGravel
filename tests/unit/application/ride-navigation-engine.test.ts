import { describe, expect, it, vi } from "vitest";

import { createRideNavigationEngine } from "@/application/ride-session/navigation-engine";
import type {
  PositionSource,
  PositionSourceObserver,
  RawPosition,
} from "@/application/ride-session/position-pipeline";
import { createRideSessionController } from "@/application/ride-session/ride-session-controller";
import { newRideId } from "@/domain/ride/ids";
import { asSessionInstructionId } from "@/domain/ride-session/ids";
import { sessionPausedEvent } from "@/domain/ride-session/create";
import { asRouteCandidateId } from "@/domain/route/ids";

function fakePositionSource(): {
  readonly source: PositionSource;
  position(position: RawPosition): void;
  error(): void;
  readonly stop: ReturnType<typeof vi.fn>;
} {
  let observer: PositionSourceObserver | null = null;
  const stop = vi.fn();
  return {
    source: {
      permission: async () => "granted",
      watch(next) {
        observer = next;
        return { stop };
      },
    },
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

  it("refuses a resolved route that is not the session's bound answer", async () => {
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

    await expect(engine.start()).resolves.toBe(false);
    expect(engine.snapshot()).toMatchObject({
      status: "failed",
      message: "The resolved route does not match the RideSession binding.",
    });
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
