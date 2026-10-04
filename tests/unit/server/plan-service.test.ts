/**
 * The route-plan service (23-API-CONTRACTS §2–§3, §14;
 * 17-IMPLEMENTATION-PLAN Task 2.4a; Task 3.1 wires the real pipeline).
 *
 * The service is the server-side half of the planning pipeline: it validates
 * bounded input, calls the deployment's provider, runs the canonical candidate
 * pipeline (normalize → hard eligibility → enrich → deterministic score) and
 * normalizes every failure into the API error object — never a raw provider
 * message, stack or router address. Role assignment is still the documented
 * Wave-3.3 stub.
 */

import { describe, expect, it } from "vitest";

import { GraphHopperProviderError } from "@/infrastructure/routing/graphhopper/response-parser";
import { ROUTE_POLICY, planRide } from "@/server/planning/plan-service";
import type { PlanRideInput } from "@/server/planning/plan-service";
import type { RoutePlanIdentityWire } from "@/application/planner/ports/route-plan-contract";
import type {
  ProviderCandidate,
  ProviderCandidateSet,
  ProviderCapabilities,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import type { FunGeneratorReport } from "@/application/planner/fun-generators";

const IDENTITY: RoutePlanIdentityWire = {
  rideId: "ride_test",
  rideRevision: 7,
  planningGeneration: 2,
};

const ORIGIN: Coordinate = { lon: -75.16, lat: 39.95 };
const DESTINATION: Coordinate = { lon: -74.8, lat: 40.2 };
const MIDPOINT: Coordinate = { lon: -75.0, lat: 40.05 };

const REQUEST: ProviderRouteRequest = {
  requestId: "req_test",
  origin: ORIGIN,
  destination: DESTINATION,
  stops: [],
  shaping: [],
  profile: "motorcycle_fastest",
  avoidPolygons: [],
  options: {
    includeAlternatives: true,
    avoidHighways: false,
    tollPolicy: "avoid",
    vehicle: "motorcycle",
  },
};

const CAPABILITIES: ProviderCapabilities = {
  profiles: ["motorcycle_fastest"],
  supportsAlternatives: true,
  supportsAvoidPolygons: false,
};

interface StubOptions {
  readonly candidates?: readonly ProviderCandidate[];
  readonly reject?: unknown;
}

interface StubProvider extends RouteCandidateProvider {
  calls: number;
  lastRequest: ProviderRouteRequest | null;
  lastSignal: AbortSignal | null;
}

function stubProvider(options: StubOptions = {}): StubProvider {
  const provider: StubProvider = {
    id: "stub-router",
    calls: 0,
    lastRequest: null,
    lastSignal: null,
    capabilities: (): ProviderCapabilities => CAPABILITIES,
    async candidates(
      request: ProviderRouteRequest,
      signal: AbortSignal,
    ): Promise<ProviderCandidateSet> {
      provider.calls += 1;
      provider.lastRequest = request;
      provider.lastSignal = signal;
      if (options.reject !== undefined) throw options.reject;
      return { candidates: options.candidates ?? [] };
    },
  };
  return provider;
}

function candidate(overrides: Partial<ProviderCandidate> = {}): ProviderCandidate {
  return {
    providerId: "stub-router",
    profile: "motorcycle_fastest",
    geometry: [ORIGIN, MIDPOINT, DESTINATION],
    distanceMeters: 120_000,
    durationSeconds: 6_000,
    providerMetadata: { fingerprint: "fp_primary" },
    ...overrides,
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("the test expected a defined value");
  return value;
}

function input(overrides: Partial<PlanRideInput> = {}): PlanRideInput {
  return { identity: IDENTITY, request: REQUEST, ...overrides };
}

describe("planRide — success path", () => {
  it("returns an advisory Jev character for the shadow fun winner without changing route selection", async () => {
    const roadSummary = {
      totalMeters: 120_000,
      surfaceByRoadClassMeters: { "asphalt|secondary": 120_000 },
      curvatureMeters: { "0.72": 120_000 },
      tollMeters: 0,
    };
    const provider = stubProvider({ candidates: [candidate({ roadSummary })] });
    const baseline = await planRide(input(), { provider, env: {} });
    let observedFeatures: unknown = null;
    const enriched = await planRide(input(), {
      provider,
      env: {},
      funCharacterClassifier: {
        classify: async (assessment) => {
          observedFeatures = assessment.features;
          return { label: "TWISTY", confidence: 0.91, model: "jev-1.13.0" };
        },
      },
    });

    expect(baseline.ok).toBe(true);
    expect(enriched.ok).toBe(true);
    if (!baseline.ok || !enriched.ok) return;
    expect(enriched.bundle.candidates[0]?.score).toEqual(baseline.bundle.candidates[0]?.score);
    expect(enriched.bundle.candidates[0]?.fingerprint).toBe(baseline.bundle.candidates[0]?.fingerprint);
    expect(enriched.bundle.selectedRouteId).toBe(enriched.bundle.candidates[0]?.id);
    expect(baseline.bundle.selectedRouteId).toBe(baseline.bundle.candidates[0]?.id);
    expect(observedFeatures).toMatchObject({ curvature: expect.any(Number) });
    expect(enriched.diagnostics.funCharacter).toMatchObject({
      fingerprint: enriched.bundle.candidates[0]?.fingerprint,
      label: "TWISTY",
      confidence: 0.91,
      model: "jev-1.13.0",
    });
  });

  it.each([
    { model: "jev-latest", confidence: 0.91 },
    { model: "unexpected-model", confidence: 0.91 },
    { model: "jev-1.13.0", confidence: Number.NaN },
    { model: "jev-1.13.0", confidence: 2 },
  ])("drops malformed classifier diagnostics without changing a valid plan: %j", async (reading) => {
    const provider = stubProvider({ candidates: [candidate({ roadSummary: {
      totalMeters: 120_000, surfaceByRoadClassMeters: { "asphalt|secondary": 120_000 },
      curvatureMeters: { "0.72": 120_000 }, tollMeters: 0,
    } })] });
    const baseline = await planRide(input(), { provider, env: {}, funCharacterClassifier: null });
    const result = await planRide(input(), {
      provider, env: {}, funCharacterClassifier: { classify: async () => ({ label: "TWISTY", ...reading }) },
    });
    expect(baseline.ok).toBe(true);
    expect(result.ok).toBe(true);
    if (!baseline.ok || !result.ok) throw new Error("Expected valid routes with optional diagnostics");
    expect(result.diagnostics.funCharacter).toBeUndefined();
    expect(result.bundle.candidates.map(({ fingerprint, score }) => ({ fingerprint, score }))).toEqual(
      baseline.bundle.candidates.map(({ fingerprint, score }) => ({ fingerprint, score })),
    );
    expect(result.bundle.candidates.find(({ id }) => id === result.bundle.selectedRouteId)?.fingerprint).toBe(
      baseline.bundle.candidates.find(({ id }) => id === baseline.bundle.selectedRouteId)?.fingerprint,
    );
  });

  it("keeps a valid plan when the optional character model fails", async () => {
    const provider = stubProvider({ candidates: [candidate({
      roadSummary: {
        totalMeters: 120_000,
        surfaceByRoadClassMeters: { "asphalt|secondary": 120_000 },
        curvatureMeters: { "0.72": 120_000 },
        tollMeters: 0,
      },
    })] });
    const result = await planRide(input(), {
      provider,
      env: {},
      funCharacterClassifier: {
        classify: async () => { throw new Error("private provider detail"); },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.candidates).toHaveLength(1);
    expect(result.bundle.selectedRouteId).toBe(result.bundle.candidates[0]?.id);
    expect(result.diagnostics.funCharacter).toBeUndefined();
  });

  it("maps provider candidates into a bundle with real eligibility, score and earned roles", async () => {
    const provider = stubProvider({
      candidates: [
        candidate({ durationSeconds: 6_480 }),
        candidate({
          durationSeconds: 5_760,
          distanceMeters: 131_966,
          // A different corridor: the diversity stage keeps both only when the
          // two routes are geographically distinct (06 §14).
          geometry: [ORIGIN, { lon: -74.9, lat: 40.1 }, DESTINATION],
        }),
      ],
    });

    const result = await planRide(input(), { provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity).toEqual(IDENTITY);
    expect(result.bundle.candidates).toHaveLength(2);
    expect(result.bundle.policyVersion).toBe(ROUTE_POLICY.version);
    // The roles are real now: `fastest` is the reference and `best-ride` is the
    // highest deterministic score, both earned from candidate metrics.
    const candidates = result.bundle.candidates;
    const fastest = candidates.reduce((winner, entry) =>
      entry.durationSeconds < winner.durationSeconds ? entry : winner,
    );
    const best = candidates.reduce((winner, entry) =>
      entry.score.total > winner.score.total ? entry : winner,
    );
    expect(result.bundle.roles.fastest).toBe(fastest.id);
    expect(result.bundle.roles["best-ride"]).toBe(best.id);
    expect(result.bundle.selectedRouteId).toBe(best.id);
    expect(result.bundle.selectionSource).toBe("automatic");
    // Wave 3 has no surface or urban-friction evidence, so those roles are left
    // unclaimed rather than being forced onto a candidate (06 §15).
    expect(result.bundle.roles["more-dirt"]).toBeNull();
    expect(result.bundle.roles["lower-workload"]).toBeNull();
    expect(result.diagnostics.optionalProvidersUnavailable).toEqual([]);
    expect(result.diagnostics.providers).toBeUndefined();
  });

  it("maps each candidate with honest metrics, geometry and real policy provenance", async () => {
    const instructions = [{
      text: "Turn left onto Ridge Pike",
      distanceMeters: 420,
      durationSeconds: 62,
      type: "turn",
      maneuver: "left" as const,
      roadName: "Ridge Pike",
      geometryIndex: 1,
    }];
    const provider = stubProvider({ candidates: [candidate({ instructions })] });

    const result = await planRide(input(), { provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mapped = required(result.bundle.candidates[0]);
    expect(mapped.geometry).toEqual([ORIGIN, MIDPOINT, DESTINATION]);
    expect(mapped.distanceMeters).toBe(120_000);
    expect(mapped.durationSeconds).toBe(6_000);
    expect(mapped.instructions).toEqual(instructions);
    expect(mapped.eligibility).toEqual({ eligible: true, failures: [] });
    // The evidence map is keyed honestly: the surface mix exists as a question,
    // and its answer is unknown, never an invented value.
    expect(Object.keys(mapped.evidence)).toEqual(["surfaceMix"]);
    expect(mapped.evidence["surfaceMix"]?.status).toBe("unknown");
    expect(mapped.evidence["surfaceMix"]?.value).toBeNull();
    expect(mapped.warnings).toEqual([]);
    expect(mapped.score.policyVersion).toBe(ROUTE_POLICY.version);
    expect(mapped.score.total).toBeGreaterThan(0);
    expect(mapped.fingerprint).toBe("fp_primary");
    expect(mapped.provider).toEqual({
      providerId: "stub-router",
      profile: "motorcycle_fastest",
    });
  });

  it("passes the caller's signal and the validated request to the provider", async () => {
    const controller = new AbortController();
    const provider = stubProvider({ candidates: [candidate()] });

    await planRide(input(), { provider, signal: controller.signal });

    expect(provider.calls).toBe(1);
    // The service hands the provider its own parsed copy, never the caller's
    // object: validated narrowing drops unknown keys and cannot be mutated by a
    // caller after the fact.
    expect(provider.lastRequest).toEqual(REQUEST);
    expect(provider.lastRequest).not.toBe(REQUEST);
    // A lane derives its own budget signal from the caller's, so the provider
    // sees a combined signal rather than the caller's object — and the caller's
    // abort still reaches it (06 §28).
    expect(provider.lastSignal).not.toBeNull();
    expect(provider.lastSignal?.aborted).toBe(false);
    controller.abort();
    expect(provider.lastSignal?.aborted).toBe(true);
  });

  it("keeps the copy of geometry it returns independent of the provider's arrays", async () => {
    const geometry: Coordinate[] = [ORIGIN, DESTINATION];
    const provider = stubProvider({ candidates: [candidate({ geometry })] });

    const result = await planRide(input(), { provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    geometry.push(MIDPOINT);
    expect(required(result.bundle.candidates[0]).geometry).toEqual([
      ORIGIN,
      DESTINATION,
    ]);
  });
});

describe("planRide — hard eligibility before scoring", () => {
  it("drops a candidate whose geometry cannot be a route", async () => {
    const provider = stubProvider({
      candidates: [
        candidate({ geometry: [ORIGIN] }),
        candidate({
          providerMetadata: { fingerprint: "fp_ok" },
          geometry: [ORIGIN, DESTINATION],
        }),
      ],
    });

    const result = await planRide(input(), { provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.candidates).toHaveLength(1);
    expect(required(result.bundle.candidates[0]).fingerprint).toBe("fp_ok");
  });

  it("drops a candidate with a non-finite coordinate", async () => {
    const provider = stubProvider({
      candidates: [
        candidate({
          geometry: [ORIGIN, { lon: Number.NaN, lat: 40 }],
        }),
      ],
    });

    const result = await planRide(input(), { provider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("provider-unavailable");
    expect(result.error.recoverable).toBe(true);
  });

  it("drops a candidate with a non-finite metric", async () => {
    const provider = stubProvider({
      candidates: [candidate({ durationSeconds: Number.POSITIVE_INFINITY })],
    });

    const result = await planRide(input(), { provider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("provider-unavailable");
  });

  it("reports an unsatisfiable rider constraint as a constraint conflict", async () => {
    // An avoid ring around the whole candidate line: hard eligibility rejects
    // it before scoring, and the failure is the rider's constraint, not an
    // engine outage.
    const ring = [
      { lon: -76, lat: 39 },
      { lon: -74, lat: 39 },
      { lon: -74, lat: 41 },
      { lon: -76, lat: 41 },
      { lon: -76, lat: 39 },
    ];
    const provider = stubProvider({ candidates: [candidate()] });

    const result = await planRide(
      input({ request: { ...REQUEST, avoidPolygons: [ring] } }),
      { provider },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("constraint-conflict");
    expect(result.error.recoverable).toBe(true);
  });

  it("attaches the real score only to candidates that survived eligibility", async () => {
    const provider = stubProvider({
      candidates: [
        candidate({ geometry: [ORIGIN, MIDPOINT, DESTINATION], durationSeconds: 6_000 }),
        candidate({ durationSeconds: 5_000, providerMetadata: { fingerprint: "fp_two" } }),
      ],
    });

    const result = await planRide(input(), { provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const entry of result.bundle.candidates) {
      expect(entry.score.policyVersion).toBe(ROUTE_POLICY.version);
      expect(entry.score.components.curvature.evidenceStatus).toBe("estimated");
    }
  });
});

describe("planRide — failure normalization", () => {
  it("carries the engine's normalized taxonomy and rider copy", async () => {
    const provider = stubProvider({
      reject: new GraphHopperProviderError("No route was found.", "no-route", {
        providerDetail: "Cannot find point 1: 1,1",
      }),
    });

    const result = await planRide(input(), { provider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no-route");
    expect(result.error.message).toBe("No route was found.");
    expect(result.error.recoverable).toBe(false);
    expect(JSON.stringify(result.error)).not.toContain("Cannot find point");
  });

  it("never leaks an unknown failure's own message", async () => {
    const provider = stubProvider({
      reject: new Error("connect ECONNREFUSED 127.0.0.1:8989"),
    });

    const result = await planRide(input(), { provider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("provider-unavailable");
    expect(result.error.recoverable).toBe(true);
    expect(JSON.stringify(result.error)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(result.error)).not.toContain("8989");
  });

  it("reports a caller cancellation as cancelled, not as an outage", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = stubProvider({ reject: controller.signal.reason });

    const result = await planRide(input(), {
      provider,
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("cancelled");
  });
});

describe("planRide — input validation", () => {
  it("rejects malformed input before any provider call", async () => {
    const provider = stubProvider({ candidates: [candidate()] });
    const bad = input({
      request: { ...REQUEST, origin: { lon: -181, lat: 200 } },
    });

    const result = await planRide(bad, { provider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
    expect(result.error.recoverable).toBe(false);
    expect(provider.calls).toBe(0);
    const issues = result.error.details?.["issues"];
    expect(Array.isArray(issues)).toBe(true);
  });

  it("rejects more stops than the v1 bound", async () => {
    const provider = stubProvider({ candidates: [candidate()] });
    const bad = input({
      request: {
        ...REQUEST,
        stops: Array.from({ length: 9 }, (_, index) => ({
          lon: -75 + index * 0.01,
          lat: 40,
        })),
      },
    });

    const result = await planRide(bad, { provider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
    expect(provider.calls).toBe(0);
  });
});

describe("planRide — the labeled route-plan fixture (Task 2.4b)", () => {
  const FIXTURE_ENV = { OGV_ROUTE_PLAN_FIXTURE: "1" };

  it("answers from the fixture file through the same mapping path as a live answer", async () => {
    // No provider is injected: the default adapter would try to reach the
    // deployment's router and refuse, so a usable bundle here *proves* the
    // fixture path skipped the provider call entirely.
    const result = await planRide(input(), { env: FIXTURE_ENV });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const candidates = result.bundle.candidates;
    expect(candidates).toHaveLength(2);
    // The bundle is a ranking: 06 §14's MMR selection puts the strongest
    // distinct candidate first, which is the automatic selection.
    expect(candidates.map((entry) => entry.durationSeconds)).toEqual([155, 245]);
    expect(candidates.map((entry) => entry.distanceMeters)).toEqual([1209, 1711]);
    expect(candidates[0]?.geometry).toHaveLength(10);
    expect(candidates[1]?.geometry).toHaveLength(14);
    // The live mapping and pipeline ran: the provider's fingerprint survives,
    // and the role policy earns the roles from the real score.
    expect(candidates[0]?.fingerprint).toBe("fixture:se-pa:fastest:v1");
    expect(candidates[1]?.fingerprint).toBe("fixture:se-pa:twisty:v1");
    for (const entry of candidates) {
      expect(entry.eligibility).toEqual({ eligible: true, failures: [] });
      expect(entry.evidence["surfaceMix"]?.status).toBe("unknown");
      expect(entry.score.policyVersion).toBe(ROUTE_POLICY.version);
    }
    const best = candidates.reduce((winner, entry) =>
      entry.score.total > winner.score.total ? entry : winner,
    );
    expect(result.bundle.roles["best-ride"]).toBe(best.id);
    expect(result.bundle.roles.fastest).toBe(candidates[0]?.id);
    expect(result.bundle.selectedRouteId).toBe(best.id);
    expect(result.bundle.policyVersion).toBe(ROUTE_POLICY.version);
  });

  it("closes discovery fixture candidates at the requested origin", async () => {
    const request: ProviderRouteRequest = {
      ...REQUEST,
      destination: ORIGIN,
      discovery: { targetMinutes: 90, toleranceMinutes: 20 },
    };
    const result = await planRide(input({ request }), { env: FIXTURE_ENV });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.bundle.candidates) {
      expect(candidate.geometry[0]).toEqual(ORIGIN);
      expect(candidate.geometry.at(-1)).toEqual(ORIGIN);
      expect(candidate.eligibility).toEqual({ eligible: true, failures: [] });
    }
  });

  it("a loop's ride time picks its recommendation, not a shorter higher-scoring loop", async () => {
    const provider = stubProvider({
      candidates: [
        candidate({ durationSeconds: 8_340, providerMetadata: { fingerprint: "fp_short" } }),
        candidate({
          durationSeconds: 11_300,
          geometry: [ORIGIN, { lon: MIDPOINT.lon + 0.2, lat: MIDPOINT.lat - 0.2 }, ORIGIN],
          providerMetadata: { fingerprint: "fp_fits" },
        }),
      ],
    });
    const request: ProviderRouteRequest = {
      ...REQUEST,
      destination: ORIGIN,
      discovery: { targetMinutes: 180, toleranceMinutes: 27 },
    };

    const result = await planRide(input({ request }), { provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fits = required(result.bundle.candidates.find((entry) => entry.durationSeconds === 11_300));
    expect(result.bundle.roles["best-ride"]).toBe(fits.id);
    expect(result.bundle.selectedRouteId).toBe(fits.id);
  });

  it("labels every fixture answer as a fixture, never as a live router", async () => {
    const result = await planRide(input(), { env: FIXTURE_ENV });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual({
      optionalProvidersUnavailable: [],
      providers: [{ providerId: "fixture", outcome: "ok", note: "FIXTURE — not a live router" }],
    });
  });

  it("leaves the live path untouched: an injected provider wins over the env gate", async () => {
    const provider = stubProvider({ candidates: [candidate({ durationSeconds: 60 })] });

    const result = await planRide(input(), { provider, env: FIXTURE_ENV });

    expect(provider.calls).toBe(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.candidates).toHaveLength(1);
    expect(result.diagnostics).toEqual({ optionalProvidersUnavailable: [] });
  });

  it("cancels inside the fixture latency instead of answering late", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(undefined), 10);
    const started = Date.now();

    const result = await planRide(input(), {
      env: { ...FIXTURE_ENV, OGV_ROUTE_PLAN_FIXTURE_DELAY_MS: "5000" },
      signal: controller.signal,
    });

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("cancelled");
    expect(result.error.recoverable).toBe(false);
  });
});

describe("planRide — fast first (UX rework)", () => {
  const THREE_PROFILES: ProviderCapabilities = {
    profiles: ["motorcycle_fastest", "motorcycle_scenic", "motorcycle_twisty"],
    supportsAlternatives: true,
    supportsAvoidPolygons: false,
  };

  function recordingProvider(answer: (request: ProviderRouteRequest) => readonly ProviderCandidate[]) {
    const requests: ProviderRouteRequest[] = [];
    let active = 0;
    let maxActive = 0;
    const provider: RouteCandidateProvider & { requests: ProviderRouteRequest[]; maxActive: () => number } = {
      id: "stub-router",
      requests,
      maxActive: () => maxActive,
      capabilities: () => THREE_PROFILES,
      async candidates(request) {
        requests.push(request);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { candidates: answer(request) };
      },
    };
    return provider;
  }

  const corridor = (lon: number) => [ORIGIN, { lon, lat: 40.1 }, DESTINATION];

  it("asks every character lane for one path, all at once", async () => {
    const provider = recordingProvider((request) => [
      candidate({
        profile: request.profile,
        geometry: corridor(request.profile === "motorcycle_twisty" ? -74.95 : request.profile === "motorcycle_scenic" ? -75.1 : -75.0),
        providerMetadata: { fingerprint: `fp_${request.profile}` },
      }),
    ]);

    const result = await planRide(input(), { provider });

    expect(result.ok).toBe(true);
    expect(provider.requests).toHaveLength(3);
    expect(provider.requests.every((request) => !request.options.includeAlternatives)).toBe(true);
    expect(provider.maxActive()).toBe(3);
  });

  it("fetches engine alternatives when the lanes converge on one ride", async () => {
    const provider = recordingProvider((request) =>
      request.options.includeAlternatives
        ? [
            candidate({ geometry: corridor(-75.0), providerMetadata: { fingerprint: "fp_a" } }),
            candidate({ geometry: corridor(-74.85), durationSeconds: 6_300, providerMetadata: { fingerprint: "fp_b" } }),
          ]
        : [candidate({ profile: request.profile, geometry: corridor(-75.0) })],
    );

    const result = await planRide(input(), { provider });

    expect(result.ok).toBe(true);
    expect(provider.requests).toHaveLength(4);
    expect(provider.requests[3]?.options.includeAlternatives).toBe(true);
    if (result.ok) expect(result.bundle.candidates.length).toBeGreaterThanOrEqual(2);
  });
});

describe("planRide — road authority (route intelligence RI-1)", () => {
  // Rides the candidate's own line from ORIGIN to MIDPOINT.
  const closedRoad = {
    sourceId: "feed",
    sourceRecordId: "c1",
    kind: "closure" as const,
    geometry: { type: "line" as const, coordinates: [ORIGIN, MIDPOINT] },
    roadName: "Ridge Road",
    description: "Bridge out.",
    validFrom: null,
    validUntil: null,
  };
  const feedInfo = {
    id: "feed",
    label: "Test feed",
    authority: "authoritative-operational" as const,
    family: "road-authority" as const,
    facet: "closures" as const,
    coverage: [{ west: -76, south: 39, east: -74, north: 41 }],
    precedence: 1,
  };
  const coordinatorWith = async (
    snapshot: import("@/application/route-intelligence/types").RoadAuthoritySnapshot,
  ) => {
    const { createRoadAuthorityCoordinator } = await import("@/application/route-intelligence/coordinator");
    return createRoadAuthorityCoordinator({
      sources: [{
        info: feedInfo,
        budget: {
          maxRemoteCallsPerPlan: 1, maxRecords: 1, timeoutMs: 1, concurrency: 1,
          cacheTtlMs: 1, serveStaleMs: 1, retry: "none", cancellable: false,
        },
        probe: () => ({ available: true, reason: null }),
        snapshot: async () => snapshot,
      }],
    });
  };

  it("a route over an authoritative active closure is refused, with an honest reason", async () => {
    const roadAuthority = await coordinatorWith({
      status: "fresh", fetchedAt: "2026-09-27T12:00:00.000Z", reason: null, records: [closedRoad], covered: feedInfo.coverage,
    });
    const result = await planRide(input(), {
      provider: stubProvider({ candidates: [candidate()] }), env: {}, roadAuthority, funCharacterClassifier: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("Every route found uses a road that is closed right now.");
  });

  it("a feed outage keeps the route, with closures unknown and a stated caveat", async () => {
    const roadAuthority = await coordinatorWith({ status: "unavailable", fetchedAt: null, reason: "down", records: [], covered: [] });
    const result = await planRide(input(), {
      provider: stubProvider({ candidates: [candidate()] }), env: {}, roadAuthority, funCharacterClassifier: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const planned = required(result.bundle.candidates[0]);
    expect(planned.evidence["closures"]?.status).toBe("unknown");
    expect(planned.warnings.map((warning) => warning.code)).toContain("road-authority-unavailable");
  });

  it("with road authority off, planning is exactly what it was (GraphHopper only)", async () => {
    const off = await planRide(input(), {
      provider: stubProvider({ candidates: [candidate()] }), env: {}, roadAuthority: null, funCharacterClassifier: null,
    });
    const defaulted = await planRide(input(), {
      provider: stubProvider({ candidates: [candidate()] }), env: {}, funCharacterClassifier: null,
    });
    expect(off.ok && defaulted.ok).toBe(true);
    if (!off.ok || !defaulted.ok) return;
    expect(required(off.bundle.candidates[0]).warnings).toEqual(required(defaulted.bundle.candidates[0]).warnings);
    expect(required(off.bundle.candidates[0]).evidence["closures"]).toBeUndefined();
  });
});

describe("planRide — fun-route generator family (OGV_FUN_GENERATORS)", () => {
  const roadSummary = {
    totalMeters: 50_000,
    surfaceByRoadClassMeters: { "asphalt|tertiary": 50_000 },
    curvatureMeters: { "0.95": 50_000 },
    tollMeters: 0,
  };
  // A rider-curated corridor that bulges north of the straight trip.
  const library = async () => [{
    id: "ride",
    geometry: Array.from({ length: 161 }, (_, index) => ({
      lon: -75.12 + (0.25 * index) / 160,
      lat: 40.12 + Math.sin(index * 0.6) * 0.0005,
    })),
  }];
  const routedThrough = (request: ProviderRouteRequest): ProviderCandidate =>
    candidate({
      profile: request.profile,
      geometry: request.shaping.length === 0 ? [ORIGIN, MIDPOINT, DESTINATION] : [ORIGIN, ...request.shaping, DESTINATION],
      roadSummary,
      providerMetadata: { fingerprint: `fp_${request.shaping.length}` },
    });
  const settings = (mode: "shadow" | "on") => ({
    mode,
    allocation: "fixed" as const,
    budget: { maxProviderCalls: 2, deadlineMs: 5_000 },
  });

  it("is off by default and never calls the provider beyond the lanes", async () => {
    const provider = stubProvider({ candidates: [candidate({ roadSummary })] });
    let reports = 0;
    const result = await planRide(input(), {
      provider,
      env: {},
      funGeneratorLibrary: library,
      onFunGeneratorReport: () => { reports += 1; },
    });
    expect(result.ok).toBe(true);
    expect(provider.calls).toBe(1);
    expect(reports).toBe(0);
  });

  it("shadow runs after the answer, records a report and never changes the bundle", async () => {
    const answer = (request: ProviderRouteRequest) => ({ candidates: [routedThrough(request)] });
    const offCalls: ProviderRouteRequest[] = [];
    const off = await planRide(input(), {
      provider: { ...stubProvider(), candidates: async (request) => { offCalls.push(request); return answer(request); } },
      env: {},
      funGeneratorLibrary: library,
    });
    let resolveReport: (report: FunGeneratorReport) => void = () => undefined;
    const reported = new Promise<FunGeneratorReport>((resolve) => { resolveReport = resolve; });
    const shadow = await planRide(input(), {
      provider: { ...stubProvider(), candidates: async (request) => answer(request) },
      env: {},
      funGenerators: settings("shadow"),
      funGeneratorLibrary: library,
      onFunGeneratorReport: (report, mode) => { expect(mode).toBe("shadow"); resolveReport(report); },
    });
    expect(off.ok && shadow.ok).toBe(true);
    if (!off.ok || !shadow.ok) return;
    expect(shadow.bundle.candidates.map((entry) => entry.fingerprint)).toEqual(off.bundle.candidates.map((entry) => entry.fingerprint));
    const report = await reported;
    expect(report.providerCallsUsed).toBeGreaterThan(0);
    expect(report.providerCallsUsed).toBeLessThanOrEqual(2);
    expect(report.pool.length).toBeGreaterThan(0);
    expect(report.pool[0]?.generator).toBe("corridor-probe");
  });

  it("on merges eligible generated routes into the canonical ranking", async () => {
    let report: FunGeneratorReport | null = null;
    const result = await planRide(input(), {
      provider: { ...stubProvider(), candidates: async (request) => ({ candidates: [routedThrough(request)] }) },
      env: {},
      funGenerators: settings("on"),
      funGeneratorLibrary: library,
      onFunGeneratorReport: (value) => { report = value; },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(report).not.toBeNull();
    const pooled = (report as FunGeneratorReport | null)?.pool.map((entry) => entry.candidate.geometry.length) ?? [];
    expect(pooled.length).toBeGreaterThan(0);
    expect(result.bundle.candidates.some((entry) => entry.geometry.length > 3)).toBe(true);
  });
});

describe("rider mode plan integration", () => {
  it("leads with the quieter rider-mode route but keeps the faster choice to compare", async () => {
    const run = (meters: number, roadClass: string, urbanDensity: string) => ({ totalMeters: meters, surfaceByRoadClassMeters: { [`asphalt|${roadClass}`]: meters }, curvatureMeters: {}, tollMeters: 0, roadRuns: [{ meters, durationSeconds: null, surface: "asphalt", roadClass, roadEnvironment: "road", urbanDensity, curvatureRatio: null, toll: false }] });
    const busy = candidate({ roadSummary: run(120_000, "primary", "city") });
    const quiet = candidate({
      geometry: [ORIGIN, { lat: MIDPOINT.lat + 0.05, lon: MIDPOINT.lon - 0.05 }, DESTINATION],
      durationSeconds: 6_900,
      distanceMeters: 125_000,
      providerMetadata: { fingerprint: "fp_quiet" },
      roadSummary: run(125_000, "tertiary", "rural"),
    });
    const provider: RouteCandidateProvider = { ...stubProvider(), candidates: async request => ({ candidates: [request.options.riderModeFactor === undefined ? busy : { ...quiet, providerMetadata: { ...quiet.providerMetadata, riderModeFactor: request.options.riderModeFactor } }] }) };
    const result = await planRide(input({ request: { ...REQUEST, options: { ...REQUEST.options, traffic: "protect-ride", roadCharacter: "balanced", departureNow: false } } }), {
      provider, roadAuthority: null, env: { OGV_RIDER_MODES: "on", OGV_FUN_GENERATORS_CALLS: "2" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.candidates.length).toBeGreaterThanOrEqual(2);
    const best = result.bundle.candidates.find(entry => entry.id === result.bundle.roles["best-ride"]);
    const fastest = result.bundle.candidates.find(entry => entry.id === result.bundle.roles.fastest);
    expect(best?.durationSeconds).toBe(6_900);
    expect(fastest?.durationSeconds).toBe(6_000);
  });

  it.each([false, true])("obeys the shared budget and kill switch (off=%s)", async off => {
    const requests: ProviderRouteRequest[] = [];
    const roadSummary = { totalMeters: 120_000, surfaceByRoadClassMeters: { "asphalt|primary": 120_000 }, curvatureMeters: {}, tollMeters: 0, roadRuns: [{ meters: 120_000, durationSeconds: null, surface: "asphalt", roadClass: "primary", roadEnvironment: "road", urbanDensity: "city", curvatureRatio: null, toll: false }] };
    const provider: RouteCandidateProvider = { ...stubProvider(), candidates: async request => { requests.push(request); return { candidates: [candidate({ roadSummary })] }; } };
    const result = await planRide(input({ request: { ...REQUEST, options: { ...REQUEST.options, traffic: "protect-ride", roadCharacter: "balanced", departureNow: false } } }), {
      provider, roadAuthority: null, env: { OGV_RIDER_MODES: off ? "off" : "on", OGV_FUN_GENERATORS_CALLS: "2" },
    });
    expect(result.ok).toBe(true);
    expect(requests.filter(request => request.options.riderModeFactor !== undefined)).toHaveLength(off ? 0 : 2);
    if (result.ok) {
      if (off) expect(result.diagnostics.riderModes).toBeUndefined();
      else expect(result.diagnostics.riderModes).toMatchObject({ calls: 2, trials: expect.arrayContaining([expect.objectContaining({ busyShare: 1, minutes: 100 })]) });
    }
  });
});
