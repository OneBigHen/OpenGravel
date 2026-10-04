/**
 * The provider-neutral planning boundary (02-ARCHITECTURE-CONTRACT §10/§13,
 * 03-DOMAIN-MODEL §14–§19, 06-ROUTING-AND-DECISION-ENGINE §2–§7).
 *
 * Two contracts are under test here:
 *
 * 1. `buildProviderRequest` maps an authored intent onto the port request and
 *    reports what it could not resolve instead of dropping it.
 * 2. `intentIdentity` includes **every** route-affecting input, so a cache can
 *    never serve a plan computed for a different intent. The mutation table
 *    below is the anti-cache-poisoning regression: one case per route-affecting
 *    field, plus the pair tests proving copy-only changes keep the identity.
 */

import { describe, expect, it } from "vitest";

import type {
  PlanRequestContext,
  PlanRequestResult,
  PlanRequestVersions,
} from "@/application/planner/build-plan-request";
import {
  DEFAULT_PROVIDER_PROFILE,
  buildProviderRequest,
  canonicalIntentIdentity,
  defaultProfileFor,
  fnv1a64Hex,
  intentIdentity,
} from "@/application/planner/build-plan-request";
import type {
  ProviderCandidate,
  ProviderCandidateSet,
  ProviderCapabilities,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { GeometryPayload } from "@/domain/geometry/types";
import {
  asGeometryRef,
  asRoadEntityId,
  type AvoidAreaId,
  type GeometryRef,
  type PointId,
  type RoadSpanId,
  type ShapingId,
  type SketchId,
  type StopId,
} from "@/domain/ride/ids";
import { defaultRideIntent, createRideDocument } from "@/domain/ride/create";
import type {
  AvoidArea,
  Coordinate,
  RideDocument,
  RideIntent,
  RoadSpanConstraint,
  ShapingPoint,
  StopPoint,
} from "@/domain/ride/types";

const origin: Coordinate = { lon: -75.1652, lat: 39.9526 };
const finish: Coordinate = { lon: -75.5012, lat: 40.1203 };
const firstStop: Coordinate = { lon: -75.31, lat: 40.02 };
const secondStop: Coordinate = { lon: -75.44, lat: 40.09 };
const firstShaping: Coordinate = { lon: -75.2, lat: 40.03 };
const secondShaping: Coordinate = { lon: -75.35, lat: 40.11 };

const VERSIONS: PlanRequestVersions = {
  routePolicy: "PA_NJ_ROUTE_POLICY_VNEXT_1",
  graph: "gh-nj-2026-04",
  evidence: "road-intel-3",
};

const AVOID_RINGS: readonly (readonly Coordinate[])[] = [
  [
    { lon: -75.4, lat: 40.0 },
    { lon: -75.3, lat: 40.0 },
    { lon: -75.3, lat: 40.1 },
    { lon: -75.4, lat: 40.0 },
  ],
];

const AVOID_POLYGON: GeometryPayload = { kind: "polygon", rings: AVOID_RINGS };

function startPoint(): NonNullable<RideIntent["start"]> {
  return {
    id: "pt_start" as PointId,
    kind: "start",
    coordinate: origin,
    label: "Home",
    provenance: { type: "map", selectedAt: "2026-04-01T08:00:00.000Z" },
  };
}

function finishPoint(): NonNullable<RideIntent["finish"]> {
  return {
    id: "pt_finish" as PointId,
    kind: "finish",
    coordinate: finish,
    label: "Cabin",
    provenance: { type: "search", provider: "nominatim", query: "Cabin" },
  };
}

function stop(id: string, coordinate: Coordinate): StopPoint {
  return {
    id: id as StopId,
    kind: "stop",
    coordinate,
    arrivalIntent: "fuel",
    provenance: { type: "map", selectedAt: "2026-04-01T09:00:00.000Z" },
  };
}

function shaping(id: string, coordinate: Coordinate): ShapingPoint {
  return { id: id as ShapingId, kind: "shape", coordinate, source: "map-drag" };
}

function avoidArea(id: string, geometryRef: string, enabled: boolean): AvoidArea {
  return {
    id: id as AvoidAreaId,
    name: id,
    geometryRef: asGeometryRef(geometryRef),
    enabled,
    createdBy: "rider",
  };
}

function roadSpan(): RoadSpanConstraint {
  return {
    id: "span_1" as RoadSpanId,
    mode: "must",
    direction: "forward",
    roadEntityId: asRoadEntityId("road_611"),
    geometryRef: asGeometryRef("geo_span_1"),
    anchorRefs: [{ lon: -75.28, lat: 40.05 }],
    evidenceSnapshot: { evidenceVersion: "road-intel-3" },
  };
}

/** A fully populated, valid authored intent: every section present. */
function fullIntent(): RideIntent {
  return {
    ...defaultRideIntent(),
    shape: "destination",
    start: startPoint(),
    finish: finishPoint(),
    stops: [stop("stop_1", firstStop), stop("stop_2", secondStop)],
    shaping: [shaping("shape_1", firstShaping), shaping("shape_2", secondShaping)],
    time: { kind: "budget", targetMinutes: 180, toleranceMinutes: 20 },
    departure: { kind: "future", at: "2026-04-01T13:00:00.000Z" },
    roadCharacter: "curvy",
    surface: {
      preference: "mixed",
      targetUnpavedShare: { min: 0.2, target: 0.35, max: 0.5 },
      unknownSurfacePolicy: "allow-with-warning",
    },
    terrain: { level: "moderate" },
    traffic: "protect-ride",
    avoidHighways: true,
    tollPolicy: "avoid",
    bike: {
      bikeId: "bike_1",
      category: "adventure",
      fuelRangeMiles: 180,
      reserveMiles: 30,
      maintainedGravel: "allow",
      roughTracks: "allow",
      unknownSurface: "allow-with-warning",
      custom: { luggage: true },
    },
    avoidAreas: [
      avoidArea("avoid_1", "geo_avoid_1", true),
      avoidArea("avoid_2", "geo_avoid_2", false),
    ],
    roadSpans: [roadSpan()],
    sketch: {
      id: "sketch_1" as SketchId,
      rawStrokeRefs: [asGeometryRef("geo_stroke_1")],
      corridorRef: asGeometryRef("geo_corridor_1"),
      topologyHints: [{ kind: "near-loop", at: { lon: -75.44, lat: 40.14 }, strokeIndices: [0] }],
      endpointPolicy: "preserve-existing",
    },
    longTrip: { staged: false, notes: "day 1 of 2" },
  };
}

interface ResolverSpy {
  readonly refs: readonly GeometryRef[];
  readonly resolveGeometry: (ref: GeometryRef) => GeometryPayload | null;
}

/**
 * The fixture sketch's stored trace: a line payload both of its handles resolve
 * to. Task 4.4 makes `fullIntent()`'s sketch resolvable, because a request that
 * carries a sketch re-derives its corridor from those handles (04 §19).
 */
const SKETCH_LINE: GeometryPayload = {
  kind: "line",
  coordinates: [
    { lon: -75.44, lat: 40.14 },
    { lon: -75.43, lat: 40.15 },
  ],
};

function resolverSpy(payloads: ReadonlyMap<string, GeometryPayload>): ResolverSpy {
  const refs: GeometryRef[] = [];
  const resolved = new Map<string, GeometryPayload>([
    ["geo_stroke_1", SKETCH_LINE],
    ["geo_corridor_1", SKETCH_LINE],
    ...payloads,
  ]);
  return {
    refs,
    resolveGeometry: (ref) => {
      refs.push(ref);
      return resolved.get(ref) ?? null;
    },
  };
}

function contextWith(
  spy: ResolverSpy,
  extra?: Omit<PlanRequestContext, "resolveGeometry">,
): PlanRequestContext {
  return { resolveGeometry: spy.resolveGeometry, ...extra };
}

function expectOk(result: PlanRequestResult): Extract<PlanRequestResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected a built request, got issues: ${result.issues.join(" | ")}`);
  }
  return result;
}

function expectInvalid(result: PlanRequestResult): Extract<PlanRequestResult, { ok: false }> {
  if (result.ok) throw new Error("expected an invalid result");
  return result;
}

describe("buildProviderRequest — mapping (06-ROUTING-AND-DECISION-ENGINE §6)", () => {
  it("maps a fully populated intent onto the provider request", async () => {
    const spy = resolverSpy(new Map([["geo_avoid_1", AVOID_POLYGON]]));

    const result = expectOk(
      await buildProviderRequest(
        fullIntent(),
        contextWith(spy, {
          requestId: "req_fixed",
          includeAlternatives: true,
          profileFor: () => "curvy-gravel",
        }),
      ),
    );

    expect(result.request.requestId).toBe("req_fixed");
    expect(result.request.origin).toEqual(origin);
    expect(result.request.destination).toEqual(finish);
    expect(result.request.stops).toEqual([firstStop, secondStop]);
    expect(result.request.shaping).toEqual([firstShaping, secondShaping]);
    expect(result.profile).toBe("curvy-gravel");
    expect(result.request.profile).toBe(result.profile);
    expect(result.request.options).toEqual({
      includeAlternatives: true,
      avoidHighways: true,
      tollPolicy: "avoid",
      surfacePreference: "mixed",
      targetUnpavedShare: 0.35,
      traffic: "protect-ride",
      departureNow: false,
      bike: { category: "adventure", maintainedGravel: "allow", roughTracks: "allow" },
      roadCharacter: "curvy",
      noveltyPreference: "balanced",
      vehicle: "motorcycle",
    });
    expect(result.request.avoidPolygons).toEqual(AVOID_RINGS);
    expect(result.unresolvedRefs).toEqual([]);
  });

  it("mints a request id when the caller does not supply one", async () => {
    const spy = resolverSpy(new Map());

    const result = expectOk(await buildProviderRequest(fullIntent(), contextWith(spy)));

    expect(result.request.requestId.startsWith("req_")).toBe(true);
    expect(result.request.requestId.length).toBeGreaterThan("req_".length);
  });

  it("defaults the profile to the documented internal stub", async () => {
    const spy = resolverSpy(new Map());

    const result = expectOk(await buildProviderRequest(fullIntent(), contextWith(spy)));

    expect(DEFAULT_PROVIDER_PROFILE).toBe("motorcycle");
    expect(result.profile).toBe(DEFAULT_PROVIDER_PROFILE);
    expect(defaultProfileFor()).toBe(DEFAULT_PROVIDER_PROFILE);
    expect(result.request.options.includeAlternatives).toBe(false);
  });

  it("keeps authored order for stops and shaping anchors", async () => {
    const spy = resolverSpy(new Map());
    const intent = fullIntent();

    const result = expectOk(
      await buildProviderRequest(
        {
          ...intent,
          stops: [...intent.stops].reverse(),
          shaping: [...intent.shaping].reverse(),
        },
        contextWith(spy),
      ),
    );

    expect(result.request.stops).toEqual([secondStop, firstStop]);
    expect(result.request.shaping).toEqual([secondShaping, firstShaping]);
  });

  it("resolves only enabled avoid areas and never touches a disabled ref", async () => {
    const spy = resolverSpy(
      new Map([
        ["geo_avoid_1", AVOID_POLYGON],
        ["geo_avoid_2", AVOID_POLYGON],
      ]),
    );

    const result = expectOk(await buildProviderRequest(fullIntent(), contextWith(spy)));

    // The disabled avoid ref is never touched; the enabled one is — and so is
    // the authored road span's line, because the builder resolves every span's
    // corridor for the provider request (Task 4.3b). The sketch's own handles are
    // read first, because a sketch supplies the corridor the trace is re-derived
    // from (Task 4.4).
    expect(spy.refs).toEqual([
      "geo_stroke_1",
      "geo_corridor_1",
      "geo_avoid_1",
      "geo_span_1",
    ]);
    expect(result.request.avoidPolygons).toHaveLength(1);
    expect(result.unresolvedRefs).toEqual([]);
  });

  it("accepts an asynchronous geometry resolver", async () => {
    const context: PlanRequestContext = {
      resolveGeometry: (ref) =>
        Promise.resolve(ref === "geo_avoid_1" ? AVOID_POLYGON : null),
    };

    const result = expectOk(await buildProviderRequest(fullIntent(), context));

    expect(result.request.avoidPolygons).toHaveLength(1);
  });

  it("reports an unresolved avoid-area ref instead of silently dropping it", async () => {
    const spy = resolverSpy(new Map());

    const result = expectOk(await buildProviderRequest(fullIntent(), contextWith(spy)));

    expect(result.unresolvedRefs).toEqual([asGeometryRef("geo_avoid_1")]);
    expect(result.request.avoidPolygons).toEqual([]);
  });

  it("reports a non-polygon payload as unresolved rather than routing through it", async () => {
    const spy = resolverSpy(
      new Map<string, GeometryPayload>([
        ["geo_avoid_1", { kind: "line", coordinates: [origin, finish] }],
      ]),
    );

    const result = expectOk(await buildProviderRequest(fullIntent(), contextWith(spy)));

    expect(result.unresolvedRefs).toEqual([asGeometryRef("geo_avoid_1")]);
    expect(result.request.avoidPolygons).toEqual([]);
  });

  it("freezes the built request so a later mutation cannot retarget the call", async () => {
    const spy = resolverSpy(new Map());

    const result = expectOk(await buildProviderRequest(fullIntent(), contextWith(spy)));

    expect(Object.isFrozen(result.request)).toBe(true);
    expect(Object.isFrozen(result.request.options)).toBe(true);
    expect(Object.isFrozen(result.request.stops)).toBe(true);
    expect(Object.isFrozen(result.request.stops[0])).toBe(true);
  });
});

describe("buildProviderRequest — trip shape (03-DOMAIN-MODEL §3)", () => {
  it("plans a loop as a round trip back to the origin", async () => {
    const spy = resolverSpy(new Map());

    const result = expectOk(
      await buildProviderRequest(
        { ...fullIntent(), shape: "loop", finish: null },
        contextWith(spy),
      ),
    );

    expect(result.request.origin).toEqual(origin);
    expect(result.request.destination).toEqual(origin);
    expect(result.request.discovery).toEqual({
      targetMinutes: 180,
      toleranceMinutes: 20,
    });
  });

  it("does not send loop-discovery metadata for a non-loop or unbudgeted ride", async () => {
    const spy = resolverSpy(new Map());
    const destination = expectOk(
      await buildProviderRequest(fullIntent(), contextWith(spy)),
    );
    const unbudgetedLoop = expectOk(
      await buildProviderRequest(
        { ...fullIntent(), shape: "loop", time: { kind: "none" } },
        contextWith(spy),
      ),
    );

    expect(destination.request.discovery).toBeUndefined();
    expect(unbudgetedLoop.request.discovery).toBeUndefined();
  });

  it("keeps a loop a round trip even when a finish is still authored", async () => {
    const spy = resolverSpy(new Map());

    const result = expectOk(
      await buildProviderRequest(
        { ...fullIntent(), shape: "loop" },
        contextWith(spy),
      ),
    );

    expect(result.request.destination).toEqual(origin);
  });

  it("plans an open ride as point-to-point when a finish exists", async () => {
    const spy = resolverSpy(new Map());

    const result = expectOk(
      await buildProviderRequest({ ...fullIntent(), shape: "open" }, contextWith(spy)),
    );

    expect(result.request.destination).toEqual(finish);
  });
});

describe("buildProviderRequest — invalid intents", () => {
  it("rejects a destination ride without a start", async () => {
    const spy = resolverSpy(new Map());

    // No sketch: a trace's own endpoints would fill the missing start (04 §19),
    // so the rejection is asserted on a ride that has nothing to derive from.
    const result = expectInvalid(
      await buildProviderRequest(
        { ...fullIntent(), start: null, sketch: null },
        contextWith(spy),
      ),
    );

    expect(result.issues.some((issue) => issue.startsWith("missing-start:"))).toBe(true);
    expect(spy.refs).toEqual([]);
  });

  it("rejects a destination ride without a finish", async () => {
    const spy = resolverSpy(new Map());

    const result = expectInvalid(
      await buildProviderRequest(
        { ...fullIntent(), finish: null, sketch: null },
        contextWith(spy),
      ),
    );

    expect(result.issues.some((issue) => issue.startsWith("missing-finish:"))).toBe(true);
  });

  it("rejects an open ride with neither finish nor corridor", async () => {
    const spy = resolverSpy(new Map());

    const result = expectInvalid(
      await buildProviderRequest(
        { ...fullIntent(), shape: "open", finish: null, sketch: null },
        contextWith(spy),
      ),
    );

    expect(
      result.issues.some((issue) => issue.startsWith("open-ride-without-finish:")),
    ).toBe(true);
  });

  it("rejects an impossible time budget", async () => {
    const spy = resolverSpy(new Map());

    const result = expectInvalid(
      await buildProviderRequest(
        {
          ...fullIntent(),
          time: { kind: "budget", targetMinutes: 0, toleranceMinutes: -5 },
        },
        contextWith(spy),
      ),
    );

    expect(result.issues.some((issue) => issue.includes("targetMinutes"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("toleranceMinutes"))).toBe(true);
  });

  it("rejects an unparsable deadline", async () => {
    const spy = resolverSpy(new Map());

    const result = expectInvalid(
      await buildProviderRequest(
        {
          ...fullIntent(),
          time: {
            kind: "returnBy",
            localTime: "25:99",
            date: "2026-02-30",
            toleranceMinutes: 10,
          },
        },
        contextWith(spy),
      ),
    );

    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("rejects an illegal stop order (duplicate stop identity)", async () => {
    const spy = resolverSpy(new Map());

    const result = expectInvalid(
      await buildProviderRequest(
        {
          ...fullIntent(),
          stops: [stop("stop_1", firstStop), stop("stop_1", secondStop)],
        },
        contextWith(spy),
      ),
    );

    expect(result.issues.some((issue) => issue.includes("duplicate"))).toBe(true);
  });

  it("rejects an out-of-bounds coordinate", async () => {
    const spy = resolverSpy(new Map());
    const start = startPoint();

    const result = expectInvalid(
      await buildProviderRequest(
        { ...fullIntent(), start: { ...start, coordinate: { lon: 200, lat: 40 } } },
        contextWith(spy),
      ),
    );

    expect(result.issues).not.toEqual([]);
  });
});

interface IdentityCase {
  readonly name: string;
  readonly mutate: (intent: RideIntent) => RideIntent;
}

const ROUTE_AFFECTING_CASES: readonly IdentityCase[] = [
  { name: "start coordinate", mutate: (i) => ({ ...i, start: { ...startPoint(), coordinate: { lon: -76.0, lat: 40.5 } } }) },
  { name: "start removed", mutate: (i) => ({ ...i, start: null }) },
  { name: "finish coordinate", mutate: (i) => ({ ...i, finish: { ...finishPoint(), coordinate: { lon: -76.2, lat: 40.6 } } }) },
  { name: "finish removed", mutate: (i) => ({ ...i, finish: null }) },
  { name: "shape", mutate: (i) => ({ ...i, shape: "loop" }) },
  { name: "stops order", mutate: (i) => ({ ...i, stops: [...i.stops].reverse() }) },
  { name: "stops added", mutate: (i) => ({ ...i, stops: [...i.stops, stop("stop_3", { lon: -75.5, lat: 40.05 })] }) },
  { name: "stops removed", mutate: (i) => ({ ...i, stops: i.stops.slice(0, 1) }) },
  { name: "shaping order", mutate: (i) => ({ ...i, shaping: [...i.shaping].reverse() }) },
  { name: "shaping added", mutate: (i) => ({ ...i, shaping: [...i.shaping, shaping("shape_3", { lon: -75.6, lat: 40.2 })] }) },
  { name: "time target minutes", mutate: (i) => ({ ...i, time: { kind: "budget", targetMinutes: 240, toleranceMinutes: 20 } }) },
  { name: "time tolerance", mutate: (i) => ({ ...i, time: { kind: "budget", targetMinutes: 180, toleranceMinutes: 45 } }) },
  { name: "time kind", mutate: (i) => ({ ...i, time: { kind: "none" } }) },
  { name: "departure instant", mutate: (i) => ({ ...i, departure: { kind: "future", at: "2026-04-01T14:00:00.000Z" } }) },
  { name: "departure kind", mutate: (i) => ({ ...i, departure: { kind: "now" } }) },
  { name: "road character", mutate: (i) => ({ ...i, roadCharacter: "backroads" }) },
  { name: "novelty preference", mutate: (i) => ({ ...i, noveltyPreference: "prefer-new-to-me" }) },
  { name: "surface preference", mutate: (i) => ({ ...i, surface: { ...i.surface, preference: "dirt-preferred" } }) },
  { name: "surface unpaved target", mutate: (i) => ({ ...i, surface: { ...i.surface, targetUnpavedShare: { min: 0.2, target: 0.4, max: 0.5 } } }) },
  { name: "surface unknown policy", mutate: (i) => ({ ...i, surface: { ...i.surface, unknownSurfacePolicy: "avoid-when-possible" } }) },
  { name: "terrain level", mutate: (i) => ({ ...i, terrain: { level: "any-supported" } }) },
  { name: "traffic preference", mutate: (i) => ({ ...i, traffic: "minimize-delay" }) },
  { name: "avoid highways", mutate: (i) => ({ ...i, avoidHighways: false }) },
  { name: "toll policy", mutate: (i) => ({ ...i, tollPolicy: "allow-with-warning" }) },
  { name: "bike id", mutate: (i) => ({ ...i, bike: { ...i.bike, bikeId: "bike_2" } }) },
  { name: "bike category", mutate: (i) => ({ ...i, bike: { ...i.bike, category: "dual-sport" } }) },
  { name: "bike fuel range", mutate: (i) => ({ ...i, bike: { ...i.bike, fuelRangeMiles: 220 } }) },
  { name: "bike reserve", mutate: (i) => ({ ...i, bike: { ...i.bike, reserveMiles: 45 } }) },
  { name: "bike gravel policy", mutate: (i) => ({ ...i, bike: { ...i.bike, maintainedGravel: "avoid" } }) },
  { name: "bike rough-track policy", mutate: (i) => ({ ...i, bike: { ...i.bike, roughTracks: "avoid" } }) },
  { name: "bike unknown-surface policy", mutate: (i) => ({ ...i, bike: { ...i.bike, unknownSurface: "avoid-when-possible" } }) },
  { name: "bike custom constraints", mutate: (i) => ({ ...i, bike: { ...i.bike, custom: { luggage: false } } }) },
  { name: "avoid area ref", mutate: (i) => ({ ...i, avoidAreas: [avoidArea("avoid_1", "geo_avoid_9", true), i.avoidAreas[1] as AvoidArea] }) },
  { name: "avoid area enabled", mutate: (i) => ({ ...i, avoidAreas: [avoidArea("avoid_1", "geo_avoid_1", false), i.avoidAreas[1] as AvoidArea] }) },
  { name: "avoid area removed", mutate: (i) => ({ ...i, avoidAreas: i.avoidAreas.slice(1) }) },
  { name: "road span mode", mutate: (i) => ({ ...i, roadSpans: [{ ...roadSpan(), mode: "prefer" }] }) },
  { name: "road span direction", mutate: (i) => ({ ...i, roadSpans: [{ ...roadSpan(), direction: "reverse" }] }) },
  { name: "road span geometry ref", mutate: (i) => ({ ...i, roadSpans: [{ ...roadSpan(), geometryRef: asGeometryRef("geo_span_9") }] }) },
  { name: "road span road entity", mutate: (i) => ({ ...i, roadSpans: [{ ...roadSpan(), roadEntityId: asRoadEntityId("road_999") }] }) },
  { name: "road span anchors", mutate: (i) => ({ ...i, roadSpans: [{ ...roadSpan(), anchorRefs: [{ lon: -75.9, lat: 40.9 }] }] }) },
  { name: "road span evidence version", mutate: (i) => ({ ...i, roadSpans: [{ ...roadSpan(), evidenceSnapshot: { evidenceVersion: "road-intel-4" } }] }) },
  { name: "sketch corridor ref", mutate: (i) => ({ ...i, sketch: { ...(i.sketch as NonNullable<RideIntent["sketch"]>), corridorRef: asGeometryRef("geo_corridor_9") } }) },
  { name: "sketch endpoint policy", mutate: (i) => ({ ...i, sketch: { ...(i.sketch as NonNullable<RideIntent["sketch"]>), endpointPolicy: "derive" } }) },
  { name: "sketch removed", mutate: (i) => ({ ...i, sketch: null }) },
];

const COPY_ONLY_CASES: readonly IdentityCase[] = [
  { name: "start label", mutate: (i) => ({ ...i, start: { ...startPoint(), label: "Work" } }) },
  { name: "start provenance", mutate: (i) => ({ ...i, start: { ...startPoint(), provenance: { type: "gps", accuracyMeters: 8, observedAt: "2026-04-01T08:00:00.000Z" } } }) },
  { name: "point id", mutate: (i) => ({ ...i, start: { ...startPoint(), id: "pt_other" as PointId } }) },
  { name: "stop label", mutate: (i) => ({ ...i, stops: [{ ...stop("stop_1", firstStop), label: "Fuel" }, i.stops[1] as StopPoint] }) },
  { name: "stop arrival intent", mutate: (i) => ({ ...i, stops: [{ ...stop("stop_1", firstStop), arrivalIntent: "scenic" }, i.stops[1] as StopPoint] }) },
  { name: "stop id", mutate: (i) => ({ ...i, stops: [stop("stop_9", firstStop), i.stops[1] as StopPoint] }) },
  { name: "shaping source", mutate: (i) => ({ ...i, shaping: [{ ...shaping("shape_1", firstShaping), source: "sketch" }, i.shaping[1] as ShapingPoint] }) },
  { name: "avoid area name", mutate: (i) => ({ ...i, avoidAreas: [{ ...avoidArea("avoid_1", "geo_avoid_1", true), name: "Turnpike" }, i.avoidAreas[1] as AvoidArea] }) },
  { name: "avoid area author", mutate: (i) => ({ ...i, avoidAreas: [{ ...avoidArea("avoid_1", "geo_avoid_1", true), createdBy: "advisor" }, i.avoidAreas[1] as AvoidArea] }) },
  { name: "road span snapshot notes", mutate: (i) => ({ ...i, roadSpans: [{ ...roadSpan(), evidenceSnapshot: { evidenceVersion: "road-intel-3", notes: "gated" } }] }) },
  { name: "sketch raw strokes", mutate: (i) => ({ ...i, sketch: { ...(i.sketch as NonNullable<RideIntent["sketch"]>), rawStrokeRefs: [asGeometryRef("geo_stroke_2")] } }) },
  { name: "sketch topology hints", mutate: (i) => ({ ...i, sketch: { ...(i.sketch as NonNullable<RideIntent["sketch"]>), topologyHints: [] } }) },
  { name: "long-trip notes", mutate: (i) => ({ ...i, longTrip: { staged: false, notes: "day 2" } }) },
];

describe("intentIdentity — canonical route-affecting identity (02-ARCHITECTURE-CONTRACT §13)", () => {
  it("is stable across calls and object key order, and shaped as id2:<16 hex>", () => {
    const intent = fullIntent();
    const reordered = reorderIntent(intent);
    const nestedReorder: RideIntent = {
      ...intent,
      bike: {
        custom: { luggage: true },
        unknownSurface: "allow-with-warning",
        roughTracks: "allow",
        maintainedGravel: "allow",
        reserveMiles: 30,
        fuelRangeMiles: 180,
        category: "adventure",
        bikeId: "bike_1",
      },
      surface: {
        unknownSurfacePolicy: "allow-with-warning",
        targetUnpavedShare: { max: 0.5, target: 0.35, min: 0.2 },
        preference: "mixed",
      },
    };

    expect(canonicalIntentIdentity(reordered, VERSIONS)).toBe(
      canonicalIntentIdentity(intent, VERSIONS),
    );
    expect(canonicalIntentIdentity(nestedReorder, VERSIONS)).toBe(
      canonicalIntentIdentity(intent, VERSIONS),
    );
    expect(intentIdentity(reordered, VERSIONS)).toBe(intentIdentity(intent, VERSIONS));
    expect(intentIdentity(nestedReorder, VERSIONS)).toBe(
      intentIdentity(intent, VERSIONS),
    );
    expect(intentIdentity(intent, VERSIONS)).toMatch(/^id2:[0-9a-f]{16}$/);
    expect(intentIdentity(intent, VERSIONS)).toBe(intentIdentity(intent, VERSIONS));
  });

  it.each(ROUTE_AFFECTING_CASES)("changes when $name changes", ({ mutate }) => {
    const base = fullIntent();

    expect(mutate(base)).not.toEqual(base);
    expect(intentIdentity(mutate(base), VERSIONS)).not.toBe(
      intentIdentity(base, VERSIONS),
    );
  });

  it.each(COPY_ONLY_CASES)("does not change when $name changes", ({ mutate }) => {
    const base = fullIntent();

    expect(intentIdentity(mutate(base), VERSIONS)).toBe(
      intentIdentity(base, VERSIONS),
    );
  });

  it.each([
    ["routePolicy", { ...VERSIONS, routePolicy: "PA_NJ_ROUTE_POLICY_VNEXT_2" }],
    ["graph", { ...VERSIONS, graph: "gh-nj-2026-05" }],
    ["evidence", { ...VERSIONS, evidence: "road-intel-4" }],
  ] satisfies readonly (readonly [string, PlanRequestVersions])[])(
    "changes when the %s version changes",
    (_name, versions) => {
      expect(intentIdentity(fullIntent(), versions)).not.toBe(
        intentIdentity(fullIntent(), VERSIONS),
      );
    },
  );

  it("does not change when document metadata such as the title changes", () => {
    const titled: RideDocument = {
      ...createRideDocument({ title: "Sunday gravel loop" }),
      intent: fullIntent(),
    };
    const renamed: RideDocument = { ...titled, title: "Untitled ride" };

    expect(renamed.title).not.toBe(titled.title);
    expect(intentIdentity(renamed.intent, VERSIONS)).toBe(
      intentIdentity(titled.intent, VERSIONS),
    );
  });

  it("maps no two different route-affecting inputs to the same identity", () => {
    const base = fullIntent();
    const seen = new Map<string, string>([
      [intentIdentity(base, VERSIONS), "base"],
    ]);

    for (const { name, mutate } of ROUTE_AFFECTING_CASES) {
      const identity = intentIdentity(mutate(base), VERSIONS);
      const collision = seen.get(identity);
      expect(collision, `${name} collides with ${String(collision)}`).toBeUndefined();
      seen.set(identity, name);
    }
  });

  it("normalizes coordinates so sub-metric noise cannot fork the cache", () => {
    const base = fullIntent();
    const jittered: RideIntent = {
      ...base,
      start: { ...startPoint(), coordinate: { lon: origin.lon + 1e-12, lat: origin.lat } },
    };

    expect(intentIdentity(jittered, VERSIONS)).toBe(intentIdentity(base, VERSIONS));
  });

  it("implements FNV-1a 64-bit over UTF-8 bytes", () => {
    // Published FNV-1a 64 test vectors.
    expect(fnv1a64Hex("")).toBe("cbf29ce484222325");
    expect(fnv1a64Hex("a")).toBe("af63dc4c8601ec8c");
    expect(fnv1a64Hex("foobar")).toBe("85944171f73967e8");
    // Multi-byte text is hashed by its UTF-8 bytes (TextEncoder is the reference).
    for (const text of ["é", "🇦🇷", "gravel 🚀 road", "straße"]) {
      expect(fnv1a64Hex(text)).toBe(fnv1a64OverUtf8Bytes(text));
    }
    expect(fnv1a64Hex("é")).not.toBe(fnv1a64Hex("e"));
  });
});

/** Independent reference: the same algorithm fed by `TextEncoder` bytes. */
function fnv1a64OverUtf8Bytes(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** The same intent with its keys inserted in the reverse order. */
function reorderIntent(intent: RideIntent): RideIntent {
  return {
    longTrip: intent.longTrip,
    sketch: intent.sketch,
    roadSpans: intent.roadSpans,
    avoidAreas: intent.avoidAreas,
    bike: intent.bike,
    tollPolicy: intent.tollPolicy,
    avoidHighways: intent.avoidHighways,
    traffic: intent.traffic,
    terrain: intent.terrain,
    surface: intent.surface,
    noveltyPreference: intent.noveltyPreference,
    roadCharacter: intent.roadCharacter,
    departure: intent.departure,
    time: intent.time,
    shaping: intent.shaping,
    stops: intent.stops,
    finish: intent.finish,
    start: intent.start,
    shape: intent.shape,
  };
}

/** A provider that waits, so an abort has something to cancel. */
class WaitingProvider implements RouteCandidateProvider {
  readonly id = "waiting-provider";

  capabilities(): ProviderCapabilities {
    return { profiles: ["motorcycle"], supportsAlternatives: true, supportsAvoidPolygons: true };
  }

  candidates(
    _request: ProviderRouteRequest,
    signal: AbortSignal,
  ): Promise<ProviderCandidateSet> {
    if (signal.aborted) return Promise.reject(signal.reason);
    const set: ProviderCandidateSet = { candidates: [] };
    return new Promise<ProviderCandidateSet>((resolve, reject) => {
      const timer = setTimeout(() => resolve(set), 50);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  }
}

/** A provider that answers immediately, to pin the candidate-set shape. */
class ImmediateProvider implements RouteCandidateProvider {
  readonly id = "immediate-provider";

  capabilities(): ProviderCapabilities {
    return { profiles: ["motorcycle"], supportsAlternatives: false, supportsAvoidPolygons: false };
  }

  candidates(request: ProviderRouteRequest): Promise<ProviderCandidateSet> {
    const candidate: ProviderCandidate = {
      providerId: this.id,
      profile: request.profile,
      geometry: [request.origin, request.destination],
      distanceMeters: 1_000,
      durationSeconds: 120,
      instructions: [
        {
          text: "Head north",
          distanceMeters: 500,
          durationSeconds: 60,
          type: "continue",
        },
      ],
      providerMetadata: { "gh.priority": 1, "gh.toll": false },
    };
    return Promise.resolve({ candidates: [candidate] });
  }
}

describe("RouteCandidateProvider port (02-ARCHITECTURE-CONTRACT §10)", () => {
  it("carries provider-internal capabilities, never rider-facing labels", () => {
    const capabilities = new WaitingProvider().capabilities();

    expect(capabilities).toEqual({
      profiles: ["motorcycle"],
      supportsAlternatives: true,
      supportsAvoidPolygons: true,
    });
  });

  it("honors the AbortSignal and rejects with its reason", async () => {
    const provider = new WaitingProvider();
    const controller = new AbortController();
    const reason = new Error("rider cancelled the plan");
    const spy = resolverSpy(new Map());
    const request = expectOk(
      await buildProviderRequest(fullIntent(), contextWith(spy, { requestId: "req_1" })),
    ).request;

    const pending = provider.candidates(request, controller.signal);
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("rejects immediately when the signal was already aborted", async () => {
    const provider = new WaitingProvider();
    const controller = new AbortController();
    const reason = new Error("already cancelled");
    controller.abort(reason);
    const spy = resolverSpy(new Map());
    const request = expectOk(
      await buildProviderRequest(fullIntent(), contextWith(spy)),
    ).request;

    await expect(provider.candidates(request, controller.signal)).rejects.toBe(reason);
  });

  it("returns full-resolution candidate geometry, metrics and instructions", async () => {
    const provider: RouteCandidateProvider = new ImmediateProvider();
    const request = expectOk(
      await buildProviderRequest(fullIntent(), contextWith(resolverSpy(new Map()))),
    ).request;

    const set = await provider.candidates(request, new AbortController().signal);

    expect(provider.id).toBe("immediate-provider");
    expect(set.candidates).toHaveLength(1);
    expect(set.candidates[0]?.geometry).toEqual([origin, finish]);
    expect(set.candidates[0]?.distanceMeters).toBe(1_000);
    expect(set.candidates[0]?.instructions?.[0]?.type).toBe("continue");
    expect(set.candidates[0]?.providerMetadata?.["gh.priority"]).toBe(1);
  });
});
