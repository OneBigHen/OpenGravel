import { describe, expect, it } from "vitest";

import { createTomTomTrafficPreparationProvider } from "@/application/preparation/traffic-provider";
import type { RoutePreparationContext } from "@/application/preparation/prepare-route";
import type { CorridorMatch } from "@/application/traffic";
import type { TrafficResponse, TrafficSegment } from "@/infrastructure/traffic";

const CORRIDOR = [
  { lon: -75.1, lat: 40.1 },
  { lon: -75.09, lat: 40.11 },
  { lon: -75.08, lat: 40.12 },
] as const;

const context: RoutePreparationContext = {
  trafficCorridor: CORRIDOR,
  departure: "2026-09-17T14:00:00.000Z",
  rideDurationMinutes: 60,
};

// Synthetic fixture: hand-built for deterministic unit coverage, never a real
// traffic observation and never presentable as live traffic.
function segment(overrides: Partial<TrafficSegment> = {}): TrafficSegment {
  return {
    id: "synthetic-segment-a",
    geometry: [CORRIDOR[0], CORRIDOR[1]],
    speedClass: "congested",
    delaySeconds: 300,
    currentSpeed: 20,
    freeFlowSpeed: 50,
    confidence: 0.8,
    roadClosure: false,
    observedAt: "2026-09-17T14:00:00.000Z",
    ...overrides,
  };
}

function traffic(overrides: Partial<TrafficResponse> = {}): TrafficResponse {
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
      segment(),
      segment({ id: "synthetic-segment-b", geometry: [CORRIDOR[1], CORRIDOR[2]] }),
    ],
    ...overrides,
  };
}

/** Both route segments of the synthetic corridor are covered. */
function fullMatch(overrides: Partial<CorridorMatch> = {}): CorridorMatch {
  return {
    segmentMatches: [],
    matchedTrafficSegmentIds: ["synthetic-segment-a", "synthetic-segment-b"],
    unmatchedTrafficSegmentIds: [],
    coverageRatio: 1,
    ...overrides,
  };
}

function provider(body: unknown): ReturnType<typeof createTomTomTrafficPreparationProvider> {
  return createTomTomTrafficPreparationProvider({
    fetcher: async () => Response.json(body),
  });
}

describe("traffic preparation provider coverage", () => {
  it("keeps a full-coverage answer as matched traffic", async () => {
    const result = await provider({ traffic: traffic(), corridorMatch: fullMatch() }).refresh(context);

    expect(result.state).toBe("ready");
    expect(result.reason).toBe("Traffic matched to this route.");
    expect(result.data?.coverageRatio).toBe(1);
    expect(result.data?.display).not.toContain("part of route");
  });

  it("never claims a whole-route match from a one-segment answer on a long route", async () => {
    const oneSegment = traffic({ segments: [segment()] });
    const thinMatch = fullMatch({
      matchedTrafficSegmentIds: ["synthetic-segment-a"],
      unmatchedTrafficSegmentIds: [],
      coverageRatio: 1 / 127,
    });
    const result = await provider({ traffic: oneSegment, corridorMatch: thinMatch }).refresh(context);

    expect(result.state).toBe("unavailable");
    expect(result.reason).toBe("Traffic was checked for only part of this route.");
    expect(result.reason).not.toBe("Traffic matched to this route.");
    expect(result.data).toBeUndefined();
  });

  it("labels partial coverage honestly and sums only the matched segments", async () => {
    const unmatchedLongDelay = segment({
      id: "synthetic-segment-b",
      geometry: [CORRIDOR[1], CORRIDOR[2]],
      delaySeconds: 3_600,
    });
    const partialMatch = fullMatch({
      matchedTrafficSegmentIds: ["synthetic-segment-a"],
      unmatchedTrafficSegmentIds: ["synthetic-segment-b"],
      coverageRatio: 0.5,
    });
    const result = await provider({
      traffic: traffic({ segments: [segment(), unmatchedLongDelay] }),
      corridorMatch: partialMatch,
    }).refresh(context);

    expect(result.state).toBe("ready");
    expect(result.reason).toBe("Traffic was checked for part of this route; the rest is unknown.");
    expect(result.data?.display).toContain("part of route checked");
    expect(result.data?.coverageRatio).toBe(0.5);
    // The unmatched hour-long delay must not be added to the route's band.
    expect(result.data?.delayBand?.maxMinutes).toBeLessThan(30);
  });

  it("does not double-count a provider segment that appears twice", async () => {
    const duplicated = traffic({
      segments: [segment(), segment({ id: "synthetic-segment-a" })],
    });
    const duplicatedMatch = fullMatch({
      matchedTrafficSegmentIds: ["synthetic-segment-a", "synthetic-segment-a"],
      coverageRatio: 0.5,
    });
    const result = await provider({ traffic: duplicated, corridorMatch: duplicatedMatch }).refresh(context);

    expect(result.state).toBe("ready");
    expect(result.data?.delayBand?.maxMinutes).toBeLessThan(15);
  });

  it("treats a response without coverage as unchecked rather than matched", async () => {
    const result = await provider({ traffic: traffic() }).refresh(context);

    expect(result.state).toBe("unavailable");
    expect(result.reason).toBe("Traffic was checked for only part of this route.");
  });
});

describe("traffic preparation provider closures", () => {
  it("surfaces a reported closure instead of claiming no traffic delays", async () => {
    const closed = traffic({
      segments: [segment({ id: "synthetic-segment-a", speedClass: "closed", roadClosure: true, delaySeconds: 0 })],
    });
    const result = await provider({ traffic: closed, corridorMatch: fullMatch() }).refresh(context);

    expect(result.state).toBe("ready");
    expect(result.data?.roadClosure).toBe(true);
    expect(result.data?.delayBand).toBeNull();
    expect(result.data?.display).not.toBe("No traffic delays");
    expect(result.data?.display.toLowerCase()).toContain("closure");
    expect(result.reason.toLowerCase()).toContain("closure");
  });

  it("keeps a closure visible even when another segment reports a delay", async () => {
    const mixed = traffic({
      segments: [
        segment({ id: "synthetic-segment-a", delaySeconds: 600 }),
        segment({ id: "synthetic-segment-b", geometry: [CORRIDOR[1], CORRIDOR[2]], speedClass: "closed", roadClosure: true, delaySeconds: 0 }),
      ],
    });
    const result = await provider({ traffic: mixed, corridorMatch: fullMatch() }).refresh(context);

    expect(result.state).toBe("ready");
    expect(result.data?.roadClosure).toBe(true);
    expect(result.data?.display.toLowerCase()).toContain("closure");
  });

  it("keeps a closure from an aged answer rather than turning it into an all-clear", async () => {
    const stale = traffic({
      freshness: {
        status: "stale",
        fetchedAt: "2026-09-17T12:00:00.000Z",
        validUntil: "2026-09-17T12:01:00.000Z",
        departureTime: "2026-09-17T14:00:00.000Z",
      },
      segments: [segment({ id: "synthetic-segment-a", speedClass: "closed", roadClosure: true, delaySeconds: 0 })],
    });
    const result = await provider({ traffic: stale, corridorMatch: fullMatch() }).refresh(context);

    expect(result.data?.roadClosure).toBe(true);
    expect(result.data?.display.toLowerCase()).toContain("closure");
    expect(result.data?.freshnessLabel).toBe("Stale");
  });

  it("still reports ordinary delays as a delay band", async () => {
    const result = await provider({ traffic: traffic(), corridorMatch: fullMatch() }).refresh(context);

    expect(result.state).toBe("ready");
    expect(result.data?.roadClosure).toBeUndefined();
    expect(result.data?.display).toMatch(/(No traffic delays|\+\d+(–\d+)? min in traffic)/);
  });
});
