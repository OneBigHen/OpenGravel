import { describe, expect, it } from "vitest";

import {
  matchCorridor,
  protectTheRideCost,
  type TrafficResponse,
} from "@/application/traffic";

const ROUTE = [
  { lon: -75.1, lat: 40.1 },
  { lon: -75.09, lat: 40.11 },
  { lon: -75.08, lat: 40.12 },
] as const;

// Synthetic fixture: these segments are hand-built for deterministic unit
// coverage. They are not real traffic observations and must never be presented
// as live traffic in a UI or report.
function syntheticTraffic(overrides: Partial<TrafficResponse> = {}): TrafficResponse {
  return {
    availability: "available",
    label: "Synthetic traffic fixture",
    reason: null,
    provenance: "Synthetic fixture only",
    departureApplicability: "current",
    freshness: {
      status: "fresh",
      fetchedAt: "2026-09-17T14:00:00.000Z",
      validUntil: "2026-09-17T14:01:00.000Z",
      departureTime: "2026-09-17T14:00:00.000Z",
    },
    segments: [
      {
        id: "synthetic-segment-b",
        geometry: [ROUTE[1], ROUTE[2]],
        speedClass: "slow",
        delaySeconds: 120,
        currentSpeed: 35,
        freeFlowSpeed: 45,
        confidence: 0.8,
        roadClosure: false,
        observedAt: "2026-09-17T14:00:00.000Z",
      },
      {
        id: "synthetic-segment-a",
        geometry: [ROUTE[0], ROUTE[1]],
        speedClass: "congested",
        delaySeconds: 480,
        currentSpeed: 20,
        freeFlowSpeed: 50,
        confidence: 0.7,
        roadClosure: false,
        observedAt: "2026-09-17T14:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("traffic application boundary", () => {
  it("matches synthetic traffic to route segments independent of provider order", () => {
    const response = syntheticTraffic();
    const first = matchCorridor(ROUTE, response);
    const second = matchCorridor(ROUTE, {
      ...response,
      segments: [...response.segments].reverse(),
    });

    expect(first.segmentMatches.map((match) => match.trafficSegmentId)).toEqual([
      "synthetic-segment-a",
      "synthetic-segment-b",
    ]);
    expect(second.segmentMatches).toEqual(first.segmentMatches);
    expect(first.coverageRatio).toBe(1);
  });

  it("keeps unavailable traffic unknown and leaves the existing cost unchanged", () => {
    const cost = protectTheRideCost({
      availability: "unavailable",
      label: "Traffic unknown",
      reason: "No API key configured.",
      provenance: "TomTom Traffic API",
      departureApplicability: "unknown",
      freshness: {
        status: "unknown",
        fetchedAt: null,
        validUntil: null,
        departureTime: "2026-09-17T14:00:00.000Z",
      },
      segments: [],
    });

    expect(cost).toMatchObject({
      status: "unknown",
      normalizedCost: null,
      delayBand: null,
      label: "Traffic unknown",
      applied: false,
    });
  });

  it("turns available synthetic delay into an uncertain band and a usable score term", () => {
    const cost = protectTheRideCost(syntheticTraffic());

    expect(cost.status).toBe("known");
    expect(cost.applied).toBe(true);
    expect(cost.normalizedCost).toBeGreaterThan(0);
    expect(cost.delayBand?.maxMinutes).toBeGreaterThanOrEqual(cost.delayBand?.minMinutes ?? 0);
    expect(cost.label).toMatch(/^(No traffic delays|\+\d+(–\d+)? min in traffic)$/);
    expect(cost.label).not.toContain("Synthetic");
  });

  it("does not turn missing delay estimates into a false all-clear zero", () => {
    const response = syntheticTraffic({
      segments: syntheticTraffic().segments.map((segment) => ({
        ...segment,
        delaySeconds: null,
      })),
    });

    expect(protectTheRideCost(response)).toMatchObject({
      status: "unknown",
      applied: false,
      normalizedCost: null,
      delayBand: null,
      label: "Traffic unknown",
    });
  });
});

describe("traffic band copy (M4)", () => {
  it("says no delay plainly and names a band in minutes", async () => {
    const { trafficBandLabel } = await import("@/application/traffic/protect-ride-cost");
    expect(trafficBandLabel(0, 0)).toBe("No traffic delays");
    expect(trafficBandLabel(4, 4)).toBe("+4 min in traffic");
    expect(trafficBandLabel(3, 7)).toBe("+3–7 min in traffic");
  });
});
