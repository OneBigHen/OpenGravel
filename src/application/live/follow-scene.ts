/**
 * The follower map's scene: the rider's planned route, the breadcrumb they have
 * already ridden, and the one dot where they are now.
 *
 * It is projected into the app's own `MapScene` rather than drawn with a second
 * renderer, so the follower map is the same cartography, the same basemap and the
 * same camera as the rest of OpenGravel — a follower sees the line the rider sees,
 * not a screenshot of it. Two deliberate reuses:
 *
 * - The ridden breadcrumb is drawn in the route `travelled` treatment: it is
 *   literally the road already ridden, which is what that treatment means
 *   (`src/infrastructure/map/maplibre/style.ts`). It gets no casing and stays
 *   quieter than the line ahead.
 * - The planned line is the `selected` line, so the road ahead reads heaviest.
 *
 * Nothing here is invented. A ride with no points has no rider mark, a plan with
 * no geometry has no line, and a fix older than the freshness bound is marked
 * `stale` instead of being drawn as current.
 */

import { isDrawableLine } from "@/application/map/drawable";
import { rideCameraFor, type RideCamera } from "@/application/map/ride-camera";
import type {
  MapScene,
  RiderPositionConfidence,
  RiderPositionScene,
  RouteScene,
} from "@/application/map/types";
import { LIVE_STALE_AFTER_MS, type LiveFollowSnapshot, type LiveRouteGeometry } from "@/domain/live/types";
import type { Coordinate } from "@/domain/ride/types";
import { asRouteCandidateId } from "@/domain/route/ids";

/** The planned line's ids; one per segment, so a break in the plan stays a break. */
export const LIVE_PLANNED_ROUTE_PREFIX = "live-planned-";
/** The ridden breadcrumb's id. */
export const LIVE_TRAIL_ID = "live-trail";
/** A fix worse than this is drawn as degraded, not as a precise position. */
const DEGRADED_ACCURACY_METERS = 50;

/** The longest planned segment, which is the line the camera reads its direction from. */
export function plannedLine(route: LiveRouteGeometry | null): readonly Coordinate[] {
  if (route === null) return [];
  let longest: readonly Coordinate[] = [];
  for (const segment of route.segments) {
    if (segment.length > longest.length) longest = segment;
  }
  return longest;
}

/** The planned route's drawable segments, in the plan's own order. */
function plannedRoutes(route: LiveRouteGeometry | null): RouteScene[] {
  if (route === null) return [];
  return route.segments
    .filter((segment) => isDrawableLine(segment))
    .map((segment, index) => ({
      id: asRouteCandidateId(`${LIVE_PLANNED_ROUTE_PREFIX}${index}`),
      role: null,
      geometry: segment,
      state: "selected" as const,
    }));
}

/** The ridden breadcrumb, or none when there is not yet a line to draw. */
function trailRoute(snapshot: LiveFollowSnapshot): RouteScene[] {
  if (!isDrawableLine(snapshot.trail)) return [];
  return [
    {
      id: asRouteCandidateId(LIVE_TRAIL_ID),
      role: null,
      geometry: snapshot.trail.map((point) => ({ lon: point.lon, lat: point.lat })),
      state: "travelled",
    },
  ];
}

/** How much of the newest fix the map may present as current. */
export function followConfidence(snapshot: LiveFollowSnapshot, now: number): RiderPositionConfidence {
  const last = snapshot.last;
  if (last === null) return "stale";
  if (now - last.t > LIVE_STALE_AFTER_MS) return "stale";
  if (last.accuracy !== null && last.accuracy > DEGRADED_ACCURACY_METERS) return "degraded";
  return "good";
}

/** The rider's mark, or `null` while they have not reported a position. */
function riderPosition(snapshot: LiveFollowSnapshot, now: number): RiderPositionScene | null {
  const last = snapshot.last;
  if (last === null) return null;
  return {
    coordinate: { lon: last.lon, lat: last.lat },
    confidence: followConfidence(snapshot, now),
    // A stale fix keeps its coordinate but loses its heading: a direction from
    // minutes ago is not where the rider is pointing now (08 §4).
    heading: last.heading,
  };
}

/** The whole scene for one follower read. */
export function buildFollowScene(snapshot: LiveFollowSnapshot, now: number): MapScene {
  const routes = [...plannedRoutes(snapshot.route), ...trailRoute(snapshot)];
  const selected = routes.find((route) => route.state === "selected") ?? null;
  return {
    mode: "ride",
    routes,
    selectedRouteId: selected === null ? null : selected.id,
    points: [],
    preview: null,
    avoidAreas: [],
    roadSpans: [],
    sketch: null,
    avoidHandles: [],
    previewArea: null,
    selectedObject: null,
    riderPosition: riderPosition(snapshot, now),
  };
}

/**
 * The camera the follower map eases to on each new point: the rider's own ride
 * camera (heading up when they are moving, zoom by speed, tilted like the ride
 * screen), centred on their newest fix.
 *
 * When nothing says which way the rider faces — stopped, no heading, no planned
 * line — the camera reports `bearing: null`, which the map host reads as "keep
 * the bearing you have". That is what stops a stopped rider's compass noise from
 * spinning a follower's map, without this module having to remember a bearing.
 */
export function followCameraFor(snapshot: LiveFollowSnapshot): RideCamera | null {
  const last = snapshot.last;
  if (last === null) return null;
  return rideCameraFor({
    position: { lon: last.lon, lat: last.lat },
    headingDegrees: last.heading,
    speedMps: last.speed,
    routeLine: plannedLine(snapshot.route),
    maneuverMeters: null,
    previousBearing: null,
  });
}
