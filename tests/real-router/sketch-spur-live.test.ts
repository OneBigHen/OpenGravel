/**
 * Live check of drawn routes round Hatboro, PA (owner, 2026-11-13: a drawn
 * route "zigzagged" into side streets and back). Each drawing is a real road
 * loop traced by a wobbly finger; the snapped route must stay on the drawn
 * roads and must not ride into a dead end and back that the drawing did not.
 * Skips when no local GraphHopper answers.
 */

import { describe, expect, it } from "vitest";

import { buildSketchCorridor } from "@/application/planner/sketch-corridor";
import { MAX_PROVIDER_SKETCH_CORRIDOR_POINTS, type ProviderRouteRequest } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import {
  cumulativeMeters,
  pointAlong,
  resampleSketchCorridor,
  routeShareNearLine,
  shapeAwareSketchAnchors,
  spurCount,
} from "@/domain/sketch/snap";
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

/** Three loops out of Hatboro the way a rider would draw them. */
const LOOPS: readonly (readonly Coordinate[])[] = [
  [{ lat: 40.179, lon: -75.1077 }, { lat: 40.164, lon: -75.1 }, { lat: 40.17, lon: -75.088 }, { lat: 40.183, lon: -75.095 }, { lat: 40.1795, lon: -75.107 }],
  [{ lat: 40.179, lon: -75.1077 }, { lat: 40.165, lon: -75.116 }, { lat: 40.156, lon: -75.105 }, { lat: 40.162, lon: -75.09 }, { lat: 40.1795, lon: -75.107 }],
  [{ lat: 40.179, lon: -75.1077 }, { lat: 40.195, lon: -75.115 }, { lat: 40.2, lon: -75.095 }, { lat: 40.185, lon: -75.09 }, { lat: 40.1795, lon: -75.107 }],
];

/** The roads under a loop, as the engine's fastest answer through its corners. */
async function roadsThrough(points: readonly Coordinate[]): Promise<Coordinate[]> {
  const response = await fetch(`${BASE_URL}/route`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profile: "motorcycle_fastest",
      points: points.map((point) => [point.lon, point.lat]),
      points_encoded: false,
      instructions: false,
    }),
  });
  const body = (await response.json()) as { paths: { points: { coordinates: [number, number][] } }[] };
  return body.paths[0]!.points.coordinates.map(([lon, lat]) => ({ lon, lat }));
}

/** A finger tracing `line`: a sample every 10 m, wobbling about 20 m either side. */
function fingerTrace(line: readonly Coordinate[]): Coordinate[] {
  const cumulative = cumulativeMeters(line);
  const total = cumulative.at(-1) ?? 0;
  const out: Coordinate[] = [];
  for (let along = 0, step = 0; along <= total; along += 10, step += 1) {
    const at = pointAlong(line, cumulative, along);
    const wobble = Math.sin(step / 4) * 0.00018;
    out.push({ lat: at.lat + wobble, lon: at.lon - wobble });
  }
  return out;
}

function sketchRequest(stroke: readonly Coordinate[]): ProviderRouteRequest {
  const derived = buildSketchCorridor([stroke]);
  const corridor = derived.corridor;
  return {
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
}

live(`Hatboro drawings (${BASE_URL})`, () => {
  it.each(LOOPS.map((loop, index) => [index, loop] as const))(
    "loop %i stays on the drawn roads and adds no out-and-back spur",
    async (index, loop) => {
      const drawnRoads = await roadsThrough(loop);
      const provider = createGraphHopperProvider({ baseUrl: BASE_URL });
      const result = await provider.candidates(sketchRequest(fingerTrace(drawnRoads)), new AbortController().signal);
      const route = result.candidates[0]?.geometry ?? [];
      const onRoads = routeShareNearLine(route, drawnRoads, 15);
      console.log(
        `HATBORO loop${index}: drawn ${((cumulativeMeters(drawnRoads).at(-1) ?? 0) / 1609.344).toFixed(2)} mi, ` +
          `route ${((cumulativeMeters(route).at(-1) ?? 0) / 1609.344).toFixed(2)} mi, on drawn roads ${onRoads.toFixed(3)}, ` +
          `spurs ${spurCount(route)} (drawn ${spurCount(drawnRoads)})`,
      );
      expect(onRoads).toBeGreaterThanOrEqual(0.75);
      expect(spurCount(route)).toBeLessThanOrEqual(spurCount(drawnRoads));
    },
  );
});
