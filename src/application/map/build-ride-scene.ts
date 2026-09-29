/**
 * The Ride Focus map scene (05-MAP-INTERACTION-AND-CARTOGRAPHY §2–§3;
 * 08-RIDE-NAVIGATION-AND-FREE-RIDE §2, §5, §9; 17-IMPLEMENTATION-PLAN Task 8.5).
 *
 * The planner's projection (`buildMapScene`) answers "what is the rider
 * authoring"; this one answers "where is the rider going". They are separate
 * functions for the same reason they are separate screens: the ride scene has no
 * avoid areas, no road-span drafts, no sketch and no selection — it has the
 * answer being followed and the present position, and claiming any of the rest
 * would announce a capability the surface does not have.
 *
 * What the ride scene deliberately does **not** contain:
 *
 * - **No selection.** Nothing is tappable-into-edit at speed. A scene with no
 *   `selectedObject` is what makes that a property of the projection rather than
 *   of a stylesheet.
 * - **No fabricated line.** A route whose geometry did not resolve produces an
 *   empty route list, and the surface says the line is unavailable; a straight
 *   line between two endpoints would be a route the rider is not on.
 * - **No progress marker.** §5's progress matching is the 8.2 engine's; a
 *   nearest-point guess drawn on the map is exactly the parallel-road jump §5
 *   forbids, so it does not exist until the engine can answer.
 */

import type { Coordinate } from "@/domain/ride/types";
import type { PositionQuality } from "@/domain/ride-session/types";
import type { RouteCandidateId } from "@/domain/route/ids";

import { MIN_EXTENT_SPAN, type MapExtent } from "./build-map-scene";
import { isDrawableRoute } from "./drawable";
import type { MapScene, RiderPositionConfidence, RiderPositionScene, RouteScene } from "./types";

export interface RideSceneInput {
  /** The route answer being followed, when the session has one. */
  readonly routeId: RouteCandidateId | null;
  /** The resolved line, in travel order; empty when the handle did not resolve. */
  readonly routeLine: readonly Coordinate[];
  /** A transient candidate shown for review while the session remains route-free. */
  readonly suggestionPreview?: {
    readonly routeId: RouteCandidateId;
    readonly routeLine: readonly Coordinate[];
  } | null;
  /** The port's own position projection (8 §4); speed and heading are not drawn. */
  readonly position: {
    readonly coordinate: Coordinate | null;
    readonly quality: PositionQuality;
    /** The direction the arrow points, when known (the follow camera's bearing). */
    readonly heading?: number | null;
  };
}

/**
 * The domain's four freshness labels, as the three the renderer paints (08 §4).
 * `unavailable` never reaches here: a position with no coordinate is not drawn.
 */
export function confidenceFor(quality: PositionQuality): RiderPositionConfidence {
  switch (quality) {
    case "fresh-good":
      return "good";
    case "fresh-poor":
      return "degraded";
    case "stale":
    case "unavailable":
      return "stale";
  }
}

/**
 * How wide the view is when the rider asks for the camera back (08 §2).
 *
 * `MIN_EXTENT_SPAN` is the planner's own lower bound (~2 km) and is the right
 * scale for planning; at speed a rider needs the next maneuver legible, so the
 * recenter view is deliberately tighter — roughly a kilometre across, which is
 * about forty seconds of riding at 55 mph.
 */
export const RIDE_RECENTER_SPAN = MIN_EXTENT_SPAN / 2;

/**
 * The extent a recenter frames: a square around the rider, never the whole ride.
 *
 * A recenter that framed the route would be a fit, not a recenter — the rider
 * asking "where am I" must get themselves, at a scale where the next turn is on
 * screen.
 */
export function recenterExtent(coordinate: Coordinate): MapExtent {
  const half = RIDE_RECENTER_SPAN / 2;
  return {
    minLon: coordinate.lon - half,
    minLat: coordinate.lat - half,
    maxLon: coordinate.lon + half,
    maxLat: coordinate.lat + half,
  };
}

/** Projects the ride surface's active route, optional candidate preview and position. */
export function buildRideScene(input: RideSceneInput): MapScene {
  const activeRoute = {
    id: (input.routeId ?? "route_unknown") as RouteCandidateId,
    role: null,
    geometry: input.routeLine,
    state: "selected" as const,
  };
  const routes: RouteScene[] = input.routeId !== null && isDrawableRoute(activeRoute) ? [activeRoute] : [];
  const suggestionPreview = input.suggestionPreview ?? null;
  if (suggestionPreview !== null && suggestionPreview.routeId !== input.routeId) {
    const previewRoute = {
      id: suggestionPreview.routeId,
      role: null,
      geometry: suggestionPreview.routeLine,
      state: "preview" as const,
    };
    if (isDrawableRoute(previewRoute)) routes.push(previewRoute);
  }
  const riderPosition: RiderPositionScene | null =
    input.position.coordinate === null
      ? null
      : {
          coordinate: input.position.coordinate,
          confidence: confidenceFor(input.position.quality),
          ...(input.position.heading === undefined || input.position.heading === null
            ? {}
            : { heading: input.position.heading }),
        };
  return {
    mode: "ride",
    routes,
    selectedRouteId: input.routeId,
    points: [],
    preview: null,
    avoidAreas: [],
    roadSpans: [],
    roadSpanPreview: null,
    sketch: null,
    sketchDraft: null,
    avoidHandles: [],
    previewArea: null,
    changedSpan: null,
    riderPosition,
    selectedObject: null,
  };
}
