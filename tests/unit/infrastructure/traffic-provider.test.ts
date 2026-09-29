import { describe, expect, it, vi } from "vitest";

import {
  createTomTomTrafficProvider,
  type TrafficProvider,
} from "@/infrastructure/traffic";

const DEPARTURE = "2026-09-17T14:00:00.000Z";
const CORRIDOR = [
  { lon: -75.1, lat: 40.1 },
  { lon: -75.09, lat: 40.11 },
] as const;

describe("traffic provider port and TomTom adapter", () => {
  it("keeps the port provider-shaped and reports missing credentials as unavailable", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider: TrafficProvider = createTomTomTrafficProvider({
      env: {},
      fetcher,
    });

    const result = await provider.getTraffic({
      corridor: CORRIDOR,
      departureTime: DEPARTURE,
    });

    expect(result.availability).toBe("unavailable");
    expect(result.segments).toEqual([]);
    // Missing credentials are an honest unknown, in the rider's words: the
    // configuration defect is not the rider's problem and the vendor's name is
    // not the rider's business (VNX-007 / Rule E).
    expect(result.reason).toBe("Traffic data is not available right now.");
    expect(result.reason).not.toMatch(/tomtom|api key|credential/i);
    expect(result.provenance).toBe("Live traffic feed");
    expect(result.label).toBe("Traffic unknown");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps the documented Flow Segment Data response without inventing clear traffic", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      flowSegmentData: {
        frc: "FRC2",
        currentSpeed: 41,
        freeFlowSpeed: 70,
        currentTravelTime: 153,
        freeFlowTravelTime: 90,
        confidence: 0.59,
        roadClosure: false,
        coordinates: {
          coordinate: [
            { latitude: 40.1, longitude: -75.1 },
            { latitude: 40.11, longitude: -75.09 },
          ],
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = createTomTomTrafficProvider({
      apiKey: "test-key",
      fetcher,
      now: () => DEPARTURE,
    });

    const result = await provider.getTraffic({
      corridor: CORRIDOR,
      waypoints: [CORRIDOR[0]],
      departureTime: DEPARTURE,
    });

    expect(result.availability).toBe("available");
    expect(result.segments).toMatchObject([{
      speedClass: "congested",
      delaySeconds: 63,
      currentSpeed: 41,
      freeFlowSpeed: 70,
      confidence: 0.59,
      roadClosure: false,
      geometry: CORRIDOR,
    }]);
    expect(result.freshness.status).toBe("fresh");
    expect(result.departureApplicability).toBe("current");

    const [url] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toContain("/traffic/services/4/flowSegmentData/absolute/10/json");
    expect(String(url)).toContain("point=40.1%2C-75.1");
    expect(String(url)).toContain("key=test-key");
  });

  it("keeps a future departure unknown because Flow Segment Data is current-only", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = createTomTomTrafficProvider({
      apiKey: "test-key",
      fetcher,
      now: () => DEPARTURE,
    });

    const result = await provider.getTraffic({
      corridor: CORRIDOR,
      departureTime: "2026-09-17T16:00:00.000Z",
    });

    expect(result.availability).toBe("unavailable");
    expect(result.departureApplicability).toBe("future-unavailable");
    expect(result.label).toBe("Traffic unknown");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
