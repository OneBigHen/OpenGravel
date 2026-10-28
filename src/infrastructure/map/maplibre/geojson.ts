/**
 * `MapScene` → GeoJSON (05-MAP-INTERACTION-AND-CARTOGRAPHY §3, §5, §11, §21).
 *
 * The renderer receives GeoJSON, so this module is the one place a scene becomes
 * features — and it is where two easy lies would happen:
 *
 * - **Coordinate order.** The domain carries `{ lon, lat }`; GeoJSON is
 *   `[lon, lat]`. The swap happens here, once, and the tests pin it.
 * - **Empty geometry.** A route whose handle did not resolve produces *no*
 *   feature, never a straight line between two endpoints that pretends to be the
 *   route (the same discipline `buildMapScene` applies to the scene itself).
 *
 * Selection is a feature property (`selected`), because 05 §5 makes selection
 * presentation state: it changes what is highlighted, never what is authored, and
 * a re-selected scene must be able to re-tint one line without re-uploading
 * anything else.
 */

import { searchLabelImageId, searchPinImageId } from "./search-pin-images";
import {
  MIN_DRAWABLE_LINE_POSITIONS,
  drawableAreaRings,
  isDrawableLine,
  isDrawableRoadSpan,
  isDrawableSketch,
  isDrawableSketchDraft,
  isDrawableRoute,
} from "@/application/map/drawable";
import type { MapObjectRef, MapScene, PointScene, RouteScene } from "@/application/map/types";
import { ROUTE_AFTER_SUNSET_FEATURE_STATE, ROUTE_SUNSET_MARKER_FEATURE_STATE, ROUTE_SURFACE_FEATURE_STATE } from "@/application/map/types";
import type { PlaceScene } from "@/application/places/place-scene";
import type { Coordinate } from "@/domain/ride/types";

/** GeoJSON positions, nests included: `[lon, lat]`, a line, or a polygon. */
export type GeoJsonCoordinates =
  | readonly number[]
  | readonly GeoJsonCoordinates[];

export interface GeoJsonFeature {
  readonly type: "Feature";
  readonly id: number;
  readonly properties: Record<string, string | number | boolean | null>;
  readonly geometry: {
    readonly type: "LineString" | "Point" | "Polygon";
    readonly coordinates: GeoJsonCoordinates;
  };
}

export interface GeoJsonFeatureCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly GeoJsonFeature[];
}

const EMPTY: GeoJsonFeatureCollection = { type: "FeatureCollection", features: [] };

/** `{ lon, lat }` → `[lon, lat]`. */
export function position(coordinate: Coordinate): readonly number[] {
  return [coordinate.lon, coordinate.lat];
}

function line(coordinates: readonly Coordinate[]): readonly (readonly number[])[] {
  return coordinates.map(position);
}

/** Rings → the nested array form a GeoJSON polygon carries. */
function polygonRings(
  value: readonly (readonly Coordinate[])[],
): readonly (readonly (readonly number[])[])[] {
  return value.map(line);
}

/** True when this object ref is the selected one. */
function isSelected(selected: MapObjectRef | null, ref: MapObjectRef): boolean {
  if (selected === null || selected.kind !== ref.kind) return false;
  switch (ref.kind) {
    case "route":
      return selected.kind === "route" && selected.routeId === ref.routeId;
    case "point":
      return selected.kind === "point" && selected.pointId === ref.pointId;
    case "stop":
      return selected.kind === "stop" && selected.stopId === ref.stopId;
    case "avoid-area":
      return selected.kind === "avoid-area" && selected.avoidAreaId === ref.avoidAreaId;
    case "road-span":
      return selected.kind === "road-span" && selected.roadSpanId === ref.roadSpanId;
  }
}

export function routeFeatureCollection(scene: MapScene): GeoJsonFeatureCollection {
  const features: GeoJsonFeature[] = [];
  scene.routes.forEach((route, index) => {
    // The drawable predicate is shared with the camera extent (4.0 review,
    // finding 10): what the projection refuses to draw must not frame the camera
    // either, and one predicate is the only way the two stay in agreement.
    if (!isDrawableRoute(route)) return;
    const surface = unambiguousSurface(route);
    features.push({
      type: "Feature",
      id: index,
      properties: {
        id: route.id,
        state: route.state,
        role: route.role,
        tint: route.tint ?? 0,
        selected: isSelected(scene.selectedObject, { kind: "route", routeId: route.id }),
        ...(surface === null ? {} : { surface }),
      },
      geometry: { type: "LineString", coordinates: line(route.geometry) },
    });
  });
  // Label points ride the same source (line layers ignore points), so a route
  // and its name always update together.
  scene.routes.forEach((route, index) => {
    if (route.label === undefined || !isDrawableRoute(route)) return;
    features.push({
      type: "Feature",
      id: scene.routes.length + index,
      properties: { id: route.id, state: route.state, tint: Math.min(3, route.tint ?? 0), label: route.label.text },
      geometry: { type: "Point", coordinates: [route.label.at.lon, route.label.at.lat] },
    });
  });
  // The surface band rides in the same source as the line it annotates, under a
  // `state` no route treatment matches: the band is a second reading of the same
  // geometry, so one upload keeps it on the route, and the casing/core/arrow
  // layers pass over it (they filter on `selected`, never `surface`).
  const bandId = scene.routes.length * 2;
  const bands = surfaceBandFeatures(scene);
  bands.forEach((feature, offset) => {
    features.push({ ...feature, id: bandId + offset });
  });
  // The after-sunset stretch and its marker ride here too, for the same reason:
  // they are readings of the line drawn from the same scene, and one upload keeps
  // them on it (MAP-EXPERIENCE-NEXT Wave 2, item 8).
  afterSunsetFeatures(scene).forEach((feature, offset) => {
    features.push({ ...feature, id: bandId + bands.length + offset });
  });
  return features.length === 0 ? EMPTY : { type: "FeatureCollection", features };
}

/**
 * The selected line's after-sunset stretch, plus the marker where the light runs
 * out (MAP-EXPERIENCE-NEXT Wave 2, item 8).
 *
 * The geometry is the projection's own `daylight.afterSunset` line, not a share
 * of the route re-cut here: the split was made on the ETA profile, and only the
 * calculation that made it knows where the boundary really is. A scene whose
 * route carries no `daylight` (a whole ride in daylight, or an unknown sun
 * calculation) produces nothing at all — never a guessed dusk.
 */
function afterSunsetFeatures(scene: MapScene): readonly GeoJsonFeature[] {
  const features: GeoJsonFeature[] = [];
  for (const route of scene.routes) {
    if (route.state !== "selected" || route.daylight === undefined || !isDrawableRoute(route)) continue;
    const { afterSunset, sunsetAt } = route.daylight;
    if (isDrawableLine(afterSunset)) {
      features.push({
        type: "Feature",
        id: 0,
        properties: { id: route.id, state: ROUTE_AFTER_SUNSET_FEATURE_STATE },
        geometry: { type: "LineString", coordinates: line(afterSunset) },
      });
    }
    features.push({
      type: "Feature",
      id: 0,
      properties: { id: route.id, state: ROUTE_SUNSET_MARKER_FEATURE_STATE },
      geometry: { type: "Point", coordinates: position(sunsetAt) },
    });
  }
  return features;
}

/**
 * The one surface kind that covers the whole line, or `null` when the mix is
 * ambiguous — or unknown.
 *
 * A property that names one surface is only honest when there is one surface to
 * name: a mixed line gets no property at all, and its band is drawn from the
 * per-run sub-lines below. `unknown` never produces a value either, because the
 * property means "this is what the line is painted as" and an unknown stretch is
 * painted as nothing (CLAUDE.md: unknown is never shown as paved).
 */
function unambiguousSurface(route: RouteScene): string | null {
  const runs = route.surface;
  if (runs === undefined || runs.length === 0) return null;
  const kinds = new Set(runs.map((run) => run.kind));
  const [only] = [...kinds];
  return kinds.size === 1 && only !== undefined && only !== "unknown" ? only : null;
}

/** Planar ground distance between two positions, longitude scaled by latitude. */
function planarDistance(from: Coordinate, to: Coordinate): number {
  const scale = Math.cos((((from.lat + to.lat) / 2) * Math.PI) / 180) || 1;
  return Math.hypot((to.lon - from.lon) * scale, to.lat - from.lat);
}

/** Cumulative length at each position, in the same unprojected unit as its parts. */
function cumulativeLengths(geometry: readonly Coordinate[]): readonly number[] {
  const at = [0];
  let total = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    total += planarDistance(geometry[index - 1]!, geometry[index]!);
    at.push(total);
  }
  return at;
}

/** The position `distance` along the line; the line's own ends outside it. */
function coordinateAlong(
  geometry: readonly Coordinate[],
  at: readonly number[],
  distance: number,
): Coordinate | null {
  if (geometry.length < 2) return null;
  if (distance <= 0) return geometry[0] ?? null;
  const last = at.length - 1;
  if (distance >= at[last]!) return geometry[last] ?? null;
  let low = 0;
  let high = last;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (at[middle]! <= distance) low = middle;
    else high = middle;
  }
  const span = at[low + 1]! - at[low]!;
  const share = span > 0 ? (distance - at[low]!) / span : 0;
  const from = geometry[low]!;
  const to = geometry[low + 1]!;
  return {
    lon: from.lon + (to.lon - from.lon) * share,
    lat: from.lat + (to.lat - from.lat) * share,
  };
}

/**
 * The stretch between two shares of the line's length, cut at the runs' own
 * boundaries.
 *
 * The provider measures metres and the drawn geometry is a different (denser or
 * sparser) sampling of the same road, so a run is mapped **proportionally** onto
 * the line. That is the honest reading of "this share of the ride is gravel": it
 * cannot place the boundary more precisely than the geometry allows, and it never
 * invents a boundary the engine did not report.
 */
function stretchBetween(
  geometry: readonly Coordinate[],
  at: readonly number[],
  from: number,
  to: number,
): readonly Coordinate[] {
  const total = at[at.length - 1] ?? 0;
  if (!(total > 0) || geometry.length < 2) return [];
  const start = coordinateAlong(geometry, at, from * total);
  const end = coordinateAlong(geometry, at, to * total);
  if (start === null || end === null) return [];
  const stretch: Coordinate[] = [start];
  const startMeters = from * total;
  const endMeters = to * total;
  // A vertex that lands on a boundary is already one of the stretch's ends; the
  // tolerance keeps float noise from drawing the same position twice.
  const epsilon = total * 1e-9;
  for (let index = 1; index < geometry.length - 1; index += 1) {
    const meters = at[index]!;
    if (meters <= startMeters + epsilon || meters >= endMeters - epsilon) continue;
    stretch.push(geometry[index]!);
  }
  stretch.push(end);
  return stretch;
}

/**
 * The selected line's band: one sub-line per **known** surface run (05 §11).
 *
 * An `unknown` run produces no feature at all, which is the whole invariant: the
 * core line keeps the route colour there, so a stretch the engine did not measure
 * can never acquire the paved stroke. A run too short to draw produces nothing
 * either, rather than a one-position LineString the renderer would reject.
 */
function surfaceBandFeatures(scene: MapScene): readonly GeoJsonFeature[] {
  const features: GeoJsonFeature[] = [];
  for (const route of scene.routes) {
    if (route.state !== "selected" || !isDrawableRoute(route)) continue;
    const runs = route.surface;
    if (runs === undefined || runs.length === 0) continue;
    const at = cumulativeLengths(route.geometry);
    for (const run of runs) {
      if (run.kind === "unknown") continue;
      const stretch = stretchBetween(route.geometry, at, run.from, run.to);
      if (!isDrawableLine(stretch)) continue;
      features.push({
        type: "Feature",
        id: 0,
        properties: {
          id: route.id,
          state: ROUTE_SURFACE_FEATURE_STATE,
          surface: run.kind,
        },
        geometry: { type: "LineString", coordinates: line(stretch) },
      });
    }
  }
  return features;
}

/** The object ref a point scene selects by (a stop is its own brand). */
function refFor(point: PointScene): MapObjectRef {
  // A stop is addressed by its own brand; everything else is the generic point
  // ref, which carries whichever of `PointId`/`ShapingId` the scene drew.
  return point.kind === "stop"
    ? { kind: "stop", stopId: point.id as never }
    : { kind: "point", pointId: point.id as never };
}

export function pointFeatureCollection(scene: MapScene): GeoJsonFeatureCollection {
  // Stops are numbered in ride order on their pins (owner review 2026-10-04).
  let stopNumber = 0;
  const features: GeoJsonFeature[] = scene.points.map((point, index) => ({
    type: "Feature",
    id: index,
    properties: {
      id: point.id,
      kind: point.kind,
      label: point.label,
      selected: isSelected(scene.selectedObject, refFor(point)),
      ...(point.kind === "stop" ? { order: String((stopNumber += 1)) } : {}),
    },
    geometry: { type: "Point", coordinates: position(point.coordinate) },
  }));
  const preview = scene.preview;
  if (preview !== null) {
    // The ghost marker (04 §15) is an extra feature in the same source rather
    // than a source of its own: it is a point, and one point list already keeps
    // the draw order and the diff honest. Its `kind` is `preview`, which no
    // authored layer matches, so exactly one dedicated layer draws it and no
    // hit-test layer can ever select a proposal (05 §4).
    features.push({
      type: "Feature",
      id: features.length,
      properties: {
        id: null,
        kind: "preview",
        label: null,
        selected: false,
        draggedKind: preview.kind,
        snapped: preview.snapped,
      },
      geometry: { type: "Point", coordinates: position(preview.coordinate) },
    });
  }
  return features.length === 0 ? EMPTY : { type: "FeatureCollection", features };
}

/** Provider places become renderer features, never ride-object refs (OGV-D-274). */
export function placesFeatureCollection(scene: MapScene): GeoJsonFeatureCollection {
  const places = scene.places ?? [];
  if (places.length === 0) return EMPTY;
  return {
    type: "FeatureCollection",
    features: places.map((place: PlaceScene, id) => ({
      type: "Feature",
      id,
      properties: {
        id: place.id,
        kind: place.kind,
        pill: place.pill,
        ...(place.kind === "search" ? { pinImage: searchPinImageId(place.glyph ?? "place"), labelImage: searchLabelImageId(place.pill) } : {}),
        tone: place.tone,
        priority: place.priority,
        selected: place.selected,
      },
      geometry: {
        type: "Point",
        coordinates: position(place.coordinate),
      },
    })),
  };
}

export function avoidAreaFeatureCollection(scene: MapScene): GeoJsonFeatureCollection {
  const features: GeoJsonFeature[] = [];
  for (const area of scene.avoidAreas) {
    // 05 §21: a disabled area is not drawn — the plan ignores it, so the map
    // must not imply it is in force. Which rings qualify is the shared predicate.
    const drawable = drawableAreaRings(area);
    if (drawable.length === 0) continue;
    features.push({
      type: "Feature",
      id: features.length,
      properties: {
        id: area.id,
        selected: isSelected(scene.selectedObject, {
          kind: "avoid-area",
          avoidAreaId: area.id,
        }),
      },
      geometry: { type: "Polygon", coordinates: polygonRings(drawable) },
    });
  }
  // The editing handles ride in the same source as the area they belong to
  // (05 §21): one source means one diff, so a selection can never show handles
  // over a polygon that has not been re-uploaded. `kind` keeps them apart for the
  // layers — the fill and the outline layers ignore a point, exactly as the
  // handle layer ignores a polygon — and they are deliberately absent from
  // `HIT_LAYER_IDS`, so a tap on a handle is a tap on the area beneath it.
  for (const handle of scene.avoidHandles) {
    features.push({
      type: "Feature",
      id: features.length,
      properties: {
        id: handle.areaId,
        kind: "handle",
        ringIndex: handle.ringIndex,
        vertexIndex: handle.vertexIndex,
        selected: true,
      },
      geometry: { type: "Point", coordinates: position(handle.coordinate) },
    });
  }
  return features.length === 0 ? EMPTY : { type: "FeatureCollection", features };
}

/**
 * The rider's current position (05 §3, 08 §2, §4): one point, its own source.
 *
 * `confidence` is a feature property rather than one layer per freshness label,
 * for the same reason the avoid-area preview carries `valid`: the states differ in
 * how much they may be trusted, and two properties on one feature keep that a
 * styling question instead of a second source to keep in step. The mark is drawn
 * from its own source so a 1 Hz position stream re-uploads one point and never the
 * route line it is following.
 */
export function riderPositionFeatureCollection(scene: MapScene): GeoJsonFeatureCollection {
  const rider = scene.riderPosition ?? null;
  if (rider === null) return EMPTY;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: 0,
        properties: {
          id: "rider-position",
          confidence: rider.confidence,
          ...(rider.heading === undefined || rider.heading === null || rider.confidence === "stale"
            ? {}
            : { heading: rider.heading }),
        },
        geometry: { type: "Point", coordinates: position(rider.coordinate) },
      },
    ],
  };
}

/**
 * The in-flight avoid-area gesture (04 §18, 05 §21): its own source, so the
 * preview never re-uploads the authored areas and vice versa.
 *
 * `valid` is a feature property rather than two different layers per outcome, so
 * the invalid state is one dashed, muted outline rather than a second style to
 * keep in step.
 */
export function avoidPreviewFeatureCollection(scene: MapScene): GeoJsonFeatureCollection {
  const preview = scene.previewArea;
  if (preview === null || preview.rings.length === 0) return EMPTY;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: 0,
        properties: { id: "avoid-preview", valid: preview.valid },
        geometry: { type: "Polygon", coordinates: polygonRings(preview.rings) },
      },
    ],
  };
}

export function roadSpanFeatureCollection(scene: MapScene): GeoJsonFeatureCollection {
  const features: GeoJsonFeature[] = [];
  for (const span of scene.roadSpans) {
    if (!isDrawableRoadSpan(span)) continue;
    features.push({
      type: "Feature",
      id: features.length,
      properties: {
        id: span.id,
        mode: span.mode,
        direction: span.direction,
        selected: isSelected(scene.selectedObject, {
          kind: "road-span",
          roadSpanId: span.id,
        }),
      },
      geometry: { type: "LineString", coordinates: line(span.geometry) },
    });
  }
  return features.length === 0 ? EMPTY : { type: "FeatureCollection", features };
}

/**
 * The arm length and half-angle of the direction chevron the draft draws at its
 * exit (04 §17: the draft shows endpoints and direction).
 */
const SPAN_ARROW_LENGTH_METERS = 22;
const SPAN_ARROW_HALF_ANGLE_DEGREES = 28;

/**
 * The two arms of a direction arrow at the draft's exit, as line segments.
 *
 * The arrow points along the draft's own order — the order the span will be
 * authored in — so what the rider sees on the map is the direction the constraint
 * will declare. It is drawn in a local plane (longitude scaled by cos latitude)
 * so the two arms are the same length on the ground rather than in degrees, and
 * an unusable or zero-length final segment yields no arrow instead of a
 * fabricated one.
 */
function spanArrowArms(
  geometry: readonly Coordinate[],
): readonly (readonly Coordinate[])[] {
  const from = geometry[geometry.length - 2];
  const tip = geometry[geometry.length - 1];
  if (from === undefined || tip === undefined) return [];
  const cosLatitude = Math.cos((tip.lat * Math.PI) / 180) || 1;
  const dx = (tip.lon - from.lon) * cosLatitude;
  const dy = tip.lat - from.lat;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [];
  const metersToLon = 1 / (111_320 * cosLatitude);
  const metersToLat = 1 / 111_320;
  const radians = (SPAN_ARROW_HALF_ANGLE_DEGREES * Math.PI) / 180;
  const arm = (sign: number): readonly Coordinate[] => {
    // The backward unit vector, rotated by ± half-angle.
    const bx = -dx / length;
    const by = -dy / length;
    const rotatedX = bx * Math.cos(radians) - by * sign * Math.sin(radians);
    const rotatedY = bx * sign * Math.sin(radians) + by * Math.cos(radians);
    return [
      { lon: tip.lon, lat: tip.lat },
      {
        lon: tip.lon + rotatedX * SPAN_ARROW_LENGTH_METERS * metersToLon,
        lat: tip.lat + rotatedY * SPAN_ARROW_LENGTH_METERS * metersToLat,
      },
    ];
  };
  return [arm(1), arm(-1)];
}

/**
 * The in-flight road-span selection (04 §17, 05 §20): its own source, so a drag
 * never re-uploads the authored spans beneath it.
 *
 * One line feature, two handle points, and two chevron arms at the exit. The
 * endpoints travel in the same source because they are the same selection, and
 * `kind` keeps them apart for the layers — the line layer reads the line and the
 * arms, the handle layer the points only.
 */
export function roadSpanPreviewFeatureCollection(
  scene: MapScene,
): GeoJsonFeatureCollection {
  const preview = scene.roadSpanPreview ?? null;
  if (preview === null || !isDrawableLine(preview.geometry)) return EMPTY;
  const features: GeoJsonFeature[] = [
    {
      type: "Feature",
      id: 0,
      properties: { id: "road-span-preview", direction: preview.direction },
      geometry: { type: "LineString", coordinates: line(preview.geometry) },
    },
    {
      type: "Feature",
      id: 2,
      properties: { id: "road-span-preview-start", kind: "handle", end: "start" },
      geometry: { type: "Point", coordinates: position(preview.start) },
    },
    {
      type: "Feature",
      id: 3,
      properties: { id: "road-span-preview-end", kind: "handle", end: "end" },
      geometry: { type: "Point", coordinates: position(preview.end) },
    },
  ];
  spanArrowArms(preview.geometry).forEach((arm, index) => {
    features.push({
      type: "Feature",
      id: 4 + index,
      properties: { id: `road-span-preview-arrow-${index}`, kind: "arrow" },
      geometry: { type: "LineString", coordinates: line(arm) },
    });
  });
  return { type: "FeatureCollection", features };
}

export function sketchFeatureCollection(scene: MapScene): GeoJsonFeatureCollection {
  const sketch = scene.sketch;
  if (!isDrawableSketch(sketch)) return EMPTY;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: 0,
        properties: { id: "sketch", selected: false },
        geometry: { type: "LineString", coordinates: line(sketch.geometry) },
      },
    ],
  };
}

/**
 * The in-flight sketch draft (04 §19, 05 §18): every stroke as its own line.
 *
 * One feature per stroke is the point, not a detail: a multi-stroke drawing whose
 * strokes were concatenated would render a straight connector across a gap the
 * rider never drew, which is exactly what the corridor builder refuses to produce
 * (06 §18). A stroke with fewer than two positions is dropped rather than given an
 * invented endpoint.
 */
export function sketchDraftFeatureCollection(scene: MapScene): GeoJsonFeatureCollection {
  const draft = scene.sketchDraft ?? null;
  if (!isDrawableSketchDraft(draft) || draft === null) return EMPTY;
  const strokes = [...draft.strokes];
  if (draft.active !== null) strokes.push(draft.active);
  const drawable = strokes.filter(
    (stroke) => stroke.length >= MIN_DRAWABLE_LINE_POSITIONS,
  );
  return {
    type: "FeatureCollection",
    features: drawable.map((coordinates, index) => ({
      type: "Feature" as const,
      id: index,
      properties: { id: `sketch-draft-${index}` },
      geometry: { type: "LineString" as const, coordinates: line(coordinates) },
    })),
  };
}

/**
 * The changed-span emphasis, or nothing (05 §12).
 *
 * One feature and no identity: the emphasis is not an object the rider can select
 * or name, so it carries no `id` property and no selection state — the shared
 * drawable rule (the same one the camera extent uses) is the only thing that can
 * suppress it.
 */
export function changedSpanFeatureCollection(scene: MapScene): GeoJsonFeatureCollection {
  const span = scene.changedSpan ?? null;
  if (span === null || !isDrawableLine(span.coordinates)) return EMPTY;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: 0,
        properties: { id: "changed-span" },
        geometry: { type: "LineString", coordinates: line(span.coordinates) },
      },
    ],
  };
}

/** The elevation-profile scrub marker, or nothing (UX rework phase 3). */
export function scrubMarkerFeatureCollection(scene: MapScene): GeoJsonFeatureCollection {
  const marker = scene.scrubMarker ?? null;
  if (marker === null) return EMPTY;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: 0,
        properties: { id: "scrub-marker" },
        geometry: { type: "Point", coordinates: position(marker) },
      },
    ],
  };
}
