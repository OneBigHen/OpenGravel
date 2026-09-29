/**
 * The pure projection `(RideDocument, PlanningSession, UiSelection, geometry)
 * → MapScene` (02-ARCHITECTURE-CONTRACT §17, 05-MAP-INTERACTION-AND-CARTOGRAPHY
 * §3).
 *
 * Two rules make this module what it is:
 *
 * - **It is a projection, not a decision.** Roles, selection and eligibility
 *   come from the bundle; this module only arranges them for drawing. It never
 *   re-picks a route, never re-orders candidates and never scores.
 * - **It fabricates nothing.** Geometry comes from an injected reader; a handle
 *   the reader cannot resolve produces an empty line, never a straight line
 *   between two points that pretends to be the route.
 *
 * The reader is injected rather than imported so the projection stays pure and
 * works in a test, in SSR and against any `GeometryStore` implementation.
 *
 * The projection also owns the **editing visuals** of 05 §21 — the selected
 * area's vertex handles and the in-flight gesture's rings — because both are
 * derived from the same resolved geometry the fill is drawn from. They are
 * projection output, not authored state, and they are deliberately absent from
 * {@link sceneCoordinates}: a handle or a preview must never move the camera. The
 * in-flight sketch draft (05 §18) is the same kind of value, which is why a
 * pointer move re-projects a few coordinates rather than writing the document.
 */

import { allVertexHandles } from "@/application/planner/avoid-area-geometry";
import { formatDuration } from "@/application/planner/measurements";
import { ALTERNATIVE_LABEL, ROLE_LABELS } from "@/application/planner/planner-view-model";
import { routeLabelAnchors } from "./route-labels";
import { ROUTE_ROLES } from "@/application/planner/planning-session";
import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import { isUsableEvidence } from "@/domain/evidence/types";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { GeometryRef } from "@/domain/ride/ids";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import type {
  RouteBundle,
  RouteCandidate,
  RouteRole,
  RouteRoles,
} from "@/domain/route/types";

import {
  drawableAreaRings,
  isDrawableRoadSpan,
  isDrawableRoute,
  isDrawableSketch,
} from "./drawable";
import type {
  AreaScene,
  AvoidHandleScene,
  ChangedSpanScene,
  MapObjectRef,
  MapScene,
  MapUiSelection,
  PointScene,
  PreviewAreaScene,
  PreviewPointScene,
  PreviewRoadSpanScene,
  PreviewSketchScene,
  RiderPositionScene,
  RoadSpanScene,
  RouteScene,
  SketchScene,
} from "./types";

/** Everything the projection needs; `readGeometry` is the only impure input. */
export interface MapSceneInput {
  readonly document: RideDocument;
  readonly session: PlanningSessionSnapshot;
  readonly uiState: MapUiSelection;
  /**
   * The in-flight drag ghost (04 §15). Presentation state, so it arrives with the
   * selection half of the projection; `undefined` and `null` both mean "no drag".
   */
  readonly preview?: PreviewPointScene | null;
  /**
   * The in-flight avoid-area gesture (04 §18): a rectangle drag, a polygon draft,
   * a whole-area move or a single-vertex move. Presentation state, like the point
   * ghost; `undefined` and `null` both mean "no avoid-area gesture".
   */
  readonly previewArea?: PreviewAreaScene | null;
  /**
   * The in-flight road-span selection (04 §17, 05 §20). Presentation state, like
   * the two other previews; `undefined` and `null` both mean "nothing selected".
   */
  readonly previewSpan?: PreviewRoadSpanScene | null;
  /**
   * The in-flight sketch draft (04 §19, 05 §18): the strokes drawn so far in this
   * gesture chain. Presentation state, like the other previews; `undefined` and
   * `null` both mean "nothing is being drawn".
   */
  readonly previewSketch?: PreviewSketchScene | null;
  /** Synchronous geometry lookup; `null` means "not available right now". */
  readonly readGeometry: (ref: GeometryRef) => GeometryPayload | null;
  /**
   * Where the rider is, when they asked the planner to find them ("center on
   * me"). Presentation state from a one-shot fix, never read from the document;
   * `undefined` and `null` both mean "no dot".
   */
  readonly riderPosition?: RiderPositionScene | null;
  /**
   * The changed section of the last successful update (05 §12). Presentation state,
   * like the previews; `undefined` and `null` both mean "nothing to emphasise".
   */
  readonly changedSpan?: ChangedSpanScene | null;
}

/** A geographic bounding box for camera fit (05 §8–§9). */
export interface MapExtent {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

/**
 * The baseline deployment region, used only when the scene holds no coordinate
 * at all: the SVG host must still be clickable before the rider has placed
 * anything. Not a claim about the rider's location (04 §3) and not a camera
 * state — it is replaced as soon as one coordinate exists.
 */
export const DEFAULT_MAP_EXTENT: MapExtent = {
  minLon: -75.6,
  minLat: 39.0,
  maxLon: -74.0,
  maxLat: 40.5,
};

/** Share of the span added around the content. */
const EXTENT_PADDING_RATIO = 0.08;

/** Smallest span the camera will produce, in degrees (~2 km). */
export const MIN_EXTENT_SPAN = 0.02;

function copyCoordinate(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

/** The line a geometry handle resolves to, or an empty line when it does not. */
function lineCoordinatesFromRef(
  ref: GeometryRef,
  readGeometry: MapSceneInput["readGeometry"],
): readonly Coordinate[] {
  const payload = readGeometry(ref);
  if (payload === null || payload.kind !== "line") return [];
  return payload.coordinates.map(copyCoordinate);
}

/** The line a candidate handle resolves to, or an empty line when it does not. */
function lineCoordinates(
  candidate: RouteCandidate,
  readGeometry: MapSceneInput["readGeometry"],
): readonly Coordinate[] {
  return lineCoordinatesFromRef(candidate.geometryRef, readGeometry);
}

/** The rings an avoid-area handle resolves to, or none when it does not. */
function areaRings(
  ref: GeometryRef,
  readGeometry: MapSceneInput["readGeometry"],
): readonly (readonly Coordinate[])[] {
  const payload = readGeometry(ref);
  if (payload === null || payload.kind !== "polygon") return [];
  return payload.rings.map((ring) => ring.map(copyCoordinate));
}

/**
 * The role a bundle assigned to one candidate, or `null`.
 *
 * `ROUTE_ROLES` order decides when a candidate holds several roles: `best-ride`
 * is the rider-facing headline, so it wins (05 §11, 06 §15).
 */
function roleFor(roles: RouteRoles, candidateId: RouteCandidate["id"]): RouteRole | null {
  for (const role of ROUTE_ROLES) {
    if (roles[role] === candidateId) return role;
  }
  return null;
}

/** The bundle to draw: the committed one, or the last good one while planning. */
function drawableBundle(session: PlanningSessionSnapshot): RouteBundle | null {
  return session.committedBundle ?? session.lastGoodBundle;
}

/**
 * Whether the answer on screen is **stale**: the document has moved past the
 * revision that answer addresses, so the rider's edit is still unanswered.
 *
 * Both states that produce it are the same rider-facing fact — an in-flight update
 * (04 §9) and an update that failed (04 §21) — and both require the same drawing:
 * 05 §11's previous treatment, dimmed but readable. The condition is derived from
 * the bundle and the document rather than from the phase, so a route can never be
 * drawn as the rider's chosen answer while it describes a ride that no longer
 * exists.
 */
function answerIsStale(
  bundle: RouteBundle,
  document: RideDocument,
): boolean {
  return bundle.rideRevision !== document.revision;
}

function routeScenes(
  bundle: RouteBundle | null,
  document: RideDocument,
  readGeometry: MapSceneInput["readGeometry"],
): readonly RouteScene[] {
  if (bundle === null) return [];
  const stale = answerIsStale(bundle, document);
  const labelled = !stale && bundle.candidates.length > 1;
  const lines = bundle.candidates.map((candidate) => lineCoordinates(candidate, readGeometry));
  const marked = [document.intent.start, ...document.intent.stops, document.intent.finish]
    .filter((point) => point !== null)
    .map((point) => point.coordinate);
  const anchors = labelled ? routeLabelAnchors(lines, marked) : [];
  return bundle.candidates.map((candidate, index) => {
    const role = roleFor(bundle.roles, candidate.id);
    const at = anchors[index] ?? null;
    return {
      id: candidate.id,
      role,
      geometry: lines[index]!,
      state: stale
        ? "previous"
        : candidate.id === bundle.selectedRouteId
          ? "selected"
          : "alternative",
      tint: index,
      ...(at === null
        ? {}
        : {
            label: {
              text: `${role === null ? ALTERNATIVE_LABEL : ROLE_LABELS[role]} · ${formatDuration(candidate.durationSeconds)}`,
              at,
            },
          }),
    };
  });
}

/** Whether this candidate's surface is verified, for the card badge (04 §11). */
export function candidateSurfaceIsUnknown(candidate: RouteCandidate): boolean {
  const evidence = candidate.evidence["surfaceMix"];
  if (evidence === undefined) return true;
  return !isUsableEvidence(evidence);
}

function pointScenes(document: RideDocument): readonly PointScene[] {
  const points: PointScene[] = [];
  const { start, stops, shaping, finish } = document.intent;
  if (start !== null) {
    points.push({
      id: start.id,
      kind: "start",
      coordinate: copyCoordinate(start.coordinate),
      label: start.label ?? null,
    });
  }
  for (const stop of stops) {
    points.push({
      id: stop.id,
      kind: "stop",
      coordinate: copyCoordinate(stop.coordinate),
      label: stop.label ?? null,
    });
  }
  for (const anchor of shaping) {
    points.push({
      id: anchor.id,
      kind: "shaping",
      coordinate: copyCoordinate(anchor.coordinate),
      label: null,
    });
  }
  // A loop rides back to its start (06 §17): an authored destination is kept
  // for when the rider switches back, but it is not part of this ride (M2).
  if (finish !== null && document.intent.shape !== "loop") {
    points.push({
      id: finish.id,
      kind: "finish",
      coordinate: copyCoordinate(finish.coordinate),
      label: finish.label ?? null,
    });
  }
  return points;
}

/**
 * The authored road spans, with each stored line read back (05 §20). A span whose
 * handle does not resolve keeps an empty line: the constraint exists in the ride
 * and the map says it cannot be drawn, rather than inventing a neighbour.
 */
function roadSpanScenes(
  document: RideDocument,
  readGeometry: MapSceneInput["readGeometry"],
): readonly RoadSpanScene[] {
  return document.intent.roadSpans.map((span) => ({
    id: span.id,
    mode: span.mode,
    direction: span.direction,
    geometry: lineCoordinatesFromRef(span.geometryRef, readGeometry),
  }));
}

/** The corridor a sketch handle resolves to, or an empty line (05 §19). */
function sketchScene(
  document: RideDocument,
  readGeometry: MapSceneInput["readGeometry"],
): SketchScene | null {
  const sketch = document.intent.sketch;
  if (sketch === null) return null;
  return {
    corridorRef: sketch.corridorRef,
    endpointPolicy: sketch.endpointPolicy,
    geometry: lineCoordinatesFromRef(sketch.corridorRef, readGeometry),
  };
}

function areaScenes(
  document: RideDocument,
  readGeometry: MapSceneInput["readGeometry"],
): readonly AreaScene[] {
  return document.intent.avoidAreas.map((area) => ({
    id: area.id,
    rings: areaRings(area.geometryRef, readGeometry),
    enabled: area.enabled,
  }));
}

/**
 * The vertex handles of the area the rider is editing (05 §21).
 *
 * Only the **selected, enabled** area gets handles, and only once its rings have
 * resolved: a disabled area is not in force (its fill is not drawn either), and a
 * handle floating over an area the map refuses to draw would be an affordance
 * pointing at nothing. The rings are the ones the reader returned, so a handle is
 * always on the polygon the rider can see.
 */
function avoidHandleScenes(
  areas: readonly AreaScene[],
  uiState: MapUiSelection,
): readonly AvoidHandleScene[] {
  const selected = uiState.selectedObject;
  if (selected === null || selected.kind !== "avoid-area") return [];
  const area = areas.find((candidate) => candidate.id === selected.avoidAreaId);
  if (area === undefined || !area.enabled) return [];
  return allVertexHandles(area.rings).map((handle) => ({
    areaId: area.id,
    ringIndex: handle.ringIndex,
    vertexIndex: handle.vertexIndex,
    coordinate: copyCoordinate(handle.coordinate),
  }));
}

/**
 * Projects one scene. Pure: it reads only its arguments (plus the injected
 * reader) and never mutates the document or the session.
 */
export function buildMapScene(input: MapSceneInput): MapScene {
  const bundle = drawableBundle(input.session);
  const avoidAreas = areaScenes(input.document, input.readGeometry);
  return {
    // Only the planner exists in this slice; `ride`/`explore` arrive with their
    // hosts, and claiming a mode nothing produces would be a lie.
    mode: "plan",
    routes: routeScenes(bundle, input.document, input.readGeometry),
    selectedRouteId: bundle?.selectedRouteId ?? null,
    points: pointScenes(input.document),
    preview: input.preview ?? null,
    avoidAreas,
    roadSpans: roadSpanScenes(input.document, input.readGeometry),
    roadSpanPreview: input.previewSpan ?? null,
    sketch: sketchScene(input.document, input.readGeometry),
    sketchDraft: input.previewSketch ?? null,
    avoidHandles: avoidHandleScenes(avoidAreas, input.uiState),
    previewArea: input.previewArea ?? null,
    changedSpan: input.changedSpan ?? null,
    // The planner's dot is only the rider's own "center on me" fix; the live,
    // followed position arrives with the Ride Focus projection
    // (`build-ride-scene.ts`), never from an authored document.
    riderPosition: input.riderPosition ?? null,
    selectedObject: input.uiState.selectedObject,
  };
}

/**
 * Every coordinate a scene draws, in a stable order.
 *
 * "Draws" is the load-bearing word: the drawable predicates are shared with the
 * GeoJSON projection, so a disabled avoid area, a one-point span and an
 * unresolvable line contribute nothing here either. The camera is framed by what
 * the rider can see, and an object the map refuses to draw must not be able to
 * move it (4.0 review, finding 10).
 *
 * The preview is deliberately **not** here: a ghost marker is a proposal, not
 * content, and letting it into the extent would make a drag move the camera
 * (05 §8 fits the ride, never the rider's pointer).
 */
export function sceneCoordinates(scene: MapScene): readonly Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (const route of scene.routes) {
    if (isDrawableRoute(route)) coordinates.push(...route.geometry);
  }
  for (const point of scene.points) coordinates.push(point.coordinate);
  for (const area of scene.avoidAreas) {
    for (const ring of drawableAreaRings(area)) coordinates.push(...ring);
  }
  for (const span of scene.roadSpans) {
    if (isDrawableRoadSpan(span)) coordinates.push(...span.geometry);
  }
  if (isDrawableSketch(scene.sketch)) coordinates.push(...scene.sketch.geometry);
  // The rider's own position is content, not a preview: the ride's opening
  // framing has to include the rider, or the first frame of an active ride shows
  // a line the rider is somewhere off the edge of (08 §2). Unlike a drag ghost,
  // which is deliberately excluded, this is where the rider *is*.
  // The planner's "center on me" dot is not: "Show whole ride" frames the ride,
  // not the rider wherever they happen to be sitting.
  const rider = scene.riderPosition ?? null;
  if (rider !== null && scene.mode !== "plan") coordinates.push(rider.coordinate);
  return coordinates;
}

/**
 * A stable key for the routes a scene draws, or `null` when it draws none.
 *
 * This is the camera rule's input (05 §8): the planner reframes when the drawn
 * route *changes*, and a key is what makes that a declarative comparison instead
 * of a hidden timer.
 *
 * The key covers the **whole geometry**, not just the endpoints and the vertex
 * count: the plannable edits are interior ones (a shaping anchor, a road span, a
 * rerouted middle), and an endpoint-only key stayed identical when the rider
 * moved a middle vertex — so the camera kept whatever framing the previous line
 * produced (4.0 review, finding 9). Coordinates are rounded to the renderer's own
 * 1e-7 canonical precision, so float noise cannot re-fit the camera and a real
 * vertex move always does.
 *
 * It deliberately covers geography and **not** presentation. `RouteSceneState` is
 * what a line looks like — `selected`, `alternative`, the dimmed `previous` an edit
 * in flight or a failed update draws (04 §9, §21; 05 §11) — and a change of paint
 * must never move the camera. Including the state did exactly that: every replan
 * flips the answer on screen from `selected` to `previous` and back, so the map
 * re-fitted twice per edit, animating 450 ms each time, for a line that had not
 * moved a metre. A rider selecting a *different* candidate still re-fits, because a
 * different candidate is different geometry.
 */
export function drawnRoutesKey(scene: MapScene): string | null {
  const drawn = scene.routes.filter(isDrawableRoute);
  if (drawn.length === 0) return null;
  return drawn
    .map((route) =>
      [
        route.id,
        route.geometry
          .map((coordinate) => `${coordinate.lon.toFixed(7)},${coordinate.lat.toFixed(7)}`)
          .join(" "),
      ].join(":"),
    )
    .join(";");
}

/**
 * The camera extent for a scene: the content's bounding box, padded, with a
 * minimum span so a single point is still a usable map. An empty scene gets the
 * documented baseline region (05 §8–§9).
 */
export function sceneExtent(scene: MapScene): MapExtent {
  const coordinates = sceneCoordinates(scene);
  if (coordinates.length === 0) return DEFAULT_MAP_EXTENT;
  return extentOf(coordinates);
}

/** The coordinates one selectable object draws, in scene order. */
function coordinatesForRef(
  scene: MapScene,
  ref: MapObjectRef,
): readonly Coordinate[] {
  switch (ref.kind) {
    case "route":
      return scene.routes.find((route) => route.id === ref.routeId)?.geometry ?? [];
    case "point":
      return scene.points
        .filter((point) => point.id === ref.pointId)
        .map((point) => point.coordinate);
    case "stop":
      return scene.points
        .filter((point) => point.id === ref.stopId)
        .map((point) => point.coordinate);
    case "avoid-area": {
      const area = scene.avoidAreas.find(
        (candidate) => candidate.id === ref.avoidAreaId,
      );
      // The drawable rings only: "zoom to" an object the map does not draw would
      // otherwise frame geometry the rider cannot see.
      return area === undefined ? [] : drawableAreaRings(area).flat();
    }
    case "road-span":
      return scene.roadSpans.find((span) => span.id === ref.roadSpanId)?.geometry ?? [];
  }
}

/**
 * The camera extent for one object (04 §15 "zoom to"), so a list action can frame
 * a stop, a route or an anchor without the map surface being involved.
 *
 * An object the scene cannot draw yet — a route whose geometry handle has not
 * resolved — falls back to the whole scene rather than to a fabricated point: the
 * worst outcome is a camera that shows the ride instead of the one object, never
 * one that shows somewhere the object is not.
 */
export function objectExtent(scene: MapScene, ref: MapObjectRef): MapExtent {
  const coordinates = coordinatesForRef(scene, ref);
  if (coordinates.length === 0) return sceneExtent(scene);
  return extentOf(coordinates);
}

/** The padded, minimum-span extent of a non-empty coordinate list. */
function extentOf(coordinates: readonly Coordinate[]): MapExtent {
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const coordinate of coordinates) {
    minLon = Math.min(minLon, coordinate.lon);
    maxLon = Math.max(maxLon, coordinate.lon);
    minLat = Math.min(minLat, coordinate.lat);
    maxLat = Math.max(maxLat, coordinate.lat);
  }

  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;
  const paddedLon = Math.max(lonSpan * (1 + EXTENT_PADDING_RATIO * 2), MIN_EXTENT_SPAN);
  const paddedLat = Math.max(latSpan * (1 + EXTENT_PADDING_RATIO * 2), MIN_EXTENT_SPAN);
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;

  return {
    minLon: centerLon - paddedLon / 2,
    maxLon: centerLon + paddedLon / 2,
    minLat: centerLat - paddedLat / 2,
    maxLat: centerLat + paddedLat / 2,
  };
}
