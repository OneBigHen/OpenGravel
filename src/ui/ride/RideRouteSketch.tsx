/**
 * The finish card's route sketch (08 §13): the line the rider just rode, drawn
 * inline from the route's own coordinates. No map, no tiles, no token — the
 * shape is the memory of the ride, and it survives a dead connection.
 *
 * The ridden part of the line is Ember, the rest Topo Sage at 45%; the split is
 * drawn only when the engine reported how far along the route the rider got.
 * Without that fraction the sketch still shows the route, in the muted stroke
 * the split's own "still to ride" half uses, so it claims nothing about how much
 * was covered.
 */

import type { Coordinate } from "@/domain/ride/types";
import {
  projectTrackPoints,
  toPolylinePoints,
  type ProjectedPoint,
  type TrackProjectionBox,
} from "@/ui/rides/track-projection";

/** 320×120 with 10 px of padding; a 4 px line and 6 px dots read at arm's length. */
export const RIDE_SKETCH_BOX: TrackProjectionBox = { width: 320, height: 120, padding: 10 };

/** Half the start/finish dot: 6 px across in the box's own units. */
const DOT_RADIUS = 3;

export interface RiddenLineSplit {
  /** The line from the start to where the rider stopped, as the line's own coordinates. */
  readonly travelled: readonly Coordinate[];
  /** That point to the route's end. */
  readonly remaining: readonly Coordinate[];
}

/**
 * Equirectangular segment length in degrees, scaled by the cosine of the
 * segment's mean latitude. Only the *proportion* of the line matters for the
 * split, so this is enough and stays free of a geodesy dependency.
 */
function segmentLength(a: Coordinate, b: Coordinate): number {
  const meanLatitude = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const east = (b.lon - a.lon) * Math.cos(meanLatitude);
  const north = b.lat - a.lat;
  return Math.hypot(east, north);
}

/**
 * Splits the line at `fraction` of its own length, interpolating the boundary
 * point so the two halves meet exactly. `null` when there is no honest split to
 * make: an unknown fraction, a line too short to draw, or a line with no length.
 */
export function splitRiddenLine(
  coordinates: readonly Coordinate[],
  fraction: number | null,
): RiddenLineSplit | null {
  if (fraction === null || !Number.isFinite(fraction) || coordinates.length < 2) return null;
  const clamped = Math.min(1, Math.max(0, fraction));
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const length = segmentLength(coordinates[index - 1]!, coordinates[index]!);
    lengths.push(length);
    total += length;
  }
  if (total <= 0) return null;
  if (clamped <= 0) return { travelled: coordinates.slice(0, 1), remaining: [...coordinates] };
  const target = clamped * total;
  let walked = 0;
  let segment = 0;
  while (segment < lengths.length && walked + lengths[segment]! <= target) {
    walked += lengths[segment]!;
    segment += 1;
  }
  if (segment >= lengths.length) return { travelled: [...coordinates], remaining: [] };
  const from = coordinates[segment]!;
  const to = coordinates[segment + 1]!;
  const share = (target - walked) / lengths[segment]!;
  const split: Coordinate = {
    lon: from.lon + (to.lon - from.lon) * share,
    lat: from.lat + (to.lat - from.lat) * share,
  };
  return {
    travelled: [...coordinates.slice(0, segment + 1), split],
    remaining: [split, ...coordinates.slice(segment + 1)],
  };
}

/**
 * What a screen reader hears ("42 mi ridden, 72% along the route"). The route's
 * planned total is not on this surface, so the label names what is known
 * instead of inventing the "of 58" the sketch itself does not know.
 */
export function rideRouteSketchLabel(
  distanceText: string | null,
  fraction: number | null,
): string {
  const percent =
    fraction === null || !Number.isFinite(fraction)
      ? null
      : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  if (distanceText !== null && percent !== null) {
    return `Route sketch: ${distanceText} ridden, ${percent}% along the route.`;
  }
  if (distanceText !== null) return `Route sketch: ${distanceText} ridden.`;
  if (percent !== null) return `Route sketch: ${percent}% along the route.`;
  return "Route sketch of this ride's route.";
}

export interface RideRouteSketchProps {
  readonly routeLine: readonly Coordinate[];
  /** Progress along the line in `0..1` as the engine measured it; `null` = unknown. */
  readonly fraction: number | null;
  /** "42 mi", from the summary's own distance stat; `null` when it stated none. */
  readonly distanceText: string | null;
}

function dot(point: ProjectedPoint | undefined) {
  if (point === undefined) return null;
  return <circle className="og-ride__sketch-dot" cx={point.x.toFixed(1)} cy={point.y.toFixed(1)} r={DOT_RADIUS} />;
}

export function RideRouteSketch({ routeLine, fraction, distanceText }: RideRouteSketchProps) {
  const line = projectTrackPoints(routeLine, routeLine, RIDE_SKETCH_BOX);
  if (routeLine.length < 2 || line.length < 2) return null;
  const split = splitRiddenLine(routeLine, fraction);
  const travelled = split === null ? [] : projectTrackPoints(routeLine, split.travelled, RIDE_SKETCH_BOX);
  const remaining =
    split === null ? line : projectTrackPoints(routeLine, split.remaining, RIDE_SKETCH_BOX);
  return (
    <svg
      className="og-ride__sketch"
      viewBox={`0 0 ${RIDE_SKETCH_BOX.width} ${RIDE_SKETCH_BOX.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={rideRouteSketchLabel(distanceText, fraction)}
      data-testid="ride-route-sketch"
      data-split={split === null ? "unknown" : "known"}
    >
      {remaining.length < 2 ? null : (
        <polyline
          className="og-ride__sketch-line og-ride__sketch-line--remaining"
          points={toPolylinePoints(remaining)}
        />
      )}
      {travelled.length < 2 ? null : (
        <polyline
          className="og-ride__sketch-line og-ride__sketch-line--travelled"
          points={toPolylinePoints(travelled)}
        />
      )}
      {dot(line[0])}
      {dot(line[line.length - 1])}
    </svg>
  );
}
