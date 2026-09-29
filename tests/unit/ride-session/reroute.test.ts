import { describe, expect, it } from "vitest";

import type { RideSessionRepositoryPort } from "@/application/persistence/ride-session-repository";
import {
  buildRerouteRequest,
  rerouteOfferState,
  rerouteRideSession,
  type ReroutePlannerPort,
} from "@/application/ride-session/reroute";
import { lineAhead, loopRejoinAnchors } from "@/application/ride-session/loop-rejoin";
import { createRideSessionController } from "@/application/ride-session/ride-session-controller";
import type { PlanRequestContext } from "@/application/planner/build-plan-request";
import type {
  ProviderCandidate,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { RoutePlanCandidate } from "@/application/planner/ports/route-plan-contract";
import type { GeometryPayload } from "@/domain/geometry/types";
import { asRecordingId } from "@/domain/recording/ids";
import { createRideDocument, defaultRideIntent } from "@/domain/ride/create";
import {
  asGeometryRef,
  newRideId,
  type AvoidAreaId,
  type PointId,
  type RideId,
  type RoadSpanId,
  type ShapingId,
  type StopId,
} from "@/domain/ride/ids";
import type {
  Coordinate,
  RideDocument,
  RideIntent,
  StopPoint,
} from "@/domain/ride/types";
import { asRideSessionId } from "@/domain/ride-session/ids";
import type {
  RideSessionEvent,
  SessionRouteBinding,
} from "@/domain/ride-session/types";
import { asRouteCandidateId } from "@/domain/route/ids";
import type { RouteScoreComponents } from "@/domain/route/types";
import { planRide } from "@/server/planning/plan-service";

const BASE = Date.parse("2026-09-22T12:00:00.000Z");

function at(seconds: number): string {
  return new Date(BASE + seconds * 1_000).toISOString();
}

const CURRENT: Coordinate = { lon: -75.7, lat: 40.1 };
const FINISH: Coordinate = { lon: -75.1, lat: 40.5 };
const COMPLETED_COORDINATE: Coordinate = { lon: -75.6, lat: 40.2 };
const FUEL_COORDINATE: Coordinate = { lon: -75.4, lat: 40.3 };
const FOOD_COORDINATE: Coordinate = { lon: -75.2, lat: 40.4 };

const COMPLETED = "stop_completed" as StopId;
const FUEL = "stop_fuel" as StopId;
const FOOD = "stop_food" as StopId;

function point(id: string, kind: "start" | "finish", coordinate: Coordinate) {
  return {
    id: id as PointId,
    kind,
    coordinate,
    provenance: { type: "map" as const, selectedAt: at(0) },
  };
}

function stop(id: StopId, coordinate: Coordinate): StopPoint {
  return {
    id,
    kind: "stop",
    coordinate,
    provenance: { type: "map", selectedAt: at(0) },
  };
}

function documentWithIntent(intent: RideIntent, rideId: RideId = newRideId()): RideDocument {
  const document = createRideDocument({ rideId, now: at(0) });
  return {
    ...document,
    revision: 7,
    intent,
    history: { ...document.history, baseIntent: intent },
  };
}

function rideIntent(): RideIntent {
  return {
    ...defaultRideIntent(),
    shape: "destination",
    start: point("pt_original_start", "start", { lon: -75.8, lat: 40 }),
    finish: point("pt_finish", "finish", FINISH),
    stops: [
      stop(COMPLETED, COMPLETED_COORDINATE),
      stop(FUEL, FUEL_COORDINATE),
      stop(FOOD, FOOD_COORDINATE),
    ],
    time: { kind: "returnBy", localTime: "17:30", date: "2026-09-22", toleranceMinutes: 15 },
    roadCharacter: "curvy",
    surface: {
      preference: "dirt-preferred",
      targetUnpavedShare: { min: 0.25, target: 0.4, max: 0.6 },
      unknownSurfacePolicy: "avoid-when-possible",
    },
    traffic: "protect-ride",
    avoidHighways: true,
  };
}

function requestContext(
  payloads: Readonly<Record<string, GeometryPayload>> = {},
  profileFor?: (intent: RideIntent) => string,
): PlanRequestContext {
  return {
    requestId: "req_reroute",
    includeAlternatives: true,
    resolveGeometry: (ref) => payloads[ref] ?? null,
    ...(profileFor === undefined ? {} : { profileFor }),
  };
}

describe("buildRerouteRequest", () => {
  it("uses pending stops in session order and cannot put a completed stop back on the road", async () => {
    const intent = rideIntent();

    const built = await buildRerouteRequest(
      {
        currentPosition: CURRENT,
        authoredIntent: intent,
        remainingStopIds: [FOOD, FUEL],
        completedStopIds: [COMPLETED],
      },
      requestContext(),
    );

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.origin).toEqual(CURRENT);
    expect(built.request.destination).toEqual(FINISH);
    expect(built.request.stops).toEqual([FOOD_COORDINATE, FUEL_COORDINATE]);
    expect(built.rerouteIntent.stops.map((entry) => entry.id)).toEqual([FOOD, FUEL]);

    const reintroduced = await buildRerouteRequest(
      {
        currentPosition: CURRENT,
        authoredIntent: intent,
        remainingStopIds: [COMPLETED, FUEL],
        completedStopIds: [COMPLETED],
      },
      requestContext(),
    );

    expect(reintroduced).toMatchObject({
      ok: false,
      failure: { code: "completed-stop-reintroduced", stopId: COMPLETED },
    });
  });

  it("preserves authored exclusions, spans, sketch, surface, bike, traffic, and time intent", async () => {
    const avoidRef = asGeometryRef("geo_avoid_reroute");
    const spanRef = asGeometryRef("geo_span_reroute");
    const sketchRef = asGeometryRef("geo_sketch_reroute");
    const polygon: GeometryPayload = {
      kind: "polygon",
      rings: [[
        { lon: -75.5, lat: 40.35 },
        { lon: -75.45, lat: 40.35 },
        { lon: -75.45, lat: 40.38 },
        { lon: -75.5, lat: 40.35 },
      ]],
    };
    const line: GeometryPayload = {
      kind: "line",
      coordinates: [
        { lon: -75.35, lat: 40.32 },
        { lon: -75.3, lat: 40.36 },
      ],
    };
    const authored = rideIntent();
    const intent: RideIntent = {
      ...authored,
      bike: { ...authored.bike, category: "dual-sport", roughTracks: "allow" },
      avoidAreas: [{
        id: "avoid_reroute" as AvoidAreaId,
        name: "closure",
        geometryRef: avoidRef,
        enabled: true,
        createdBy: "rider",
      }],
      roadSpans: [{
        id: "span_reroute" as RoadSpanId,
        mode: "must",
        direction: "forward",
        geometryRef: spanRef,
        anchorRefs: line.coordinates,
      }],
      sketch: {
        id: "sketch_reroute" as never,
        rawStrokeRefs: [sketchRef],
        corridorRef: sketchRef,
        topologyHints: [],
        endpointPolicy: "derive",
      },
    };
    let projected: RideIntent | null = null;

    const built = await buildRerouteRequest(
      {
        currentPosition: CURRENT,
        authoredIntent: intent,
        remainingStopIds: [FUEL, FOOD],
        completedStopIds: [COMPLETED],
      },
      requestContext(
        { [avoidRef]: polygon, [spanRef]: line, [sketchRef]: line },
        (rerouteIntent) => {
          projected = rerouteIntent;
          return "motorcycle_adventure";
        },
      ),
    );

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(projected).toMatchObject({
      time: intent.time,
      surface: intent.surface,
      bike: intent.bike,
      traffic: "protect-ride",
      avoidAreas: intent.avoidAreas,
      roadSpans: intent.roadSpans,
      sketch: { corridorRef: sketchRef, endpointPolicy: "preserve-existing" },
    });
    expect(built.request.profile).toBe("motorcycle_adventure");
    expect(built.request.avoidPolygons).toEqual(polygon.rings);
    expect(built.request.roadSpans).toEqual([
      expect.objectContaining({ id: "span_reroute", mode: "must", corridor: line.coordinates }),
    ]);
    expect(built.request.sketch?.corridor).toEqual(line.coordinates);
    expect(built.request.options).toMatchObject({ avoidHighways: true, tollPolicy: "avoid" });
  });

  it("returns a typed failure when an active constraint cannot be resolved", async () => {
    const intent: RideIntent = {
      ...rideIntent(),
      avoidAreas: [{
        id: "avoid_missing" as AvoidAreaId,
        name: null,
        geometryRef: asGeometryRef("geo_missing"),
        enabled: true,
        createdBy: "rider",
      }],
    };

    const built = await buildRerouteRequest(
      {
        currentPosition: CURRENT,
        authoredIntent: intent,
        remainingStopIds: [FUEL, FOOD],
        completedStopIds: [COMPLETED],
      },
      requestContext(),
    );

    expect(built).toMatchObject({
      ok: false,
      failure: { code: "constraint-unresolved", geometryRefs: ["geo_missing"] },
    });
  });

  it("keeps an authored loop's original start as the return target", async () => {
    const intent: RideIntent = { ...rideIntent(), shape: "loop", finish: null };

    const built = await buildRerouteRequest(
      {
        currentPosition: CURRENT,
        authoredIntent: intent,
        remainingStopIds: [FUEL, FOOD],
        completedStopIds: [COMPLETED],
      },
      requestContext(),
    );

    expect(built).toMatchObject({
      ok: true,
      request: {
        origin: CURRENT,
        destination: intent.start?.coordinate,
      },
    });
  });
});

describe("buildRerouteRequest for a loop with its line ahead", () => {
  /** A 0.1°-per-leg square loop (~11 km a side) east and north of its start. */
  const LOOP_START: Coordinate = { lon: -75.8, lat: 40 };
  const loopLine: readonly Coordinate[] = [
    LOOP_START,
    { lon: -75.7, lat: 40 },
    { lon: -75.7, lat: 40.1 },
    { lon: -75.8, lat: 40.1 },
    LOOP_START,
  ];

  it("rides back onto the rest of the loop instead of straight to the start", async () => {
    const intent: RideIntent = {
      ...rideIntent(),
      shape: "loop",
      finish: null,
      stops: [],
      shaping: [{ id: "shape_authored" as ShapingId, kind: "shape", coordinate: { lon: -75.75, lat: 40 }, source: "map-drag" }],
    };
    // The rider missed a turn early on the second leg.
    const ahead = lineAhead(loopLine, 9_000 + 2_000);

    const built = await buildRerouteRequest(
      { currentPosition: { lon: -75.69, lat: 40.02 }, authoredIntent: intent, remainingStopIds: [], completedStopIds: [], aheadLine: ahead },
      requestContext(),
    );

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.destination).toEqual(LOOP_START);
    // Anchors follow the rest of the loop: up leg two, across the top, down leg four.
    const shaping = built.request.shaping;
    expect(shaping.length).toBeGreaterThanOrEqual(4);
    expect(shaping.some((point) => point.lat > 40.09 && point.lon < -75.72)).toBe(true);
    expect(shaping.some((point) => point.lon < -75.79 && point.lat < 40.08)).toBe(true);
    // The authored shaping behind the rider is not ridden again.
    expect(shaping).not.toContainEqual({ lon: -75.75, lat: 40 });
  });

  it("anchors only after the last remaining stop, since stops are ridden first", () => {
    const ahead = lineAhead(loopLine, 5_000);
    const topLeftCorner: Coordinate = { lon: -75.8, lat: 40.1 };
    const anchors = loopRejoinAnchors(ahead, [topLeftCorner]);
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) expect(anchor.lon).toBeCloseTo(-75.8, 3);
  });

  it("adds nothing when the loop is nearly done, or without its line", async () => {
    expect(loopRejoinAnchors(lineAhead(loopLine, 38_500))).toEqual([]);
    const intent: RideIntent = { ...rideIntent(), shape: "loop", finish: null, stops: [] };
    const built = await buildRerouteRequest(
      { currentPosition: CURRENT, authoredIntent: intent, remainingStopIds: [], completedStopIds: [] },
      requestContext(),
    );
    expect(built.ok && built.request.shaping).toEqual([]);
  });

  it("cuts the line at the rider's matched distance", () => {
    const ahead = lineAhead(loopLine, 5_000);
    expect(ahead[0]?.lat).toBe(40);
    expect(ahead[0]?.lon).toBeGreaterThan(-75.8);
    expect(ahead[0]?.lon).toBeLessThan(-75.7);
    expect(ahead.at(-1)).toEqual(LOOP_START);
    expect(lineAhead(loopLine, 1e9)).toEqual([]);
  });
});

function scoreComponents(): RouteScoreComponents {
  const component = {
    input: null,
    weight: 0,
    contribution: 0,
    explanationKey: "test",
    evidenceStatus: "unknown" as const,
  };
  return {
    curvature: component,
    backroad: component,
    surfaceFit: component,
    elevation: component,
    traffic: component,
    junctionFriction: component,
    novelty: component,
    closureRisk: component,
    timeCost: component,
    confidence: component,
  };
}

function plannedCandidate(id = "route_new"): RoutePlanCandidate {
  return {
    id: asRouteCandidateId(id),
    provider: { providerId: "test", profile: "motorcycle" },
    geometry: [CURRENT, FUEL_COORDINATE, FOOD_COORDINATE, FINISH],
    distanceMeters: 50_000,
    durationSeconds: 3_600,
    eligibility: { eligible: true, failures: [] },
    evidence: {},
    score: { policyVersion: "test", total: 1, components: scoreComponents() },
    warnings: [],
    fingerprint: "chosen-route",
  };
}

function successfulPlanner(candidate = plannedCandidate()): ReroutePlannerPort {
  return {
    plan: async (input) => ({
      ok: true,
      identity: input.identity,
      bundle: {
        policyVersion: "policy-test",
        graphVersion: "graph-test",
        evidenceVersion: "evidence-test",
        candidates: [candidate],
        roles: {
          "best-ride": candidate.id,
          fastest: candidate.id,
          "fast-and-fun": null,
          "more-twisties": null,
          "more-dirt": null,
          "lower-workload": null,
        },
        selectedRouteId: candidate.id,
        selectionSource: "automatic",
      },
      diagnostics: { optionalProvidersUnavailable: [] },
    }),
  };
}

interface SessionHarness {
  readonly ride: RideDocument;
  readonly session: ReturnType<typeof createRideSessionController>;
  readonly journal: RideSessionEvent[];
  readonly oldBinding: SessionRouteBinding;
}

async function sessionHarness(): Promise<SessionHarness> {
  const ride = documentWithIntent(rideIntent());
  const journal: RideSessionEvent[] = [];
  const repository: RideSessionRepositoryPort = {
    async appendEvents(_sessionId, entries) {
      journal.push(...entries.map((entry) => entry.event));
      return { ok: true };
    },
    async checkpoint() {
      return { ok: true };
    },
    async loadSession() {
      return null;
    },
    async listSessions() {
      return [];
    },
    async deleteSession() {},
  };
  const session = createRideSessionController({ repository, now: () => at(2) });
  const oldBinding: SessionRouteBinding = {
    planningGeneration: 3,
    routeId: asRouteCandidateId("route_old"),
  };
  await session.start({
    sessionId: asRideSessionId("sess_reroute"),
    activity: "guided",
    rideId: ride.rideId,
    rideRevision: ride.revision,
    route: oldBinding,
    itinerary: [COMPLETED, FUEL, FOOD],
    recordingId: asRecordingId("rec_active"),
    at: at(0),
  });
  await session.dispatch({ type: "waypoint.arrived", at: at(0.5) });
  await session.dispatch({
    type: "position.updated",
    at: at(1),
    position: {
      coordinate: CURRENT,
      observedAt: at(1),
      accuracyMeters: 8,
      headingDegrees: 90,
      speedMps: 12,
    },
  });
  return { ride, session, journal, oldBinding };
}

describe("rerouteRideSession", () => {
  it("offers the control only for a sustained off-route state with a reliable fix", async () => {
    const harness = await sessionHarness();
    const state = harness.session.snapshot();
    if (state === null) throw new Error("session did not start");

    expect(rerouteOfferState(state, at(2))).toEqual({
      canOffer: false,
      reason: "not-off-route",
    });
    const changed = await harness.session.dispatch({
      type: "off-route.changed",
      state: "off-route",
      at: at(1.5),
    });
    if (changed.state === null) throw new Error("off-route state did not apply");
    expect(rerouteOfferState(changed.state, at(2))).toEqual({ canOffer: true });
    expect(rerouteOfferState(changed.state, at(30))).toEqual({
      canOffer: false,
      reason: "unreliable-position",
    });
  });

  it("binds the authoritative selection with exactly one journal event and preserves the activity", async () => {
    const harness = await sessionHarness();
    const before = harness.journal.length;

    const result = await rerouteRideSession({
      ride: harness.ride,
      session: harness.session,
      planner: successfulPlanner(),
      requestContext: requestContext(),
      now: () => at(2),
    });

    expect(result.outcome).toBe("succeeded");
    expect(harness.journal.slice(before)).toEqual([
      {
        type: "mode.changed",
        activity: "guided",
        at: at(2),
        route: { planningGeneration: 4, routeId: asRouteCandidateId("route_new") },
      },
    ]);
    expect(harness.session.snapshot()).toMatchObject({
      activity: "guided",
      recordingId: "rec_active",
      completedStopIds: [COMPLETED],
      remainingStopIds: [FUEL, FOOD],
      plan: { route: { planningGeneration: 4, routeId: "route_new" } },
    });
  });

  it("keeps the previous binding when planning fails", async () => {
    const harness = await sessionHarness();
    const before = harness.journal.length;
    const planner: ReroutePlannerPort = {
      plan: async () => ({
        ok: false,
        error: {
          code: "constraint-conflict",
          message: "Your constraints leave no eligible route.",
          recoverable: true,
        },
      }),
    };

    const result = await rerouteRideSession({
      ride: harness.ride,
      session: harness.session,
      planner,
      requestContext: requestContext(),
      now: () => at(2),
    });

    expect(result).toMatchObject({
      outcome: "failed",
      failure: { code: "planning-failed", planningCode: "constraint-conflict" },
    });
    expect(harness.session.snapshot()?.plan.route).toEqual(harness.oldBinding);
    expect(harness.journal).toHaveLength(before);
  });

  it("refuses a selected id that was not the pipeline's automatic role choice", async () => {
    const harness = await sessionHarness();
    const before = harness.journal.length;
    const selected = plannedCandidate("route_unranked");
    const best = plannedCandidate("route_best");
    const planner: ReroutePlannerPort = {
      plan: async (input) => ({
        ok: true,
        identity: input.identity,
        bundle: {
          policyVersion: "policy-test",
          graphVersion: "graph-test",
          evidenceVersion: "evidence-test",
          candidates: [selected, best],
          roles: {
            "best-ride": best.id,
            fastest: selected.id,
            "fast-and-fun": null,
            "more-twisties": null,
            "more-dirt": null,
            "lower-workload": null,
          },
          selectedRouteId: selected.id,
          selectionSource: "automatic",
        },
        diagnostics: { optionalProvidersUnavailable: [] },
      }),
    };

    const result = await rerouteRideSession({
      ride: harness.ride,
      session: harness.session,
      planner,
      requestContext: requestContext(),
      now: () => at(2),
    });

    expect(result).toEqual({
      outcome: "failed",
      failure: { code: "selection-not-authoritative" },
    });
    expect(harness.session.snapshot()?.plan.route).toEqual(harness.oldBinding);
    expect(harness.journal).toHaveLength(before);
  });

  it("cancels while geometry-backed request preparation is still pending", async () => {
    const avoidRef = asGeometryRef("geo_slow_avoid");
    const base = await sessionHarness();
    const ride = documentWithIntent(
      {
        ...base.ride.intent,
        avoidAreas: [{
          id: "avoid_slow" as AvoidAreaId,
          name: null,
          geometryRef: avoidRef,
          enabled: true,
          createdBy: "rider",
        }],
      },
      base.ride.rideId,
    );
    let startedResolve: (() => void) | null = null;
    const resolving = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const abort = new AbortController();
    let plannerCalls = 0;
    const pending = rerouteRideSession({
      ride,
      session: base.session,
      planner: {
        plan: async () => {
          plannerCalls += 1;
          throw new Error("planner must not run after request cancellation");
        },
      },
      requestContext: {
        requestId: "req_slow",
        resolveGeometry: () => {
          startedResolve?.();
          return new Promise<GeometryPayload | null>(() => undefined);
        },
      },
      now: () => at(2),
      signal: abort.signal,
    });
    await resolving;
    const reason = new DOMException("rider cancelled", "AbortError");
    abort.abort(reason);

    await expect(pending).resolves.toEqual({ outcome: "cancelled", reason });
    expect(plannerCalls).toBe(0);
    expect(base.session.snapshot()?.plan.route).toEqual(base.oldBinding);
  });

  it("propagates cancellation to planning and never binds a route", async () => {
    const harness = await sessionHarness();
    const abort = new AbortController();
    let receivedSignal: AbortSignal | null = null;
    let markStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const planner: ReroutePlannerPort = {
      plan: (_input, signal) => {
        receivedSignal = signal;
        markStarted?.();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    };

    const pending = rerouteRideSession({
      ride: harness.ride,
      session: harness.session,
      planner,
      requestContext: requestContext(),
      now: () => at(2),
      signal: abort.signal,
    });
    await started;
    const reason = new DOMException("rider cancelled", "AbortError");
    abort.abort(reason);

    await expect(pending).resolves.toEqual({ outcome: "cancelled", reason });
    expect(receivedSignal).toBe(abort.signal);
    expect(harness.session.snapshot()?.plan.route).toEqual(harness.oldBinding);
  });

  it("chooses the same authoritative candidate for the same reroute inputs", async () => {
    const candidates: readonly ProviderCandidate[] = [
      {
        providerId: "fixture-router",
        profile: "motorcycle",
        geometry: [CURRENT, { lon: -75.45, lat: 40.31 }, FINISH],
        distanceMeters: 58_000,
        durationSeconds: 4_100,
        providerMetadata: { fingerprint: "scenic-choice" },
      },
      {
        providerId: "fixture-router",
        profile: "motorcycle",
        geometry: [CURRENT, { lon: -75.28, lat: 40.18 }, FINISH],
        distanceMeters: 47_000,
        durationSeconds: 3_200,
        providerMetadata: { fingerprint: "fast-choice" },
      },
    ];
    const provider: RouteCandidateProvider = {
      id: "fixture-router",
      capabilities: () => ({
        profiles: [],
        supportsAlternatives: true,
        supportsAvoidPolygons: true,
      }),
      candidates: async () => ({ candidates }),
    };
    const planner: ReroutePlannerPort = {
      plan: (input, signal) => planRide(input, { provider, signal }),
    };
    const first = await sessionHarness();
    const second = await sessionHarness();

    const [left, right] = await Promise.all([
      rerouteRideSession({
        ride: first.ride,
        session: first.session,
        planner,
        requestContext: requestContext(),
        now: () => at(2),
      }),
      rerouteRideSession({
        ride: second.ride,
        session: second.session,
        planner,
        requestContext: requestContext(),
        now: () => at(2),
      }),
    ]);

    expect(left, JSON.stringify(left)).toMatchObject({ outcome: "succeeded" });
    expect(right, JSON.stringify(right)).toMatchObject({ outcome: "succeeded" });
    if (left.outcome !== "succeeded" || right.outcome !== "succeeded") return;
    expect(left.selectedCandidate.fingerprint).toBe(right.selectedCandidate.fingerprint);
    expect(left.selectedCandidate.fingerprint).toBe("fast-choice");
  });
});
