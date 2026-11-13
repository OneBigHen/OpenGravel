/**
 * Live check of the owner's 2026-11-13 drawing in Hatboro, PA: a wobbly
 * finger-drawn loop round the town must snap to roads without out-and-back
 * spurs (the "zigzag onto side streets" in his screenshot). Skips when no local
 * GraphHopper answers.
 */

import { describe, expect, it } from "vitest";

import { buildSketchCorridor } from "@/application/planner/sketch-corridor";
import { MAX_PROVIDER_SKETCH_CORRIDOR_POINTS, type ProviderRouteRequest } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import { haversine } from "@/domain/geometry/analysis";
import { cumulativeMeters, pointAlong, resampleSketchCorridor, shapeAwareSketchAnchors } from "@/domain/sketch/snap";
import { MAX_SKETCH_REQUEST_ANCHORS } from "@/domain/sketch/types";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";

const BASE_URL = process.env.GRAPHHOPPER_URL ?? "http://127.0.0.1:8989";

async function routerIsReachable(): Promise<boolean> {
  try {
    return (await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1_500) })).ok;
  } catch {
    return false;
  }
}
const live = (await routerIsReachable()) ? describe : describe.skip;

/** The loop the owner drew round Hatboro, as a finger would: corners cut, a wobble every few meters. */
const CORNERS: readonly Coordinate[] = [
  { lat: 40.1825, lon: -75.1030 },
  { lat: 40.1760, lon: -75.0905 },
  { lat: 40.1650, lon: -75.0880 },
  { lat: 40.1625, lon: -75.1000 },
  { lat: 40.1640, lon: -75.1160 },
  { lat: 40.1760, lon: -75.1175 },
  { lat: 40.1820, lon: -75.1080 },
];
function wobblyStroke(): Coordinate[] {
  const out: Coordinate[] = [];
  let k = 0;
  for (let i = 0; i < CORNERS.length - 1; i += 1) {
    const a = CORNERS[i]!;
    const b = CORNERS[i + 1]!;
    const steps = Math.ceil(haversine(a, b) / 12);
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      const wobble = Math.sin(k / 3) * 0.00025; // about 25 m either side
      out.push({ lat: a.lat + (b.lat - a.lat) * t + wobble, lon: a.lon + (b.lon - a.lon) * t - wobble });
      k += 1;
    }
  }
  out.push(CORNERS.at(-1)!);
  return out;
}

/** Places where the route rides out and straight back the same way. */
function spurTips(route: readonly Coordinate[]): number {
  const cumulative = cumulativeMeters(route);
  const total = cumulative.at(-1) ?? 0;
  let tips = 0;
  let lastTip = -Infinity;
  for (let index = 1; index < route.length - 1; index += 1) {
    const at = cumulative[index]!;
    if (at < 25 || total - at < 25 || at - lastTip < 100) continue;
    const before = pointAlong(route, cumulative, at - 25);
    const after = pointAlong(route, cumulative, at + 25);
    if (haversine(before, after) <= 8) {
      tips += 1;
      lastTip = at;
    }
  }
  return tips;
}

live(`Hatboro drawing (${BASE_URL})`, () => {
  it("snaps to roads with no out-and-back spurs", async () => {
    const derived = buildSketchCorridor([wobblyStroke()]);
    const corridor = derived.corridor;
    const request: ProviderRouteRequest = {
      requestId: "req_live_hatboro_drawing",
      origin: corridor[0]!,
      destination: corridor.at(-1)!,
      stops: [],
      shaping: [],
      profile: "motorcycle_twisty",
      avoidPolygons: [],
      sketch: {
        anchors: shapeAwareSketchAnchors(corridor, { maxAnchors: MAX_SKETCH_REQUEST_ANCHORS }).map((anchor) => anchor.at),
        corridor: resampleSketchCorridor(corridor, MAX_PROVIDER_SKETCH_CORRIDOR_POINTS),
        endpointPolicy: "derive",
        nearLoop: derived.nearLoop,
        topologyHints: derived.topologyHints,
        derivedEndpoints: derived.derivedEndpoints,
      },
      options: { includeAlternatives: false, avoidHighways: false, tollPolicy: "allow-with-warning", vehicle: "motorcycle" },
    };
    const provider = createGraphHopperProvider({ baseUrl: BASE_URL });
    const result = await provider.candidates(request, new AbortController().signal);
    const route = result.candidates[0]?.geometry ?? [];
    const spurs = spurTips(route);
    console.log(`HATBORO drawing: ${route.length} points, ${(cumulativeMeters(route).at(-1)! / 1609.344).toFixed(1)} mi, spurs=${spurs}`);
    expect(route.length).toBeGreaterThan(10);
    expect(spurs).toBe(0);
  });
});
