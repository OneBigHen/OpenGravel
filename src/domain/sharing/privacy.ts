import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { deepFreeze } from "@/domain/util/freeze";
import type { ShareRoute } from "./types";

/**
 * The one shared privacy implementation (10-SHARING-AND-OFFLINE §11).
 *
 * Every privacy rule lives here and only here: the preview and the published
 * link call the same function with the same settings, so what the rider saw is
 * by construction what a holder of the link gets.
 *
 * The four knobs:
 *
 * - `hideStart` / `hideFinish` hide a fixed {@link HIDE_ZONE_METERS} zone at
 *   that end (the default privacy zone around home/finish).
 * - `trimMetersFromEnds` hides exactly N meters from *both* ends, measured
 *   along the route's own geometry. The two hide zones and N compose additively.
 * - `blurCoordinates` rounds every shared coordinate to
 *   {@link COORDINATE_ROUNDING_DECIMALS} decimals (~100 m), applied after the
 *   trim so a precise cut is never undone by a sloppy one — and never made
 *   precise again by the blur.
 *
 * A trim is measured along the polyline. Segment gaps contribute no distance:
 * the distance between two disjoint segments is unknown, and unknown stays
 * unknown rather than being bridged with an invented number.
 */

/** The default privacy zone a `hide*` knob removes from that end (meters). */
export const HIDE_ZONE_METERS = 500;

/** Coordinate blur precision: 3 decimals ≈ 100 m at riding latitudes. */
export const COORDINATE_ROUNDING_DECIMALS = 3;

export interface PrivacyTrimSettings {
  readonly hideStart: boolean;
  readonly hideFinish: boolean;
  /** Meters hidden from both ends, on top of the hide zones. Finite, ≥ 0. */
  readonly trimMetersFromEnds: number;
  readonly blurCoordinates: boolean;
}

export class PrivacyTrimError extends Error {
  readonly code = "invalid-trim";

  constructor(message: string) {
    super(message);
    this.name = "PrivacyTrimError";
  }
}

/** Privacy-first defaults: both ends hidden and coordinates blurred. */
export function defaultPrivacyTrim(): PrivacyTrimSettings {
  return deepFreeze({
    hideStart: true,
    hideFinish: true,
    trimMetersFromEnds: 0,
    blurCoordinates: true,
  });
}

/** Length of the shared geometry along its own polyline (gaps excluded). */
export function routeDistanceMeters(route: ShareRoute): number {
  let total = 0;
  for (const points of route.segments) {
    for (let index = 1; index < points.length; index += 1) {
      total += haversine(points[index - 1] as Coordinate, points[index] as Coordinate);
    }
  }
  return total;
}

function interpolate(start: Coordinate, end: Coordinate, fraction: number): Coordinate {
  return deepFreeze({
    lon: start.lon + (end.lon - start.lon) * fraction,
    lat: start.lat + (end.lat - start.lat) * fraction,
  });
}

/**
 * Consumes `meters` of geometry from the front of the route, leaving an
 * interpolated boundary point at exactly the cut (so the hidden distance is
 * exactly `meters`, not "about"). Segments fully consumed are dropped.
 */
function cutFromStart(
  segments: readonly (readonly Coordinate[])[],
  meters: number,
): readonly (readonly Coordinate[])[] {
  if (meters <= 0) return segments;
  let remaining = meters;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const points = segments[segmentIndex] as readonly Coordinate[];
    for (let index = 0; index + 1 < points.length; index += 1) {
      const step = haversine(points[index] as Coordinate, points[index + 1] as Coordinate);
      if (!(step > 0)) continue;
      if (remaining < step) {
        const cut = interpolate(
          points[index] as Coordinate,
          points[index + 1] as Coordinate,
          remaining / step,
        );
        return deepFreeze([
          [cut, ...points.slice(index + 1)],
          ...segments.slice(segmentIndex + 1).map((segment) => [...segment]),
        ]);
      }
      remaining -= step;
    }
  }
  return [];
}

function reversed(segments: readonly (readonly Coordinate[])[]): readonly (readonly Coordinate[])[] {
  return [...segments].reverse().map((segment) => [...segment].reverse());
}

function roundPoint(point: Coordinate): Coordinate {
  const factor = 10 ** COORDINATE_ROUNDING_DECIMALS;
  return deepFreeze({
    lon: Math.round(point.lon * factor) / factor,
    lat: Math.round(point.lat * factor) / factor,
  });
}

function validateTrim(trimMetersFromEnds: number): number {
  if (!Number.isFinite(trimMetersFromEnds) || trimMetersFromEnds < 0) {
    throw new PrivacyTrimError(
      "trimMetersFromEnds must be a finite, non-negative number of meters.",
    );
  }
  return trimMetersFromEnds;
}

/**
 * Applies the §11 privacy trim to a route: the exact geometry the share
 * snapshot may expose.
 */
export function applyPrivacyTrim(
  route: ShareRoute,
  settings: PrivacyTrimSettings,
): ShareRoute {
  const trim = validateTrim(settings.trimMetersFromEnds);
  const head = (settings.hideStart ? HIDE_ZONE_METERS : 0) + trim;
  const tail = (settings.hideFinish ? HIDE_ZONE_METERS : 0) + trim;
  if (head + tail >= routeDistanceMeters(route)) {
    return deepFreeze({ segments: [] });
  }
  const forward = cutFromStart(route.segments, head);
  const tailCut = cutFromStart(reversed(forward), tail);
  const trimmed = reversed(tailCut)
    .filter((segment) => segment.length >= 2)
    .map((segment) => segment.map((point) => (settings.blurCoordinates ? roundPoint(point) : point)));
  return deepFreeze({ segments: trimmed });
}
