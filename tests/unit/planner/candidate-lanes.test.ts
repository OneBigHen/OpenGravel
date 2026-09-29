/**
 * Bounded candidate lanes (Wave 3 Task 3.2, 06-ROUTING-AND-DECISION-ENGINE §4/§5/§28/§29).
 *
 * A lane is one bounded provider call with a purpose and a deadline. The
 * properties that matter are the ones that keep generation finite and a
 * deployment honest: exactly one call per lane, at most two lanes in flight, a
 * per-lane deadline that ends in a diagnostic rather than a hanging plan, a
 * total candidate cap, and a caller cancellation that propagates unchanged
 * instead of being converted into a lane failure (06 §28).
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_LANES,
  MAX_CONCURRENT_LANES,
  MAX_TOTAL_CANDIDATES,
  resolveLanes,
  runLanes,
  type CandidateLane,
} from "@/application/planner/candidate-lanes";
import type {
  ProviderCandidate,
  ProviderCapabilities,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";

const REQUEST: ProviderRouteRequest = {
  requestId: "req_lanes",
  origin: { lon: -75.2, lat: 40 },
  destination: { lon: -74.8, lat: 40.2 },
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

/** Lane definitions with a tiny budget, so a suite never waits for a router. */
function lanes(count: number, deadlineMs = 1_000): readonly CandidateLane[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `lane-${index}`,
    profile: `motorcycle_${index}`,
    purpose: "test lane",
    maxCalls: 1 as const,
    deadlineMs,
  }));
}

function candidate(profile: string, offset: number): ProviderCandidate {
  const geometry: Coordinate[] = [
    { lon: -75.2 + offset, lat: 40 },
    { lon: -74.8 + offset, lat: 40.2 },
  ];
  return {
    providerId: "stub-router",
    profile,
    geometry,
    distanceMeters: 10_000 + offset * 1_000_000,
    durationSeconds: 900,
    providerMetadata: { fingerprint: `fp_${profile}` },
  };
}

interface StubOptions {
  readonly profiles?: readonly string[];
  readonly perCall?: number;
  readonly delayMs?: number;
  readonly reject?: (call: number) => unknown;
  readonly neverResolves?: boolean;
  readonly onCall?: (call: number, signal: AbortSignal) => void;
}

interface StubProvider extends RouteCandidateProvider {
  calls: number;
  active: number;
  maxActive: number;
  readonly requestedProfiles: string[];
}

function stubProvider(options: StubOptions = {}): StubProvider {
  const provider: StubProvider = {
    id: "stub-router",
    calls: 0,
    active: 0,
    maxActive: 0,
    requestedProfiles: [],
    capabilities: (): ProviderCapabilities => ({
      profiles: [...(options.profiles ?? ["motorcycle_fastest"])],
      supportsAlternatives: true,
      supportsAvoidPolygons: true,
    }),
    async candidates(
      request: ProviderRouteRequest,
      signal: AbortSignal,
    ): Promise<{ candidates: readonly ProviderCandidate[] }> {
      provider.calls += 1;
      provider.active += 1;
      provider.maxActive = Math.max(provider.maxActive, provider.active);
      provider.requestedProfiles.push(request.profile);
      options.onCall?.(provider.calls, signal);
      try {
        if (options.neverResolves === true) {
          await new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }
        const rejection = options.reject?.(provider.calls);
        if (rejection !== undefined) throw rejection;
        if (options.delayMs !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }
        return {
          candidates: Array.from({ length: options.perCall ?? 1 }, (_, index) =>
            candidate(request.profile, index + provider.calls * 10),
          ),
        };
      } finally {
        provider.active -= 1;
      }
    },
  };
  return provider;
}

describe("resolveLanes", () => {
  const graphHopper: ProviderCapabilities = {
    profiles: [
      "motorcycle_fastest",
      "motorcycle_twisty",
      "motorcycle_scenic",
      "motorcycle_adventure",
    ],
    supportsAlternatives: true,
    supportsAvoidPolygons: true,
  };

  it("publishes bounded lane definitions", () => {
    expect(DEFAULT_LANES.map((lane) => lane.id)).toEqual([
      "baseline-efficient",
      "balanced",
      "curvy",
      "surface-targeted",
    ]);
    for (const lane of DEFAULT_LANES) {
      expect(lane.maxCalls).toBe(1);
      expect(lane.deadlineMs).toBeGreaterThan(0);
      expect(lane.deadlineMs).toBeLessThanOrEqual(30_000);
      expect(lane.purpose.length).toBeGreaterThan(0);
    }
  });

  it("runs only the baseline lane when alternatives were not requested", () => {
    const resolved = resolveLanes({
      capabilities: graphHopper,
      intent: {},
      includeAlternatives: false,
    });

    expect(resolved.map((lane) => lane.id)).toEqual(["baseline-efficient"]);
    expect(resolved[0]?.profile).toBe("motorcycle_fastest");
  });

  it("resolves balanced onto the served base profile, else scenic, and drops a duplicate lane", () => {
    // No base profile here: balanced is the scenic middle character (UX rework).
    expect(
      resolveLanes({ capabilities: graphHopper, intent: {}, includeAlternatives: true }).map(
        (lane) => lane.profile,
      ),
    ).toEqual(["motorcycle_fastest", "motorcycle_scenic", "motorcycle_twisty"]);
    // Neither base nor scenic: balanced falls onto the baseline and is dropped.
    expect(
      resolveLanes({
        capabilities: { ...graphHopper, profiles: ["motorcycle_fastest", "motorcycle_twisty"] },
        intent: {},
        includeAlternatives: true,
      }).map((lane) => lane.profile),
    ).toEqual(["motorcycle_fastest", "motorcycle_twisty"]);

    expect(
      resolveLanes({
        capabilities: { ...graphHopper, profiles: ["motorcycle_base", "motorcycle_fastest"] },
        intent: {},
        includeAlternatives: true,
      }).map((lane) => lane.id),
    ).toEqual(["baseline-efficient", "balanced"]);
    expect(
      resolveLanes({
        capabilities: { ...graphHopper, profiles: ["motorcycle_base", "motorcycle_fastest"] },
        intent: {},
        includeAlternatives: true,
      })[1]?.profile,
    ).toBe("motorcycle_base");
  });

  it("offers the surface-targeted lane only when the intent prefers non-paved", () => {
    const paved = resolveLanes({
      capabilities: graphHopper,
      intent: { surface: { preference: "mostly-pavement" } },
      includeAlternatives: true,
    });
    const mixed = resolveLanes({
      capabilities: graphHopper,
      intent: { surface: { preference: "mixed" } },
      includeAlternatives: true,
    });

    expect(paved.map((lane) => lane.id)).not.toContain("surface-targeted");
    expect(mixed.map((lane) => lane.id)).toEqual([
      "baseline-efficient",
      "balanced",
      "curvy",
      "surface-targeted",
    ]);
    expect(mixed[3]?.profile).toBe("motorcycle_adventure");
  });

  it("keeps a lane whose profile the deployment serves and drops the rest", () => {
    expect(
      resolveLanes({
        capabilities: { ...graphHopper, profiles: ["motorcycle_twisty"] },
        intent: {},
        includeAlternatives: true,
      }).map((lane) => lane.id),
    ).toEqual(["curvy"]);
  });

  it("treats an undeclared profile list as unknown rather than as 'serves nothing'", () => {
    expect(
      resolveLanes({
        capabilities: { ...graphHopper, profiles: [] },
        intent: {},
        includeAlternatives: true,
      }).map((lane) => lane.id),
    ).toEqual(["baseline-efficient", "curvy"]);
  });
});

describe("runLanes", () => {
  it("calls each lane once and never runs more than two at a time", async () => {
    const provider = stubProvider({ delayMs: 5 });
    const signal = new AbortController().signal;

    const result = await runLanes({
      lanes: lanes(4),
      requestFor: (profile) => ({ ...REQUEST, profile }),
      provider,
      signal,
    });

    expect(provider.calls).toBe(4);
    expect(provider.maxActive).toBeLessThanOrEqual(MAX_CONCURRENT_LANES);
    expect(provider.maxActive).toBeGreaterThan(1);
    expect(result.candidates).toHaveLength(4);
    expect(result.diagnostics.map((entry) => entry.outcome)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    expect(result.diagnostics.map((entry) => entry.candidateCount)).toEqual([1, 1, 1, 1]);
    // Candidates arrive in lane order, one call per lane.
    expect(provider.requestedProfiles).toEqual([
      "motorcycle_0",
      "motorcycle_1",
      "motorcycle_2",
      "motorcycle_3",
    ]);
  });

  it("records a lane failure as a diagnostic and keeps the other lanes' candidates", async () => {
    const provider = stubProvider({
      reject: (call) => (call === 1 ? new Error("lane one is broken") : undefined),
    });

    const result = await runLanes({
      lanes: lanes(2),
      requestFor: (profile) => ({ ...REQUEST, profile }),
      provider,
      signal: new AbortController().signal,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.profile).toBe("motorcycle_1");
    expect(result.diagnostics[0]).toMatchObject({
      laneId: "lane-0",
      profile: "motorcycle_0",
      outcome: "failed",
      candidateCount: 0,
      note: "rejection:unknown",
    });
    expect(result.diagnostics[1]?.outcome).toBe("ok");
  });

  it("classifies a rejection through the injected classifier only", async () => {
    const provider = stubProvider({ reject: () => new Error("connect ECONNREFUSED") });

    const result = await runLanes({
      lanes: lanes(1),
      requestFor: (profile) => ({ ...REQUEST, profile }),
      provider,
      signal: new AbortController().signal,
      classifyFailure: (error) => ({
        code: (error as { readonly code?: string }).code ?? "provider-unavailable",
      }),
    });

    expect(result.diagnostics[0]?.note).toBe("rejection:provider-unavailable");
    expect(result.diagnostics[0]?.failure).toEqual({ code: "provider-unavailable" });
  });

  it("ends a lane on its deadline with a timeout diagnostic", async () => {
    const provider = stubProvider({ neverResolves: true });
    const started = Date.now();

    const result = await runLanes({
      lanes: lanes(1, 10),
      requestFor: (profile) => ({ ...REQUEST, profile }),
      provider,
      signal: new AbortController().signal,
    });

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.candidates).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      outcome: "timeout",
      candidateCount: 0,
      note: "lane-deadline-exceeded",
    });
  });

  it("caps the total candidate count and stops calling lanes past the cap", async () => {
    const provider = stubProvider({ perCall: 4 });

    const result = await runLanes({
      lanes: lanes(3),
      requestFor: (profile) => ({ ...REQUEST, profile }),
      provider,
      signal: new AbortController().signal,
    });

    expect(result.candidates).toHaveLength(MAX_TOTAL_CANDIDATES);
    expect(result.diagnostics.map((entry) => entry.outcome)).toEqual([
      "ok",
      "capped",
      "skipped",
    ]);
    expect(result.diagnostics[1]?.candidateCount).toBe(MAX_TOTAL_CANDIDATES - 4);
    expect(result.diagnostics[2]?.note).toBe("candidate-cap-reached");
    expect(provider.calls).toBe(2);
  });

  it("propagates a caller cancellation unchanged instead of reporting a lane failure", async () => {
    const controller = new AbortController();
    const provider = stubProvider({
      delayMs: 5,
      onCall: (call) => {
        if (call === 1) controller.abort(new Error("rider cancelled"));
      },
    });

    await expect(
      runLanes({
        lanes: lanes(4),
        requestFor: (profile) => ({ ...REQUEST, profile }),
        provider,
        signal: controller.signal,
      }),
    ).rejects.toBe(controller.signal.reason);
    // The wave already in flight was aborted; no further lane was started.
    expect(provider.calls).toBe(MAX_CONCURRENT_LANES);
  });

  it("refuses to start work when the caller is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("rider cancelled"));

    await expect(
      runLanes({
        lanes: lanes(2),
        requestFor: (profile) => ({ ...REQUEST, profile }),
        provider: stubProvider(),
        signal: controller.signal,
      }),
    ).rejects.toBe(controller.signal.reason);
  });
});
