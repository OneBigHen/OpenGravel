/**
 * The heading-up ride camera (DV-10): the camera a mounted phone wants, the way
 * Google Maps and Calimoto navigate.
 *
 * - **Heading-up with a tilt.** The road ahead points up the screen. The bearing
 *   is the rider's GPS course while they move fast enough for it to mean
 *   something, else the route's own direction where the rider is, else the
 *   last bearing the camera had (a stopped rider's compass noise must not spin
 *   the map).
 * - **Zoom follows speed and the next turn.** Town speeds see the street, open
 *   road sees further ahead, and an upcoming turn zooms in to show it.
 *
 * Pure, so the rules are tested without a renderer.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

export interface RideCamera {
  readonly center: Coordinate;
  /** Degrees clockwise from north; `null` keeps the bearing the map has. */
  readonly bearing: number | null;
  readonly zoom: number;
  readonly pitch: number;
}

export interface RideCameraInput {
  readonly position: Coordinate;
  /** The GPS course, or `null` when the fix did not report one. */
  readonly headingDegrees: number | null;
  readonly speedMps: number | null;
  /** The line being followed; empty in Free Ride. */
  readonly routeLine: readonly Coordinate[];
  /** Metres to the next maneuver, or `null` when there is none. */
  readonly maneuverMeters: number | null;
  /** The bearing the camera had, kept when nothing better is known. */
  readonly previousBearing: number | null;
}

/** The tilt: a 3-D look that software renderers and older phones still draw fast; 55°+ loaded far tiles too slowly. */
export const RIDE_CAMERA_PITCH = 50;

/** Below this speed a GPS course is noise (a walking pace). */
const COURSE_MIN_SPEED_MPS = 2.5;
/** How far ahead the route's own direction is read. */
const ROUTE_LOOKAHEAD_METERS = 60;
/** Further than this from the line, its direction says nothing about the rider. */
const ROUTE_NEAR_METERS = 80;
/** Close enough to a turn to zoom in on it. */
const TURN_ZOOM_METERS = 250;

/** `zoom` for a speed: street level in town, further ahead on open road. */
export function zoomForSpeed(speedMps: number | null): number {
  if (speedMps === null || !Number.isFinite(speedMps)) return 16;
  if (speedMps < 9) return 16.6; // under 20 mph
  if (speedMps < 16) return 16; // under 36 mph
  if (speedMps < 24) return 15.4; // under 54 mph
  return 14.8;
}

/** Initial bearing from `from` to `to`, degrees clockwise from north. */
export function bearingBetween(from: Coordinate, to: Coordinate): number {
  const toRad = Math.PI / 180;
  const lat1 = from.lat * toRad;
  const lat2 = to.lat * toRad;
  const dLon = (to.lon - from.lon) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) / toRad) + 360) % 360;
}

/** Nearest point on segment `a→b` to `p`, in a local flat projection. */
function nearestOnSegment(p: Coordinate, a: Coordinate, b: Coordinate): { point: Coordinate; t: number } {
  const scale = Math.cos((p.lat * Math.PI) / 180);
  const ax = a.lon * scale;
  const bx = b.lon * scale;
  const px = p.lon * scale;
  const dx = bx - ax;
  const dy = b.lat - a.lat;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (p.lat - a.lat) * dy) / lengthSquared));
  return { point: { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t }, t };
}

/** Where the rider is nearest the line: the segment index, the point and how far. */
export function nearestOnLine(
  line: readonly Coordinate[],
  position: Coordinate,
): { readonly index: number; readonly point: Coordinate; readonly meters: number } | null {
  let best: { index: number; point: Coordinate; meters: number } | null = null;
  for (let index = 0; index + 1 < line.length; index += 1) {
    const a = line[index];
    const b = line[index + 1];
    if (a === undefined || b === undefined) continue;
    const { point } = nearestOnSegment(position, a, b);
    const meters = haversine(position, point);
    if (best === null || meters < best.meters) best = { index, point, meters };
  }
  return best;
}

/** The route's direction just ahead of the rider, or `null` when they are off it. */
export function routeBearingAt(line: readonly Coordinate[], position: Coordinate): number | null {
  const nearest = nearestOnLine(line, position);
  if (nearest === null || nearest.meters > ROUTE_NEAR_METERS) return null;
  let travelled = 0;
  let from = nearest.point;
  for (let index = nearest.index + 1; index < line.length; index += 1) {
    const next = line[index];
    if (next === undefined) break;
    travelled += haversine(from, next);
    from = next;
    if (travelled >= ROUTE_LOOKAHEAD_METERS) break;
  }
  if (travelled < 1) return null;
  return bearingBetween(nearest.point, from);
}

export function rideCameraFor(input: RideCameraInput): RideCamera {
  const moving = input.speedMps !== null && input.speedMps >= COURSE_MIN_SPEED_MPS;
  const course = moving && input.headingDegrees !== null && Number.isFinite(input.headingDegrees)
    ? ((input.headingDegrees % 360) + 360) % 360
    : null;
  const bearing = course ?? routeBearingAt(input.routeLine, input.position) ?? input.previousBearing;
  let zoom = zoomForSpeed(input.speedMps);
  if (input.maneuverMeters !== null && input.maneuverMeters < TURN_ZOOM_METERS) zoom = Math.max(zoom, 16.8);
  return { center: input.position, bearing, zoom, pitch: RIDE_CAMERA_PITCH };
}
