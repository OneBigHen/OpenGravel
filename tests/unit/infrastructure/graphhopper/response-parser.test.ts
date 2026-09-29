/**
 * GraphHopper response parsing — port of the legacy
 * `tests/unit/lib/routing/graphhopper-response.test.ts` and the response half of
 * `tests/unit/graphhopper.test.ts` (baseline `06785c00…`) against the VNext
 * `ProviderCandidate` DTO and the §13 error taxonomy.
 */

import { describe, expect, it } from "vitest";

import type { Coordinate } from "@/domain/ride/types";
import {
  GraphHopperProviderError,
  createRouteFingerprint,
  normalizeGraphHopperProviderError,
  parseGraphHopperPath,
  type GraphHopperPath,
  type GraphHopperPathMeta,
} from "@/infrastructure/routing/graphhopper/response-parser";

const GEOMETRY: readonly Coordinate[] = [
  { lon: -76.8867, lat: 40.2732 },
  { lon: -76.7, lat: 40.15 },
  { lon: -76.5, lat: 40.2 },
  { lon: -76.3055, lat: 40.0379 },
];

const PATH: GraphHopperPath = {
  distance: 61_128.978,
  time: 4_335_684,
  ascend: 420,
  descend: 390,
  points: {
    coordinates: [
      [-76.8867, 40.2732],
      [-76.7, 40.15],
      [-76.5, 40.2],
      [-76.3055, 40.0379],
    ],
  },
  snapped_waypoints: {
    coordinates: [
      [-76.8866, 40.2731],
      [-76.3054, 40.038],
    ],
  },
  instructions: [
    { distance: 1_000, time: 80_000, sign: 0, text: "Continue", street_name: "Market Street", interval: [0, 1] },
    { distance: 800, time: 60_000, sign: 2, text: "Turn right", street_name: "River Road", interval: [1, 2] },
  ],
};

const META: GraphHopperPathMeta = {
  providerId: "graphhopper",
  profile: "motorcycle_twisty",
  index: 0,
  engineVersion: "11.0",
};

describe("GraphHopper response parser", () => {
  it("normalizes decoded geometry, metrics, instructions and provider metadata", () => {
    const candidate = parseGraphHopperPath(PATH, META);

    expect(candidate).toMatchObject({
      providerId: "graphhopper",
      profile: "motorcycle_twisty",
      distanceMeters: 61_128.978,
      durationSeconds: 4_335.684,
      providerMetadata: {
        engineVersion: "11.0",
        ascentMeters: 420,
        descentMeters: 390,
      },
    });
    expect(candidate.geometry).toEqual(GEOMETRY);
    expect(candidate.instructions).toHaveLength(2);
    expect(candidate.instructions?.[0]).toEqual({
      text: "Continue",
      distanceMeters: 1_000,
      durationSeconds: 80,
      type: "continue",
      maneuver: "straight",
      roadName: "Market Street",
      geometryIndex: 0,
    });
    expect(candidate.instructions?.[1]).toEqual({
      text: "Turn right",
      distanceMeters: 800,
      durationSeconds: 60,
      type: "turn",
      maneuver: "right",
      roadName: "River Road",
      geometryIndex: 1,
    });
  });

  it("keeps the provider's own instruction vocabulary", () => {
    const types = (signs: readonly (number | undefined)[]) =>
      signs.map(
        (sign, index) =>
          parseGraphHopperPath(
            { ...PATH, instructions: [{ sign }] },
            { ...META, index },
          ).instructions?.[0]?.type,
      );

    expect(types([0, 2, -2, 4, 5, 6, 7, -7, undefined])).toEqual([
      "continue",
      "turn",
      "turn",
      "finish",
      "via",
      "roundabout",
      "keep-left",
      "keep-right",
      "continue",
    ]);
  });

  it("never invents instruction copy when the engine sent none", () => {
    const candidate = parseGraphHopperPath(
      { ...PATH, instructions: [{ distance: 100, time: 1_000 }] },
      META,
    );

    expect(candidate.instructions?.[0]).toEqual({
      text: "",
      distanceMeters: 100,
      durationSeconds: 1,
      type: "continue",
    });
  });

  it("reports missing metrics honestly instead of fabricating them", () => {
    const candidate = parseGraphHopperPath(
      { points: { coordinates: [[-76.8867, 40.2732], [-76.3055, 40.0379]] } },
      META,
    );

    expect(candidate.distanceMeters).toBe(0);
    expect(candidate.durationSeconds).toBe(0);
    expect(candidate.instructions).toBeUndefined();
    expect(candidate.providerMetadata).toEqual({
      engineVersion: "11.0",
      fingerprint: createRouteFingerprint("motorcycle_twisty", candidate.geometry, 0),
    });
  });

  it("drops a repeated point the engine sends at a snapped waypoint, and remaps instructions", () => {
    const candidate = parseGraphHopperPath(
      {
        distance: 200,
        time: 20_000,
        points: { coordinates: [[-75, 40], [-75, 40], [-74.999, 40], [-74.998, 40]] },
        instructions: [
          { distance: 100, time: 10_000, sign: 0, text: "Continue", interval: [0, 2] },
          { distance: 100, time: 10_000, sign: 2, text: "Turn right", interval: [2, 3] },
        ],
        details: { surface: [[0, 3, "asphalt"]], road_class: [[0, 3, "tertiary"]] },
      },
      META,
    );
    expect(candidate.geometry).toHaveLength(3);
    expect(candidate.instructions?.map((instruction) => instruction.geometryIndex)).toEqual([0, 1]);
    // The road summary still measures every metre the engine described.
    expect(candidate.roadSummary?.surfaceByRoadClassMeters["asphalt|tertiary"]).toBeGreaterThan(160);
  });

  it("rejects a successful response whose geometry cannot be ridden", () => {
    expect(() =>
      parseGraphHopperPath({ points: { coordinates: [[-76.9, 40.2]] } }, META),
    ).toThrow(GraphHopperProviderError);
    expect(() => parseGraphHopperPath({}, META)).toThrow(
      expect.objectContaining({ code: "provider-unavailable" }),
    );
  });

  it("derives stable fingerprints that distinguish geometries", () => {
    const first = createRouteFingerprint("motorcycle_twisty", GEOMETRY, 0);

    expect(first).toBe(createRouteFingerprint("motorcycle_twisty", GEOMETRY, 0));
    expect(first).not.toBe(createRouteFingerprint("motorcycle_twisty", GEOMETRY, 1));
    expect(first).not.toBe(createRouteFingerprint("motorcycle_scenic", GEOMETRY, 0));
    expect(first).not.toBe(
      createRouteFingerprint(
        "motorcycle_twisty",
        [
          { lon: -76.8867, lat: 40.2732 },
          { lon: -76.7, lat: 40.16 },
        ],
        0,
      ),
    );
    expect(parseGraphHopperPath(PATH, META).providerMetadata?.fingerprint).toBe(first);
  });

  it("classifies provider failures into the VNext error taxonomy", () => {
    expect(normalizeGraphHopperProviderError(400, "Point 1 is out of bounds")).toMatchObject({
      code: "outside-coverage",
      httpStatus: 400,
      recoverable: false,
    });
    expect(normalizeGraphHopperProviderError(400, "Cannot find point 3")).toMatchObject({
      code: "outside-coverage",
    });
    expect(normalizeGraphHopperProviderError(422, "No route was found")).toMatchObject({
      code: "no-route",
      recoverable: false,
    });
    expect(normalizeGraphHopperProviderError(408, "Request timed out")).toMatchObject({
      code: "provider-timeout",
      recoverable: true,
    });
    expect(normalizeGraphHopperProviderError(504, "Gateway timeout")).toMatchObject({
      code: "provider-timeout",
      recoverable: true,
    });
    expect(normalizeGraphHopperProviderError(503, "GraphHopper is starting")).toMatchObject({
      code: "provider-unavailable",
      recoverable: true,
    });
    expect(normalizeGraphHopperProviderError(400, "Cannot compile expression")).toMatchObject({
      code: "validation",
      recoverable: false,
    });
  });

  it("never puts raw provider text or the router address in the client-facing message", () => {
    const internalUrl = "http://graphhopper.internal:8989/private";
    const error = normalizeGraphHopperProviderError(
      400,
      `Cannot find point 3 near ${internalUrl}`,
    );

    expect(error).toBeInstanceOf(GraphHopperProviderError);
    expect(error.message).not.toContain(internalUrl);
    expect(error.message).toContain("outside the installed routing region");
    // Diagnostics stay reachable for structured logs, never for rider copy.
    expect(error.providerDetail).toContain(internalUrl);
  });
});
