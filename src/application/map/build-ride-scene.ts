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
 * - **No progress marker.** The map never guesses where the rider is: the only
 *   progress it draws is the matcher's own answer (§5), and it draws it as a
 *   split in the line rather than as a mark on it. When the matcher has not
 *   answered — no fix, a stale fix, an off-route or rejoining match — the whole
 *   line stays ahead.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { PositionQuality } from "@/domain/ride-session/types";
import type { RouteCandidateId } from "@/domain/route/ids";

import { MIN_EXTENT_SPAN, type MapExtent } from "./build-map-scene";
import { isDrawableLine, isDrawableRoute } from "./drawable";
import type {
  MapScene,
  RiderPositionConfidence,
  RiderPositionScene,
  RouteScene,
} from "./types";

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
  /**
   * The matcher's share of the line already ridden, `0..1` (`RideFocusProgress.
   * fraction`), or `null` when it has not answered. It only ever *splits the
   * drawn line*: nothing is marked at the split, and a fraction that is not
   * known, not finite, or not strictly inside `(0, 1)` leaves the line whole.
   */
  readonly progressFraction?: number | null;
  /**
   * Whether the matcher currently holds the rider **on** the line. Absent or
   * `false` means "not confirmed", and the whole route draws as ahead: a match
   * that is off-route, rejoining or not yet decided projects onto a line the
   * rider is not on, so a split made from it would claim a progress nobody
   * measured.
   */
  readonly onRoute?: boolean;
}

/**
 * A route line cut at the progress point, in travel order: what is behind the
 * rider and what is still ahead. Both halves carry the split point, so the two
 * drawn lines meet exactly where the rider is.
 */
export interface RideRouteSplit {
  readonly travelled: readonly Coordinate[];
  readonly ahead: readonly Coordinate[];
}

/**
 * How close the progress point must be to a vertex for the split to land on it
 * rather than on an interpolated position beside it. Half a metre: far below any
 * geometry's own sampling, and enough to keep float noise from drawing a
 * duplicate position at a vertex.
 */
const SPLIT_VERTEX_EPSILON_METERS = 0.5;

/**
 * Cuts the line at the share of its length the matcher reports (8 §5).
 *
 * Measured with `haversine` cumulative distance over the line **as drawn**, in
 * travel order: the fraction comes from the engine's own ground distance, so
 * mapping it proportionally onto the geometry is the same honest approximation
 * the surface band makes, and it never places the boundary more precisely than
 * the line it is drawn on.
 *
 * `null` when there is nothing to split: no answer, a fraction at (or outside)
 * either end, a line too short to draw, or a half that would be a single
 * position. The caller then draws the whole route as ahead, which is the honest
 * reading of every one of those cases.
 */
export function splitRouteAtProgress(
  line: readonly Coordinate[],
  fraction: number | null,
): RideRouteSplit | null {
  if (fraction === null || !Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) return null;
  if (!isDrawableLine(line)) return null;
  const at: number[] = [0];
  for (let index = 1; index < line.length; index += 1) {
    at.push(at[index - 1]! + haversine(line[index - 1]!, line[index]!));
  }
  const total = at[at.length - 1]!;
  if (!(total > 0)) return null;
  const target = fraction * total;
  let index = 0;
  while (index + 2 < line.length && at[index + 1]! <= target) index += 1;
  const atFrom = at[index]!;
  const atTo = at[index + 1]!;
  if (target - atFrom <= SPLIT_VERTEX_EPSILON_METERS) return splitAtVertex(line, index);
  if (atTo - target <= SPLIT_VERTEX_EPSILON_METERS) return splitAtVertex(line, index + 1);
  const from = line[index]!;
  const to = line[index + 1]!;
  const span = atTo - atFrom;
  const share = span > 0 ? (target - atFrom) / span : 0;
  const point: Coordinate = {
    lon: from.lon + (to.lon - from.lon) * share,
    lat: from.lat + (to.lat - from.lat) * share,
  };
  return splitResult(
    [...line.slice(0, index + 1), point],
    [point, ...line.slice(index + 1)],
  );
}

function splitAtVertex(line: readonly Coordinate[], index: number): RideRouteSplit | null {
  return splitResult(line.slice(0, index + 1), line.slice(index));
}

function splitResult(
  travelled: readonly Coordinate[],
  ahead: readonly Coordinate[],
): RideRouteSplit | null {
  return isDrawableLine(travelled) && isDrawableLine(ahead) ? { travelled, ahead } : null;
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
 * Whether a fix is current enough for its progress answer to be drawn as
 * current. The same two labels 8 §4 calls presentable, asked once here so the
 * map and the sheet cannot disagree about what "now" means.
 */
function isFreshFix(quality: PositionQuality): boolean {
  return quality === "fresh-good" || quality === "fresh-poor";
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

/**
 * The drawn form of the followed route: one `selected` line when progress is
 * unknown, or the rider's own answer split into `travelled` (behind) and
 * `selected` (ahead).
 *
 * The split is made only when all four conditions hold: the matcher answered, it
 * holds the rider on the line, the fix is fresh, and the fraction is strictly
 * inside the line. Any one of them missing is "not known here", and the whole
 * line draws as ahead — never a split on a guess (CLAUDE.md: unknown is never
 * converted to known).
 */
function followedRoutes(
  routeId: RouteCandidateId,
  routeLine: readonly Coordinate[],
  input: RideSceneInput,
): readonly RouteScene[] {
  const split =
    input.onRoute === true && isFreshFix(input.position.quality)
      ? splitRouteAtProgress(routeLine, input.progressFraction ?? null)
      : null;
  if (split === null) {
    const whole = { id: routeId, role: null, geometry: routeLine, state: "selected" as const };
    return isDrawableRoute(whole) ? [whole] : [];
  }
  // The rider has ridden the part behind them; what is left is the answer still
  // being followed, in the same Ember-over-casing treatment. `selected` is
  // emitted first so a lookup by route id finds the line ahead rather than the
  // one just ridden. Neither half carries a surface band: a ride scene does not
  // carry measured runs today, and runs measured against the whole line would
  // not line up on a truncated one without being re-cut.
  return [
    { id: routeId, role: null, geometry: split.ahead, state: "selected" as const },
    { id: routeId, role: null, geometry: split.travelled, state: "travelled" as const },
  ];
}

/** Projects the ride surface's active route, optional candidate preview and position. */
export function buildRideScene(input: RideSceneInput): MapScene {
  const routes: RouteScene[] =
    input.routeId === null ? [] : [...followedRoutes(input.routeId, input.routeLine, input)];
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
