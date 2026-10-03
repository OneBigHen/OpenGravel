/**
 * The declarative map scene and its intents
 * (02-ARCHITECTURE-CONTRACT §17, 05-MAP-INTERACTION-AND-CARTOGRAPHY §3–§6).
 *
 * The map is a **renderer**. It receives a scene that was projected outside any
 * renderer-specific code, and it emits typed intents. It never reads the ride
 * document, never writes one, and never learns how a scene was produced: the
 * scene is the same for MapLibre today, for the Mapbox Standard adapter that
 * lands behind the same port, and for a test double.
 *
 * The scene carries the 05 §3 members this slice can actually produce. Rider
 * layers, navigation frames and recording trails arrive with the waves that
 * author them; claiming them as empty arrays here would announce a capability
 * the product does not have yet.
 */

import type { AvoidAreaId, PointId, RoadSpanId, ShapingId, StopId } from "@/domain/ride/ids";
import type { Coordinate, SketchIntent } from "@/domain/ride/types";
import type { RouteCandidateId } from "@/domain/route/ids";
import type { RouteRole } from "@/domain/route/types";

import type { InfoFeature, LayerRaster, MapLayerId } from "@/application/map-layers";
import type { PlaceId, PlaceScene } from "@/application/places";

/** The map-layer part of a scene (UX rework phase 8). */
export interface InfoLayersScene {
  readonly rasters?: readonly LayerRaster[];
  readonly features: readonly InfoFeature[];
  /**
   * The traffic-flow raster tile template (`…/{z}/{x}/{y}`), or `null` to hide
   * it. Carried in the scene so the host needs no knowledge of the app's routes.
   */
  readonly trafficFlowTiles: string | null;
  /** The feature whose card is open, drawn emphasised. */
  readonly selectedId: string | null;
  /** Layers whose features are drawn; lets the style colour by layer. */
  readonly visible: readonly MapLayerId[];
}

import type { PointerTool } from "./interaction";

/** What the map is being used for (05 §3). */
export type MapMode = "plan" | "ride" | "explore";

/**
 * How a route is drawn (05 §11). `selected` is unmistakable (Ember over an
 * Ember-Strong casing) and alternatives are muted; `preview` is the transient
 * treatment for an answer the rider has not committed, `previous` is the dimmed
 * but readable route a replan keeps on screen, and `proposed` is the dashed,
 * clearly-secondary treatment an AI proposal uses until it is applied.
 *
 * The projection emits `selected`/`alternative` today; the renderer styles all
 * five so the waves that author the others do not need a cartography change.
 */
export type RouteSceneState =
  | "selected"
  | "alternative"
  | "preview"
  | "previous"
  | "proposed";

/** One route line plus the role the bundle assigned it. */
export interface RouteScene {
  readonly id: RouteCandidateId;
  /** `null` when the bundle claims no role for this candidate (OGV-D-148). */
  readonly role: RouteRole | null;
  /** Full-resolution line, in travel order; empty when unresolvable. */
  readonly geometry: readonly Coordinate[];
  readonly state: RouteSceneState;
  /**
   * The candidate's colour slot: its index in the bundle, so the line and its
   * decision card share one colour whichever is selected (UX rework phase 2).
   * Absent is slot 0 (Ember), the colour of a single ride such as ride mode's.
   */
  readonly tint?: number;
  /**
   * A short name for the line on the map, e.g. "Fastest · 1 h 57 min"
   * (UX rework phase 9), and where it sits: the point of the line farthest from
   * the other choices. Present only when the rider has choices to tell apart.
   */
  readonly label?: { readonly text: string; readonly at: Coordinate };
}

/**
 * The section of the route the last successful update actually changed (05 §12).
 *
 * It is presentation state, like a preview: it is derived outside the renderer
 * (`changed-span.ts`), it carries no identity, it is deliberately absent from
 * {@link sceneCoordinates} so it can never move the camera, and it is drawn from
 * its own source so the emphasis never re-uploads the route it highlights.
 *
 * `untilIso` is the end of the bounded interval 05 §12 asks for: the renderer must
 * not draw the emphasis past it, even if the surface that owns the state is late.
 * `undefined` means "no deadline of its own — the scene that carries it does".
 */
export interface ChangedSpanScene {
  /** The divergent section, in the route's own travel order. */
  readonly coordinates: readonly Coordinate[];
  /** ISO-8601 instant after which the emphasis is over, or `undefined`. */
  readonly untilIso?: string;
}

export type PointSceneKind = "start" | "finish" | "stop" | "shaping";

/**
 * The transient drag preview (04 §15 "ghost marker, snap preview").
 *
 * A preview is *not* an authored object: it has no identity, it never appears in
 * the document, and it is deliberately absent from {@link sceneCoordinates}, so a
 * ghost marker can never move the camera or count as content. What it carries is
 * exactly what a ghost needs: which kind of object is being dragged (so the ghost
 * reads as that object), where it currently is, and whether that position snapped
 * onto an authored object.
 */
export interface PreviewPointScene {
  /** The kind of object under the pointer, so the ghost reads as that object. */
  readonly kind: PointSceneKind;
  /** The proposed position: the snapped coordinate, or the raw pointer position. */
  readonly coordinate: Coordinate;
  /** True when `coordinate` is another authored object's position (05 §7). */
  readonly snapped: boolean;
}

/**
 * How much of a fix the map may present as current (08 §4, 12 §9).
 *
 * Deliberately the renderer's own three-step vocabulary rather than the domain's
 * four labels: the fourth (`unavailable`) has no coordinate to draw, and how a
 * mark is painted is a cartography question, not a domain one. The mapping is
 * made once, in the projection.
 */
export type RiderPositionConfidence = "good" | "degraded" | "stale";

/**
 * The rider's current position (05 §3 navigation frame, 08 §2, §9).
 *
 * Signal Blue is reserved for location (12 §9), and the mark is drawn **above**
 * every route layer — the rider must always be able to see themselves over their
 * own line. A stale fix keeps its coordinate, because last-known is still the
 * best answer and the map is what makes it legible, but it is drawn as `stale`
 * so the map cannot present it as current (8 §4).
 */
export interface RiderPositionScene {
  readonly coordinate: Coordinate;
  readonly confidence: RiderPositionConfidence;
  /**
   * Direction of travel, degrees clockwise from north, or absent/`null` when
   * unknown. Known, the mark is a heading arrow instead of a dot.
   */
  readonly heading?: number | null;
}

/** One authored point: an endpoint, a stop or a shaping anchor. */
export interface PointScene {
  readonly id: PointId | StopId | ShapingId;
  readonly kind: PointSceneKind;
  readonly coordinate: Coordinate;
  readonly label: string | null;
}

/** One avoid area, with its rings already read from the geometry store. */
export interface AreaScene {
  readonly id: AvoidAreaId;
  readonly rings: readonly (readonly Coordinate[])[];
  readonly enabled: boolean;
}

/**
 * One vertex handle of the selected, editable avoid area (05 §21).
 *
 * Handles are **projection output, not authored state**: they exist only while the
 * area is selected, they are derived from the rings the geometry store already
 * returned, and they are drawn by their own non-hit-test layer so a tap on a
 * handle is a tap on the area (the vertex a drag grabs is resolved by the
 * workspace against the pointer's own coordinate, see OGV-D-232).
 */
export interface AvoidHandleScene {
  readonly areaId: AvoidAreaId;
  readonly ringIndex: number;
  readonly vertexIndex: number;
  readonly coordinate: Coordinate;
}

/**
 * The in-flight avoid-area gesture (04 §18, 05 §21): the ring a rectangle drag
 * would author, the ring a polygon draft would close, or the moved/translated
 * rings of an existing area.
 *
 * A preview is deliberately *not* authored state, exactly like the point ghost:
 * it has no identity, it never appears in the document, it is absent from
 * {@link sceneCoordinates} so it can never move the camera, and it is drawn by
 * its own layers from its own source. `valid` is the ring validator's answer, so
 * a shape the store would refuse reads as refused *before* the rider releases
 * rather than as an error afterwards.
 */
export interface PreviewAreaScene {
  readonly rings: readonly (readonly Coordinate[])[];
  readonly valid: boolean;
}

/** One authored road-span constraint (05 §20), with its stored line read. */
export interface RoadSpanScene {
  readonly id: RoadSpanId;
  readonly mode: "must" | "prefer" | "avoid";
  readonly direction: "forward" | "reverse" | "either";
  /** Empty when the handle does not resolve; never a fabricated span. */
  readonly geometry: readonly Coordinate[];
}

/**
 * The in-flight road-span selection (04 §17, 05 §20): the snapped span line in
 * the rider's own draft order, with both endpoint handles and the direction that
 * order means against the route's traversal.
 *
 * A preview is *not* an authored object, exactly like the point ghost and the
 * avoid-area draft: it has no identity, it never appears in the document, and it
 * is deliberately absent from {@link sceneCoordinates} so a selection cannot move
 * the camera. It is drawn by its own layers from its own source, which is why a
 * drag never re-uploads the authored spans beneath it.
 */
export interface PreviewRoadSpanScene {
  /** The snapped line, in draft order (entry → exit). */
  readonly geometry: readonly Coordinate[];
  readonly direction: "forward" | "reverse" | "either";
  /** The entry handle, as the rider authored it. */
  readonly start: Coordinate;
  /** The exit handle, as the rider authored it. */
  readonly end: Coordinate;
}

/**
 * The in-flight sketch gesture (04 §19, 05 §18): the strokes already drawn in this
 * draft, plus the one the pointer is drawing right now.
 *
 * A preview is *not* authored state, exactly like the point ghost and the
 * avoid-area draft: it has no identity, it never appears in the document, and it is
 * deliberately absent from {@link sceneCoordinates} so drawing cannot move the
 * camera. It is drawn from its own source with its own layer, which is what makes
 * a pointer move a local visual update rather than a store write (05 §18).
 *
 * `active` is `null` between strokes; a stroke with fewer than two positions
 * draws nothing, because a finger that has not moved yet has not drawn a line.
 */
export interface PreviewSketchScene {
  /** The strokes this draft has accumulated, in authoring order. */
  readonly strokes: readonly (readonly Coordinate[])[];
  /** The stroke under the pointer, or `null` between gestures. */
  readonly active: readonly Coordinate[] | null;
}

/**
 * A committed sketch corridor (05 §3, §19): its stored line plus the endpoint
 * policy the sketch was authored with. The raw strokes stay in the geometry
 * store — the map draws the corridor, which is what the plan actually uses.
 */
export interface SketchScene extends Pick<SketchIntent, "corridorRef" | "endpointPolicy"> {
  /** Empty when the corridor handle does not resolve. */
  readonly geometry: readonly Coordinate[];
}

/**
 * A selectable map object (05 §5). Selection is presentation state: it never
 * changes the ride document.
 */
export type MapObjectRef =
  | { readonly kind: "route"; readonly routeId: RouteCandidateId }
  /**
   * A start, a destination or a shaping anchor: one map object kind, because the
   * renderer draws them as one point layer and the rider selects one thing. The
   * id keeps both brands so a caller can tell an anchor from an endpoint without
   * a cast (the projection resolves the difference against the ride document).
   */
  | { readonly kind: "point"; readonly pointId: PointId | ShapingId }
  | { readonly kind: "stop"; readonly stopId: StopId }
  | { readonly kind: "avoid-area"; readonly avoidAreaId: AvoidAreaId }
  | { readonly kind: "road-span"; readonly roadSpanId: RoadSpanId };

/** The UI selection half of the projection (02 §3). */
export interface MapUiSelection {
  /** The object the rider last selected, or `null`. */
  readonly selectedObject: MapObjectRef | null;
}

/**
 * True for the map objects a `point-drag` gesture may grab (05 §4): the authored
 * points — start, destination, stops and shaping anchors.
 *
 * Routes, avoid areas and road spans are selectable objects too, but dragging one
 * resizes or reshapes it, which is a different tool and a different command
 * (`polygon-edit`, `road-span-select`); treating them as points here would let one
 * gesture author the wrong kind of edit. Shared with the renderer so the press
 * hit test and the workspace's gesture handling agree by construction.
 */
export function isDraggablePointRef(ref: MapObjectRef | null): boolean {
  return ref !== null && (ref.kind === "point" || ref.kind === "stop");
}

/** Everything `buildMapScene` projects (02 §17). */
export interface MapScene {
  readonly mode: MapMode;
  readonly routes: readonly RouteScene[];
  readonly selectedRouteId: RouteCandidateId | null;
  readonly points: readonly PointScene[];
  /** The in-flight drag ghost, or `null` when no point is being dragged. */
  readonly preview: PreviewPointScene | null;
  readonly avoidAreas: readonly AreaScene[];
  readonly roadSpans: readonly RoadSpanScene[];
  /**
   * The in-flight span selection, or `null` (04 §17, 05 §20). Optional so a
   * scene built without a selection (any non-planner caller) stays valid.
   */
  readonly roadSpanPreview?: PreviewRoadSpanScene | null;
  /** `null` when the ride has no committed sketch. */
  readonly sketch: SketchScene | null;
  /**
   * The in-flight sketch draft, or `null` (04 §19, 05 §18). Optional so a scene
   * built without a drawing gesture (any non-planner caller) stays valid.
   */
  readonly sketchDraft?: PreviewSketchScene | null;
  /**
   * The rider's current position, or `null` (05 §3, 08 §2). Optional so every
   * scene built without a live position (the planner's, any test double's) stays
   * valid, exactly like `changedSpan`.
   */
  readonly riderPosition?: RiderPositionScene | null;
  /**
   * The selected area's vertex handles, or none when nothing is being edited
   * (05 §21). Not a hit-test layer: see {@link AvoidHandleScene}.
   */
  readonly avoidHandles: readonly AvoidHandleScene[];
  /** The in-flight avoid-area gesture's rings, or `null` (04 §18). */
  readonly previewArea: PreviewAreaScene | null;
  /**
   * The changed section of the last successful update, or `null` (05 §12).
   * Optional so a scene built without one (any non-planner caller, or a phase with
   * nothing to emphasise) stays valid.
   */
  readonly changedSpan?: ChangedSpanScene | null;
  /**
   * The point under the rider's finger on the elevation profile (UX rework
   * phase 3): a presentation-only marker on the route, never selectable and
   * never part of the camera extent.
   */
  readonly scrubMarker?: Coordinate | null;
  readonly selectedObject: MapObjectRef | null;
  /**
   * Nearby places (happy hours, events) drawn as pills over the basemap and
   * under every route layer.
   *
   * Optional, like `riderPosition`: a scene built without places stays valid.
   * Places are provider data, never ride objects, so they are deliberately
   * **not** a `MapObjectRef`: a tap on one is its own `place-click` intent,
   * which the places surface consumes before the workspace sees anything, and
   * they are absent from {@link sceneCoordinates} so they never move the camera.
   * Selection lives on each `PlaceScene` (`selected`), not in `selectedObject`.
   */
  readonly places?: readonly PlaceScene[];
  /**
   * The rider's map layers (UX rework phase 8): provider features for the
   * layers they switched on, and whether the live traffic-flow raster shows.
   * Information about the map, never ride state; optional like `places`.
   */
  readonly infoLayers?: InfoLayersScene;
}

/**
 * What the map emits (05 §4–§6).
 *
 * A **tap** is exactly one of `map-click` (the surface), `object-click` (one
 * meaningful object under the pointer) or `overlap-click` (several route
 * candidates under the pointer, which 05 §6 resolves with a chooser rather than
 * by pixel order). The three carry the tap coordinate, because the workspace may
 * be mid-placement and needs the geography even when an object was under the
 * pointer (OGV-D-213).
 *
 * The **pointer stream** is forwarded only while a drawing tool owns the pointer
 * (05 §4): the map is the pointer transport, the interaction machine decides what
 * a release means, and a tool that needs the full path keeps its own buffer.
 * `camera-changed` is a user pan/zoom, which is what suspends automatic fit
 * (05 §8). A drawing gesture ends either as `gesture-commit` (the machine
 * committed it) or as `gesture-cancel` (it was dropped); there is no third
 * outcome, and neither is a tap.
 */
export type MapIntent =
  | { readonly type: "map-click"; readonly coordinate: Coordinate }
  | {
      readonly type: "object-click";
      readonly ref: MapObjectRef;
      readonly coordinate: Coordinate;
    }
  | {
      readonly type: "overlap-click";
      readonly candidates: readonly MapObjectRef[];
      readonly coordinate: Coordinate;
    }
  | {
      readonly type: "pointer-down";
      readonly pointerId: number;
      readonly coordinate: Coordinate;
      /**
       * The object under the press, resolved by the renderer's own hit test, or
       * `null` for the open surface. A drag needs to know what it grabbed *at
       * press time* (05 §4): a release cannot be asked which object it started
       * on, and the workspace may not query the renderer.
       */
      readonly ref: MapObjectRef | null;
    }
  | { readonly type: "pointer-move"; readonly pointerId: number; readonly coordinate: Coordinate }
  | { readonly type: "pointer-up"; readonly pointerId: number; readonly coordinate: Coordinate }
  | {
      readonly type: "gesture-commit";
      readonly tool: PointerTool;
      readonly geometry: readonly Coordinate[];
    }
  /**
   * The interaction machine dropped an in-flight gesture without committing it
   * (cancel, lost capture, Escape, a tool change, a ride-revision change). It
   * carries no coordinate, because there is nothing to place: the workspace uses
   * it to drop a preview, never to dispatch a command (05 §4).
   */
  | { readonly type: "gesture-cancel" }
  | { readonly type: "camera-changed" }
  /**
   * A tap on a place pill (OGV-D-274). Emitted only while no drawing tool owns
   * the pointer, and it takes priority over anything under the pill, because a
   * pill is drawn on top and reads as the thing tapped. Never a ride object.
   */
  | { readonly type: "place-click"; readonly placeId: PlaceId; readonly coordinate: Coordinate }
  /**
   * A tap on a map-layer feature (phase 8), emitted like `place-click`: only
   * while no drawing tool owns the tap, and consumed by the layers surface.
   */
  | { readonly type: "info-feature-click"; readonly featureId: string; readonly coordinate: Coordinate };
