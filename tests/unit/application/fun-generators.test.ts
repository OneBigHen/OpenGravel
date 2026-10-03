import { describe, expect, it } from "vitest";

import {
  runFunGenerators,
  type FunCandidateGenerator,
  type FunCandidateVerdict,
  type FunGeneratorContext,
  type FunProbe,
  type FunRouteMeasurement,
  type ProductionRoute,
} from "@/application/planner/fun-generators";
import {
  corridorProbeGenerator,
  departureRejoinGenerator,
  funRouteMeasurement,
  missingLinkGenerator,
  prizeLoopGenerator,
} from "@/application/planner/fun-generator-strategies";
import { libraryCorridorSources } from "@/application/planner/fun-generator-sources";
import type {
  ProviderCandidate,
  ProviderCandidateSet,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";

const ORIGIN: Coordinate = { lon: -75.5, lat: 40.5 };
const DESTINATION: Coordinate = { lon: -75.1, lat: 40.5 };

const REQUEST: ProviderRouteRequest = {
  requestId: "req_fun",
  origin: ORIGIN,
  destination: DESTINATION,
  stops: [],
  shaping: [],
  profile: "motorcycle_twisty",
  avoidPolygons: [],
  options: { includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", vehicle: "motorcycle" },
};

/** A straight line sampled every ~0.01°, bent into a zigzag when `wiggle` > 0. */
function line(from: Coordinate, to: Coordinate, steps: number, wiggle = 0): Coordinate[] {
  return Array.from({ length: steps + 1 }, (_, index) => ({
    lon: from.lon + ((to.lon - from.lon) * index) / steps,
    lat: from.lat + ((to.lat - from.lat) * index) / steps + (index % 2 === 0 ? 0 : wiggle),
  }));
}

/** A gently winding line: a sine wave across the straight path. */
function wavy(from: Coordinate, to: Coordinate, steps: number, amplitude = 0.0015): Coordinate[] {
  return Array.from({ length: steps + 1 }, (_, index) => ({
    lon: from.lon + ((to.lon - from.lon) * index) / steps,
    lat: from.lat + ((to.lat - from.lat) * index) / steps + Math.sin(index * 0.6) * amplitude,
  }));
}

function measurement(overrides: Partial<FunRouteMeasurement> = {}): FunRouteMeasurement {
  return {
    fingerprint: "fp",
    durationSeconds: 3_000,
    distanceMeters: 40_000,
    bendShare: 0.02,
    curvatureUnit: 0.1,
    backroadShare: 0.4,
    longestBendRunMeters: 200,
    ...overrides,
  };
}

const PRODUCTION: ProductionRoute = {
  id: "production:0",
  geometry: line(ORIGIN, DESTINATION, 40),
  measurement: measurement(),
};

function context(overrides: Partial<FunGeneratorContext> = {}): FunGeneratorContext {
  return { request: REQUEST, production: [PRODUCTION], sources: [], ...overrides };
}

function providerReturning(answer: (request: ProviderRouteRequest) => ProviderCandidate | null) {
  const requests: ProviderRouteRequest[] = [];
  const provider: RouteCandidateProvider = {
    id: "stub",
    capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }),
    async candidates(request: ProviderRouteRequest): Promise<ProviderCandidateSet> {
      requests.push(request);
      const candidate = answer(request);
      return { candidates: candidate === null ? [] : [candidate] };
    },
  };
  return { provider, requests };
}

function routed(geometry: readonly Coordinate[]): ProviderCandidate {
  return { providerId: "stub", profile: "motorcycle_twisty", geometry, distanceMeters: 45_000, durationSeconds: 3_300 };
}

/** A generator whose probes each route a distinct northern detour. */
function syntheticGenerator(
  id: FunCandidateGenerator["id"],
  count: number,
  options: { calls?: number; curvature?: (index: number) => number; offset?: number } = {},
): FunCandidateGenerator {
  return {
    id,
    propose: () =>
      Array.from({ length: count }, (_, index): FunProbe => ({
        id: `${id}:${index}`,
        generator: id,
        maxProviderCalls: options.calls ?? 1,
        sourceIds: [`src${index}`],
        forecast: { curvatureUnit: options.curvature?.(index) ?? 0.5, addedSeconds: 300 },
        async execute(call) {
          let candidate: ProviderCandidate | null = null;
          for (let attempt = 0; attempt < (options.calls ?? 1); attempt += 1) {
            candidate = await call({
              ...REQUEST,
              shaping: [{ lon: -75.3, lat: 40.55 + (index + (options.offset ?? 0)) * 0.05 }],
            });
          }
          return { candidate, adherence: 0.9, note: "ok" };
        },
      })),
  };
}

const ELIGIBLE = async (candidate: ProviderCandidate): Promise<FunCandidateVerdict> => ({
  eligible: true,
  measurement: measurement({ fingerprint: `fp_${candidate.geometry[1]?.lat ?? 0}`, curvatureUnit: 0.6 }),
});

function detourFor(request: ProviderRouteRequest): ProviderCandidate {
  const via = request.shaping[0] ?? { lon: -75.3, lat: 40.5 };
  return routed([...line(ORIGIN, via, 20), ...line(via, DESTINATION, 20).slice(1)]);
}

const BASE = {
  budget: { maxProviderCalls: 2, deadlineMs: 5_000 },
  allocation: "fixed" as const,
  verify: ELIGIBLE,
  signal: new AbortController().signal,
  duplicateSimilarityThreshold: 0.85,
};

describe("runFunGenerators — shared budget, verification and dedup", () => {
  it("never spends more provider calls than the family budget and reports the rest as skipped", async () => {
    const { provider, requests } = providerReturning(detourFor);
    const report = await runFunGenerators({
      ...BASE,
      context: context(),
      generators: [syntheticGenerator("corridor-probe", 3), syntheticGenerator("departure-rejoin", 3, { offset: 5 })],
      provider,
    });
    expect(requests).toHaveLength(2);
    expect(report.providerCallsUsed).toBe(2);
    // Fixed allocation alternates generators.
    expect(report.probes.slice(0, 2).map((probe) => probe.generator)).toEqual(["corridor-probe", "departure-rejoin"]);
    expect(report.probes.filter((probe) => probe.status === "skipped-budget")).toHaveLength(4);
    expect(report.pool.map((entry) => entry.generator)).toEqual(["corridor-probe", "departure-rejoin"]);
    // Every generated request is a single path: alternatives never multiply the cost.
    expect(requests.every((request) => request.options.includeAlternatives === false)).toBe(true);
  });

  it("does not start a two-call probe with only one call left", async () => {
    const { provider, requests } = providerReturning(detourFor);
    const report = await runFunGenerators({
      ...BASE,
      budget: { maxProviderCalls: 1, deadlineMs: 5_000 },
      context: context(),
      generators: [syntheticGenerator("missing-link", 1, { calls: 2 })],
      provider,
    });
    expect(requests).toHaveLength(0);
    expect(report.probes[0]?.status).toBe("skipped-budget");
  });

  it("pools only routes that pass the caller's canonical eligibility gate", async () => {
    const { provider } = providerReturning(detourFor);
    const report = await runFunGenerators({
      ...BASE,
      context: context(),
      generators: [syntheticGenerator("corridor-probe", 1)],
      provider,
      verify: async () => ({ eligible: false, codes: ["road-closed"] }),
    });
    expect(report.pool).toHaveLength(0);
    expect(report.probes[0]).toMatchObject({ status: "ineligible", ineligibleCodes: ["road-closed"] });
  });

  it("reports an answer that repeats a production route as a duplicate, not a new option", async () => {
    const { provider } = providerReturning(() => routed(PRODUCTION.geometry));
    const report = await runFunGenerators({
      ...BASE,
      context: context(),
      generators: [syntheticGenerator("corridor-probe", 1)],
      provider,
    });
    expect(report.pool).toHaveLength(0);
    expect(report.probes[0]).toMatchObject({ status: "duplicate", duplicateOf: "production:0" });
  });

  it("stops at the family deadline without failing the caller", async () => {
    const provider: RouteCandidateProvider = {
      id: "slow",
      capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }),
      candidates: (_request, signal) =>
        new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    };
    const report = await runFunGenerators({
      ...BASE,
      budget: { maxProviderCalls: 3, deadlineMs: 20 },
      context: context(),
      generators: [syntheticGenerator("corridor-probe", 3)],
      provider,
    });
    expect(report.probes[0]?.status).toBe("failed");
    expect(report.probes.slice(1).every((probe) => probe.status === "skipped-deadline")).toBe(true);
    expect(report.pool).toHaveLength(0);
  });

  it("adaptive allocation spends the first call on the probe forecast to close the curvy gap", async () => {
    const { provider, requests } = providerReturning(detourFor);
    const report = await runFunGenerators({
      ...BASE,
      budget: { maxProviderCalls: 1, deadlineMs: 5_000 },
      allocation: "adaptive",
      context: context(),
      generators: [syntheticGenerator("corridor-probe", 3, { curvature: (index) => [0.12, 0.9, 0.3][index] ?? 0 })],
      provider,
    });
    expect(requests).toHaveLength(1);
    expect(report.probes.find((probe) => probe.providerCalls === 1)?.probeId).toBe("corridor-probe:1");
  });

  it("propagates a caller abort", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller"));
    const { provider } = providerReturning(detourFor);
    await expect(
      runFunGenerators({ ...BASE, signal: controller.signal, context: context(), generators: [], provider }),
    ).rejects.toThrow("caller");
  });
});

describe("fun generator strategies", () => {
  const curvyWindow = line({ lon: -75.35, lat: 40.55 }, { lon: -75.25, lat: 40.55 }, 60, 0.001);
  const secondWindow = line({ lon: -75.22, lat: 40.56 }, { lon: -75.15, lat: 40.56 }, 40, 0.001);

  it("corridor-probe shapes an ordinary point-to-point request through the library corridor", async () => {
    const probes = corridorProbeGenerator.propose(context({ sources: [{ id: "ride#0", geometry: curvyWindow }] }));
    expect(probes).toHaveLength(1);
    const { provider, requests } = providerReturning(() => routed([ORIGIN, ...curvyWindow, DESTINATION]));
    const execution = await probes[0]!.execute(async (request) => (await provider.candidates(request, new AbortController().signal)).candidates[0] ?? null);
    expect(requests[0]?.shaping.length).toBeGreaterThanOrEqual(2);
    expect(requests[0]?.origin).toEqual(ORIGIN);
    expect(execution.adherence).toBeGreaterThan(0.9);
    expect(probes[0]?.forecast.curvatureUnit).not.toBeNull();
  });

  it("corridor-probe and departure-rejoin fail closed for rider-authored geometry", () => {
    const authored = { ...REQUEST, stops: [{ lon: -75.3, lat: 40.5 }] };
    const sources = [{ id: "ride#0", geometry: curvyWindow }];
    expect(corridorProbeGenerator.propose(context({ request: authored, sources }))).toEqual([]);
    expect(departureRejoinGenerator.propose(context({ request: authored, sources }))).toEqual([]);
  });

  it("departure-rejoin needs a measured production route to depart from", () => {
    const near = line({ lon: -75.35, lat: 40.505 }, { lon: -75.25, lat: 40.505 }, 40, 0.001);
    expect(departureRejoinGenerator.propose(context({ production: [], sources: [{ id: "r#0", geometry: near }] }))).toEqual([]);
    const probes = departureRejoinGenerator.propose(context({ sources: [{ id: "r#0", geometry: near }] }));
    expect(probes).toHaveLength(1);
    expect(probes[0]?.maxProviderCalls).toBe(1);
  });

  it("missing-link reserves two calls and rejects a dogleg connector before composing", async () => {
    const probes = missingLinkGenerator.propose(context({
      sources: [{ id: "a#0", geometry: curvyWindow }, { id: "b#0", geometry: secondWindow }],
    }));
    expect(probes.length).toBeGreaterThan(0);
    expect(probes[0]?.maxProviderCalls).toBe(2);
    let calls = 0;
    const execution = await probes[0]!.execute(async (request) => {
      calls += 1;
      // A connector that wanders far north before reaching the gap end.
      return routed([request.origin, { lon: -75.2, lat: 40.9 }, request.destination]);
    });
    expect(calls).toBe(1);
    expect(execution).toMatchObject({ candidate: null, note: "connector-dogleg" });
  });

  it("missing-link never trusts a connector whose roads were not measured", async () => {
    const probes = missingLinkGenerator.propose(context({
      sources: [{ id: "a#0", geometry: curvyWindow }, { id: "b#0", geometry: secondWindow }],
    }));
    const execution = await probes[0]!.execute(async (request) => routed([request.origin, request.destination]));
    expect(execution.note).toBe("connector-unmeasured");
  });

  it("prize-loop only proposes for a timeboxed loop and routes back to the origin", () => {
    const sources = [
      { id: "east#0", geometry: wavy({ lon: -75.49, lat: 40.5 }, { lon: -75.38, lat: 40.5 }, 160, 0.0005) },
      { id: "west#0", geometry: wavy({ lon: -75.38, lat: 40.53 }, { lon: -75.49, lat: 40.53 }, 160, 0.0005) },
    ];
    expect(prizeLoopGenerator.propose(context({ sources }))).toEqual([]);
    const loop = { ...REQUEST, destination: ORIGIN, discovery: { targetMinutes: 90, toleranceMinutes: 15 } };
    const probes = prizeLoopGenerator.propose(context({ request: loop, sources }));
    expect(probes.length).toBeGreaterThan(0);
    expect([...(probes[0]?.sourceIds ?? [])].sort()).toEqual(["east#0", "west#0"]);
  });
});

describe("library corridor sources", () => {
  it("keeps windows on the way and drops a ride far off the trip", () => {
    const onTheWay = line({ lon: -75.4, lat: 40.52 }, { lon: -75.2, lat: 40.52 }, 80, 0.0008);
    const farAway = line({ lon: -77.5, lat: 41.5 }, { lon: -77.3, lat: 41.5 }, 80, 0.0008);
    const sources = libraryCorridorSources(REQUEST, [
      { id: "near", geometry: onTheWay },
      { id: "far", geometry: farAway },
    ]);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source.id.startsWith("near#"))).toBe(true);
    expect(sources.every((source) => (source.priority ?? -1) >= 0 && (source.priority ?? 2) <= 1)).toBe(true);
  });
});

describe("funRouteMeasurement", () => {
  it("reads measured engine evidence and leaves missing evidence unknown", () => {
    const measured = funRouteMeasurement({
      fingerprint: "fp",
      durationSeconds: 100,
      distanceMeters: 1_000,
      evidence: {
        curvature: {
          value: { curvyMeters: 100, totalMeters: 1_000, unit: 0.5, longestRunMeters: 60 },
          status: "estimated",
          confidence: 0.7,
          provenance: [],
        },
      },
    });
    expect(measured).toMatchObject({ bendShare: 0.1, curvatureUnit: 0.5, longestBendRunMeters: 60, backroadShare: null });
  });
});
