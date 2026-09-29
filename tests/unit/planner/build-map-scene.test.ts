/**
 * `buildMapScene` / `sceneExtent` (02-ARCHITECTURE-CONTRACT §17,
 * 05-MAP-INTERACTION-AND-CARTOGRAPHY §3).
 *
 * The map is a pure renderer: the scene is projected from
 * `(RideDocument, PlanningSession, UiSelection)` plus an injected geometry
 * reader, and it never invents geometry, roles or selection it was not given.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAP_EXTENT,
  buildMapScene,
  drawnRoutesKey,
  sceneCoordinates,
  sceneExtent,
  type MapSceneInput,
} from "@/application/map/build-map-scene";
import type { MapUiSelection } from "@/application/map/types";
import {
  emptyPlanningSession,
  emptyRouteRoles,
  type PlanningSessionSnapshot,
} from "@/application/planner/planning-session";
import { defaultRideIntent } from "@/domain/ride/create";
import {
  asGeometryRef,
  newAvoidAreaId,
  newRideId,
  newRoadSpanId,
  newShapingId,
  newSketchId,
  newStopId,
  type AvoidAreaId,
  type GeometryRef,
  type PointId,
  type RideId,
} from "@/domain/ride/ids";
import {
  SCHEMA_VERSION,
  type Coordinate,
  type RideDocument,
  type RideIntent,
  type RidePoint,
  type StopPoint,
} from "@/domain/ride/types";
import type { GeometryPayload } from "@/domain/geometry/types";
import { asRouteCandidateId, type RouteCandidateId } from "@/domain/route/ids";
import type { RouteBundle, RouteCandidate, RouteRoles } from "@/domain/route/types";

const FIXED = "2026-09-17T00:00:00.000Z";
const RIDE_ID: RideId = newRideId();

const ORIGIN: Coordinate = { lon: -75.2, lat: 39.95 };
const DESTINATION: Coordinate = { lon: -74.8, lat: 40.2 };
const MIDPOINT: Coordinate = { lon: -75.0, lat: 40.05 };
const STOP_COORDINATE: Coordinate = { lon: -74.95, lat: 40.02 };

const START_REF = asGeometryRef("geo_start");
const FINISH_REF = asGeometryRef("geo_finish");
const ROUTE_REF_A = asGeometryRef("geo_route_a");
const ROUTE_REF_B = asGeometryRef("geo_route_b");
const AVOID_REF = asGeometryRef("geo_avoid");
const UNKNOWN_REF = asGeometryRef("geo_missing");

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

function stopPoint(): StopPoint {
  return {
    id: newStopId(),
    kind: "stop",
    coordinate: STOP_COORDINATE,
    provenance: { type: "map", selectedAt: FIXED },
  };
}

function documentWith(overrides: Partial<RideIntent> = {}): RideDocument {
  const intent: RideIntent = {
    ...defaultRideIntent(),
    start: endpoint("pt_start", "start", ORIGIN),
    finish: endpoint("pt_finish", "finish", DESTINATION),
    ...overrides,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    rideId: RIDE_ID,
    revision: 3,
    createdAt: FIXED,
    updatedAt: FIXED,
    title: null,
    provenance: { type: "new" },
    intent,
    history: { entries: [], cursor: -1, baseIntent: intent, appliedProposalIds: [] },
  };
}

function candidate(
  id: string,
  geometryRef: GeometryRef,
  overrides: Partial<RouteCandidate> = {},
): RouteCandidate {
  return {
    id: asRouteCandidateId(id),
    provider: { providerId: "graphhopper", profile: "motorcycle_fastest" },
    geometryRef,
    distanceMeters: 120_000,
    durationSeconds: 6_000,
    eligibility: { eligible: true, failures: [] },
    evidence: {},
    score: { policyVersion: "VNEXT_STUB_0", total: 0, components: unscoredComponents() },
    warnings: [],
    fingerprint: `fp_${id}`,
    ...overrides,
  };
}

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

const ROUTE_A_ID: RouteCandidateId = asRouteCandidateId("route_a");
const ROUTE_B_ID: RouteCandidateId = asRouteCandidateId("route_b");

function bundle(
  candidates: readonly RouteCandidate[],
  selectedRouteId: RouteCandidateId,
  roles: Partial<RouteRoles> = {},
): RouteBundle {
  return {
    rideId: RIDE_ID,
    rideRevision: 3,
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

function sessionWith(
  overrides: Partial<PlanningSessionSnapshot> = {},
): PlanningSessionSnapshot {
  return { ...emptyPlanningSession(RIDE_ID), ...overrides };
}

const GEOMETRY: Readonly<Record<string, GeometryPayload>> = {
  [START_REF]: { kind: "line", coordinates: [ORIGIN, MIDPOINT] },
  [FINISH_REF]: { kind: "line", coordinates: [DESTINATION] },
  [ROUTE_REF_A]: { kind: "line", coordinates: [ORIGIN, MIDPOINT, DESTINATION] },
  [ROUTE_REF_B]: { kind: "line", coordinates: [ORIGIN, DESTINATION] },
  [AVOID_REF]: {
    kind: "polygon",
    rings: [
      [
        { lon: -75.1, lat: 39.9 },
        { lon: -75.05, lat: 39.9 },
        { lon: -75.05, lat: 39.95 },
        { lon: -75.1, lat: 39.9 },
      ],
    ],
  },
};

const readGeometry = (ref: GeometryRef): GeometryPayload | null =>
  GEOMETRY[ref] ?? null;

function sceneInput(
  overrides: Partial<MapSceneInput> = {},
): MapSceneInput {
  return {
    document: documentWith(),
    session: sessionWith(),
    uiState: { selectedObject: null },
    readGeometry,
    ...overrides,
  };
}

describe("buildMapScene — projection from document, session and UI selection", () => {
  it("renders an empty plan scene with no fabricated content", () => {
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({ start: null, finish: null }),
      }),
    );

    expect(scene.mode).toBe("plan");
    expect(scene.routes).toEqual([]);
    expect(scene.points).toEqual([]);
    expect(scene.avoidAreas).toEqual([]);
    expect(scene.sketch).toBeNull();
    expect(scene.selectedRouteId).toBeNull();
    expect(scene.selectedObject).toBeNull();
  });

  it("projects start, finish and stops as distinct points, in order", () => {
    const stop = stopPoint();
    const scene = buildMapScene(
      sceneInput({ document: documentWith({ stops: [stop] }) }),
    );

    expect(scene.points.map((point) => point.kind)).toEqual([
      "start",
      "stop",
      "finish",
    ]);
    expect(required(scene.points[0]).coordinate).toEqual(ORIGIN);
    expect(required(scene.points[1]).id).toBe(stop.id);
    expect(required(scene.points[2]).coordinate).toEqual(DESTINATION);
  });

  it("a loop keeps its authored destination off the map (M2)", () => {
    const scene = buildMapScene(sceneInput({ document: documentWith({ shape: "loop" }) }));
    expect(scene.points.map((point) => point.kind)).toEqual(["start"]);
  });

  it("marks the bundle's selected route and leaves the rest as alternatives", () => {
    const a = candidate(ROUTE_A_ID, ROUTE_REF_A);
    const b = candidate(ROUTE_B_ID, ROUTE_REF_B);
    const scene = buildMapScene(
      sceneInput({
        session: sessionWith({
          phase: "ready",
          committedBundle: bundle([a, b], ROUTE_A_ID, { "best-ride": ROUTE_A_ID }),
          lastGoodBundle: bundle([a, b], ROUTE_A_ID, { "best-ride": ROUTE_A_ID }),
          selectedRouteId: ROUTE_A_ID,
        }),
      }),
    );

    expect(scene.routes).toHaveLength(2);
    expect(required(scene.routes[0]).state).toBe("selected");
    expect(required(scene.routes[0]).role).toBe("best-ride");
    expect(required(scene.routes[0]).geometry).toEqual([ORIGIN, MIDPOINT, DESTINATION]);
    expect(required(scene.routes[1]).state).toBe("alternative");
    expect(required(scene.routes[1]).role).toBeNull();
    expect(scene.selectedRouteId).toBe(ROUTE_A_ID);
  });

  it("reads the role from the bundle's role record, not from array order", () => {
    const a = candidate(ROUTE_A_ID, ROUTE_REF_A);
    const b = candidate(ROUTE_B_ID, ROUTE_REF_B);
    const scene = buildMapScene(
      sceneInput({
        session: sessionWith({
          committedBundle: bundle([a, b], ROUTE_B_ID, { fastest: ROUTE_B_ID }),
          selectedRouteId: ROUTE_B_ID,
        }),
      }),
    );

    expect(required(scene.routes[0]).role).toBeNull();
    expect(required(scene.routes[1]).role).toBe("fastest");
    expect(required(scene.routes[1]).state).toBe("selected");
  });

  it("falls back to the last-good bundle while a new attempt is in flight", () => {
    const a = candidate(ROUTE_A_ID, ROUTE_REF_A);
    const scene = buildMapScene(
      sceneInput({
        session: sessionWith({
          phase: "routing-primary",
          committedBundle: null,
          lastGoodBundle: bundle([a], ROUTE_A_ID),
          selectedRouteId: ROUTE_A_ID,
        }),
      }),
    );

    expect(scene.routes).toHaveLength(1);
    expect(required(scene.routes[0]).state).toBe("selected");
    expect(scene.selectedRouteId).toBe(ROUTE_A_ID);
  });

  it("draws an answer that no longer addresses the document as the previous route (04 §9, §21; 05 §11)", () => {
    const a = candidate(ROUTE_A_ID, ROUTE_REF_A, { distanceMeters: 4_608, durationSeconds: 425 });
    // The document is at revision 3; this answer is for revision 2, i.e. the
    // rider's edit is still unanswered.
    const answeredEarlier = { ...bundle([a], ROUTE_A_ID), rideRevision: 2 };
    // Both states that make an answer stale — an update in flight and an update
    // that failed — must draw it dimmed but readable, never as the rider's answer.
    for (const phase of ["routing-primary", "failed"] as const) {
      const stale = buildMapScene(
        sceneInput({
          session: sessionWith({
            phase,
            committedBundle: null,
            lastGoodBundle: answeredEarlier,
            selectedRouteId: ROUTE_A_ID,
          }),
        }),
      );

      expect(stale.routes.map((route) => route.state)).toEqual(["previous"]);
      // The bundle's own selection is still reported: the rider chose this ride,
      // and the drawing says it is the previous one, not that they unchose it.
      expect(stale.selectedRouteId).toBe(ROUTE_A_ID);
    }

    // The same bundle, once it answers the document again, is the selected route.
    const settled = buildMapScene(
      sceneInput({
        session: sessionWith({
          phase: "ready",
          committedBundle: bundle([a], ROUTE_A_ID),
          selectedRouteId: ROUTE_A_ID,
        }),
      }),
    );
    expect(required(settled.routes[0]).state).toBe("selected");
  });

  it("carries the changed-span emphasis it was given, and none when it was given none (05 §12)", () => {
    const span = { coordinates: [MIDPOINT, DESTINATION], untilIso: FIXED };

    const scene = buildMapScene(sceneInput({ changedSpan: span }));
    expect(scene.changedSpan).toEqual(span);
    expect(buildMapScene(sceneInput()).changedSpan).toBeNull();
    expect(buildMapScene(sceneInput({ changedSpan: null })).changedSpan).toBeNull();
  });

  it("never invents geometry for a handle the reader cannot resolve", () => {
    const a = candidate(ROUTE_A_ID, UNKNOWN_REF);
    const scene = buildMapScene(
      sceneInput({
        session: sessionWith({
          committedBundle: bundle([a], ROUTE_A_ID),
          selectedRouteId: ROUTE_A_ID,
        }),
      }),
    );

    expect(required(scene.routes[0]).geometry).toEqual([]);
    expect(required(scene.points[0]).coordinate).toEqual(ORIGIN);
  });

  it("projects avoid areas with their rings and enabled state", () => {
    const areaId: AvoidAreaId = newAvoidAreaId();
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({
          avoidAreas: [
            { id: areaId, name: null, geometryRef: AVOID_REF, enabled: true, createdBy: "map" },
            { id: newAvoidAreaId(), name: null, geometryRef: UNKNOWN_REF, enabled: false, createdBy: "map" },
          ],
        }),
      }),
    );

    expect(scene.avoidAreas).toHaveLength(2);
    expect(required(scene.avoidAreas[0]).id).toBe(areaId);
    expect(required(scene.avoidAreas[0]).rings).toHaveLength(1);
    expect(required(scene.avoidAreas[1]).rings).toEqual([]);
    expect(required(scene.avoidAreas[1]).enabled).toBe(false);
  });

  it("projects a committed sketch corridor with its stored geometry", () => {
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({
          sketch: {
            id: newSketchId(),
            rawStrokeRefs: [],
            corridorRef: ROUTE_REF_B,
            topologyHints: [],
            endpointPolicy: "derive",
          },
        }),
      }),
    );

    // The corridor is resolved from the geometry store, because the map draws the
    // corridor the plan uses — and the raw strokes stay where they belong.
    expect(scene.sketch).toEqual({
      corridorRef: ROUTE_REF_B,
      endpointPolicy: "derive",
      geometry: [ORIGIN, DESTINATION],
    });
  });

  it("draws no sketch line when the corridor handle does not resolve", () => {
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({
          sketch: {
            id: newSketchId(),
            rawStrokeRefs: [],
            // A handle the reader does not know: the sketch exists in the ride and
            // the map says it cannot draw it, rather than inventing a line.
            corridorRef: UNKNOWN_REF,
            topologyHints: [],
            endpointPolicy: "derive",
          },
        }),
      }),
    );

    expect(scene.sketch?.geometry).toEqual([]);
  });

  it("projects authored road spans with their stored lines", () => {
    const spanId = newRoadSpanId();
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({
          roadSpans: [
            {
              id: spanId,
              mode: "avoid",
              direction: "either",
              geometryRef: ROUTE_REF_B,
              anchorRefs: [ORIGIN, DESTINATION],
            },
          ],
        }),
      }),
    );

    expect(scene.roadSpans).toEqual([
      {
        id: spanId,
        mode: "avoid",
        direction: "either",
        geometry: [ORIGIN, DESTINATION],
      },
    ]);
  });

  it("projects shaping anchors as their own point kind", () => {
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({
          shaping: [
            { id: newShapingId(), kind: "shape", coordinate: MIDPOINT, source: "map-drag" },
          ],
        }),
      }),
    );

    const shaping = scene.points.filter((point) => point.kind === "shaping");
    expect(shaping).toHaveLength(1);
    expect(shaping[0]?.coordinate).toEqual(MIDPOINT);
    expect(shaping[0]?.label).toBeNull();
  });

  it("carries the UI selection through without adding meaning", () => {
    const uiState: MapUiSelection = {
      selectedObject: { kind: "route", routeId: ROUTE_B_ID },
    };
    const scene = buildMapScene(sceneInput({ uiState }));

    expect(scene.selectedObject).toEqual({ kind: "route", routeId: ROUTE_B_ID });
  });

  it("does not mutate the document or session it was given", () => {
    const document = documentWith();
    const session = sessionWith();
    const before = JSON.stringify({ document });

    buildMapScene(sceneInput({ document, session }));

    expect(JSON.stringify({ document })).toBe(before);
    expect(session.phase).toBe("idle");
  });
});

describe("sceneExtent — camera fit for the SVG host", () => {
  it("falls back to the documented baseline region for an empty scene", () => {
    const scene = buildMapScene(
      sceneInput({ document: documentWith({ start: null, finish: null }) }),
    );

    expect(sceneExtent(scene)).toEqual(DEFAULT_MAP_EXTENT);
  });

  it("covers every projected coordinate", () => {
    const a = candidate(ROUTE_A_ID, ROUTE_REF_A);
    const scene = buildMapScene(
      sceneInput({
        session: sessionWith({
          committedBundle: bundle([a], ROUTE_A_ID),
          selectedRouteId: ROUTE_A_ID,
        }),
      }),
    );

    const extent = sceneExtent(scene);

    expect(extent.minLon).toBeLessThanOrEqual(DESTINATION.lon);
    expect(extent.maxLon).toBeGreaterThanOrEqual(DESTINATION.lon);
    expect(extent.minLat).toBeLessThanOrEqual(ORIGIN.lat);
    expect(extent.maxLat).toBeGreaterThanOrEqual(DESTINATION.lat);
  });

  it("keeps a usable span when every coordinate is the same point", () => {
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({ start: null, finish: null }),
        session: sessionWith(),
      }),
    );
    const single = {
      ...scene,
      points: [
        { id: "pt_one" as PointId, kind: "start" as const, coordinate: ORIGIN, label: null },
      ],
    };

    const extent = sceneExtent(single);

    expect(extent.maxLon - extent.minLon).toBeGreaterThan(0);
    expect(extent.maxLat - extent.minLat).toBeGreaterThan(0);
    expect(extent.minLon).toBeLessThanOrEqual(ORIGIN.lon);
    expect(extent.maxLon).toBeGreaterThanOrEqual(ORIGIN.lon);
  });
});

/**
 * Finding 10 of the 4.0 review: the camera must be fitted to what the map
 * actually **draws**.
 *
 * GeoJSON conversion already refuses to draw a disabled avoid area, a one-point
 * span or an unresolvable line; the extent calculation counted them anyway, so a
 * stale avoid area forty kilometres away could pull the opening camera (or the
 * automatic fit after a plan) off the ride. Extent and projection now share one
 * set of drawable predicates, and these are the cases that prove it.
 */
describe("sceneExtent — camera extent honesty (4.0 review, finding 10)", () => {
  /** Far enough away that including it would move every assertion below. */
  const FAR_RING = [
    { lon: -60.0, lat: 20.0 },
    { lon: -59.9, lat: 20.0 },
    { lon: -59.9, lat: 20.1 },
    { lon: -60.0, lat: 20.0 },
  ];
  const FAR_REF = asGeometryRef("geo_far_area");
  const ONE_POINT_REF = asGeometryRef("geo_one_point");

  const readWith = (extra: Readonly<Record<string, GeometryPayload>>) =>
    (ref: GeometryRef): GeometryPayload | null => extra[ref] ?? readGeometry(ref);

  function area(enabled: boolean) {
    return {
      id: newAvoidAreaId(),
      name: null,
      geometryRef: FAR_REF,
      enabled,
      createdBy: "rider" as const,
    };
  }

  it("ignores the rings of a disabled avoid area, which the map does not draw", () => {
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({ avoidAreas: [area(false)] }),
        readGeometry: readWith({
          [FAR_REF]: { kind: "polygon", rings: [FAR_RING] },
        }),
      }),
    );

    // The scene still carries the area (it is authored state)…
    expect(scene.avoidAreas[0]?.enabled).toBe(false);
    expect(sceneCoordinates(scene).some((coordinate) => coordinate.lon === -60)).toBe(false);
    // …and the camera framing the ride is not pulled to it: the extent stays
    // inside the ride's own box instead of reaching the far ring's coordinates.
    const extent = sceneExtent(scene);
    expect(extent.minLon).toBeGreaterThan(-75.3);
    expect(extent.maxLon).toBeLessThan(-74.7);
    expect(extent.minLat).toBeGreaterThan(39.9);
    expect(extent.maxLat).toBeLessThan(40.3);
  });

  it("includes an enabled avoid area, because that one is drawn", () => {
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({ avoidAreas: [area(true)] }),
        readGeometry: readWith({
          [FAR_REF]: { kind: "polygon", rings: [FAR_RING] },
        }),
      }),
    );

    expect(sceneCoordinates(scene).some((coordinate) => coordinate.lon === -60)).toBe(true);
  });

  it("ignores a one-point span, a one-point sketch and an unresolvable route", () => {
    const onePointRoute = candidate(ROUTE_A_ID, ONE_POINT_REF);
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({
          start: null,
          finish: null,
          roadSpans: [
            {
              id: newRoadSpanId(),
              mode: "avoid",
              direction: "either",
              geometryRef: ONE_POINT_REF,
              anchorRefs: [],
            },
          ],
          sketch: {
            id: newSketchId(),
            rawStrokeRefs: [],
            corridorRef: ONE_POINT_REF,
            topologyHints: [],
            endpointPolicy: "derive",
          },
        }),
        session: sessionWith({
          committedBundle: bundle([onePointRoute], ROUTE_A_ID),
          selectedRouteId: ROUTE_A_ID,
        }),
        readGeometry: readWith({
          [ONE_POINT_REF]: { kind: "line", coordinates: [FAR_RING[0]!] },
        }),
      }),
    );

    // The scene keeps the authored objects, with the geometry a handle produced.
    expect(scene.roadSpans[0]?.geometry).toHaveLength(1);
    expect(scene.sketch?.geometry).toHaveLength(1);
    expect(scene.routes[0]?.geometry).toHaveLength(1);
    // None of it is drawable, so none of it may move the camera: with no
    // endpoints either, the scene falls back to the documented baseline region.
    expect(sceneCoordinates(scene).some((coordinate) => coordinate.lon === -60)).toBe(false);
    expect(sceneExtent(scene)).toEqual(DEFAULT_MAP_EXTENT);
  });
});

/**
 * Finding 9 of the 4.0 review: the auto-fit signal must notice interior edits.
 *
 * The key is what tells the workspace "the drawn route changed, fit again" (05
 * §8). An endpoint-only key stayed identical when the rider moved a middle
 * vertex, so an edited route could stay framed by the camera state of the route
 * before it.
 */
describe("drawnRoutesKey — the camera's change signal (4.0 review, finding 9)", () => {
  function routeScene(geometry: readonly Coordinate[]) {
    return { id: ROUTE_A_ID, role: null, geometry, state: "selected" as const };
  }

  it("is null when no route has a drawable line", () => {
    expect(drawnRoutesKey({ ...buildMapScene(sceneInput()), routes: [] })).toBeNull();
  });

  it("changes when an interior vertex moves while both endpoints stay put", () => {
    const before = buildMapScene(
      sceneInput({
        session: sessionWith({
          committedBundle: bundle([candidate(ROUTE_A_ID, ROUTE_REF_A)], ROUTE_A_ID),
          selectedRouteId: ROUTE_A_ID,
        }),
      }),
    );
    const movedMiddle = {
      ...before,
      routes: [routeScene([ORIGIN, { lon: -75.4, lat: 40.4 }, DESTINATION])],
    };
    const original = {
      ...before,
      routes: [routeScene([ORIGIN, MIDPOINT, DESTINATION])],
    };

    // Same id, same state, same endpoints, same vertex count: only the interior
    // geometry differs, and that is exactly the edit the key must notice.
    expect(drawnRoutesKey(movedMiddle)).not.toBe(drawnRoutesKey(original));
  });

  it("is stable for an unchanged drawing", () => {
    const scene = buildMapScene(
      sceneInput({
        session: sessionWith({
          committedBundle: bundle([candidate(ROUTE_A_ID, ROUTE_REF_A)], ROUTE_A_ID),
          selectedRouteId: ROUTE_A_ID,
        }),
      }),
    );

    expect(drawnRoutesKey(scene)).toBe(drawnRoutesKey(scene));
  });

  it("does not move for a presentation-only change (04 §9, 05 §11)", () => {
    const geometry = [ORIGIN, MIDPOINT, DESTINATION];
    const selected = { id: ROUTE_A_ID, role: null, geometry, state: "selected" as const };
    const previous = { ...selected, state: "previous" as const };

    // The camera frames *geography*. An update in flight — or one that failed —
    // draws the same line with the previous treatment, and re-fitting the camera
    // for a change of paint would yank the map twice per edit (04 §9, §21).
    expect(drawnRoutesKey({ ...buildMapScene(sceneInput()), routes: [previous] })).toBe(
      drawnRoutesKey({ ...buildMapScene(sceneInput()), routes: [selected] }),
    );
  });
});

describe("avoid-area editing visuals (05 §21)", () => {
  const areaWith = (geometryRef: GeometryRef, enabled: boolean) => ({
    id: newAvoidAreaId(),
    name: null,
    geometryRef,
    enabled,
    createdBy: "map" as const,
  });

  it("offers one handle per distinct vertex of the selected, enabled area", () => {
    const area = areaWith(AVOID_REF, true);
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({ avoidAreas: [area] }),
        uiState: { selectedObject: { kind: "avoid-area", avoidAreaId: area.id } },
      }),
    );

    // The fixture ring closes on its first vertex, so three distinct corners.
    expect(scene.avoidHandles).toHaveLength(3);
    expect(scene.avoidHandles.map((handle) => handle.vertexIndex)).toEqual([0, 1, 2]);
    expect(scene.avoidHandles[0]).toEqual({
      areaId: area.id,
      ringIndex: 0,
      vertexIndex: 0,
      coordinate: { lon: -75.1, lat: 39.9 },
    });
  });

  it("offers no handles when nothing is selected", () => {
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({ avoidAreas: [areaWith(AVOID_REF, true)] }),
        uiState: { selectedObject: null },
      }),
    );

    expect(scene.avoidHandles).toEqual([]);
  });

  it("offers no handles for a disabled area, which the map does not draw", () => {
    const area = areaWith(AVOID_REF, false);
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({ avoidAreas: [area] }),
        uiState: { selectedObject: { kind: "avoid-area", avoidAreaId: area.id } },
      }),
    );

    expect(scene.avoidHandles).toEqual([]);
  });

  it("offers no handles for an area whose rings did not resolve", () => {
    const area = areaWith(UNKNOWN_REF, true);
    const scene = buildMapScene(
      sceneInput({
        document: documentWith({ avoidAreas: [area] }),
        uiState: { selectedObject: { kind: "avoid-area", avoidAreaId: area.id } },
      }),
    );

    expect(scene.avoidAreas[0]?.rings).toEqual([]);
    expect(scene.avoidHandles).toEqual([]);
  });

  it("offers no handles for an area the document does not hold", () => {
    const scene = buildMapScene(
      sceneInput({
        uiState: { selectedObject: { kind: "avoid-area", avoidAreaId: newAvoidAreaId() } },
      }),
    );

    expect(scene.avoidHandles).toEqual([]);
  });

  it("projects the in-flight gesture, and keeps it out of the camera extent", () => {
    const far: Coordinate = { lon: -60, lat: 20 };
    const scene = buildMapScene(
      sceneInput({
        previewArea: {
          valid: true,
          rings: [
            [far, { lon: -60, lat: 20.1 }, { lon: -59.9, lat: 20.1 }, far],
          ],
        },
      }),
    );

    expect(scene.previewArea?.valid).toBe(true);
    // A gesture is a proposal, not content: framing it would move the camera
    // under the rider's own pointer (05 §8).
    expect(sceneCoordinates(scene).some((coordinate) => coordinate.lon === -60)).toBe(false);
  });

  it("carries no gesture when none is in flight", () => {
    expect(buildMapScene(sceneInput()).previewArea).toBeNull();
  });
});
