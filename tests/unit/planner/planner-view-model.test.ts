/**
 * `buildPlannerViewModel` (04-PLANNER-AND-WORKSPACE-UX §8–§11, §21, §29).
 *
 * The view model is the rider-facing half of the session: it turns phases and
 * bundle data into the copy and card fields the workspace renders, and it
 * fabricates nothing — an unknown duration stays "Unknown", a missing role
 * stays an alternative, and a disabled plan button always says why.
 */

import { describe, expect, it } from "vitest";

import {
  buildPlannerViewModel,
  fastestReference,
  itineraryRefFor,
  mapRefForItineraryRef,
  type PlannerViewModelInput,
  visiblePlanningSession,
} from "@/application/planner/planner-view-model";
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
  newRideId,
  type PointId,
  type RideId,
} from "@/domain/ride/ids";
import {
  SCHEMA_VERSION,
  type Coordinate,
  type RideDocument,
  type RideIntent,
  type RidePoint,
  type ShapingPoint,
  type StopPoint,
} from "@/domain/ride/types";
import { asRouteCandidateId, type RouteCandidateId } from "@/domain/route/ids";
import type {
  RouteBundle,
  RouteCandidate,
  RouteRoles,
} from "@/domain/route/types";
import { knownEvidence } from "@/domain/evidence/types";

const FIXED = "2026-09-17T00:00:00.000Z";
const RIDE_ID: RideId = newRideId();

const ORIGIN: Coordinate = { lon: -75.2, lat: 39.95 };
const DESTINATION: Coordinate = { lon: -74.8, lat: 40.2 };

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("the test expected a defined value");
  return value;
}

function endpoint(
  id: string,
  kind: "start" | "finish",
  coordinate: Coordinate,
): RidePoint {
  return {
    id: id as PointId,
    kind,
    coordinate,
    provenance: { type: "map", selectedAt: FIXED },
  };
}

function documentWith(overrides: Partial<RideIntent> = {}): RideDocument {
  const intent: RideIntent = { ...defaultRideIntent(), ...overrides };
  return {
    schemaVersion: SCHEMA_VERSION,
    rideId: RIDE_ID,
    revision: 4,
    createdAt: FIXED,
    updatedAt: FIXED,
    title: null,
    provenance: { type: "new" },
    intent,
    history: { entries: [], cursor: -1, baseIntent: intent, appliedProposalIds: [] },
  };
}

const READY_DOCUMENT = documentWith({
  start: endpoint("pt_start", "start", ORIGIN),
  finish: endpoint("pt_finish", "finish", DESTINATION),
});

function unscoredComponents(): RouteCandidate["score"]["components"] {
  const component = (key: string): RouteCandidate["score"]["components"]["curvature"] => ({
    input: null,
    weight: 0,
    contribution: 0,
    explanationKey: `unscored.${key}`,
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

function candidate(
  id: string,
  overrides: Partial<RouteCandidate> = {},
): RouteCandidate {
  return {
    id: asRouteCandidateId(id),
    provider: { providerId: "graphhopper", profile: "motorcycle_fastest" },
    geometryRef: asGeometryRef(`geo_${id}`),
    distanceMeters: 125_529,
    durationSeconds: 6_480,
    eligibility: { eligible: true, failures: [] },
    evidence: {},
    score: { policyVersion: "VNEXT_STUB_0", total: 0, components: unscoredComponents() },
    warnings: [],
    fingerprint: `fp_${id}`,
    ...overrides,
  };
}

const BEST_ID: RouteCandidateId = asRouteCandidateId("route_best");
const FAST_ID: RouteCandidateId = asRouteCandidateId("route_fast");

const BEST = candidate(BEST_ID);
const FAST = candidate(FAST_ID, {
  distanceMeters: 131_966,
  durationSeconds: 5_760,
});

describe("routing method comparison ownership", () => {
  it.each(["primary-ready", "alternatives-loading"] as const)("keeps the current primary usable during %s", (phase) => {
    const routes = bundle([BEST, FAST], BEST_ID, { "best-ride": BEST_ID, fastest: FAST_ID });
    const vm = buildPlannerViewModel({ document: READY_DOCUMENT, session: session(phase, { committedBundle: routes, selectedRouteId: BEST_ID }) });
    expect(vm.routingComparisons.stale).toBe(false);
    expect(vm.routingComparisons.methods[0]?.routeId).toBe(BEST_ID);
  });

  it("projects the selected route and only the current attempt's Jev reading", () => {
    const routes = bundle([BEST, FAST], BEST_ID, { "best-ride": BEST_ID, fastest: FAST_ID });
    const reading = { fingerprint: BEST.fingerprint, label: "TWISTY" as const, confidence: 0.9, model: "jev-1.13.0", policyVersion: "test" };
    const ready = session("ready", { committedBundle: routes, selectedRouteId: BEST_ID, diagnostics: [{ providerId: "api", outcome: "ok", candidateCount: 2, funCharacter: reading }] });
    const vm = buildPlannerViewModel({ document: READY_DOCUMENT, session: ready });
    expect(vm.routingComparisons.selectedRouteId).toBe(BEST_ID);
    expect(vm.routingComparisons.jev.routeId).toBe(BEST_ID);
    const stale = buildPlannerViewModel({ document: READY_DOCUMENT, session: { ...ready, identity: { ...ready.identity, planningGeneration: 2 }, committedBundle: null, lastGoodBundle: routes, phase: "failed" } });
    expect(stale.routingComparisons.stale).toBe(true);
    expect(stale.routingComparisons.jev.state).toBe("unavailable");
  });
});

function bundle(
  candidates: readonly RouteCandidate[],
  selectedRouteId: RouteCandidateId,
  roles: Partial<RouteRoles> = {},
): RouteBundle {
  return {
    rideId: RIDE_ID,
    rideRevision: 4,
    planningGeneration: 1,
    policyVersion: "VNEXT_STUB_0",
    graphVersion: "unknown",
    evidenceVersion: "unknown",
    candidates,
    selectedRouteId,
    selectionSource: "automatic",
    roles: { ...emptyRouteRoles(), ...roles },
    createdAt: FIXED,
  };
}

function session(
  phase: PlanningPhase,
  overrides: Partial<PlanningSessionSnapshot> = {},
): PlanningSessionSnapshot {
  // The document fixture is at revision 4 and every bundle in this suite answers
  // revision 4, so the identity is coherent unless a test changes it.
  return {
    ...emptyPlanningSession(RIDE_ID),
    identity: { rideId: RIDE_ID, rideRevision: 4, planningGeneration: 1 },
    phase,
    ...overrides,
  };
}

function input(overrides: Partial<PlannerViewModelInput> = {}): PlannerViewModelInput {
  return { document: READY_DOCUMENT, session: session("idle"), ...overrides };
}

describe("buildPlannerViewModel — plan commitment and disabled reasons", () => {
  it("asks for a start when none is authored", () => {
    const vm = buildPlannerViewModel(
      input({ document: documentWith(), session: session("idle") }),
    );

    expect(vm.canPlan).toBe(false);
    expect(vm.disabledReason).toBe("Search for a start, or set it on the map.");
    expect(vm.startLabel).toBe("No start yet");
    expect(vm.finishLabel).toBe("No destination yet");
    // The status line reports the plan's state; the disabled reason is the
    // single instruction, so the two never say the same thing (OGV-D-214).
    expect(vm.statusMessage).toBe("No plan yet.");
    expect(vm.routeCards).toEqual([]);
    expect(vm.errorMessage).toBeNull();
  });

  it("asks for a destination once a start exists", () => {
    const vm = buildPlannerViewModel(
      input({
        document: documentWith({ start: endpoint("pt_start", "start", ORIGIN) }),
      }),
    );

    expect(vm.canPlan).toBe(false);
    expect(vm.disabledReason).toBe("Search for a destination, or choose it on the map.");
    expect(vm.finishLabel).toBe("No destination yet");
  });

  it("enables planning once both endpoints exist", () => {
    const vm = buildPlannerViewModel(input());

    expect(vm.canPlan).toBe(true);
    expect(vm.disabledReason).toBeNull();
    expect(vm.startLabel).toBe("Dropped pin");
    expect(vm.startCoordinateLabel).toBe("39.9500, -75.2000");
    expect(vm.finishLabel).toBe("Dropped pin");
    expect(vm.finishCoordinateLabel).toBe("40.2000, -74.8000");
  });

  it("names a placed point the rider named, and never invents one", () => {
    const vm = buildPlannerViewModel(
      input({
        document: documentWith({
          start: { ...endpoint("pt_start", "start", ORIGIN), label: "Home" },
          finish: endpoint("pt_finish", "finish", DESTINATION),
        }),
      }),
    );

    // The rider's own name wins; a pin without one is a dropped pin, and the
    // coordinate stays available as the secondary value either way.
    expect(vm.startLabel).toBe("Home");
    expect(vm.startCoordinateLabel).toBe("39.9500, -75.2000");
    expect(vm.finishLabel).toBe("Dropped pin");
    expect(vm.finishCoordinateLabel).toBe("40.2000, -74.8000");
  });

  it("does not require a destination on a loop ride", () => {
    const vm = buildPlannerViewModel(
      input({
        document: documentWith({
          shape: "loop",
          start: endpoint("pt_start", "start", ORIGIN),
        }),
        session: session("idle"),
      }),
    );

    expect(vm.canPlan).toBe(true);
  });

  it("refuses a second commit while an attempt is in flight", () => {
    const vm = buildPlannerViewModel(input({ session: session("validating") }));

    expect(vm.canPlan).toBe(false);
    expect(vm.disabledReason).toBe("Your ride is on its way — one moment.");
    expect(vm.statusMessage).toBe("Finding your ride…");
  });

  it("says it is finding when the ride has no previous answer", () => {
    const vm = buildPlannerViewModel(
      input({ session: session("routing-primary") }),
    );

    expect(vm.statusMessage).toBe("Finding your ride…");
  });

  it("says it is updating when the attempt answers a newer revision", () => {
    const vm = buildPlannerViewModel(
      input({
        session: session("routing-primary", {
          identity: { rideId: RIDE_ID, rideRevision: 5, planningGeneration: 2 },
          lastGoodBundle: bundle([BEST], BEST_ID, { "best-ride": BEST_ID }),
        }),
      }),
    );

    expect(vm.statusMessage).toBe("Updating ride…");
  });

  it("reports alternatives loading without making the route look unusable", () => {
    const vm = buildPlannerViewModel(
      input({
        session: session("alternatives-loading", {
          committedBundle: bundle([BEST, FAST], BEST_ID, { "best-ride": BEST_ID }),
          lastGoodBundle: bundle([BEST, FAST], BEST_ID, { "best-ride": BEST_ID }),
          selectedRouteId: BEST_ID,
        }),
      }),
    );

    expect(vm.statusMessage).toBe("Finding other roads…");
  });
});

describe("buildPlannerViewModel — failure and cancellation copy", () => {
  const cases: readonly { error: PlanningError; expected: string }[] = [
    {
      error: { code: "no-route", message: "no provider produced a usable route", recoverable: false },
      // The owner review's copy: it says what failed and what to do next, and the
      // primary CTA reads "Plan again" beside it rather than as a success claim.
      expected: "No legal route to this destination — try another point.",
    },
    {
      error: {
        code: "provider-unavailable",
        message: "no provider answered the planning request",
        recoverable: true,
      },
      expected: "The routing service is unavailable right now.",
    },
    {
      error: {
        code: "constraint-conflict",
        message: "no candidate satisfied hard eligibility",
        recoverable: true,
      },
      expected: "Your constraints leave no eligible route.",
    },
  ];

  it.each(cases)("maps $error.code to rider copy", ({ error, expected }) => {
    const vm = buildPlannerViewModel(
      input({ session: session("failed", { error }) }),
    );

    expect(vm.errorMessage).toBe(expected);
    expect(vm.statusMessage).toMatch(/failed/i);
    expect(vm.canPlan).toBe(true);
  });

  it("keeps the previous-ride notice when the failure had one", () => {
    const vm = buildPlannerViewModel(
      input({
        session: session("failed", {
          error: { code: "no-route", message: "x", recoverable: false },
          lastGoodBundle: bundle([BEST], BEST_ID, { "best-ride": BEST_ID }),
        }),
      }),
    );

    expect(vm.statusMessage).toMatch(/previous ride/i);
  });

  it("cancelling is not a failure and never invents an error", () => {
    const vm = buildPlannerViewModel(
      input({
        session: session("cancelled", {
          lastGoodBundle: bundle([BEST], BEST_ID, { "best-ride": BEST_ID }),
        }),
      }),
    );

    expect(vm.errorMessage).toBeNull();
    expect(vm.statusMessage).toMatch(/cancelled/i);
    expect(vm.canPlan).toBe(true);
  });
});

describe("buildPlannerViewModel — route cards", () => {
  const ready = (): PlanningSessionSnapshot =>
    session("ready", {
      committedBundle: bundle([BEST, FAST], BEST_ID, {
        "best-ride": BEST_ID,
        fastest: FAST_ID,
      }),
      lastGoodBundle: bundle([BEST, FAST], BEST_ID, {
        "best-ride": BEST_ID,
        fastest: FAST_ID,
      }),
      selectedRouteId: BEST_ID,
    });

  it("renders role, duration, distance and the added time versus fastest", () => {
    const vm = buildPlannerViewModel(input({ session: ready() }));

    expect(vm.routeCards).toHaveLength(2);
    const best = required(vm.routeCards[0]);
    expect(best.routeId).toBe(BEST_ID);
    expect(best.roleLabel).toBe("Best Ride");
    expect(best.durationLabel).toBe("1 h 48 min");
    expect(best.distanceLabel).toBe("78 mi");
    expect(best.addedTimeLabel).toBe("+12 min vs Fastest");
    expect(best.isSelected).toBe(true);

    const fast = required(vm.routeCards[1]);
    expect(fast.roleLabel).toBe("Fastest");
    expect(fast.durationLabel).toBe("1 h 36 min");
    expect(fast.addedTimeLabel).toBeNull();
    expect(fast.isSelected).toBe(false);
  });

  it("marks the automatically selected, unroled candidate as the placeholder Best Ride", () => {
    const vm = buildPlannerViewModel(
      input({
        session: session("ready", {
          committedBundle: bundle([BEST, FAST], BEST_ID),
          selectedRouteId: BEST_ID,
        }),
      }),
    );

    expect(required(vm.routeCards[0]).roleLabel).toBe("Best Ride");
  });

  it("never relabels a rider's own pick as the placeholder recommendation", () => {
    const riderChoice = {
      ...bundle([BEST, FAST], FAST_ID),
      selectionSource: "rider" as const,
    };
    const vm = buildPlannerViewModel(
      input({
        session: session("ready", {
          committedBundle: riderChoice,
          selectedRouteId: FAST_ID,
          selectionSource: "rider",
        }),
      }),
    );

    const selected = vm.routeCards.find((card) => card.isSelected);
    expect(selected?.roleLabel).toBe("Alternative");
    expect(vm.routeCards.some((card) => card.roleLabel === "Best Ride")).toBe(false);
  });

  it("lets the bundle's own role win over the placeholder", () => {
    const vm = buildPlannerViewModel(
      input({
        session: session("ready", {
          committedBundle: bundle([BEST], BEST_ID, { fastest: BEST_ID }),
          selectedRouteId: BEST_ID,
        }),
      }),
    );

    expect(required(vm.routeCards[0]).roleLabel).toBe("Fastest");
  });

  it("surfaces role labels without letting any provider name into card text", () => {
    // Rule E / VNX-007: the provider that computed a candidate is provenance,
    // never rider copy. The provider ids below are the two engines the ledger
    // names, and neither may appear anywhere in the projected card text.
    const otherEngine = candidate("route_other_engine", {
      provider: { providerId: "valhalla", profile: "motorcycle_scenic" },
    });
    const vm = buildPlannerViewModel(
      input({
        session: session("ready", {
          committedBundle: bundle([BEST, otherEngine], BEST_ID, {
            "best-ride": BEST_ID,
            fastest: otherEngine.id,
          }),
          selectedRouteId: BEST_ID,
        }),
      }),
    );

    // Exactly the fields `RouteDecisionCard` renders into the button's text.
    const cardText = vm.routeCards
      .flatMap((card) => [
        card.roleLabel,
        card.durationLabel,
        card.distanceLabel,
        card.addedTimeLabel ?? "",
        ...card.badges,
      ])
      .join(" | ");

    expect(cardText).toContain("Best Ride");
    expect(cardText).toContain("Fastest");
    expect(cardText).not.toMatch(/graphhopper|valhalla/i);
    expect(JSON.stringify(vm)).not.toMatch(/graphhopper|valhalla/i);
  });

  it("badges an unverified surface instead of claiming a surface", () => {
    const vm = buildPlannerViewModel(input({ session: ready() }));

    expect(required(vm.routeCards[0]).badges).toEqual(["Surface unknown"]);
  });

  it("drops the badge once surface evidence is usable", () => {
    const known = candidate(BEST_ID, {
      evidence: {
        surfaceMix: knownEvidence(
          "paved",
          { id: "osm", label: "OSM", category: "osm" },
          0.9,
        ),
      },
    });
    const vm = buildPlannerViewModel(
      input({
        session: session("ready", {
          committedBundle: bundle([known], BEST_ID),
          selectedRouteId: BEST_ID,
        }),
      }),
    );

    expect(required(vm.routeCards[0]).badges).toEqual(["Surface likely"]);
  });

  it("keeps unknown metrics unknown rather than printing zero", () => {
    const unknown = candidate(BEST_ID, {
      durationSeconds: Number.NaN,
      distanceMeters: Number.NaN,
    });
    const vm = buildPlannerViewModel(
      input({
        session: session("ready", {
          committedBundle: bundle([unknown], BEST_ID),
          selectedRouteId: BEST_ID,
        }),
      }),
    );

    const card = required(vm.routeCards[0]);
    expect(card.durationLabel).toBe("Unknown");
    expect(card.distanceLabel).toBe("Unknown");
    expect(card.addedTimeLabel).toBeNull();
  });

  it("shows at most three choices and always keeps the selected one", () => {
    const ids = ["route_1", "route_2", "route_3", "route_4"].map((id) =>
      asRouteCandidateId(id),
    );
    const candidates = ids.map((id, index) =>
      candidate(id, {
        durationSeconds: 6_000 + index * 60,
        distanceMeters: 100_000 + index * 1_000,
      }),
    );
    const selected = required(ids[3]);
    const vm = buildPlannerViewModel(
      input({
        session: session("ready", {
          committedBundle: bundle(candidates, selected),
          selectedRouteId: selected,
        }),
      }),
    );

    expect(vm.routeCards).toHaveLength(3);
    expect(vm.routeCards.some((card) => card.routeId === selected)).toBe(true);
    expect(vm.routeCards.filter((card) => card.isSelected)).toHaveLength(1);
  });
});

describe("buildPlannerViewModel — the object list (04 §15)", () => {
  const STOP_A: StopPoint = {
    id: "stop_a" as unknown as StopPoint["id"],
    kind: "stop",
    coordinate: { lon: -75.1, lat: 39.98 },
    label: "Coffee",
    arrivalIntent: "food",
    provenance: { type: "map", selectedAt: FIXED },
  };
  const STOP_B: StopPoint = {
    id: "stop_b" as unknown as StopPoint["id"],
    kind: "stop",
    coordinate: { lon: -75.0, lat: 40.0 },
    provenance: { type: "map", selectedAt: FIXED },
  };
  const ANCHOR: ShapingPoint = {
    id: "shape_a" as unknown as ShapingPoint["id"],
    kind: "shape",
    coordinate: { lon: -75.05, lat: 39.99 },
    source: "map-drag",
  };

  it("lists start, the stops in order, then the finish", () => {
    const vm = buildPlannerViewModel(
      input({ document: documentWith({ ...READY_DOCUMENT.intent, stops: [STOP_A, STOP_B] }) }),
    );

    expect(vm.itinerary.map((row) => row.kind)).toEqual([
      "start",
      "stop",
      "stop",
      "finish",
    ]);
    expect(vm.itinerary.map((row) => row.position)).toEqual([null, 1, 2, null]);
    expect(vm.itinerary[1]?.label).toBe("Coffee");
    expect(vm.itinerary[1]?.arrivalIntent).toBe("food");
    // A stop without a name is a dropped pin, with its coordinate as the
    // secondary value — not the coordinate worn as the name.
    expect(vm.itinerary[2]?.label).toBe("Dropped pin");
    expect(vm.itinerary[2]?.coordinateLabel).toBe("40.0000, -75.0000");
    expect(vm.itinerary[2]?.arrivalIntent).toBeNull();
  });

  it("keeps shaping anchors out of the itinerary", () => {
    const vm = buildPlannerViewModel(
      input({
        document: documentWith({
          ...READY_DOCUMENT.intent,
          stops: [STOP_A],
          shaping: [ANCHOR],
        }),
      }),
    );

    expect(vm.itinerary.some((row) => row.kind === "shaping")).toBe(false);
    expect(vm.shapingPoints).toHaveLength(1);
    expect(vm.shapingPoints[0]?.ref).toEqual({ kind: "shaping", shapingId: ANCHOR.id });
  });

  it("maps a map selection back onto the list row it addresses", () => {
    const document = documentWith({
      ...READY_DOCUMENT.intent,
      stops: [STOP_A],
      shaping: [ANCHOR],
    });

    expect(itineraryRefFor(document, { kind: "stop", stopId: STOP_A.id })).toEqual({
      kind: "stop",
      stopId: STOP_A.id,
    });
    expect(
      itineraryRefFor(document, { kind: "point", pointId: document.intent.start!.id }),
    ).toEqual({ kind: "start" });
    expect(itineraryRefFor(document, { kind: "point", pointId: ANCHOR.id })).toEqual({
      kind: "shaping",
      shapingId: ANCHOR.id,
    });
    // A route is not an authored point, and the open surface is not a selection.
    expect(
      itineraryRefFor(document, { kind: "route", routeId: asRouteCandidateId("route_x") }),
    ).toBeNull();
    expect(itineraryRefFor(document, null)).toBeNull();
  });

  it("resolves a list row back to the map object the document holds", () => {
    const document = documentWith({
      ...READY_DOCUMENT.intent,
      stops: [STOP_A],
      shaping: [ANCHOR],
    });

    expect(mapRefForItineraryRef(document, { kind: "start" })).toEqual({
      kind: "point",
      pointId: document.intent.start!.id,
    });
    expect(
      mapRefForItineraryRef(document, { kind: "stop", stopId: STOP_A.id }),
    ).toEqual({ kind: "stop", stopId: STOP_A.id });
    expect(
      mapRefForItineraryRef(document, { kind: "shaping", shapingId: ANCHOR.id }),
    ).toEqual({ kind: "point", pointId: ANCHOR.id });
    // An empty slot and a stale identity both resolve to nothing rather than to a
    // fabricated object.
    const empty = documentWith();
    expect(mapRefForItineraryRef(empty, { kind: "start" })).toBeNull();
    expect(
      mapRefForItineraryRef(empty, { kind: "stop", stopId: STOP_B.id }),
    ).toBeNull();
    expect(
      mapRefForItineraryRef(empty, { kind: "shaping", shapingId: ANCHOR.id }),
    ).toBeNull();
  });
});

describe("buildPlannerViewModel — commitment label and recovery (04 §8, §29)", () => {
  it("asks to create before any answer exists", () => {
    expect(buildPlannerViewModel(input()).planLabel).toBe("Create ride");
    expect(buildPlannerViewModel(input()).failed).toBe(false);
  });

  it("asks to update once an answer is on screen", () => {
    const vm = buildPlannerViewModel(
      input({
        session: session("ready", {
          committedBundle: bundle([BEST], BEST_ID, { "best-ride": BEST_ID }),
        }),
      }),
    );

    expect(vm.planLabel).toBe("Update ride");
    expect(vm.failed).toBe(false);
  });

  it("never claims success beside an error: the label reads Plan again", () => {
    const vm = buildPlannerViewModel(
      input({
        // Even with a previous answer still on screen, a visible error means the
        // primary button must not read like a completed update.
        session: session("failed", {
          committedBundle: bundle([BEST], BEST_ID, { "best-ride": BEST_ID }),
          lastGoodBundle: bundle([BEST], BEST_ID, { "best-ride": BEST_ID }),
          error: { code: "no-route", message: "x", recoverable: false },
        }),
      }),
    );

    expect(vm.failed).toBe(true);
    expect(vm.planLabel).toBe("Plan again");
  });

  it("blames no destination on a loop, which has none", () => {
    const vm = buildPlannerViewModel(
      input({
        document: documentWith({ ...READY_DOCUMENT.intent, shape: "loop" }),
        session: session("failed", {
          error: { code: "no-route", message: "x", recoverable: false },
        }),
      }),
    );

    expect(vm.errorMessage).toBe("No legal route for this ride — try another point.");
  });
});

describe("buildPlannerViewModel — undo/redo labels (04 §20)", () => {
  const STOP: StopPoint = {
    id: "stop_history" as unknown as StopPoint["id"],
    kind: "stop",
    coordinate: { lon: -75.1, lat: 39.98 },
    provenance: { type: "map", selectedAt: FIXED },
  };

  it("names the entry each control would cross", () => {
    const base = documentWith({
      ...READY_DOCUMENT.intent,
      stops: [STOP],
    });
    const document: RideDocument = {
      ...base,
      history: {
        entries: [
          {
            entryId: "hist_1" as never,
            label: "Set start",
            revision: 5,
            intent: { ...base.intent, start: null },
          },
          {
            entryId: "hist_2" as never,
            label: "Moved coffee stop",
            revision: 6,
            intent: base.intent,
          },
        ],
        cursor: 1,
        baseIntent: { ...base.intent, start: null },
        appliedProposalIds: [],
      },
    };

    const vm = buildPlannerViewModel(input({ document }));

    expect(vm.undoLabel).toBe("Moved coffee stop");
    expect(vm.redoLabel).toBeNull();
  });

  it("offers no control before any history exists", () => {
    const vm = buildPlannerViewModel(input());
    expect(vm.undoLabel).toBeNull();
    expect(vm.redoLabel).toBeNull();
  });
});

describe("buildPlannerViewModel — evidence display (04 §11, 07 §5)", () => {
  const ready = (): PlanningSessionSnapshot =>
    session("ready", {
      committedBundle: bundle([BEST], BEST_ID, { "best-ride": BEST_ID }),
      selectedRouteId: BEST_ID,
    });

  const SURFACE_SOURCE = { id: "official", label: "State survey", category: "survey" } as const;

  const bandCases: readonly { readonly label: string; readonly confidence: number }[] = [
    { label: "Surface confirmed", confidence: 0.9 },
    { label: "Surface mostly known", confidence: 0.6 },
    { label: "Surface partly guessed", confidence: 0.2 },
  ];

  it.each(bandCases)("shows $label for a $confidence confidence report", ({ label, confidence }) => {
    const verified = candidate(BEST_ID, {
      evidence: {
        surfaceMix: knownEvidence("paved", SURFACE_SOURCE, confidence),
      },
    });
    const vm = buildPlannerViewModel(
      input({
        session: session("ready", {
          committedBundle: bundle([verified], BEST_ID, { "best-ride": BEST_ID }),
          selectedRouteId: BEST_ID,
        }),
      }),
    );

    const card = required(vm.routeCards[0]);
    expect(card.confidenceLabel).toBe(label);
    // The report states no coverage share, so how much of the line it verifies
    // is not measurable — never rounded to "all of it".
    expect(card.unknownSurfaceMi).toBeNull();
  });

  it("reports no unverified mileage when the evidence covers the whole line", () => {
    const covered = candidate(BEST_ID, {
      evidence: {
        surfaceMix: {
          value: "paved",
          status: "known",
          confidence: 0.9,
          coverage: 1,
          provenance: [SURFACE_SOURCE],
        },
      },
    });
    const vm = buildPlannerViewModel(
      input({
        session: session("ready", {
          committedBundle: bundle([covered], BEST_ID, { "best-ride": BEST_ID }),
          selectedRouteId: BEST_ID,
        }),
      }),
    );

    expect(required(vm.routeCards[0]).unknownSurfaceMi).toBe(0);
  });

  it("keeps an unknown surface visible as Unknown confidence, not as a number", () => {
    const vm = buildPlannerViewModel(input({ session: ready() }));
    const card = required(vm.routeCards[0]);

    expect(card.confidenceLabel).toBe("Unknown");
    expect(card.badges).toEqual(["Surface unknown"]);
    // 125 529 m of unverified line, measured from the evidence that is absent.
    expect(card.unknownSurfaceMi).toBe(78);
  });

  it("measures the unverified mileage from the evidence's own coverage", () => {
    const halfCovered = candidate(BEST_ID, {
      distanceMeters: 160_934,
      evidence: {
        surfaceMix: {
          value: "gravel",
          status: "known",
          confidence: 0.9,
          coverage: 0.5,
          provenance: [SURFACE_SOURCE],
        },
      },
    });
    const vm = buildPlannerViewModel(
      input({
        session: session("ready", {
          committedBundle: bundle([halfCovered], BEST_ID, { "best-ride": BEST_ID }),
          selectedRouteId: BEST_ID,
        }),
      }),
    );

    expect(required(vm.routeCards[0]).unknownSurfaceMi).toBe(50);
  });

  it("claims no unverified mileage when the coverage itself is not measured", () => {
    const verified = candidate(BEST_ID, {
      evidence: { surfaceMix: knownEvidence("paved", SURFACE_SOURCE, 0.9) },
    });
    const vm = buildPlannerViewModel(
      input({
        session: session("ready", {
          committedBundle: bundle([verified], BEST_ID, { "best-ride": BEST_ID }),
          selectedRouteId: BEST_ID,
        }),
      }),
    );

    expect(required(vm.routeCards[0]).unknownSurfaceMi).toBeNull();
  });

  it("makes no confidence claim for a route with no measurable metric", () => {
    const broken = candidate(BEST_ID, {
      durationSeconds: Number.NaN,
      distanceMeters: Number.NaN,
    });
    const vm = buildPlannerViewModel(
      input({
        session: session("ready", {
          committedBundle: bundle([broken], BEST_ID, { "best-ride": BEST_ID }),
          selectedRouteId: BEST_ID,
        }),
      }),
    );

    const card = required(vm.routeCards[0]);
    expect(card.confidenceLabel).toBeNull();
    expect(card.unknownSurfaceMi).toBeNull();
  });

  it("keys the explanation region by the candidate it describes", () => {
    const vm = buildPlannerViewModel(input({ session: ready() }));

    expect(required(vm.routeCards[0]).whyKey).toBe(`why-${BEST_ID}`);
  });
});

describe("fastestReference (06 §13)", () => {
  it("is the quickest measurable candidate, and ignores an unmeasurable one", () => {
    const unmeasurable = candidate(asRouteCandidateId("route_nan"), {
      durationSeconds: Number.NaN,
    });

    expect(fastestReference([BEST, FAST, unmeasurable])?.id).toBe(FAST_ID);
    expect(fastestReference([])).toBeNull();
    expect(fastestReference([unmeasurable])).toBeNull();
  });

  it("breaks a duration tie by distance and then by identity, like the role rule", () => {
    const tie = candidate(asRouteCandidateId("route_tie"), {
      distanceMeters: 100_000,
      durationSeconds: 6_480,
    });
    const longerTie = candidate(asRouteCandidateId("route_tie_long"), {
      distanceMeters: 200_000,
      durationSeconds: 6_480,
    });

    expect(fastestReference([BEST, tie, longerTie])?.id).toBe(tie.id);
  });
});

describe("visiblePlanningSession (UX audit PP-01)", () => {
  const answered = session("ready", {
    committedBundle: bundle([BEST, FAST], BEST_ID),
    lastGoodBundle: bundle([BEST, FAST], BEST_ID),
    selectedRouteId: BEST_ID,
  });

  it("hides the last answer once an edit leaves the ride without its start or finish", () => {
    const cleared = { ...documentWith({ finish: endpoint("pt_finish", "finish", DESTINATION) }), revision: 5 };
    const shown = visiblePlanningSession(cleared, answered);
    expect(shown.committedBundle).toBeNull();
    expect(shown.lastGoodBundle).toBeNull();
    expect(shown.phase).toBe("idle");
    const viewModel = buildPlannerViewModel({ document: cleared, session: shown });
    expect(viewModel.routeCards).toHaveLength(0);
    expect(viewModel.statusMessage).not.toBe("Ride ready.");
  });

  it("keeps the answer for a whole ride, and for the revision it answers", () => {
    expect(visiblePlanningSession(READY_DOCUMENT, answered)).toBe(answered);
    expect(visiblePlanningSession({ ...READY_DOCUMENT, revision: 6 }, answered)).toBe(answered);
  });

  it("shows a snap-as-you-go preview only while the pen is armed (OGV-D-285)", () => {
    const generation = answered.committedBundle?.planningGeneration ?? -1;
    const drawing = visiblePlanningSession(READY_DOCUMENT, answered, {
      generations: [generation],
      drawing: true,
    });
    expect(drawing).toBe(answered);
    const putAway = visiblePlanningSession(READY_DOCUMENT, answered, {
      generations: [generation],
      drawing: false,
    });
    expect(putAway.committedBundle).toBeNull();
    expect(putAway.lastGoodBundle).toBeNull();
    // An answer from any other generation is the ride's own and stays.
    expect(
      visiblePlanningSession(READY_DOCUMENT, answered, { generations: [generation + 1], drawing: false }),
    ).toBe(answered);
  });
});
