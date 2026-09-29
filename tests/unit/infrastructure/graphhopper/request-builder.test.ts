/**
 * GraphHopper request builder — port of the legacy
 * `tests/unit/lib/routing/graphhopper-request.test.ts` and the request half of
 * `tests/unit/graphhopper.test.ts` (baseline `06785c00…`) against VNext types.
 *
 * The tests pin the parts of the legacy request that were hard-won: waypoint
 * ordering, the requested-detail list, the custom-model rule order and ids, the
 * `OTHER` surface mapping for OSM materials GraphHopper's enum does not have,
 * the thin-corridor reward for road spans, must-use span waypoint injection and
 * the round-trip body.
 */

import { describe, expect, it } from "vitest";

import type {
  ProviderRouteOptions,
  ProviderRouteRequest,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import {
  GraphHopperProviderError,
} from "@/infrastructure/routing/graphhopper/response-parser";
import {
  REQUESTED_DETAILS,
  SKETCH_BAND_AREA_ID,
  SKETCH_HEADING_PENALTY_SECONDS,
  createGraphHopperRequest,
  estimateRoundTripDistanceMeters,
  expandMustUseSpans,
  type GraphHopperSpanConstraint,
} from "@/infrastructure/routing/graphhopper/request-builder";

const HARRISBURG: Coordinate = { lon: -76.8867, lat: 40.2732 };
const LANCASTER: Coordinate = { lon: -76.3055, lat: 40.0379 };
const READING: Coordinate = { lon: -75.9269, lat: 40.3356 };
const SHAPING: Coordinate = { lon: -76.5, lat: 40.2 };

const DEFAULT_OPTIONS: ProviderRouteOptions = {
  includeAlternatives: false,
  avoidHighways: false,
  tollPolicy: "allow-with-warning",
  vehicle: "motorcycle",
};

function request(overrides: Partial<ProviderRouteRequest> = {}): ProviderRouteRequest {
  return {
    requestId: "req_test",
    origin: HARRISBURG,
    destination: LANCASTER,
    stops: [],
    shaping: [],
    profile: "motorcycle_twisty",
    avoidPolygons: [],
    options: DEFAULT_OPTIONS,
    ...overrides,
  };
}

/** The legacy closed-bridge ring, unclosed as authored. */
const AVOID_RING: readonly Coordinate[] = [
  { lon: -76.82, lat: 39.2 },
  { lon: -76.8, lat: 39.2 },
  { lon: -76.8, lat: 39.22 },
  { lon: -76.82, lat: 39.22 },
];

const MUST_USE_SPAN: GraphHopperSpanConstraint = {
  id: "span_1",
  mode: "must",
  direction: "forward",
  label: "PA-125",
  anchors: [
    { lon: -76.61, lat: 39.29 },
    { lon: -76.62, lat: 39.3 },
  ],
  corridor: [
    { lon: -76.61, lat: 39.29 },
    { lon: -76.62, lat: 39.3 },
  ],
};

const PREFER_SPAN: GraphHopperSpanConstraint = {
  id: "span_2",
  mode: "prefer",
  direction: "either",
  label: "Ridge Road",
  anchors: [
    { lon: -76.7, lat: 39.4 },
    { lon: -76.71, lat: 39.41 },
  ],
  corridor: [
    { lon: -76.7, lat: 39.4 },
    { lon: -76.71, lat: 39.41 },
  ],
};

describe("GraphHopper request builder", () => {
  it("builds the complete normal point-to-point request", () => {
    expect(
      createGraphHopperRequest(request(), { details: REQUESTED_DETAILS }),
    ).toEqual({
      profile: "motorcycle_twisty",
      points: [
        [-76.8867, 40.2732],
        [-76.3055, 40.0379],
      ],
      points_encoded: false,
      instructions: true,
      calc_points: true,
      elevation: false,
      locale: "en-US",
      details: [...REQUESTED_DETAILS],
    });
  });

  it("orders points origin → stops → shaping → destination", () => {
    const body = createGraphHopperRequest(
      request({ stops: [READING], shaping: [SHAPING] }),
      { details: REQUESTED_DETAILS },
    );

    expect(body.points).toEqual([
      [-76.8867, 40.2732],
      [-75.9269, 40.3356],
      [-76.5, 40.2],
      [-76.3055, 40.0379],
    ]);
  });

  it("routes through a sketch's interior anchors, never its own endpoints", () => {
    const body = createGraphHopperRequest(
      request({
        shaping: [SHAPING],
        sketch: {
          anchors: [
            { lon: -76.8867, lat: 40.2732 },
            { lon: -76.6, lat: 40.3 },
            { lon: -76.4, lat: 40.1 },
            { lon: -76.3055, lat: 40.0379 },
          ],
          endpointPolicy: "derive",
          nearLoop: false,
          topologyHints: [],
          derivedEndpoints: null,
        },
      }),
      { details: REQUESTED_DETAILS },
    );

    // The trace's own ends are the request's endpoints already; only the interior
    // samples become via points, after every authored shaping anchor.
    expect(body.points).toEqual([
      [-76.8867, 40.2732],
      [-76.5, 40.2],
      [-76.6, 40.3],
      [-76.4, 40.1],
      [-76.3055, 40.0379],
    ]);
  });

  it("adds no via points for a sketch that is only its two endpoints", () => {
    const body = createGraphHopperRequest(
      request({
        sketch: {
          anchors: [
            { lon: -76.8867, lat: 40.2732 },
            { lon: -76.3055, lat: 40.0379 },
          ],
          endpointPolicy: "derive",
          nearLoop: false,
          topologyHints: [],
          derivedEndpoints: null,
        },
      }),
      { details: REQUESTED_DETAILS },
    );

    expect(body.points).toHaveLength(2);
  });

  it("holds a sketch to its drawn corridor and snaps each anchor in the drawn direction", () => {
    // A corridor drawn east from Harrisburg, then south-east to Lancaster.
    const corridor: Coordinate[] = [
      HARRISBURG,
      { lon: -76.7, lat: 40.2732 },
      { lon: -76.5, lat: 40.2732 },
      { lon: -76.4, lat: 40.15 },
      LANCASTER,
    ];
    const body = createGraphHopperRequest(
      request({
        sketch: {
          anchors: [HARRISBURG, { lon: -76.6, lat: 40.2732 }, { lon: -76.45, lat: 40.21 }, LANCASTER],
          corridor,
          endpointPolicy: "derive",
          nearLoop: false,
          topologyHints: [],
          derivedEndpoints: null,
        },
      }),
      { details: REQUESTED_DETAILS },
    );

    // Outside the band is a penalty, never a zero (OGV-D-285).
    expect(body.custom_model?.priority).toContainEqual({
      if: `!in_${SKETCH_BAND_AREA_ID}`,
      multiply_by: "0.1",
    });
    const band = body.custom_model?.areas?.features.find((feature) => feature.id === SKETCH_BAND_AREA_ID);
    expect(band?.geometry.type).toBe("MultiPolygon");
    expect(band?.geometry.coordinates).toHaveLength(corridor.length - 1);
    // Endpoints take any direction; each anchor the direction drawn there.
    expect(body.headings?.[0]).toBe("NaN");
    expect(body.headings?.at(-1)).toBe("NaN");
    expect(body.headings?.[1]).toBe(90);
    expect(Number(body.headings?.[2])).toBeGreaterThan(90);
    expect(Number(body.headings?.[2])).toBeLessThan(180);
    expect(body.heading_penalty).toBe(SKETCH_HEADING_PENALTY_SECONDS);
  });

  it("sends exactly the chunk's points and band when the provider splits a sketch", () => {
    const chunk = [
      { lon: -76.7, lat: 40.2732 },
      { lon: -76.6, lat: 40.2732, label: "Sketch", heading: 90 },
      { lon: -76.5, lat: 40.2732 },
    ];
    const body = createGraphHopperRequest(request(), {
      details: REQUESTED_DETAILS,
      points: chunk,
      sketchBand: [chunk[0]!, chunk[2]!],
    });
    expect(body.points).toEqual(chunk.map(({ lon, lat }) => [lon, lat]));
    expect(body.headings).toEqual(["NaN", 90, "NaN"]);
    expect(body.custom_model?.areas?.features[0]?.geometry.coordinates).toHaveLength(1);
  });

  it("sends no band and no headings for a request without a sketch", () => {
    const body = createGraphHopperRequest(request(), { details: REQUESTED_DETAILS });
    expect(body.headings).toBeUndefined();
    expect(body.custom_model).toBeUndefined();
  });

  it("requests alternatives only when the caller asks and two points remain", () => {
    const withAlternatives = createGraphHopperRequest(
      request({ options: { ...DEFAULT_OPTIONS, includeAlternatives: true } }),
      { details: REQUESTED_DETAILS },
    );
    expect(withAlternatives).toMatchObject({
      algorithm: "alternative_route",
      "alternative_route.max_paths": 3,
      "alternative_route.max_weight_factor": 1.8,
      "alternative_route.max_share_factor": 0.62,
    });

    // A stop makes the request multi-point: no alternative algorithm is sent.
    const withStop = createGraphHopperRequest(
      request({
        stops: [READING],
        options: { ...DEFAULT_OPTIONS, includeAlternatives: true },
      }),
      { details: REQUESTED_DETAILS },
    );
    expect(withStop).not.toHaveProperty("algorithm");
  });

  it("builds the round-trip request from the origin and drops the closing endpoint", () => {
    expect(estimateRoundTripDistanceMeters("motorcycle_twisty", 120)).toBe(122_310);

    expect(
      createGraphHopperRequest(request({ destination: HARRISBURG }), {
        details: REQUESTED_DETAILS,
        roundTrip: { targetMinutes: 120, seed: 17, heading: 80 },
      }),
    ).toEqual({
      profile: "motorcycle_twisty",
      points: [[-76.8867, 40.2732]],
      points_encoded: false,
      instructions: true,
      calc_points: true,
      elevation: false,
      locale: "en-US",
      details: [...REQUESTED_DETAILS],
      algorithm: "round_trip",
      "round_trip.distance": 122_310,
      "round_trip.seed": 17,
      headings: [80],
    });

    const withoutHeading = createGraphHopperRequest(
      request({ destination: HARRISBURG }),
      { details: REQUESTED_DETAILS, roundTrip: { targetMinutes: 120, seed: 17 } },
    );
    expect(withoutHeading).not.toHaveProperty("headings");
    expect(withoutHeading["round_trip.seed"]).toBe(17);
  });

  it("bounds and rejects round-trip inputs the engine cannot express", () => {
    expect(estimateRoundTripDistanceMeters("motorcycle_fastest", 5)).toBe(
      estimateRoundTripDistanceMeters("motorcycle_fastest", 20),
    );
    expect(estimateRoundTripDistanceMeters("motorcycle_fastest", 900)).toBe(
      estimateRoundTripDistanceMeters("motorcycle_fastest", 480),
    );
    expect(() => estimateRoundTripDistanceMeters("motorcycle_neural", 120)).toThrow(
      GraphHopperProviderError,
    );

    // The legacy invariant was "a round trip has exactly one start point"; a
    // loop that returns to its origin has no other waypoint to visit.
    expect(() =>
      createGraphHopperRequest(request({ destination: HARRISBURG, stops: [READING] }), {
        details: REQUESTED_DETAILS,
        roundTrip: { targetMinutes: 120 },
      }),
    ).toThrow(GraphHopperProviderError);

    // The port always resolves a destination; a round trip only makes sense
    // when that destination is the origin it returns to.
    expect(() =>
      createGraphHopperRequest(request(), {
        details: REQUESTED_DETAILS,
        roundTrip: { targetMinutes: 120 },
      }),
    ).toThrow(GraphHopperProviderError);
  });

  it("adds highway and toll avoidance without changing the base request", () => {
    expect(
      createGraphHopperRequest(
        request({ options: { ...DEFAULT_OPTIONS, avoidHighways: true } }),
        { details: REQUESTED_DETAILS },
      ),
    ).toMatchObject({
      profile: "motorcycle_twisty",
      custom_model: {
        priority: [{ if: "road_class == MOTORWAY || road_class == TRUNK", multiply_by: "0" }],
      },
    });

    expect(
      createGraphHopperRequest(
        request({ options: { ...DEFAULT_OPTIONS, tollPolicy: "avoid" } }),
        { details: REQUESTED_DETAILS },
      ),
    ).toMatchObject({
      custom_model: { priority: [{ if: "toll == ALL", multiply_by: "0" }] },
    });

    expect(
      createGraphHopperRequest(
        request({
          options: { ...DEFAULT_OPTIONS, avoidHighways: true, tollPolicy: "avoid" },
        }),
        { details: REQUESTED_DETAILS },
      ).custom_model?.priority,
    ).toEqual([
      { if: "road_class == MOTORWAY || road_class == TRUNK", multiply_by: "0" },
      { if: "toll == ALL", multiply_by: "0" },
    ]);
  });

  it("sends no custom model when nothing has to be expressed", () => {
    expect(
      createGraphHopperRequest(request(), { details: REQUESTED_DETAILS }),
    ).not.toHaveProperty("custom_model");
    expect(
      createGraphHopperRequest(request(), {
        details: REQUESTED_DETAILS,
        spans: [{ ...MUST_USE_SPAN, anchors: [{ lon: -76.61, lat: 39.29 }] }],
      }),
    ).not.toHaveProperty("custom_model");
  });

  it("maps avoid polygons to closed FeatureCollection areas with in_area rules", () => {
    const body = createGraphHopperRequest(request({ avoidPolygons: [AVOID_RING] }), {
      details: REQUESTED_DETAILS,
    });

    expect(body).toMatchObject({
      custom_model: {
        areas: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "opengravel_avoid_0",
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [-76.82, 39.2],
                    [-76.8, 39.2],
                    [-76.8, 39.22],
                    [-76.82, 39.22],
                    [-76.82, 39.2],
                  ],
                ],
              },
            },
          ],
        },
        priority: [{ if: "in_opengravel_avoid_0", multiply_by: "0" }],
      },
    });

    // Each resolved ring is its own polygon, so a holed area keeps both rings.
    const holed = createGraphHopperRequest(
      request({
        avoidPolygons: [
          AVOID_RING,
          [
            { lon: -76.81, lat: 39.205 },
            { lon: -76.805, lat: 39.205 },
            { lon: -76.805, lat: 39.21 },
          ],
        ],
      }),
      { details: REQUESTED_DETAILS },
    );
    expect(holed.custom_model?.areas?.features.map((feature) => feature.id)).toEqual([
      "opengravel_avoid_0",
      "opengravel_avoid_1",
    ]);
    expect(holed.custom_model?.priority).toEqual([
      { if: "in_opengravel_avoid_0", multiply_by: "0" },
      { if: "in_opengravel_avoid_1", multiply_by: "0" },
    ]);
  });

  it("ports the surface, roughness and path rules with GraphHopper's OTHER enum", () => {
    const options = {
      details: REQUESTED_DETAILS,
      surfacePolicy: {
        excludeSurfaces: ["earth", "gravel"],
        excludeSmoothness: ["very_bad"],
        excludeTrackTypes: ["grade3"],
        excludePathRoadClass: true,
      },
    } as const;

    const priority = createGraphHopperRequest(request(), options).custom_model?.priority ?? [];
    expect(priority).toEqual([
      { if: "surface == OTHER || surface == GRAVEL", multiply_by: "0" },
      { if: "smoothness == VERY_BAD", multiply_by: "0" },
      { if: "track_type == GRADE3", multiply_by: "0" },
      { if: "road_class == PATH", multiply_by: "0" },
    ]);

    // The graph-degradation mode: the active graph carries no smoothness, so the
    // condition cannot be compiled and is dropped.
    const degraded = createGraphHopperRequest(request(), {
      ...options,
      omitSmoothness: true,
    });
    expect(JSON.stringify(degraded.custom_model)).not.toContain("smoothness ==");
    expect(JSON.stringify(degraded.custom_model)).toContain("surface == OTHER");
    expect(JSON.stringify(degraded.custom_model)).toContain("track_type == GRADE3");
  });

  it("injects must-use spans as ordered via-waypoints and rewards their corridor", () => {
    const expansion = expandMustUseSpans(
      [
        { ...HARRISBURG, label: "Start" },
        { ...LANCASTER, label: "Finish" },
      ],
      [MUST_USE_SPAN, PREFER_SPAN],
    );

    expect(expansion.wireToOriginal).toEqual([0, -1, -1, 1]);
    expect(expansion.points).toEqual([
      { lon: -76.8867, lat: 40.2732, label: "Start" },
      { lon: -76.61, lat: 39.29, label: "Must-use PA-125: entry" },
      { lon: -76.62, lat: 39.3, label: "Must-use PA-125: exit" },
      { lon: -76.3055, lat: 40.0379, label: "Finish" },
    ]);

    const body = createGraphHopperRequest(
      request({ stops: [], shaping: [] }),
      { details: REQUESTED_DETAILS, spans: [MUST_USE_SPAN, PREFER_SPAN] },
    );
    expect(body.points).toEqual([
      [-76.8867, 40.2732],
      [-76.61, 39.29],
      [-76.62, 39.3],
      [-76.3055, 40.0379],
    ]);
    expect(body.custom_model?.priority).toEqual([
      { if: "in_opengravel_span_0", multiply_by: "1.8" },
      { if: "in_opengravel_span_1", multiply_by: "1.6" },
    ]);
    expect(body.custom_model?.areas?.features.map((feature) => feature.id)).toEqual([
      "opengravel_span_0",
      "opengravel_span_1",
    ]);
    // A corridor is a closed ring; the thin buffer around the span line.
    expect(body.custom_model?.areas?.features[0]?.geometry.coordinates[0]?.length).toBeGreaterThan(4);
  });

  it("traverses a reverse-direction must span in the direction the rider rides it", () => {
    const expansion = expandMustUseSpans(
      [
        { ...HARRISBURG, label: "Start" },
        { ...LANCASTER, label: "Finish" },
      ],
      [{ ...MUST_USE_SPAN, direction: "reverse" }],
    );

    expect(expansion.points[1]?.label).toBe("Must-use PA-125: entry");
    expect(expansion.points[1]?.lon).toBe(-76.62);
    expect(expansion.points[2]?.lon).toBe(-76.61);
  });

  it("never sends an unresolved span to the engine", () => {
    const unresolved: GraphHopperSpanConstraint = {
      ...MUST_USE_SPAN,
      id: "span_unresolved",
      anchors: [],
    };
    const singleAnchor: GraphHopperSpanConstraint = {
      ...MUST_USE_SPAN,
      id: "span_single",
      anchors: [{ lon: -76.61, lat: 39.29 }],
    };

    expect(
      expandMustUseSpans([{ ...HARRISBURG }, { ...LANCASTER }], [unresolved, singleAnchor]),
    ).toEqual({
      points: [HARRISBURG, LANCASTER],
      wireToOriginal: [0, 1],
    });

    const body = createGraphHopperRequest(request(), {
      details: REQUESTED_DETAILS,
      spans: [unresolved, singleAnchor],
    });
    expect(body).not.toHaveProperty("custom_model");
    expect(body.points).toEqual([
      [-76.8867, 40.2732],
      [-76.3055, 40.0379],
    ]);
  });
});
