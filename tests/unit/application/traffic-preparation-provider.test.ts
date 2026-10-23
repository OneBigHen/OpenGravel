import { describe, expect, it } from "vitest";

import { createTomTomTrafficPreparationProvider } from "@/application/preparation/traffic-provider";
import type { RoutePreparationContext } from "@/application/preparation/prepare-route";
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
    id: "synthetic-segment",
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
    segments: [segment()],
    ...overrides,
  };
}

function provider(body: unknown): ReturnType<typeof createTomTomTrafficPreparationProvider> {
  return createTomTomTrafficPreparationProvider({
    fetcher: async () => Response.json(body),
  });
}

describe("traffic preparation provider closures", () => {
  it("surfaces a reported closure instead of claiming no traffic delays", async () => {
    const closed = traffic({
      segments: [segment({ id: "closed", speedClass: "closed", roadClosure: true, delaySeconds: 0 })],
    });
    const result = await provider({ traffic: closed }).refresh(context);

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
        segment({ id: "delayed", delaySeconds: 600 }),
        segment({ id: "closed", geometry: [CORRIDOR[1], CORRIDOR[2]], speedClass: "closed", roadClosure: true, delaySeconds: 0 }),
      ],
    });
    const result = await provider({ traffic: mixed }).refresh(context);

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
      segments: [segment({ id: "closed", speedClass: "closed", roadClosure: true, delaySeconds: 0 })],
    });
    const result = await provider({ traffic: stale }).refresh(context);

    expect(result.data?.roadClosure).toBe(true);
    expect(result.data?.display.toLowerCase()).toContain("closure");
    expect(result.data?.freshnessLabel).toBe("Stale");
  });

  it("still reports ordinary delays as a delay band", async () => {
    const result = await provider({ traffic: traffic() }).refresh(context);

    expect(result.state).toBe("ready");
    expect(result.data?.roadClosure).toBeUndefined();
    expect(result.data?.display).toMatch(/(No traffic delays|\+\d+(–\d+)? min in traffic)/);
  });
});
