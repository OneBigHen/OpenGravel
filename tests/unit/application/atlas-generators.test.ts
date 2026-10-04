import { describe, expect, it } from "vitest";

import {
  createAtlasGenerators,
  type AtlasGeneratorId,
} from "@/application/planner/atlas-generators";
import type {
  FunGeneratorContext,
  FunRouteMeasurement,
  ProductionRoute,
} from "@/application/planner/fun-generators";
import type {
  ProviderCandidate,
  ProviderRouteRequest,
} from "@/application/planner/route-provider";
import type { GravelAtlasCorridor } from "@/application/roads/gravel-atlas";
import type { Coordinate } from "@/domain/ride/types";

const ORIGIN: Coordinate = { lon: -75.5, lat: 40.5 };
const DESTINATION: Coordinate = { lon: -75.1, lat: 40.5 };

const REQUEST: ProviderRouteRequest = {
  requestId: "atlas-test",
  origin: ORIGIN,
  destination: DESTINATION,
  stops: [],
  shaping: [],
  profile: "motorcycle_adventure",
  avoidPolygons: [],
  options: {
    includeAlternatives: true,
    avoidHighways: false,
    tollPolicy: "allow-with-warning",
    surfacePreference: "dirt-preferred",
    roadCharacter: "balanced",
    vehicle: "motorcycle",
  },
};

function line(...points: Coordinate[]): readonly Coordinate[] {
  return points;
}

function corridor(
  id: string,
  overrides: Partial<GravelAtlasCorridor> = {},
): GravelAtlasCorridor {
  return {
    id,
    kind: "dirt",
    geometry: line(
      { lon: -75.36, lat: 40.5 },
      { lon: -75.3, lat: 40.55 },
      { lon: -75.24, lat: 40.5 },
    ),
    lengthMeters: 16_000,
    longestDirtRunMeters: 12_000,
    bendShare: 0.22,
    francoScore: 0.8,
    curvaturePerKm: 18,
    quality: 0.9,
    reversible: true,
    gradeMix: { grade1: 10_000, grade2: 6_000 },
    maxTrackGrade: 2,
    legalConfidence: 0.95,
    access: { legal: true, unknownRestrictionFlags: [], sandShare: 0 },
    seasonal: { closed: false, seasonalClosed: false, flags: [] },
    sourceIds: [id],
    areaHints: [],
    ...overrides,
  };
}

function measurement(overrides: Partial<FunRouteMeasurement> = {}): FunRouteMeasurement {
  return {
    fingerprint: "production",
    durationSeconds: 1_800,
    distanceMeters: 50_000,
    bendShare: 0.08,
    curvatureUnit: 0.2,
    backroadShare: 0.3,
    longestBendRunMeters: 400,
    ...overrides,
  };
}

const PRODUCTION: ProductionRoute = {
  id: "production",
  geometry: line(ORIGIN, DESTINATION),
  measurement: measurement(),
};

function context(
  request: ProviderRouteRequest = REQUEST,
  production: readonly ProductionRoute[] = [PRODUCTION],
): FunGeneratorContext {
  return { request, production, sources: [] };
}

function candidate(
  request: ProviderRouteRequest,
  overrides: Partial<ProviderCandidate> = {},
): ProviderCandidate {
  const anchors = request.roadSpans?.flatMap((span) => span.anchors) ?? request.shaping;
  return {
    providerId: "test",
    profile: request.profile,
    geometry: [request.origin, ...anchors, request.destination],
    distanceMeters: 55_000,
    durationSeconds: 1_950,
    roadSummary: {
      totalMeters: 55_000,
      surfaceByRoadClassMeters: {
        "gravel|tertiary": 18_000,
        "asphalt|tertiary": 37_000,
      },
      curvatureMeters: {},
      tollMeters: 0,
      roadRuns: [],
    },
    ...overrides,
  };
}

async function executeFirst(
  id: AtlasGeneratorId,
  corridors: readonly GravelAtlasCorridor[],
  request = REQUEST,
  answer?: (request: ProviderRouteRequest) => ProviderCandidate | null,
) {
  const generator = createAtlasGenerators(corridors).find((item) => item.id === id);
  expect(generator).toBeDefined();
  const probes = generator!.propose(context(request));
  expect(probes.length).toBeGreaterThan(0);
  const requests: ProviderRouteRequest[] = [];
  const execution = await probes[0]!.execute(async (probeRequest) => {
    requests.push(probeRequest);
    return answer?.(probeRequest) ?? candidate(probeRequest);
  });
  return { generator: generator!, probes, requests, execution };
}

describe("atlas dirt and backroad generators", () => {
  it("registers atlas ids before the existing family without changing its array", () => {
    const generators = createAtlasGenerators([corridor("dirt")]);
    expect(generators.map((generator) => generator.id)).toEqual([
      "gravel-prize",
      "backroad-stitch",
    ]);
  });

  it("builds ordered entry/mid/exit must spans and flat diagnostics", async () => {
    const result = await executeFirst("gravel-prize", [corridor("dirt")]);
    const request = result.requests[0]!;
    expect(request.roadSpans).toHaveLength(1);
    expect(request.roadSpans![0]!.mode).toBe("must");
    expect(request.roadSpans![0]!.anchors.length).toBeGreaterThanOrEqual(3);
    expect(request.roadSpans![0]!.corridor!.length).toBeLessThanOrEqual(256);
    expect(result.execution.candidate?.providerMetadata).toMatchObject({
      atlasCorridorIds: JSON.stringify(["dirt"]),
      observedUnpavedShare: expect.any(Number),
      addedMinutes: expect.any(Number),
    });
  });

  it("uses the fastest production route for the point-to-point cap", async () => {
    const slower = { ...PRODUCTION, id: "slower", measurement: measurement({ durationSeconds: 2_400 }) };
    const fastest = { ...PRODUCTION, id: "fastest", measurement: measurement({ durationSeconds: 1_500 }) };
    const generator = createAtlasGenerators([corridor("dirt")])[0]!;
    const probes = generator.propose(context(REQUEST, [slower, fastest]));
    const result = await probes[0]!.execute(async (probeRequest) =>
      candidate(probeRequest, { durationSeconds: 2_100 }),
    );
    expect(result.candidate).toBeNull();
    expect(result.note).toBe("time-cap");
  });

  it("rejects routes with no measured surface summary", async () => {
    const result = await executeFirst("gravel-prize", [corridor("dirt")], REQUEST, (request) =>
      candidate(request, { roadSummary: undefined }),
    );
    expect(result.execution.candidate).toBeNull();
    expect(result.execution.note).toBe("missing-unpaved-evidence");
  });

  it("does not count sand as unpaved value and rejects a known sand route", async () => {
    const result = await executeFirst("gravel-prize", [corridor("dirt")], REQUEST, (request) =>
      candidate(request, {
        roadSummary: {
          totalMeters: 55_000,
          surfaceByRoadClassMeters: {
            "sand|track": 1_000,
            "asphalt|tertiary": 54_000,
          },
          curvatureMeters: {},
          tollMeters: 0,
        },
      }),
    );
    expect(result.execution.candidate).toBeNull();
    expect(result.execution.note).toBe("sand-route");
  });

  it("filters illegal, closed, and rough corridors for street riders", () => {
    const streetRequest: ProviderRouteRequest = {
      ...REQUEST,
      options: {
        ...REQUEST.options,
        surfacePreference: "mixed",
        bike: { category: "street", maintainedGravel: "avoid", roughTracks: "avoid" },
      },
    };
    const generator = createAtlasGenerators([
      corridor("sand", { access: { legal: true, unknownRestrictionFlags: [], sandShare: 0.1 } }),
      corridor("closed", { seasonal: { closed: true, seasonalClosed: false, flags: [] } }),
      corridor("rough", { maxTrackGrade: 3 }),
      corridor("illegal", { access: { legal: false, unknownRestrictionFlags: ["private"], sandShare: 0 } }),
    ])[0]!;
    expect(generator.propose(context(streetRequest))).toEqual([]);
  });

  it("permits grade 3/4 only for dual-sport rough-track requests", () => {
    const rough = corridor("rough", { maxTrackGrade: 4, gradeMix: { grade4: 16_000 } });
    const street = {
      ...REQUEST,
      options: {
        ...REQUEST.options,
        bike: { category: "street" as const, maintainedGravel: "allow" as const, roughTracks: "avoid" as const },
      },
    };
    const dual = {
      ...REQUEST,
      options: {
        ...REQUEST.options,
        bike: { category: "dual-sport" as const, maintainedGravel: "allow" as const, roughTracks: "allow" as const },
      },
    };
    expect(createAtlasGenerators([rough])[0]!.propose(context(street))).toEqual([]);
    expect(createAtlasGenerators([rough])[0]!.propose(context(dual)).length).toBeGreaterThan(0);
  });

  it("skips authored itinerary geometry rather than rewriting it", () => {
    const authored = { ...REQUEST, stops: [{ lon: -75.3, lat: 40.5 }] };
    const generator = createAtlasGenerators([corridor("dirt")])[0]!;
    expect(generator.propose(context(authored))).toEqual([]);
  });

  it("rejects a loop that misses the requested lower time window", async () => {
    const loop = {
      ...REQUEST,
      destination: ORIGIN,
      discovery: { targetMinutes: 120, toleranceMinutes: 10 },
    };
    const result = await executeFirst("gravel-prize", [corridor("dirt")], loop, (request) =>
      candidate(request, { durationSeconds: 4_000 }),
    );
    expect(result.execution.candidate).toBeNull();
    expect(result.execution.note).toBe("loop-shortfall");
  });

  it("limits atlas proposals to two distinct sequences", () => {
    const generators = createAtlasGenerators([
      corridor("a", { geometry: line({ lon: -75.38, lat: 40.5 }, { lon: -75.33, lat: 40.55 }) }),
      corridor("b", { geometry: line({ lon: -75.3, lat: 40.55 }, { lon: -75.24, lat: 40.5 }) }),
      corridor("c", { geometry: line({ lon: -75.2, lat: 40.52 }, { lon: -75.16, lat: 40.5 }) }),
    ]);
    for (const generator of generators) {
      const probes = generator.propose(context());
      expect(probes.length).toBeLessThanOrEqual(2);
      expect(new Set(probes.map((probe) => probe.id)).size).toBe(probes.length);
      expect(probes.every((probe) => probe.maxProviderCalls === 1)).toBe(true);
    }
  });
});
