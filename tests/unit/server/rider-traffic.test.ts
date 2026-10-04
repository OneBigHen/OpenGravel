import { afterEach, describe, expect, it, vi } from "vitest";
import { riderTrafficSampler } from "@/server/planning/rider-traffic";
import type { ProviderCandidate } from "@/application/planner/route-provider";
afterEach(() => vi.unstubAllGlobals());
describe("bounded cached rider flow sampling", () => {
  it("uses at most eight calls and caches repeated samples", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ flowSegmentData: { currentSpeed: 20, freeFlowSpeed: 50, currentTravelTime: 120, freeFlowTravelTime: 60, coordinates: { coordinate: [{ latitude: 40, longitude: -75 }, { latitude: 40.01, longitude: -75 }] } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const candidate: ProviderCandidate = { providerId: "test", profile: "test", durationSeconds: 600, distanceMeters: 2000, geometry: Array.from({ length: 20 }, (_, index) => ({ lat: 40 + index / 1000, lon: -75 })) };
    const sample = riderTrafficSampler({ TOMTOM_API_KEY: "fixture-rider-sampler" });
    const signal = new AbortController().signal;
    expect(await sample(candidate, signal)).toHaveLength(8);
    expect(fetcher).toHaveBeenCalledTimes(8);
    await sample(candidate, signal);
    expect(fetcher).toHaveBeenCalledTimes(8);
  });
  it("does not spend calls without a configured key", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const sample = riderTrafficSampler({});
    expect(await sample({ providerId: "test", profile: "test", durationSeconds: 600, distanceMeters: 1000, geometry: [{ lat: 40, lon: -75 }, { lat: 41, lon: -75 }] }, new AbortController().signal)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
