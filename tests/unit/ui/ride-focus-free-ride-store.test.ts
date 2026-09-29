import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";
import { createRideSessionController } from "@/application/ride-session/ride-session-controller";
import type { ReturnPlanResult } from "@/application/free-ride/return-plan";
import type { GuidedReroutePlanner } from "@/application/ride-session/guided-reroute";
import type { LiveSuggestionResult } from "@/application/free-ride/live-suggestions";
import type { RideFocusPointerPort, RideFocusPointerRead } from "@/application/persistence/ride-focus-pointer";
import { createRideSessionRepository } from "@/infrastructure/storage/ride-session-repository";
import { createRideFocusStore } from "@/ui/stores/ride-focus-store";
import { rideRevisedEvent, suggestionsChangedEvent } from "@/domain/ride-session/create";
import { newRideId, type GeometryRef } from "@/domain/ride/ids";
import { asRouteCandidateId } from "@/domain/route/ids";
import type { RideFocusEnvironmentPort, RideFocusEnvironmentSnapshot } from "@/application/ride-session/ports/ride-focus-environment";
import type { RideFocusPointer } from "@/application/persistence/ride-focus-pointer";
import { VNextDatabase } from "@/infrastructure/storage/db";

const BASE = Date.parse("2026-09-24T12:00:00.000Z");
const RIDE_ID = newRideId();
const SESSION_START = { lon: -77.2, lat: 40.1 };
const SAVED_HOME = { lon: -77.4, lat: 40.3 };
const LINE = [SESSION_START, { lon: -77.19, lat: 40.11 }] as const;
let databaseSequence = 0;

function environment(): RideFocusEnvironmentPort {
  const snapshot: RideFocusEnvironmentSnapshot = {
    locationPermission: "granted", wakeLock: "off", speech: "ready",
  };
  return {
    snapshot: () => snapshot,
    subscribe: (listener) => { listener(snapshot); return () => undefined; },
    setRideActive: () => undefined,
    requestLocationPermission: async () => "granted",
    dispose: () => undefined,
  };
}

async function makeRide(input: {
  readonly suggestions: "on" | "off";
  readonly evaluateLiveSuggestion?: () => Promise<LiveSuggestionResult>;
  readonly readSavedHome?: () => typeof SAVED_HOME | null;
  readonly readRouteLine?: (ref: GeometryRef) => Promise<readonly { readonly lon: number; readonly lat: number }[] | null>;
  readonly returnPlanner?: {
    plan: (request: {
      readonly navigation: import("@/domain/ride-session/navigation").SessionNavigationState;
      readonly target: { readonly kind: "saved-home" | "session-start" | "chosen-destination"; readonly coordinate: { readonly lon: number; readonly lat: number }; readonly label: string | null };
      readonly mode: import("@/application/free-ride/return-routing").ReturnMode;
      readonly signal: AbortSignal;
      readonly loopMinutes?: number;
      readonly rejoin?: readonly { readonly lon: number; readonly lat: number }[];
    }) => Promise<ReturnPlanResult>;
  };
  readonly reroutePlanner?: GuidedReroutePlanner;
  readonly announceOpportunity?: (text: string) => void;
  readonly feelOpportunity?: (kind: "opportunity" | "accepted" | "returned") => void;
  readonly rideOffers?: boolean;
}) {
  databaseSequence += 1;
  const database = new VNextDatabase(`ogv-free-ride-store-${databaseSequence}`);
  let tick: (() => void) | null = null;
  const controller = createRideSessionController({
    repository: createRideSessionRepository({ database }),
    now: () => new Date(clock).toISOString(),
  });
  let clock = BASE + 5_000;
  const start = await controller.start({
    activity: "free",
    suggestions: input.suggestions,
    rideId: RIDE_ID,
    rideRevision: 0,
    at: new Date(BASE).toISOString(),
  });
  if (start.state === null) throw new Error("Free Ride did not start");
  let pointerValue: RideFocusPointerRead = {
    status: "found",
    pointer: {
      version: 1,
      sessionId: start.state.sessionId,
      rideId: RIDE_ID,
      routeGeometryRef: null,
      updatedAt: new Date(BASE).toISOString(),
    },
  };
  const writes: Omit<RideFocusPointer, "version">[] = [];
  const pointer: RideFocusPointerPort = {
    read: () => pointerValue,
    write: (value) => {
      writes.push(value);
      pointerValue = { status: "found", pointer: { version: 1, ...value } };
    },
    clear: () => { pointerValue = { status: "absent" }; },
  };
  const evaluate = input.evaluateLiveSuggestion === undefined
    ? undefined
    : vi.fn(input.evaluateLiveSuggestion);
  const store = createRideFocusStore({
    controller,
    environment,
    pointer,
    readRouteLine: input.readRouteLine ?? (async () => LINE),
    ...(evaluate === undefined ? {} : { evaluateLiveSuggestion: evaluate }),
    ...(input.readSavedHome === undefined ? {} : { readSavedHome: input.readSavedHome }),
    ...(input.returnPlanner === undefined ? {} : { returnPlanner: input.returnPlanner }),
    ...(input.reroutePlanner === undefined ? {} : { reroutePlanner: input.reroutePlanner }),
    ...(input.announceOpportunity === undefined ? {} : { announceOpportunity: input.announceOpportunity }),
    ...(input.feelOpportunity === undefined ? {} : { feelOpportunity: input.feelOpportunity }),
    ...(input.rideOffers === undefined ? {} : { rideOffers: input.rideOffers }),
    now: () => new Date(clock).toISOString(),
    setInterval: (handler) => { tick = handler; return 1; },
    clearInterval: () => undefined,
  });
  await store.getState().start();
  await store.getState().resume();
  clock += 1_000;
  const observedAt = new Date(clock).toISOString();
  await controller.dispatch({
    type: "position.updated",
    at: observedAt,
    position: {
      coordinate: SESSION_START,
      observedAt,
      accuracyMeters: 5,
      headingDegrees: 40,
      speedMps: 12,
    },
  });
  store.getState().setMapReady(true);
  const moveTo = async (
    coordinate: { readonly lon: number; readonly lat: number },
    headingDegrees = 40,
    speedMps: number | null = 12,
  ): Promise<void> => {
    clock += 1_000;
    const at = new Date(clock).toISOString();
    await controller.dispatch({
      type: "position.updated",
      at,
      position: { coordinate, observedAt: at, accuracyMeters: 5, headingDegrees, speedMps },
    });
  };
  return {
    controller,
    database,
    evaluate,
    pointer,
    store,
    writes,
    advance: (ms = 1_000) => { clock += ms; },
    /** A fresh fix at `coordinate`, heading `headingDegrees`. */
    moveTo,
    /** Establishes the minimum real straight-running evidence for a new offer. */
    settleOfferAttention: async () => {
      await moveTo(SESSION_START);
      tick?.();
      await moveTo(SESSION_START);
      tick?.();
      await moveTo(SESSION_START);
      tick?.();
      await moveTo(SESSION_START);
      tick?.();
    },
    tick: () => tick?.(),
  };
}

describe("Ride Focus Free Ride actions", () => {
  it("does not query suggestions when their session policy is off", async () => {
    const evaluate = vi.fn(async (): Promise<LiveSuggestionResult> => ({ status: "quiet", reason: "none-ahead" }));
    const ride = await makeRide({ suggestions: "off", evaluateLiveSuggestion: evaluate });

    expect(ride.evaluate).not.toHaveBeenCalled();
    expect(ride.store.getState().suggestions).toBe("off");
    ride.store.getState().stop();
    ride.database.close();
  });

  it("clears the stale location warning once fresh GPS has returned", async () => {
    const evaluate = vi.fn(async (): Promise<LiveSuggestionResult> => ({ status: "quiet", reason: "gps" }));
    const ride = await makeRide({ suggestions: "on", evaluateLiveSuggestion: evaluate });
    await vi.waitFor(() => expect(ride.store.getState().freeRideStatusMessage).toBe("Live suggestions need a fresh, accurate location."));

    ride.tick();

    expect(ride.store.getState().navigation?.position.quality).toBe("fresh-good");
    expect(ride.store.getState().freeRideStatusMessage).toBeNull();
    expect(evaluate).toHaveBeenCalledOnce();

    ride.store.getState().stop();
    ride.database.close();
  });

  it("previews a suggestion without taking camera ownership from Free Ride", async () => {
    const suggestion = {
      id: "ahead-road",
      label: "Oak Hollow Road",
      entry: { lon: -77.19, lat: 40.11 },
      distanceToDecisionMeters: 600,
      distanceMeters: 1_200,
      route: { planningGeneration: 9, routeId: asRouteCandidateId("route_suggestion_preview") },
      routeGeometryRef: "geo_suggestion_preview" as GeometryRef,
      durationSeconds: 300,
      headingDeltaDegrees: 15,
      requiresUTurn: false,
    };
    const ride = await makeRide({
      suggestions: "on",
      evaluateLiveSuggestion: async () => ({ status: "suggestion", suggestion }),
    });

    await vi.waitFor(() => expect(ride.store.getState().liveSuggestion).toEqual(suggestion));

    expect(ride.controller.snapshot()).toMatchObject({ activity: "free", plan: { route: null } });
    expect(ride.store.getState()).toMatchObject({
      routeLine: [],
      suggestionPreviewLine: LINE,
      follow: true,
      cameraExtent: null,
    });
    // The preview is drawn inside the current view. It does not replace the
    // heading-up follow camera with an overview fit.
    expect(ride.store.getState().rideCamera).not.toBeNull();

    ride.store.getState().stop();
    ride.database.close();
  });

  it("queries only when on, binds accepted suggestions and Head Home to the same session", async () => {
    const suggestion = {
      id: "ahead-road",
      label: "Oak Hollow Road",
      entry: { lon: -77.19, lat: 40.11 },
      distanceToDecisionMeters: 600,
      distanceMeters: 1_200,
      route: { planningGeneration: 9, routeId: asRouteCandidateId("route_suggestion") },
      routeGeometryRef: "geo_suggestion" as GeometryRef,
      durationSeconds: 300,
      headingDeltaDegrees: 15,
      requiresUTurn: false,
    };
    const evaluate = vi.fn(async (): Promise<LiveSuggestionResult> => ({ status: "suggestion", suggestion }));
    const planHome = vi.fn(async () => ({
      status: "planned" as const,
      route: { planningGeneration: 10, routeId: asRouteCandidateId("route_home") },
      routeGeometryRef: "geo_home" as GeometryRef,
      durationSeconds: 600,
      distanceMeters: 4_000,
    }));
    const ride = await makeRide({
      suggestions: "on",
      evaluateLiveSuggestion: evaluate,
      readSavedHome: () => SAVED_HOME,
      returnPlanner: { plan: planHome },
    });
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(ride.store.getState().liveSuggestion).toEqual(suggestion));
    const originalSessionId = ride.controller.snapshot()?.sessionId;

    ride.advance();
    await ride.store.getState().acceptLiveSuggestion();
    expect(ride.controller.snapshot()).toMatchObject({
      sessionId: originalSessionId,
      activity: "guided",
      plan: { route: suggestion.route },
    });
    expect(ride.writes.at(-1)).toMatchObject({ routeGeometryRef: suggestion.routeGeometryRef });

    ride.advance();
    await ride.store.getState().continueFreeRide();
    expect(ride.controller.snapshot()).toMatchObject({ sessionId: originalSessionId, activity: "free" });

    ride.store.getState().recenter();
    expect(ride.store.getState().follow).toBe(true);
    const cameraTokenBeforeReturn = ride.store.getState().cameraToken;
    ride.advance();
    await ride.store.getState().headHome();
    expect(planHome).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: "saved-home", coordinate: SAVED_HOME, label: "saved Home" },
    }));
    expect(ride.controller.snapshot()).toMatchObject({
      sessionId: originalSessionId,
      activity: "guided",
      plan: { route: { routeId: "route_home" } },
    });
    expect(ride.writes.at(-1)).toMatchObject({ routeGeometryRef: "geo_home" });
    expect(ride.store.getState().follow).toBe(true);
    expect(ride.store.getState().cameraToken).toBeGreaterThan(cameraTokenBeforeReturn);
    expect(ride.store.getState().routeLine).toEqual(LINE);

    ride.store.getState().stop();
    ride.database.close();
  });

  it("uses and names the session start when saved Home is not set", async () => {
    const planHome = vi.fn(async () => ({
      status: "planned" as const,
      route: { planningGeneration: 11, routeId: asRouteCandidateId("route_session_start") },
      routeGeometryRef: "geo_session_start" as GeometryRef,
      durationSeconds: 420,
      distanceMeters: 2_800,
    }));
    const ride = await makeRide({
      suggestions: "off",
      readSavedHome: () => null,
      returnPlanner: { plan: planHome },
    });

    await ride.store.getState().headHome();

    expect(planHome).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: "session-start", coordinate: SESSION_START, label: "your session start" },
    }));
    expect(ride.store.getState().freeRideStatusMessage).toBe("Returning to your session start.");
    expect(ride.controller.snapshot()).toMatchObject({
      activity: "guided",
      plan: { route: { routeId: "route_session_start" } },
    });

    ride.store.getState().stop();
    ride.database.close();
  });

  it("finds a lower-workload way back without starting a new RideSession", async () => {
    const planReturn = vi.fn(async () => ({
      status: "planned" as const,
      route: { planningGeneration: 12, routeId: asRouteCandidateId("route_easy") },
      routeGeometryRef: "geo_easy" as GeometryRef,
      durationSeconds: 480,
      distanceMeters: 2_800,
    }));
    const ride = await makeRide({
      suggestions: "off",
      readSavedHome: () => SAVED_HOME,
      returnPlanner: { plan: planReturn },
    });
    const sessionId = ride.controller.snapshot()?.sessionId;

    await ride.store.getState().easierWayBack();

    expect(planReturn).toHaveBeenCalledWith(expect.objectContaining({
      mode: "fatigue",
      target: { kind: "saved-home", coordinate: SAVED_HOME, label: "saved Home" },
    }));
    expect(ride.controller.snapshot()).toMatchObject({
      sessionId,
      activity: "guided",
      plan: { route: { routeId: "route_easy" } },
    });
    expect(ride.store.getState().freeRideStatusMessage).toBe("Easier route · 1.7 mi to go");

    ride.store.getState().stop();
    ride.database.close();
  });

  it("turns around by routing back to the session start instead of reversing geometry", async () => {
    const planReturn = vi.fn(async (request: { readonly mode: import("@/application/free-ride/return-routing").ReturnMode }) => ({
      status: "planned" as const,
      route: {
        planningGeneration: request.mode === "head-home" ? 11 : 12,
        routeId: asRouteCandidateId(request.mode === "head-home" ? "route_home" : "route_turn"),
      },
      routeGeometryRef: (request.mode === "head-home" ? "geo_home" : "geo_turn") as GeometryRef,
      durationSeconds: 420,
      distanceMeters: 3_200,
    }));
    const ride = await makeRide({
      suggestions: "off",
      readSavedHome: () => SAVED_HOME,
      returnPlanner: { plan: planReturn },
    });

    await ride.store.getState().headHome();
    expect(ride.controller.snapshot()?.activity).toBe("guided");
    await ride.store.getState().turnAround();

    expect(planReturn).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: "turn-around",
      target: { kind: "session-start", coordinate: SESSION_START, label: "Ride start" },
    }));
    expect(ride.controller.snapshot()).toMatchObject({
      activity: "guided",
      plan: { route: { routeId: "route_turn" } },
    });
    expect(ride.store.getState().rerouteMessage).toBe("Turned around · 2 mi to go");

    ride.store.getState().stop();
    ride.database.close();
  });

  it("aborts a pending Head Home plan when a suggestion changes the RideSession", async () => {
    const suggestion = {
      id: "ahead-road",
      label: "Oak Hollow Road",
      entry: { lon: -77.19, lat: 40.11 },
      distanceToDecisionMeters: 600,
      distanceMeters: 1_200,
      route: { planningGeneration: 9, routeId: asRouteCandidateId("route_suggestion") },
      routeGeometryRef: "geo_suggestion" as GeometryRef,
      durationSeconds: 300,
      headingDeltaDegrees: 15,
      requiresUTurn: false,
    };
    const evaluate = vi.fn(async (): Promise<LiveSuggestionResult> => ({ status: "suggestion", suggestion }));
    let resolveHome: (result: Extract<ReturnPlanResult, { readonly status: "planned" }>) => void = () => undefined;
    const pendingHome = new Promise<Extract<ReturnPlanResult, { readonly status: "planned" }>>((resolve) => {
      resolveHome = resolve;
    });
    const planHome = vi.fn((request: { readonly signal: AbortSignal }) => {
      void request;
      return pendingHome;
    });
    const ride = await makeRide({
      suggestions: "on",
      evaluateLiveSuggestion: evaluate,
      readSavedHome: () => SAVED_HOME,
      returnPlanner: { plan: planHome },
    });
    await vi.waitFor(() => expect(ride.store.getState().liveSuggestion).toEqual(suggestion));

    const headHome = ride.store.getState().headHome();
    await vi.waitFor(() => expect(planHome).toHaveBeenCalledOnce());
    const signal = planHome.mock.calls[0]?.[0].signal;
    await ride.store.getState().acceptLiveSuggestion();

    expect(signal?.aborted).toBe(true);
    resolveHome({
      status: "planned",
      route: { planningGeneration: 10, routeId: asRouteCandidateId("route_home") },
      routeGeometryRef: "geo_home" as GeometryRef,
      durationSeconds: 600,
      distanceMeters: 4_000,
    });
    await headHome;
    expect(ride.controller.snapshot()).toMatchObject({
      activity: "guided",
      plan: { route: { routeId: "route_suggestion" } },
    });

    ride.store.getState().stop();
    ride.database.close();
  });

  it("does not bind a Head Home route planned for an older RideDocument revision", async () => {
    let resolveHome: (result: Extract<ReturnPlanResult, { readonly status: "planned" }>) => void = () => undefined;
    const pendingHome = new Promise<Extract<ReturnPlanResult, { readonly status: "planned" }>>((resolve) => {
      resolveHome = resolve;
    });
    const planHome = vi.fn(() => pendingHome);
    const ride = await makeRide({
      suggestions: "off",
      readSavedHome: () => SAVED_HOME,
      returnPlanner: { plan: planHome },
    });

    const headHome = ride.store.getState().headHome();
    await vi.waitFor(() => expect(planHome).toHaveBeenCalledOnce());
    ride.advance();
    const revised = await ride.controller.dispatch(rideRevisedEvent({
      rideRevision: 1,
      route: null,
    }, new Date(BASE + 7_000).toISOString()));
    expect(revised.outcome).toBe("applied");

    resolveHome({
      status: "planned",
      route: { planningGeneration: 10, routeId: asRouteCandidateId("route_home") },
      routeGeometryRef: "geo_home" as GeometryRef,
      durationSeconds: 600,
      distanceMeters: 4_000,
    });
    await headHome;

    expect(ride.controller.snapshot()).toMatchObject({
      activity: "free",
      plan: { rideRevision: 1, route: null },
    });
    expect(ride.writes).toHaveLength(0);
    expect(ride.store.getState().freeRideError).toMatch(/Ride details changed/);

    ride.store.getState().stop();
    ride.database.close();
  });
});

describe("Ride Focus reroute", () => {
  const homePlan = vi.fn(async () => ({
    status: "planned" as const,
    route: { planningGeneration: 11, routeId: asRouteCandidateId("route_home") },
    routeGeometryRef: "geo_home" as GeometryRef,
    durationSeconds: 600,
    distanceMeters: 4_000,
  }));

  async function guidedRide(reroutePlanner: GuidedReroutePlanner) {
    const ride = await makeRide({ suggestions: "off", readSavedHome: () => SAVED_HOME, returnPlanner: { plan: homePlan }, reroutePlanner });
    await ride.store.getState().headHome();
    expect(ride.controller.snapshot()?.activity).toBe("guided");
    return ride;
  }

  it("routes through a chosen detour and binds the new route", async () => {
    const plan = vi.fn<GuidedReroutePlanner["plan"]>(async () => ({
      status: "planned" as const,
      route: { planningGeneration: 12, routeId: asRouteCandidateId("route_via_fuel") },
      routeGeometryRef: "geo_via_fuel" as GeometryRef,
      durationSeconds: 700,
      distanceMeters: 5_000,
    }));
    const ride = await guidedRide({ plan });
    expect(ride.store.getState().rerouteAvailable).toBe(true);

    await ride.store.getState().reroute({ coordinate: { lon: -77.3, lat: 40.2 }, label: "Sunoco" });

    expect(plan).toHaveBeenCalledWith(expect.objectContaining({ detour: { coordinate: { lon: -77.3, lat: 40.2 }, label: "Sunoco" } }));
    expect(ride.controller.snapshot()).toMatchObject({ activity: "guided", plan: { route: { routeId: "route_via_fuel" } } });
    expect(ride.writes.at(-1)).toMatchObject({ routeGeometryRef: "geo_via_fuel", routeDurationSeconds: 700 });
    expect(ride.store.getState()).toMatchObject({ rerouteBusy: false, rerouteError: null, rerouteMessage: "Via Sunoco · 3.1 mi to go" });

    ride.store.getState().stop();
    ride.database.close();
  });

  it("plans a loop from here in Free Ride, and a missed turn gets the rider back on it", async () => {
    const reroutePlan = vi.fn<GuidedReroutePlanner["plan"]>(async () => ({ status: "unavailable" as const, reason: "no-route" as const }));
    const returnPlan = vi.fn(async (request: { readonly mode: import("@/application/free-ride/return-routing").ReturnMode; readonly fallbackToBest?: boolean }) => ({
      status: "planned" as const,
      route: {
        planningGeneration: request.fallbackToBest === true ? 50 + returnPlan.mock.calls.length : 40,
        routeId: asRouteCandidateId(`route_loop_${returnPlan.mock.calls.length}`),
      },
      routeGeometryRef: "geo_loop" as GeometryRef,
      durationSeconds: 7_000,
      distanceMeters: request.fallbackToBest === true ? 1_609 : 80_467,
    }));
    const ride = await makeRide({ suggestions: "off", returnPlanner: { plan: returnPlan }, reroutePlanner: { plan: reroutePlan } });

    await ride.store.getState().loopFromHere(120);
    expect(returnPlan).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: "loop",
      loopMinutes: 120,
      target: expect.objectContaining({ kind: "session-start", label: "Loop start" }),
    }));
    expect(ride.controller.snapshot()?.activity).toBe("guided");
    expect(ride.store.getState().freeRideStatusMessage).toBe("Loop from here · 50 mi");

    ride.advance();
    await ride.store.getState().reroute();
    expect(returnPlan).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: "loop",
      fallbackToBest: true,
      target: expect.objectContaining({ label: "Loop start" }),
    }));
    expect(returnPlan.mock.lastCall?.[0]).not.toHaveProperty("loopMinutes");
    expect(ride.store.getState().rerouteMessage).toBe("Back on your loop · 1 mi to go");
    expect(reroutePlan).not.toHaveBeenCalled();
    ride.store.getState().stop();
    ride.database.close();
  });

  it("keeps a turn-around heading back to the ride start when the rider reroutes or goes off the line", async () => {
    const reroutePlan = vi.fn<GuidedReroutePlanner["plan"]>(async () => ({ status: "unavailable" as const, reason: "no-route" as const }));
    const returnPlan = vi.fn(async (request: { readonly mode: import("@/application/free-ride/return-routing").ReturnMode; readonly fallbackToBest?: boolean }) => ({
      status: "planned" as const,
      route: {
        planningGeneration: request.fallbackToBest === true ? 30 + returnPlan.mock.calls.length : 20,
        routeId: asRouteCandidateId(`route_back_${returnPlan.mock.calls.length}`),
      },
      routeGeometryRef: "geo_back" as GeometryRef,
      durationSeconds: 300,
      distanceMeters: 1_609,
    }));
    const ride = await makeRide({ suggestions: "off", readSavedHome: () => SAVED_HOME, returnPlanner: { plan: returnPlan }, reroutePlanner: { plan: reroutePlan } });
    await ride.store.getState().turnAround();
    expect(ride.controller.snapshot()?.activity).toBe("guided");
    const back = { kind: "session-start", coordinate: SESSION_START, label: "Ride start" };

    ride.advance();
    await ride.store.getState().reroute();
    expect(returnPlan).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "turn-around", target: back, fallbackToBest: true }));
    expect(ride.store.getState().rerouteMessage).toBe("New way back · 1 mi to go");

    ride.advance();
    await ride.store.getState().reroute({ coordinate: { lon: -77.3, lat: 40.2 }, label: "Sunoco" });
    expect(returnPlan).toHaveBeenLastCalledWith(expect.objectContaining({ target: back, via: { coordinate: { lon: -77.3, lat: 40.2 }, label: "Sunoco" } }));
    expect(ride.store.getState().rerouteMessage).toBe("Via Sunoco · 1 mi to go");

    expect(reroutePlan).not.toHaveBeenCalled();
    ride.store.getState().stop();
    ride.database.close();
  });

  it("replans by itself once the rider is off the route, then waits out a cooldown", async () => {
    const plan = vi.fn<GuidedReroutePlanner["plan"]>(async () => ({ status: "unavailable" as const, reason: "no-route" as const }));
    const ride = await guidedRide({ plan });

    await ride.controller.dispatch({ type: "off-route.changed", at: new Date(BASE + 8_000).toISOString(), state: "off-route" } as never);
    ride.tick();
    await vi.waitFor(() => expect(plan).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(ride.store.getState().rerouteError).toBe("A new route couldn't be found right now. Keep riding toward the line."));

    ride.tick();
    expect(plan).toHaveBeenCalledOnce();

    ride.store.getState().stop();
    ride.database.close();
  });

  describe("copilot (FREE-RIDE-COPILOT §2, §6)", () => {
    const opportunity = {
      id: "ahead-road",
      label: "Oak Hollow Road",
      entry: { lon: -77.19, lat: 40.11 },
      distanceToDecisionMeters: 1_500,
      distanceMeters: 1_600,
      route: { planningGeneration: 9, routeId: asRouteCandidateId("route_opportunity") },
      routeGeometryRef: "geo_opportunity" as GeometryRef,
      durationSeconds: 300,
      headingDeltaDegrees: 15,
      requiresUTurn: false,
    };

    it("keeps a valid opportunity through query ticks and says it once (FR-03)", async () => {
      const announce = vi.fn();
      const feel = vi.fn();
      const ride = await makeRide({
        suggestions: "on",
        evaluateLiveSuggestion: async () => ({ status: "suggestion", suggestion: opportunity }),
        announceOpportunity: announce,
        feelOpportunity: feel,
      });
      await vi.waitFor(() => expect(ride.store.getState().liveSuggestion).toEqual(opportunity));
      for (let step = 1; step <= 3; step += 1) {
        ride.advance(31_000);
        await ride.moveTo({ lon: -77.2 + step * 0.001, lat: 40.1 + step * 0.001 });
        ride.tick();
      }
      expect(ride.evaluate).toHaveBeenCalledOnce();
      expect(ride.store.getState().liveSuggestion).toEqual(opportunity);
      expect(ride.store.getState().liveSuggestionDistanceMeters).toBeLessThan(opportunity.distanceToDecisionMeters);
      expect(announce).toHaveBeenCalledOnce();
      expect(announce.mock.calls[0]?.[0]).toMatch(/^Oak Hollow Road, ahead in /);
      expect(feel).toHaveBeenCalledWith("opportunity");
      ride.store.getState().stop();
      ride.database.close();
    });

    it("drops the opportunity once the rider has passed its decision point", async () => {
      const ride = await makeRide({
        suggestions: "on",
        evaluateLiveSuggestion: async () => ({ status: "suggestion", suggestion: opportunity }),
      });
      await vi.waitFor(() => expect(ride.store.getState().liveSuggestion).toEqual(opportunity));
      await ride.moveTo({ lon: -77.185, lat: 40.115 });
      ride.tick();
      expect(ride.store.getState().liveSuggestion).toBeNull();
      expect(ride.store.getState().suggestionPreviewLine).toEqual([]);
      ride.store.getState().stop();
      ride.database.close();
    });

    it("returns to Free Ride by itself at the end of a taken opportunity (FR-04)", async () => {
      const feel = vi.fn();
      const ride = await makeRide({
        suggestions: "on",
        evaluateLiveSuggestion: async () => ({ status: "suggestion", suggestion: opportunity }),
        feelOpportunity: feel,
      });
      await vi.waitFor(() => expect(ride.store.getState().liveSuggestion).toEqual(opportunity));
      const sessionId = ride.controller.snapshot()?.sessionId;
      ride.advance();
      await ride.store.getState().acceptLiveSuggestion();
      expect(ride.controller.snapshot()).toMatchObject({ sessionId, activity: "guided" });
      expect(feel).toHaveBeenCalledWith("accepted");
      ride.tick();
      // The segment's end (LINE's last point).
      await ride.moveTo({ lon: -77.19, lat: 40.11 });
      ride.tick();
      await vi.waitFor(() => expect(ride.controller.snapshot()).toMatchObject({ sessionId, activity: "free" }));
      await vi.waitFor(() => expect(ride.store.getState().freeRideStatusMessage).toBe("Back to Free Ride."));
      expect(feel).toHaveBeenCalledWith("returned");
      ride.store.getState().stop();
      ride.database.close();
    });
  });
});

describe("Free Ride ride offers (#14)", () => {
  function planned(id: string, minutes: number): ReturnPlanResult {
    return {
      status: "planned",
      route: { planningGeneration: 50 + minutes, routeId: asRouteCandidateId(`route_offer_${id}`) },
      routeGeometryRef: `geo_offer_${id}` as GeometryRef,
      durationSeconds: minutes * 60,
      distanceMeters: minutes * 800,
    };
  }

  it("plans the best offer, shows it with a summary, and speaks it once", async () => {
    const plan = vi.fn(async (request: { readonly mode: string; readonly loopMinutes?: number }) =>
      planned(`loop${request.loopMinutes ?? 0}`, request.loopMinutes ?? 30));
    const announce = vi.fn();
    const ride = await makeRide({ suggestions: "on", rideOffers: true, returnPlanner: { plan }, announceOpportunity: announce });
    await ride.settleOfferAttention();

    await vi.waitFor(() => expect(ride.store.getState().rideOffer).not.toBeNull());
    expect(ride.store.getState().rideOffer).toMatchObject({ id: "loop:45", summary: { minutes: 45, chips: ["Curvy", "Back here"] } });
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({ mode: "loop", loopMinutes: 45 }));
    expect(ride.store.getState().suggestionPreviewLine).toEqual(LINE);
    expect(ride.store.getState().routeLine).toEqual([]);
    expect(ride.store.getState().routeLineAvailable).toBe(false);
    expect(announce).toHaveBeenCalledOnce();
    // Nothing is bound until the rider takes it.
    expect(ride.controller.snapshot()).toMatchObject({ activity: "free", plan: { route: null } });

    ride.store.getState().stop();
    ride.database.close();
  });

  it("swipe right binds the offer as a guided ride that hands back to Free Ride", async () => {
    const plan = vi.fn(async () => planned("take", 45));
    const ride = await makeRide({ suggestions: "on", rideOffers: true, returnPlanner: { plan } });
    await ride.settleOfferAttention();
    await vi.waitFor(() => expect(ride.store.getState().rideOffer).not.toBeNull());

    await ride.store.getState().acceptRideOffer();

    expect(ride.controller.snapshot()).toMatchObject({ activity: "guided", plan: { route: { routeId: "route_offer_take" } } });
    expect(ride.writes.at(-1)).toMatchObject({ routeGeometryRef: "geo_offer_take", routeDurationSeconds: 2_700 });
    expect(ride.store.getState()).toMatchObject({
      rideOffer: null,
      routeLine: LINE,
      routeLineAvailable: true,
      freeRideStatusMessage: "Riding your loop. Free Ride picks up back here.",
    });

    ride.store.getState().stop();
    ride.database.close();
  });

  it("swipe left never brings that offer back, and a moving rider waits for the next", async () => {
    const plan = vi.fn(async (request: { readonly loopMinutes?: number }) =>
      planned(`loop${request.loopMinutes ?? 0}`, request.loopMinutes ?? 30));
    const ride = await makeRide({ suggestions: "on", rideOffers: true, returnPlanner: { plan } });
    await ride.settleOfferAttention();
    await vi.waitFor(() => expect(ride.store.getState().rideOffer?.id).toBe("loop:45"));

    ride.store.getState().skipRideOffer();
    expect(ride.store.getState().rideOffer).toBeNull();
    await ride.moveTo({ lon: -77.199, lat: 40.101 });
    ride.tick();
    expect(ride.store.getState().rideOfferBusy).toBe(false);
    expect(ride.store.getState().rideOffer).toBeNull();

    ride.advance(180_000);
    await ride.settleOfferAttention();
    await vi.waitFor(() => expect(ride.store.getState().rideOffer?.id).toBe("loop:90"));

    ride.store.getState().stop();
    ride.database.close();
  });

  it("an ignored offer lapses and counts as a skip", async () => {
    const plan = vi.fn(async () => planned("lapse", 45));
    const ride = await makeRide({ suggestions: "on", rideOffers: true, returnPlanner: { plan } });
    await ride.settleOfferAttention();
    await vi.waitFor(() => expect(ride.store.getState().rideOffer).not.toBeNull());
    const lifetime = ride.store.getState().rideOffer?.lifetimeMs ?? 0;

    ride.advance(lifetime);
    ride.tick();

    expect(ride.store.getState().rideOffer).toBeNull();
    ride.store.getState().stop();
    ride.database.close();
  });

  it("does not start a whole-ride offer when speed is unknown, even when requested", async () => {
    const plan = vi.fn(async () => planned("unknown-speed", 45));
    const ride = await makeRide({ suggestions: "on", rideOffers: true, returnPlanner: { plan } });

    await ride.moveTo(SESSION_START, 40, null);
    ride.tick();
    ride.store.getState().requestRideOffer();

    expect(plan).not.toHaveBeenCalled();
    expect(ride.store.getState().rideOffer).toBeNull();
    ride.store.getState().stop();
    ride.database.close();
  });

  it("does not publish an offer planned before the rider turns", async () => {
    let resolvePlan: (result: ReturnPlanResult) => void = () => undefined;
    const pendingPlan = new Promise<ReturnPlanResult>((resolve) => { resolvePlan = resolve; });
    const plan = vi.fn(() => pendingPlan);
    const ride = await makeRide({ suggestions: "on", rideOffers: true, returnPlanner: { plan } });
    await ride.settleOfferAttention();
    await vi.waitFor(() => expect(plan).toHaveBeenCalledOnce());

    await ride.moveTo(SESSION_START, 120);
    ride.tick();
    resolvePlan(planned("turned", 45));
    await vi.waitFor(() => expect(ride.store.getState().rideOfferBusy).toBe(false));

    expect(ride.store.getState().rideOffer).toBeNull();
    ride.store.getState().stop();
    ride.database.close();
  });

  it("rechecks suggestion eligibility before publishing a completed plan", async () => {
    let resolvePlan: (result: ReturnPlanResult) => void = () => undefined;
    const pendingPlan = new Promise<ReturnPlanResult>((resolve) => { resolvePlan = resolve; });
    const plan = vi.fn(() => pendingPlan);
    const ride = await makeRide({ suggestions: "on", rideOffers: true, returnPlanner: { plan } });
    await ride.settleOfferAttention();
    await vi.waitFor(() => expect(plan).toHaveBeenCalledOnce());

    ride.advance();
    const changed = await ride.controller.dispatch(suggestionsChangedEvent("off", new Date(BASE + 11_000).toISOString()));
    expect(changed.outcome).toBe("applied");
    resolvePlan(planned("suggestions-off", 45));
    await vi.waitFor(() => expect(ride.store.getState().rideOfferBusy).toBe(false));

    expect(ride.store.getState().rideOffer).toBeNull();
    ride.store.getState().stop();
    ride.database.close();
  });

  it("skips an offer when its route geometry is unavailable", async () => {
    const plan = vi.fn(async () => plan.mock.calls.length === 1
      ? planned("missing-line", 45)
      : { status: "unavailable" as const, reason: "no-route" as const });
    const ride = await makeRide({
      suggestions: "on",
      rideOffers: true,
      returnPlanner: { plan },
      readRouteLine: async () => null,
    });
    await ride.settleOfferAttention();
    await vi.waitFor(() => expect(ride.store.getState().rideOfferBusy).toBe(false));

    expect(plan).toHaveBeenCalledTimes(2);
    expect(ride.store.getState()).toMatchObject({
      rideOffer: null,
      rideOfferBusy: false,
      suggestionPreviewLine: [],
    });
    ride.store.getState().stop();
    ride.database.close();
  });

  it("clears public offer state when the store stops", async () => {
    const plan = vi.fn(async () => planned("stop", 45));
    const ride = await makeRide({ suggestions: "on", rideOffers: true, returnPlanner: { plan } });
    await ride.settleOfferAttention();
    await vi.waitFor(() => expect(ride.store.getState().rideOffer).not.toBeNull());

    ride.store.getState().stop();

    expect(ride.store.getState()).toMatchObject({
      rideOffer: null,
      rideOfferBusy: false,
      suggestionPreviewLine: [],
    });
    ride.database.close();
  });

  it("does not start a whole-ride planner while a segment suggestion is pending", async () => {
    const suggestion = {
      id: "ahead-road",
      label: "Oak Hollow Road",
      entry: { lon: -77.19, lat: 40.11 },
      distanceToDecisionMeters: 600,
      distanceMeters: 1_200,
      route: { planningGeneration: 9, routeId: asRouteCandidateId("route_competing") },
      routeGeometryRef: "geo_competing" as GeometryRef,
      durationSeconds: 300,
      headingDeltaDegrees: 15,
      requiresUTurn: false,
    };
    let resolveSuggestion: (result: LiveSuggestionResult) => void = () => undefined;
    const pendingSuggestion = new Promise<LiveSuggestionResult>((resolve) => { resolveSuggestion = resolve; });
    const evaluate = vi.fn(() => pendingSuggestion);
    const plan = vi.fn(async () => planned("competing-offer", 45));
    const ride = await makeRide({
      suggestions: "on",
      evaluateLiveSuggestion: evaluate,
      rideOffers: true,
      returnPlanner: { plan },
    });
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledOnce());
    await ride.settleOfferAttention();

    expect(ride.store.getState().suggestionBusy).toBe(true);
    expect(plan).not.toHaveBeenCalled();
    resolveSuggestion({ status: "suggestion", suggestion });
    await vi.waitFor(() => expect(ride.store.getState().liveSuggestion).toEqual(suggestion));

    expect(plan).not.toHaveBeenCalled();
    expect(ride.store.getState().suggestionPreviewLine).toEqual(LINE);
    ride.store.getState().stop();
    ride.database.close();
  });

  it("stays off unless the composition root turns offers on", async () => {
    const plan = vi.fn(async () => planned("off", 45));
    const ride = await makeRide({ suggestions: "on", returnPlanner: { plan } });
    ride.tick();
    await Promise.resolve();
    expect(plan).not.toHaveBeenCalled();
    expect(ride.store.getState().rideOffersAvailable).toBe(false);
    ride.store.getState().stop();
    ride.database.close();
  });
});
