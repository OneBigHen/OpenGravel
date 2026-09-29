/**
 * Road spans end-to-end into the provider request (04 §17, 06 §8/§19,
 * 17-IMPLEMENTATION-PLAN Task 2.2/4.3b).
 *
 * Three links are asserted here:
 *
 * - `buildProviderRequest` resolves each span's stored line and carries the span
 *   (mode, direction, ordered anchors, corridor) on the provider-neutral request;
 * - the GraphHopper builder turns a `must` span into **ordered via waypoints**
 *   injected right after the origin, and an `avoid` span's corridor into an
 *   avoid area feature with a zero-priority rule;
 * - the wire validator bounds the span list, its anchors and its corridor before
 *   any provider work.
 */

import { describe, expect, it } from "vitest";

import {
  buildProviderRequest,
  type PlanRequestContext,
} from "@/application/planner/build-plan-request";
import type { ProviderRoadSpan } from "@/application/planner/route-provider";
import {
  createGraphHopperRequest,
  type GraphHopperSpanConstraint,
} from "@/infrastructure/routing/graphhopper/request-builder";
import { parseRoutePlanRequestBody, MAX_ROAD_SPANS } from "@/server/planning/validation";
import { defaultRideIntent } from "@/domain/ride/create";
import { asGeometryRef, asRoadEntityId } from "@/domain/ride/ids";
import type { Coordinate, RideIntent } from "@/domain/ride/types";
import type { GeometryPayload } from "@/domain/geometry/types";

const BASE: Coordinate = { lon: -75.44, lat: 40.14 };
const ONE_METER_LAT = 1 / 111_320;
const ONE_METER_LON = 1 / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));

function metres(east: number, north: number): Coordinate {
  return {
    lon: BASE.lon + east * ONE_METER_LON,
    lat: BASE.lat + north * ONE_METER_LAT,
  };
}

const SPAN_LINE: readonly Coordinate[] = [metres(0, 0), metres(200, 0), metres(400, 0)];

const SPAN_REF = asGeometryRef("geo_span");

function intentWithSpan(overrides: Partial<RideIntent> = {}): RideIntent {
  const base = defaultRideIntent();
  return {
    ...base,
    start: {
      id: "pt_start" as never,
      kind: "start",
      coordinate: metres(-500, 0),
      provenance: { type: "map", selectedAt: "2026-01-01T00:00:00.000Z" },
    },
    finish: {
      id: "pt_finish" as never,
      kind: "finish",
      coordinate: metres(1000, 0),
      provenance: { type: "map", selectedAt: "2026-01-01T00:00:00.000Z" },
    },
    roadSpans: [
      {
        id: "span_keep" as never,
        mode: "must",
        direction: "forward",
        roadEntityId: asRoadEntityId("road_1"),
        geometryRef: SPAN_REF,
        anchorRefs: [SPAN_LINE[0]!, SPAN_LINE[2]!],
      },
    ],
    ...overrides,
  };
}

function context(
  payload: GeometryPayload | null = { kind: "line", coordinates: SPAN_LINE },
): PlanRequestContext {
  return {
    resolveGeometry: (ref) => (ref === SPAN_REF ? payload : null),
  };
}

describe("buildProviderRequest — road spans", () => {
  it("carries the resolved span with its anchors, direction and corridor", async () => {
    const built = await buildProviderRequest(intentWithSpan(), context());
    if (!built.ok) throw new Error(built.issues.join("; "));
    const spans = built.request.roadSpans ?? [];
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({
      id: "span_keep",
      mode: "must",
      direction: "forward",
      anchors: [SPAN_LINE[0], SPAN_LINE[2]],
      corridor: SPAN_LINE,
    });
  });

  it("keeps the anchors when the stored line did not resolve, without inventing a corridor", async () => {
    const built = await buildProviderRequest(intentWithSpan(), context(null));
    if (!built.ok) throw new Error(built.issues.join("; "));
    const span = built.request.roadSpans?.[0];
    expect(span?.anchors).toHaveLength(2);
    expect(span?.corridor).toBeUndefined();
  });

  it("carries an avoid span's mode through unchanged", async () => {
    const built = await buildProviderRequest(
      intentWithSpan({
        roadSpans: [
          {
            id: "span_avoid" as never,
            mode: "avoid",
            direction: "either",
            geometryRef: SPAN_REF,
            anchorRefs: [SPAN_LINE[0]!, SPAN_LINE[2]!],
          },
        ],
      }),
      context(),
    );
    if (!built.ok) throw new Error(built.issues.join("; "));
    expect(built.request.roadSpans?.[0]?.mode).toBe("avoid");
  });

  it("owns its coordinates: mutating the intent's anchors cannot change the request", async () => {
    const intent = intentWithSpan();
    const built = await buildProviderRequest(intent, context());
    if (!built.ok) throw new Error(built.issues.join("; "));
    const anchor = built.request.roadSpans?.[0]?.anchors[0];
    expect(anchor).not.toBe(intent.roadSpans[0]?.anchorRefs[0]);
    expect(Object.isFrozen(built.request)).toBe(true);
  });
});

/** The port request the builder needs, without going through the profile policy. */
function providerRequest(spans: readonly ProviderRoadSpan[]) {
  return {
    requestId: "req_span",
    origin: metres(-500, 0),
    destination: metres(1000, 0),
    stops: [],
    shaping: [],
    profile: "motorcycle_fastest",
    avoidPolygons: [],
    roadSpans: spans,
    options: {
      includeAlternatives: false,
      avoidHighways: false,
      tollPolicy: "avoid" as const,
      vehicle: "motorcycle" as const,
    },
  };
}

function spanConstraint(
  overrides: Partial<GraphHopperSpanConstraint> = {},
): GraphHopperSpanConstraint {
  return {
    id: "span_keep",
    mode: "must",
    direction: "forward",
    anchors: [SPAN_LINE[0]!, SPAN_LINE[2]!],
    corridor: SPAN_LINE,
    ...overrides,
  };
}

describe("createGraphHopperRequest — span shaping", () => {
  it("injects a must span's ordered entry/exit anchors after the origin", () => {
    const body = createGraphHopperRequest(providerRequest([]), {
      details: [],
      spans: [spanConstraint()],
    });
    expect(body.points).toEqual([
      [metres(-500, 0).lon, metres(-500, 0).lat],
      [SPAN_LINE[0]!.lon, SPAN_LINE[0]!.lat],
      [SPAN_LINE[2]!.lon, SPAN_LINE[2]!.lat],
      [metres(1000, 0).lon, metres(1000, 0).lat],
    ]);
  });

  it("swaps entry and exit for a reverse span", () => {
    const body = createGraphHopperRequest(providerRequest([]), {
      details: [],
      spans: [spanConstraint({ direction: "reverse" })],
    });
    expect(body.points[1]).toEqual([SPAN_LINE[2]!.lon, SPAN_LINE[2]!.lat]);
    expect(body.points[2]).toEqual([SPAN_LINE[0]!.lon, SPAN_LINE[0]!.lat]);
  });

  it("does not inject a span that has fewer than two anchors", () => {
    const body = createGraphHopperRequest(providerRequest([]), {
      details: [],
      spans: [spanConstraint({ anchors: [SPAN_LINE[0]!] })],
    });
    expect(body.points).toHaveLength(2);
  });

  it("renders an avoid span's corridor as a zero-priority avoid area", () => {
    const body = createGraphHopperRequest(providerRequest([]), {
      details: [],
      spans: [spanConstraint({ mode: "avoid" })],
    });
    const features = body.custom_model?.areas?.features ?? [];
    expect(features).toHaveLength(1);
    const id = features[0]!.id;
    const rule = (body.custom_model?.priority ?? []).find((entry) =>
      String(entry.if).includes(`in_${id}`),
    );
    expect(rule?.multiply_by).toBe("0");
  });

  it("keeps a must span out of the avoid rules and in the reward rules", () => {
    const body = createGraphHopperRequest(providerRequest([]), {
      details: [],
      spans: [spanConstraint()],
    });
    const features = body.custom_model?.areas?.features ?? [];
    expect(features).toHaveLength(1);
    const rule = (body.custom_model?.priority ?? []).find((entry) =>
      String(entry.if).includes(`in_${features[0]!.id}`),
    );
    expect(rule?.multiply_by).not.toBe("0");
  });
});

describe("route-plan wire validation — road spans", () => {
  const body = (roadSpans: unknown): unknown => ({
    identity: { rideId: "ride_1", rideRevision: 1, planningGeneration: 0 },
    request: {
      requestId: "req_1",
      origin: metres(0, 0),
      destination: metres(500, 0),
      stops: [],
      shaping: [],
      profile: "motorcycle_fastest",
      avoidPolygons: [],
      roadSpans,
      options: {
        includeAlternatives: false,
        avoidHighways: false,
        tollPolicy: "avoid",
        vehicle: "motorcycle",
      },
    },
  });

  const validSpan = {
    id: "span_1",
    mode: "must",
    direction: "forward",
    anchors: [metres(0, 0), metres(200, 0)],
    corridor: SPAN_LINE,
  };

  it("accepts a bounded span and parses it into the request", () => {
    const parsed = parseRoutePlanRequestBody(body([validSpan]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.request.roadSpans).toHaveLength(1);
    expect(parsed.value.request.roadSpans?.[0]?.anchors).toHaveLength(2);
  });

  it("carries no span list when the body carried none", () => {
    const parsed = parseRoutePlanRequestBody(body(undefined));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Presence mirrors the wire: the parser narrows, it never fabricates.
    expect(parsed.value.request.roadSpans).toBeUndefined();
  });

  it(`rejects more than ${MAX_ROAD_SPANS} spans`, () => {
    const many = Array.from({ length: MAX_ROAD_SPANS + 1 }, (_, index) => ({
      ...validSpan,
      id: `span_${index}`,
    }));
    const parsed = parseRoutePlanRequestBody(body(many));
    expect(parsed.ok).toBe(false);
  });

  it("rejects an unknown mode or direction", () => {
    expect(parseRoutePlanRequestBody(body([{ ...validSpan, mode: "ignore" }])).ok).toBe(false);
    expect(parseRoutePlanRequestBody(body([{ ...validSpan, direction: "sideways" }])).ok).toBe(false);
  });

  it("rejects a span with fewer than two anchors or a bad coordinate", () => {
    expect(parseRoutePlanRequestBody(body([{ ...validSpan, anchors: [metres(0, 0)] }])).ok).toBe(false);
    expect(
      parseRoutePlanRequestBody(
        body([{ ...validSpan, anchors: [metres(0, 0), { lon: 400, lat: 0 }] }]),
      ).ok,
    ).toBe(false);
  });

  it("rejects an over-long corridor before provider work", () => {
    const long = Array.from({ length: 4000 }, (_, index) => metres(index, 0));
    const parsed = parseRoutePlanRequestBody(body([{ ...validSpan, corridor: long }]));
    expect(parsed.ok).toBe(false);
  });
});
