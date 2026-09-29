/**
 * The road-matching service (04 §17, 05 §20, 23 §14; legacy
 * `src/lib/roads/road-matching.ts` at baseline `06785c00`).
 *
 * Three properties are load-bearing and each gets its own tests:
 *
 * - the request is **built through the anchors** (`origin → stops → destination`),
 *   so a match is the router's own line between them rather than a straight line;
 * - every number is **measured against the returned line**, never read out of the
 *   request, and the confidence bands are exact ≤ 5 m, matched ≤ 25 m,
 *   approximate ≤ 100 m, with anything farther refused as `no-match`;
 * - access evidence is **never fabricated**: a match that did not carry a
 *   motorcycle-access value reports `unknown`, and one that did carries it with
 *   its source.
 */

import { describe, expect, it } from "vitest";

import { GraphHopperProviderError } from "@/infrastructure/routing/graphhopper/response-parser";
import {
  ACCESS_EVIDENCE_KEY,
  MATCH_APPROXIMATE_METERS,
  MATCH_EXACT_METERS,
  MATCH_MATCHED_METERS,
  matchRoadAnchors,
} from "@/server/road-matching/match-service";
import type {
  ProviderCandidate,
  ProviderCandidateSet,
  ProviderCapabilities,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";

/** ~1 m in degrees at the test latitude; anchors are nudged by exact metres. */
const BASE: Coordinate = { lon: -75.44, lat: 40.14 };
const ONE_METER_LAT = 1 / 111_320;
const ONE_METER_LON = 1 / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));

function metres(east: number, north: number): Coordinate {
  return {
    lon: BASE.lon + east * ONE_METER_LON,
    lat: BASE.lat + north * ONE_METER_LAT,
  };
}

const CAPABILITIES: ProviderCapabilities = {
  profiles: ["motorcycle"],
  supportsAlternatives: false,
  supportsAvoidPolygons: false,
};

interface StubProvider extends RouteCandidateProvider {
  calls: number;
  lastRequest: ProviderRouteRequest | null;
}

function stubProvider(options: {
  readonly candidates?: readonly ProviderCandidate[];
  readonly reject?: unknown;
} = {}): StubProvider {
  const provider: StubProvider = {
    id: "stub-router",
    calls: 0,
    lastRequest: null,
    capabilities: (): ProviderCapabilities => CAPABILITIES,
    async candidates(
      request: ProviderRouteRequest,
    ): Promise<ProviderCandidateSet> {
      provider.calls += 1;
      provider.lastRequest = request;
      if (options.reject !== undefined) throw options.reject;
      return { candidates: options.candidates ?? [] };
    },
  };
  return provider;
}

function candidate(overrides: Partial<ProviderCandidate> = {}): ProviderCandidate {
  return {
    providerId: "stub-router",
    profile: "motorcycle",
    geometry: [metres(0, 0), metres(500, 0), metres(1000, 0)],
    distanceMeters: 1000,
    durationSeconds: 120,
    providerMetadata: { engineVersion: "11.0" },
    ...overrides,
  };
}

const ANCHORS: readonly Coordinate[] = [metres(0, 0), metres(1000, 0)];

describe("matchRoadAnchors — request shape", () => {
  it("routes through every anchor: origin, ordered stops, destination", async () => {
    const provider = stubProvider({ candidates: [candidate()] });
    const result = await matchRoadAnchors(
      { anchors: [ANCHORS[0], metres(500, 0), ANCHORS[1]] },
      { provider },
    );
    expect(result.ok).toBe(true);
    const request = provider.lastRequest;
    expect(request).not.toBeNull();
    expect(request?.origin).toEqual(ANCHORS[0]);
    expect(request?.destination).toEqual(ANCHORS[1]);
    expect(request?.stops).toEqual([metres(500, 0)]);
    expect(request?.options.vehicle).toBe("motorcycle");
  });

  it("keeps a two-anchor match stop-free and asks for no alternatives", async () => {
    const provider = stubProvider({ candidates: [candidate()] });
    await matchRoadAnchors({ anchors: [...ANCHORS] }, { provider });
    expect(provider.lastRequest?.stops).toEqual([]);
    expect(provider.lastRequest?.options.includeAlternatives).toBe(false);
  });

  it("uses the requested profile", async () => {
    const provider = stubProvider({ candidates: [candidate()] });
    await matchRoadAnchors({ anchors: [...ANCHORS], profile: "motorcycle_twisty" }, { provider });
    expect(provider.lastRequest?.profile).toBe("motorcycle_twisty");
  });
});

describe("matchRoadAnchors — drift and confidence bands", () => {
  it("reports exact when every anchor sits on the returned line", async () => {
    const provider = stubProvider({ candidates: [candidate()] });
    const result = await matchRoadAnchors({ anchors: [...ANCHORS] }, { provider });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.match.maxDriftMeters).toBeLessThanOrEqual(MATCH_EXACT_METERS);
    expect(result.match.confidence).toBe("exact");
  });

  it("reports matched for a drift above exact and within the matched band", async () => {
    const drift = MATCH_EXACT_METERS + 5;
    const provider = stubProvider({ candidates: [candidate()] });
    const result = await matchRoadAnchors(
      { anchors: [ANCHORS[0], metres(1000, drift)] },
      { provider },
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.match.maxDriftMeters).toBeGreaterThan(MATCH_EXACT_METERS);
    expect(result.match.maxDriftMeters).toBeLessThanOrEqual(MATCH_MATCHED_METERS);
    expect(result.match.confidence).toBe("matched");
  });

  it("reports approximate for a drift inside the approximate band", async () => {
    const drift = MATCH_MATCHED_METERS + 20;
    const provider = stubProvider({ candidates: [candidate()] });
    const result = await matchRoadAnchors(
      { anchors: [ANCHORS[0], metres(1000, drift)] },
      { provider },
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.match.maxDriftMeters).toBeLessThanOrEqual(MATCH_APPROXIMATE_METERS);
    expect(result.match.confidence).toBe("approximate");
  });

  it("refuses an anchor farther than the approximate band", async () => {
    const provider = stubProvider({ candidates: [candidate()] });
    const result = await matchRoadAnchors(
      { anchors: [ANCHORS[0], metres(1000, MATCH_APPROXIMATE_METERS + 50)] },
      { provider },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no-match");
  });

  it("measures the maximum drift across every anchor", async () => {
    // The middle anchor is far off the returned straight line, so the maximum —
    // not the first or the last — is what the answer reports.
    const provider = stubProvider({ candidates: [candidate()] });
    const result = await matchRoadAnchors(
      { anchors: [ANCHORS[0], metres(500, 30), ANCHORS[1]] },
      { provider },
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.match.maxDriftMeters).toBeGreaterThan(MATCH_MATCHED_METERS);
    expect(result.match.confidence).toBe("approximate");
  });

  it("carries the provider's own distance and duration through unchanged", async () => {
    const provider = stubProvider({
      candidates: [candidate({ distanceMeters: 1234.5, durationSeconds: 90 })],
    });
    const result = await matchRoadAnchors({ anchors: [...ANCHORS] }, { provider });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.match.distanceMeters).toBe(1234.5);
    expect(result.match.durationSeconds).toBe(90);
    expect(result.match.matchedGeometry.length).toBe(3);
  });
});

describe("matchRoadAnchors — access evidence honesty", () => {
  it("reports unknown when the match carried no access value", async () => {
    const provider = stubProvider({ candidates: [candidate()] });
    const result = await matchRoadAnchors({ anchors: [...ANCHORS] }, { provider });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.match.accessEvidence.status).toBe("unknown");
    expect(result.match.accessEvidence.value).toBeNull();
    expect(result.match.accessEvidence.reason).toBeTruthy();
    expect(result.match.accessEvidence.provenance).toEqual([]);
  });

  it("carries a permitted value the match itself reported, with its source", async () => {
    const provider = stubProvider({
      candidates: [
        candidate({ providerMetadata: { [ACCESS_EVIDENCE_KEY]: "permitted" } }),
      ],
    });
    const result = await matchRoadAnchors({ anchors: [...ANCHORS] }, { provider });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.match.accessEvidence.status).toBe("known");
    expect(result.match.accessEvidence.value).toBe("motorcycle");
    expect(result.match.accessEvidence.provenance[0]?.id).toBe("stub-router");
  });

  it("never promotes an unrelated metadata value into an access claim", async () => {
    const provider = stubProvider({
      candidates: [candidate({ providerMetadata: { surface: "asphalt" } })],
    });
    const result = await matchRoadAnchors({ anchors: [...ANCHORS] }, { provider });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.match.accessEvidence.status).toBe("unknown");
    expect(result.match.accessEvidence.value).toBeNull();
  });
});

describe("matchRoadAnchors — validation and provider failure", () => {
  it("rejects fewer than two anchors before any provider work", async () => {
    const provider = stubProvider({ candidates: [candidate()] });
    const result = await matchRoadAnchors({ anchors: [ANCHORS[0]] }, { provider });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
    expect(provider.calls).toBe(0);
  });

  it("rejects more than the bounded anchor count", async () => {
    const provider = stubProvider({ candidates: [candidate()] });
    const anchors = Array.from({ length: 9 }, (_, index) => metres(index * 10, 0));
    const result = await matchRoadAnchors({ anchors }, { provider });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
    expect(provider.calls).toBe(0);
  });

  it("rejects a non-finite or out-of-range coordinate", async () => {
    const provider = stubProvider({ candidates: [candidate()] });
    const bad = [
      { anchors: [{ lon: Number.NaN, lat: 40 }] },
      { anchors: [ANCHORS[0], { lon: 200, lat: 40 }] },
      { anchors: [ANCHORS[0], { lon: -75, lat: 95 }] },
      { anchors: "not an array" },
    ];
    for (const input of bad) {
      const result = await matchRoadAnchors(input, { provider });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("validation");
    }
    expect(provider.calls).toBe(0);
  });

  it("normalizes a router rejection into the error object, never raw provider text", async () => {
    const provider = stubProvider({
      reject: new GraphHopperProviderError(
        "No route was found for this trip.",
        "no-route",
        { providerDetail: "GH internal stack trace" },
      ),
    });
    const result = await matchRoadAnchors({ anchors: [...ANCHORS] }, { provider });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no-route");
    expect(result.error.message).not.toContain("GH internal");
  });

  it("reports no-match when the provider returned no candidate at all", async () => {
    const provider = stubProvider({ candidates: [] });
    const result = await matchRoadAnchors({ anchors: [...ANCHORS] }, { provider });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no-match");
  });

  it("refuses a candidate whose metrics are not usable measurements", async () => {
    const provider = stubProvider({
      candidates: [candidate({ distanceMeters: Number.NaN })],
    });
    const result = await matchRoadAnchors({ anchors: [...ANCHORS] }, { provider });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("provider-unavailable");
  });
});
