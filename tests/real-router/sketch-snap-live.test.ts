/** Optional live-router check for a route supplied by the developer. */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildSketchCorridor, corridorLengthMeters } from "@/application/planner/sketch-corridor";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import { MAX_PROVIDER_SKETCH_CORRIDOR_POINTS } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import { resampleSketchCorridor, routeShareNearLine, shapeAwareSketchAnchors, sketchStraySections } from "@/domain/sketch/snap";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { MAX_SKETCH_REQUEST_ANCHORS } from "@/domain/sketch/types";

interface RouteFixture {
  readonly stroke: readonly Coordinate[];
  readonly road: readonly Coordinate[];
}

const BASE_URL = process.env.GRAPHHOPPER_URL ?? "http://127.0.0.1:8989";
const FIXTURE_PATH = process.env.OGV_SKETCH_ROUTE_FIXTURE?.trim();
const fixture: RouteFixture | null = FIXTURE_PATH
  ? JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as RouteFixture
  : null;

async function routerIsReachable(): Promise<boolean> {
  try {
    return (await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1_500) })).ok;
  } catch {
    return false;
  }
}

const reachable = await routerIsReachable();
const live = reachable && fixture !== null ? describe : describe.skip;

function requestFor(profile: string, routeFixture: RouteFixture): ProviderRouteRequest {
  const derived = buildSketchCorridor([routeFixture.stroke]);
  const corridor = derived.corridor;
  const template: ProviderRouteRequest = {
    requestId: `req_live_sketch_${profile}`,
    origin: corridor[0]!,
    destination: corridor.at(-1)!,
    stops: [],
    shaping: [],
    profile,
    avoidPolygons: [],
    sketch: {
      anchors: shapeAwareSketchAnchors(corridor, { maxAnchors: MAX_SKETCH_REQUEST_ANCHORS }).map((anchor) => anchor.at),
      corridor: resampleSketchCorridor(corridor, MAX_PROVIDER_SKETCH_CORRIDOR_POINTS),
      endpointPolicy: "derive",
      nearLoop: derived.nearLoop,
      topologyHints: derived.topologyHints,
      derivedEndpoints: derived.derivedEndpoints,
    },
    options: {
      includeAlternatives: false,
      avoidHighways: false,
      tollPolicy: "allow-with-warning",
      vehicle: "motorcycle",
    },
  };
  return template;
}

live(`live sketch snapping (${BASE_URL})`, () => {
  it.each(["motorcycle_twisty", "motorcycle_fastest", "motorcycle_scenic", "motorcycle_adventure"])(
    "%s follows the supplied stroke",
    async (profile) => {
      const currentFixture = fixture!;
      const provider = createGraphHopperProvider({ baseUrl: BASE_URL });
      const started = Date.now();
      const result = await provider.candidates(requestFor(profile, currentFixture), new AbortController().signal);
      const elapsed = Date.now() - started;
      const route = result.candidates[0]?.geometry ?? [];

      const nearStroke = routeShareNearLine(route, currentFixture.stroke, 100);
      const onRoad = routeShareNearLine(route, currentFixture.road, 15);
      const strayed = sketchStraySections(route, currentFixture.stroke);
      const ratio = corridorLengthMeters(route) / corridorLengthMeters(currentFixture.stroke);
      console.log(
        `SKETCH ${profile} ms=${elapsed} nearStroke100=${nearStroke.toFixed(3)} ` +
          `onRoad15=${onRoad.toFixed(3)} lengthRatio=${ratio.toFixed(3)} straySections=${strayed.length}`,
      );
      expect(nearStroke).toBeGreaterThanOrEqual(0.95);
      expect(ratio).toBeLessThan(1.15);
      expect(elapsed).toBeLessThan(5_000);
    },
  );
});
