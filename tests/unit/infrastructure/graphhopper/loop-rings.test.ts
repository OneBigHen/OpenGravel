import { describe, expect, it } from "vitest";

import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import { planLoopRings, type RingAnchor } from "@/application/planner/loop-skeletons";
import { createGraphHopperProvider, type LoopRingMaker } from "@/infrastructure/routing/graphhopper/provider";

const START = { lon: -75.1064, lat: 40.1749 };
const REQUEST: ProviderRouteRequest = {
  requestId: "req_ring", origin: START, destination: START, stops: [], shaping: [], profile: "motorcycle_twisty", avoidPolygons: [],
  options: { includeAlternatives: false, avoidHighways: false, tollPolicy: "allow-with-warning", vehicle: "motorcycle", bike: { category: "street", maintainedGravel: "allow", roughTracks: "avoid" } },
  discovery: { targetMinutes: 120, toleranceMinutes: 18 },
};

const anchors: RingAnchor[] = [];
for (let dy = -0.3; dy <= 0.3; dy += 0.03) for (let dx = -0.4; dx <= 0.4; dx += 0.04) {
  anchors.push({ id: `a${anchors.length}`, lat: START.lat + dy, lon: START.lon + dx, quality: 0.5, lengthMeters: 3000 });
}
const maker: LoopRingMaker = (request, importDate, scales) =>
  importDate === "D1" ? planLoopRings({ start: request.origin, loopMeters: 100_000, seedKey: "s", anchors }, scales) : [];

function stub(timeMs: number): { bodies: Record<string, unknown>[]; fetcher: typeof fetch } {
  const bodies: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/info")) {
      return new Response(JSON.stringify({ import_date: "D1", encoded_values: { og_through: [], og_through_street: [] } }), { status: 200 });
    }
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({
      info: { version: "11.0" },
      paths: [{ distance: 90_000, time: timeMs, points: { type: "LineString", coordinates: [[START.lon, START.lat], [START.lon + 0.2, START.lat + 0.1], [START.lon, START.lat]] }, instructions: [] }],
    }), { status: 200 });
  };
  return { bodies, fetcher };
}

describe("loop rings in the provider", () => {
  it("routes each ring as one request through its anchors, with the dead-end rule, with at most six rings and six corrections", async () => {
    const { bodies, fetcher } = stub(60 * 60_000); // half the asked time: forces corrections
    const provider = createGraphHopperProvider({ baseUrl: "http://x", fetcher, loopRings: maker });
    const set = await provider.candidates(REQUEST, new AbortController().signal);
    expect(set.candidates.length).toBeGreaterThanOrEqual(3);
    const rings = bodies.filter((b) => b["algorithm"] !== "round_trip");
    expect(rings.length).toBeLessThanOrEqual(12);
    for (const ring of rings) {
      expect(ring["pass_through"]).toBe(true);
      const points = ring["points"] as number[][];
      expect(points.length).toBeGreaterThanOrEqual(4);
      expect(points[0]).toEqual(points[points.length - 1]);
      expect(JSON.stringify(ring["custom_model"])).toContain("!og_through_street");
    }
  });

  it("the first answer is ring one alone", async () => {
    const { bodies, fetcher } = stub(120 * 60_000);
    const provider = createGraphHopperProvider({ baseUrl: "http://x", fetcher, loopRings: maker });
    const set = await provider.candidates({ ...REQUEST, discovery: { ...REQUEST.discovery!, firstAnswer: true } }, new AbortController().signal);
    expect(set.candidates).toHaveLength(1);
    expect(bodies).toHaveLength(1);
  });

  it("a table for another map gives the engine's own loop with no error", async () => {
    const { bodies, fetcher } = stub(120 * 60_000);
    const other: LoopRingMaker = () => [];
    const provider = createGraphHopperProvider({ baseUrl: "http://x", fetcher, loopRings: other });
    const set = await provider.candidates(REQUEST, new AbortController().signal);
    expect(set.candidates.length).toBeGreaterThan(0);
    expect(bodies.every((b) => b["algorithm"] === "round_trip")).toBe(true);
  });
});
