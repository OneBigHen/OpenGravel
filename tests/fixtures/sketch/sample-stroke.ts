/** Synthetic 100 km switchback line used to exercise sketch simplification. */

import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import { buildSketchCorridor } from "@/application/planner/sketch-corridor";
import { MAX_PROVIDER_SKETCH_CORRIDOR_POINTS } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import { resampleSketchCorridor, shapeAwareSketchAnchors } from "@/domain/sketch/snap";
import { MAX_SKETCH_REQUEST_ANCHORS } from "@/domain/sketch/types";

const ORIGIN = { lon: 0, lat: 0 };
const METERS_PER_DEGREE = 1 / 111_320;
const LEG_COUNT = 12;
const LEG_METERS = 8_000;
const HEIGHT_METERS = 350;
const POINT_COUNT = 1_000;

function pointAt(distanceMeters: number): Coordinate {
  const leg = Math.min(LEG_COUNT - 1, Math.floor(distanceMeters / LEG_METERS));
  const along = Math.min(1, (distanceMeters - leg * LEG_METERS) / LEG_METERS);
  const xMeters = (leg % 2 === 0 ? along : 1 - along) * LEG_METERS;
  const yMeters = leg * HEIGHT_METERS;
  return {
    lon: ORIGIN.lon + xMeters * METERS_PER_DEGREE,
    lat: ORIGIN.lat + yMeters * METERS_PER_DEGREE,
  };
}

/** An invented line, generated at test time; no recorded ride points are stored. */
export const SAMPLE_STROKE: readonly Coordinate[] = Array.from({ length: POINT_COUNT }, (_value, index) =>
  pointAt((LEG_COUNT * LEG_METERS * index) / (POINT_COUNT - 1)),
);

/** A thinner synthetic line used to check proximity calculations. */
export const SAMPLE_ROAD: readonly Coordinate[] = SAMPLE_STROKE.filter(
  (_point, index) => index % 10 === 0 || index === SAMPLE_STROKE.length - 1,
);

/** A provider-neutral request derived from the synthetic drawing. */
export function sampleSketchRequest(profile: string): ProviderRouteRequest {
  const derived = buildSketchCorridor([SAMPLE_STROKE]);
  const corridor = derived.corridor;
  return {
    requestId: `req_sketch_sample_${profile}`,
    origin: corridor[0] as Coordinate,
    destination: corridor.at(-1) as Coordinate,
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
}
