/**
 * Road spans through the server planning pipeline (04 §17, 06 §8/§19, Task 4.3b).
 *
 * The load-bearing property is that a span verdict belongs to a **candidate**,
 * not to the request: the pipeline measures each returned line and drops exactly
 * the candidates that fail a required or avoided span. When nothing survives, the
 * §3 error names the rider's span count — never a span id, a provider name or an
 * internal code.
 */

import { describe, expect, it } from "vitest";

import { planRide } from "@/server/planning/plan-service";
import type { PlanRideInput } from "@/server/planning/plan-service";
import type {
  ProviderCandidate,
  ProviderCandidateSet,
  ProviderCapabilities,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { RoutePlanIdentityWire } from "@/application/planner/ports/route-plan-contract";
import { asRoadSpanId } from "@/domain/ride/ids";
import type { Coordinate } from "@/domain/ride/types";

const IDENTITY: RoutePlanIdentityWire = {
  rideId: "ride_spans",
  rideRevision: 3,
  planningGeneration: 0,
};

const ORIGIN: Coordinate = { lon: -75.16, lat: 39.95 };
const DESTINATION: Coordinate = { lon: -74.8, lat: 40.2 };
const MIDPOINT: Coordinate = { lon: -75.0, lat: 40.05 };

/** The returned candidate line: origin → midpoint → destination. */
const CANDIDATE_LINE: readonly Coordinate[] = [ORIGIN, MIDPOINT, DESTINATION];

/** A span on the returned line, in route order: entry then exit. */
const ON_ROUTE_SPAN: readonly Coordinate[] = [ORIGIN, MIDPOINT];

/** A span far north of the returned line: the route never goes there. */
const OFF_ROUTE_SPAN: readonly Coordinate[] = [
  { lon: -75.0, lat: 40.6 },
  { lon: -74.9, lat: 40.6 },
];

function requestWithSpans(
  spans: ProviderRouteRequest["roadSpans"],
): ProviderRouteRequest {
  return {
    requestId: "req_spans",
    origin: ORIGIN,
    destination: DESTINATION,
    stops: [],
    shaping: [],
    profile: "motorcycle_fastest",
    avoidPolygons: [],
    roadSpans: spans,
    options: {
      includeAlternatives: false,
      avoidHighways: false,
      tollPolicy: "avoid",
      vehicle: "motorcycle",
    },
  };
}

const REQUIRED_ON_ROUTE = {
  id: "span_keep",
  mode: "must" as const,
  direction: "forward" as const,
  anchors: ON_ROUTE_SPAN,
  corridor: ON_ROUTE_SPAN,
};

const REQUIRED_OFF_ROUTE = {
  id: "span_keep",
  mode: "must" as const,
  direction: "forward" as const,
  anchors: OFF_ROUTE_SPAN,
  corridor: OFF_ROUTE_SPAN,
};

const CAPABILITIES: ProviderCapabilities = {
  profiles: ["motorcycle_fastest"],
  supportsAlternatives: false,
  supportsAvoidPolygons: false,
};

function providerWith(candidates: readonly ProviderCandidate[]): RouteCandidateProvider {
  return {
    id: "stub-router",
    capabilities: (): ProviderCapabilities => CAPABILITIES,
    async candidates(): Promise<ProviderCandidateSet> {
      return { candidates };
    },
  };
}

function candidate(overrides: Partial<ProviderCandidate> = {}): ProviderCandidate {
  return {
    providerId: "stub-router",
    profile: "motorcycle_fastest",
    geometry: CANDIDATE_LINE,
    distanceMeters: 120_000,
    durationSeconds: 6_000,
    providerMetadata: { fingerprint: "fp_primary" },
    ...overrides,
  };
}

function input(request: ProviderRouteRequest): PlanRideInput {
  return { identity: IDENTITY, request };
}

describe("planRide — required road spans", () => {
  it("keeps a candidate that satisfies the required span", async () => {
    const result = await planRide(
      input(requestWithSpans([REQUIRED_ON_ROUTE])),
      { provider: providerWith([candidate()]) },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.candidates).toHaveLength(1);
  });

  it("drops a candidate that does not cover the required span and names the span count", async () => {
    const result = await planRide(
      input(requestWithSpans([REQUIRED_OFF_ROUTE])),
      { provider: providerWith([candidate()]) },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("constraint-conflict");
    expect(result.error.message).toContain("1 road span");
    // The copy is the rider's own fact: no internal id, code or provider name.
    expect(result.error.message).not.toContain("span_keep");
    expect(result.error.message).not.toContain("stub-router");
  });

  it("counts the rider's spans, not the internals, when several are required", async () => {
    const twoSpans = [
      REQUIRED_OFF_ROUTE,
      { ...REQUIRED_OFF_ROUTE, id: "span_keep_2" },
    ];
    const result = await planRide(input(requestWithSpans(twoSpans)), {
      provider: providerWith([candidate()]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("2 road spans");
  });

  it("measures each candidate separately: one survives when it satisfies the span", async () => {
    const offRouteCandidate = candidate({
      geometry: [
        { lon: -75.16, lat: 39.6 },
        { lon: -75.0, lat: 39.75 },
        { lon: -74.8, lat: 39.9 },
      ],
      providerMetadata: { fingerprint: "fp_off" },
    });
    const result = await planRide(
      input(requestWithSpans([REQUIRED_ON_ROUTE])),
      { provider: providerWith([offRouteCandidate, candidate()]) },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.candidates).toHaveLength(1);
    expect(result.bundle.candidates[0]?.fingerprint).toBe("fp_primary");
  });

  it("rejects an avoided span the route enters", async () => {
    const avoided = {
      id: "span_avoid",
      mode: "avoid" as const,
      direction: "either" as const,
      anchors: ON_ROUTE_SPAN,
      corridor: ON_ROUTE_SPAN,
    };
    const result = await planRide(input(requestWithSpans([avoided])), {
      provider: providerWith([candidate()]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("constraint-conflict");
  });

  it("has no span verdict when the request carried no spans", async () => {
    const result = await planRide(input(requestWithSpans(undefined)), {
      provider: providerWith([candidate()]),
    });
    expect(result.ok).toBe(true);
  });

  it("reports a required span the request could not resolve as unavailable, not satisfied", async () => {
    // An unresolved span arrives with anchors but no corridor (the browser had
    // no line to send). It must not pass silently.
    const unresolved = {
      id: asRoadSpanId("span_unresolved"),
      mode: "must" as const,
      direction: "forward" as const,
      anchors: ON_ROUTE_SPAN,
    };
    const result = await planRide(input(requestWithSpans([unresolved])), {
      provider: providerWith([candidate()]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("constraint-conflict");
  });
});
