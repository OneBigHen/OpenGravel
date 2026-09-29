/**
 * The `applyScene` diff (05-MAP-INTERACTION-AND-CARTOGRAPHY §2, §26).
 *
 * 05 §2 is a billing, WebGL-churn and camera-stability rule: the planner owns one
 * map instance for its lifetime, and neither a route change, a selection, nor an
 * opened sheet recreates it. A weaker version of that rule — "set every source on
 * every render" — would keep the instance but still re-upload geometry and reset
 * feature state on every keystroke, so the diff is per *part* rather than
 * all-or-nothing:
 *
 * - `routes` — the lines, their state and their role
 * - `points` — endpoints, stops, shaping anchors and the in-flight drag ghost
 *   (a `preview` feature in the same source, which is why it shares this part)
 * - `avoidAreas`, `roadSpans`, `sketch` — the authored constraint layers
 * - `avoidPreview` — the in-flight avoid-area gesture, its own source so a drag
 *   never re-uploads the authored areas
 * - `sketchDraft` — the in-flight drawing gesture, its own source for the same
 *   reason (05 §18: a pointer move updates the canvas, not the store)
 * - `changedSpan` — the changed section of the last successful update (05 §12),
 *   its own source so the emphasis never re-uploads the route it annotates
 * - `selection` — which object carries the highlight
 *
 * The avoid-area part covers the selected area's **vertex handles** too, because
 * they are features of the same source: a selection that gains or loses handles
 * must re-upload it, and the selection rule below already re-sets it for an
 * avoid-area selection change.
 *
 * The fingerprint is a plain string, and coordinates are rounded to 7 decimals
 * before hashing: that is the domain's own canonical precision (OGV-D-159, ~1 cm),
 * so float noise below it cannot cause a re-upload, while a real vertex move
 * always does.
 */

import type { MapScene } from "@/application/map/types";

/** One stable string per drawable part of a scene. */
export interface SceneFingerprints {
  readonly routes: string;
  readonly points: string;
  readonly avoidAreas: string;
  readonly avoidPreview: string;
  readonly roadSpans: string;
  readonly roadSpanPreview: string;
  readonly sketch: string;
  readonly sketchDraft: string;
  readonly changedSpan: string;
  /**
   * The rider's present position (08 §2, §4). Part of the diff like any other
   * source, so a 1 Hz fix re-uploads one point and never the route it follows.
   */
  readonly riderPosition: string;
  /** Provider places, keyed independently so viewport refreshes do not re-upload routes. */
  readonly places: string;
  /** The rider's map layers (phase 8): keyed by feature ids and the selection. */
  readonly infoLayers: string;
  /** The elevation scrub marker: a pointer stream re-uploads one point. */
  readonly scrubMarker: string;
  readonly selection: string;
}

/** Which parts changed since the previous scene, i.e. which sources to re-set. */
export interface SceneSyncPlan {
  readonly fingerprints: SceneFingerprints;
  readonly routes: boolean;
  readonly points: boolean;
  readonly avoidAreas: boolean;
  readonly avoidPreview: boolean;
  readonly roadSpans: boolean;
  readonly roadSpanPreview: boolean;
  readonly sketch: boolean;
  readonly sketchDraft: boolean;
  readonly changedSpan: boolean;
  readonly riderPosition: boolean;
  readonly places: boolean;
  readonly infoLayers: boolean;
  readonly scrubMarker: boolean;
  readonly selection: boolean;
  /** True when there was no previous scene: draw everything. */
  readonly all: boolean;
}

/** The renderer's coordinate precision: 1e-7 degrees, the domain's canonical. */
const PRECISION = 7;

function round(value: number): number {
  return Number(value.toFixed(PRECISION));
}

function coordinateKey(coordinate: { readonly lon: number; readonly lat: number }): string {
  return `${round(coordinate.lon)}:${round(coordinate.lat)}`;
}

function geometryKey(geometry: readonly { readonly lon: number; readonly lat: number }[]): string {
  return geometry.map(coordinateKey).join(";");
}

function selectionKey(scene: MapScene): string {
  const selected = scene.selectedObject;
  if (selected === null) return "none";
  switch (selected.kind) {
    case "route":
      return `route:${selected.routeId}`;
    case "point":
      return `point:${selected.pointId}`;
    case "stop":
      return `stop:${selected.stopId}`;
    case "avoid-area":
      return `avoid-area:${selected.avoidAreaId}`;
    case "road-span":
      return `road-span:${selected.roadSpanId}`;
  }
}

function sketchKey(scene: MapScene): string {
  const sketch = scene.sketch;
  if (sketch === null) return "none";
  return `${sketch.corridorRef}|${sketch.endpointPolicy}|${geometryKey(sketch.geometry)}`;
}

/**
 * The rider-position part (08 §2, §4), keyed by the rounded coordinate and the
 * confidence the fix is drawn with.
 *
 * Confidence is in the key because it is exactly what the mark shows: a fresh
 * fix and the same fix twenty seconds later are the same coordinate and a
 * different claim, and a key without it would leave the map drawing the previous
 * (fresh) confidence over a stale fix.
 */
function riderPositionKey(scene: MapScene): string {
  const rider = scene.riderPosition ?? null;
  if (rider === null) return "none";
  const heading = rider.heading === undefined || rider.heading === null ? "-" : Math.round(rider.heading);
  return `${rider.confidence}|${coordinateKey(rider.coordinate)}|${heading}`;
}

/** Places (OGV-D-274), keyed by everything their feature and ordering expose. */
function infoLayersKey(scene: MapScene): string {
  const layers = scene.infoLayers ?? null;
  if (layers === null) return "none";
  return `${layers.selectedId ?? ""}|${layers.features.map((feature) => feature.id).join(",")}`;
}

function placesKey(scene: MapScene): string {
  return JSON.stringify(
    (scene.places ?? []).map((place) => [
      place.id,
      coordinateKey(place.coordinate),
      place.pill,
      place.tone,
      place.priority,
      place.selected,
    ]),
  );
}

/**
 * The changed-span part (05 §12), keyed by its geometry and its own deadline.
 *
 * The deadline is part of the key on purpose: a new update that highlights the
 * same section for a fresh interval is a *new* emphasis, and a fingerprint that
 * ignored `untilIso` would leave the renderer holding the previous deadline.
 */
function changedSpanKey(scene: MapScene): string {
  const span = scene.changedSpan ?? null;
  if (span === null) return "none";
  return `${geometryKey(span.coordinates)}|${span.untilIso ?? "open"}`;
}

/** The fingerprints of one scene. Pure; the same scene always hashes the same. */
export function fingerprintScene(scene: MapScene): SceneFingerprints {
  return {
    routes: scene.routes
      .map(
        (route) =>
          `${route.id}|${route.state}|${route.role ?? "none"}|${route.tint ?? 0}|${route.label === undefined ? "" : `${route.label.text}@${coordinateKey(route.label.at)}`}|${geometryKey(route.geometry)}`,
      )
      .join(";"),
    points: scene.points
      .map(
        (point) =>
          `${point.id}|${point.kind}|${coordinateKey(point.coordinate)}|${point.label ?? ""}`,
      )
      .concat(
        scene.preview === null
          ? "preview:none"
          : `preview:${scene.preview.kind}|${coordinateKey(scene.preview.coordinate)}|${scene.preview.snapped ? "snapped" : "free"}`,
      )
      .join(";"),
    avoidAreas: scene.avoidAreas
      .map((area) => `${area.id}|${area.enabled}|${area.rings.map(geometryKey).join(";")}`)
      .concat(
        scene.avoidHandles.map(
          (handle) => `handle:${handle.areaId}:${handle.ringIndex}:${handle.vertexIndex}:${coordinateKey(handle.coordinate)}`,
        ),
      )
      .join(";"),
    avoidPreview:
      scene.previewArea === null
        ? "none"
        : `${scene.previewArea.valid ? "valid" : "invalid"}|${scene.previewArea.rings
            .map(geometryKey)
            .join(";")}`,
    roadSpans: scene.roadSpans
      .map((span) => `${span.id}|${span.mode}|${span.direction}|${geometryKey(span.geometry)}`)
      .join(";"),
    roadSpanPreview: (() => {
      const preview = scene.roadSpanPreview ?? null;
      return preview === null
        ? "none"
        : `${preview.direction}|${geometryKey(preview.geometry)}|${coordinateKey(preview.start)}|${coordinateKey(preview.end)}`;
    })(),
    sketch: sketchKey(scene),
    sketchDraft: sketchDraftKey(scene),
    changedSpan: changedSpanKey(scene),
    riderPosition: riderPositionKey(scene),
    places: placesKey(scene),
    infoLayers: infoLayersKey(scene),
    scrubMarker: scene.scrubMarker === undefined || scene.scrubMarker === null ? "none" : coordinateKey(scene.scrubMarker),
    selection: selectionKey(scene),
  };
}

/**
 * The in-flight sketch draft (05 §18), keyed by its strokes and its active one.
 *
 * Coordinates are rounded by {@link geometryKey}, so the fingerprint changes when
 * the rider's finger moves by more than a centimetre and not when float noise
 * below that appears — which is what keeps a pointer move from re-uploading
 * anything but the draft source.
 */
function sketchDraftKey(scene: MapScene): string {
  const draft = scene.sketchDraft ?? null;
  if (draft === null) return "none";
  const strokes = draft.strokes.map(geometryKey).join("|");
  const active = draft.active === null ? "none" : geometryKey(draft.active);
  return `${strokes}#${active}`;
}

const PARTS = [
  "routes",
  "points",
  "avoidAreas",
  "avoidPreview",
  "roadSpans",
  "roadSpanPreview",
  "sketch",
  "sketchDraft",
  "changedSpan",
  "riderPosition",
  "places",
  "infoLayers",
  "scrubMarker",
  "selection",
] as const satisfies readonly (keyof SceneFingerprints)[];

/** The object kind a selection fingerprint names, or `null` for no selection. */
type SelectedKind =
  | "route"
  | "point"
  | "stop"
  | "avoid-area"
  | "road-span"
  | null;

function selectedKind(fingerprint: string): SelectedKind {
  if (fingerprint === "none") return null;
  return fingerprint.slice(0, fingerprint.indexOf(":")) as SelectedKind;
}

/**
 * What must be re-set for `scene`, given the fingerprints of the scene currently
 * on screen (`null` before the first draw).
 *
 * A selection change re-sets only the sources that can draw the highlight for
 * either the object that lost it or the object that gained it: the highlight is a
 * feature property, so selecting a stop must not re-upload the routes.
 */
export function planSceneSync(
  previous: SceneFingerprints | null,
  scene: MapScene,
): SceneSyncPlan {
  const fingerprints = fingerprintScene(scene);
  if (previous === null) {
    return {
      fingerprints,
      routes: true,
      points: true,
      avoidAreas: true,
      avoidPreview: true,
      roadSpans: true,
      roadSpanPreview: true,
      sketch: true,
      sketchDraft: true,
      changedSpan: true,
      riderPosition: true,
      places: true,
      infoLayers: true,
      scrubMarker: true,
      selection: true,
      all: true,
    };
  }
  const changed = new Set(PARTS.filter((part) => previous[part] !== fingerprints[part]));
  const selectionChanged = changed.has("selection");
  const touched = new Set<SelectedKind>(
    selectionChanged
      ? [selectedKind(previous.selection), selectedKind(fingerprints.selection)]
      : [],
  );
  const selectionTouches = (...kinds: readonly SelectedKind[]): boolean =>
    [...touched].some((kind) => kinds.includes(kind));

  return {
    fingerprints,
    routes: changed.has("routes") || selectionTouches("route"),
    points: changed.has("points") || selectionTouches("point", "stop"),
    avoidAreas: changed.has("avoidAreas") || selectionTouches("avoid-area"),
    avoidPreview: changed.has("avoidPreview"),
    roadSpans: changed.has("roadSpans") || selectionTouches("road-span"),
    roadSpanPreview: changed.has("roadSpanPreview"),
    sketch: changed.has("sketch"),
    sketchDraft: changed.has("sketchDraft"),
    changedSpan: changed.has("changedSpan"),
    riderPosition: changed.has("riderPosition"),
    places: changed.has("places"),
    infoLayers: changed.has("infoLayers"),
    scrubMarker: changed.has("scrubMarker"),
    selection: selectionChanged,
    all: false,
  };
}
