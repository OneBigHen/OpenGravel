/**
 * The scene → renderer contract (02-ARCHITECTURE-CONTRACT §17, 05 §3, §5, §11).
 *
 * The MapLibre host itself needs WebGL and is exercised by the browser gate, so
 * everything it decides *before* touching the map is a pure function here: the
 * GeoJSON the sources receive, the diff that decides which sources are re-set,
 * and the palette/layer table the cartography comes from. That is what makes a
 * renderer change reviewable in jsdom (05 §2: never recreate the map for a scene
 * change — the diff is the reason a route selection is a paint, not a re-create).
 */

import { describe, expect, it } from "vitest";

import type { MapScene, RouteScene } from "@/application/map/types";
import type { GeometryRef } from "@/domain/ride/ids";
import { asRouteCandidateId } from "@/domain/route/ids";
import type { AvoidAreaId, PointId, RoadSpanId } from "@/domain/ride/ids";

/** The domain mints ids; a test only needs one that carries the brand. */
const asPointId = (value: string): PointId => value as PointId;
const asAvoidAreaId = (value: string): AvoidAreaId => value as AvoidAreaId;
const asRoadSpanId = (value: string): RoadSpanId => value as RoadSpanId;
import {
  avoidAreaFeatureCollection,
  avoidPreviewFeatureCollection,
  changedSpanFeatureCollection,
  pointFeatureCollection,
  roadSpanFeatureCollection,
  roadSpanPreviewFeatureCollection,
  routeFeatureCollection,
  sketchFeatureCollection,
} from "@/infrastructure/map/maplibre/geojson";
import { resolveIntent } from "@/infrastructure/map/maplibre/host";
import { fingerprintScene, planSceneSync } from "@/infrastructure/map/maplibre/scene-diff";
import {
  DEFAULT_MAP_PALETTE,
  HIT_LAYER_IDS,
  MAP_LAYER_IDS,
  MAP_SOURCE_IDS,
  changedSpanLayers,
  emptyBasemapStyle,
  overlayLayers,
  riderPositionLayers,
  routeLayers,
  type MapPalette,
} from "@/infrastructure/map/maplibre/style";

const SELECTED = asRouteCandidateId("route_selected");
const ALTERNATIVE = asRouteCandidateId("route_alternative");

function route(
  id: ReturnType<typeof asRouteCandidateId>,
  state: RouteScene["state"],
  geometry: readonly { lon: number; lat: number }[] = [
    { lon: -75.2, lat: 39.95 },
    { lon: -75.1, lat: 39.96 },
  ],
): RouteScene {
  return { id, role: null, geometry, state };
}

function scene(overrides: Partial<MapScene> = {}): MapScene {
  return {
    mode: "plan",
    routes: [],
    selectedRouteId: null,
    points: [],
    preview: null,
    avoidAreas: [],
    roadSpans: [],
    sketch: null,
    avoidHandles: [],
    previewArea: null,
    selectedObject: null,
    ...overrides,
  };
}

const START = {
  id: asPointId("pt_start"),
  kind: "start" as const,
  coordinate: { lon: -75.2, lat: 39.95 },
  label: "Home",
};

describe("scene → GeoJSON", () => {
  it("draws every route with its state and role as feature properties", () => {
    const collection = routeFeatureCollection(
      scene({
        routes: [route(SELECTED, "selected"), route(ALTERNATIVE, "alternative")],
        selectedRouteId: SELECTED,
        // 05 §5: the UI selection is presentation state, and it is what the
        // `selected` property (the halo) reports — separate from which line the
        // bundle drew as the chosen route.
        selectedObject: { kind: "route", routeId: SELECTED },
      }),
    );

    expect(collection.features).toHaveLength(2);
    const [first, second] = collection.features;
    expect(first?.properties).toEqual({
      id: "route_selected",
      state: "selected",
      role: null,
      tint: 0,
      selected: true,
    });
    expect(first?.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [-75.2, 39.95],
        [-75.1, 39.96],
      ],
    });
    // GeoJSON is [lon, lat] — the projection's `{lon, lat}` must not leak out
    // un-swapped, which would put every route in the wrong hemisphere.
    expect(second?.properties.state).toBe("alternative");
    expect(second?.properties.selected).toBe(false);
  });

  it("drops a route that resolves to no geometry instead of faking a line", () => {
    const collection = routeFeatureCollection(
      scene({ routes: [route(SELECTED, "selected", [])] }),
    );
    expect(collection.features).toEqual([]);
  });

  it("projects the changed-span emphasis as one anonymous line, or nothing (05 §12)", () => {
    const drawn = scene({
      changedSpan: {
        coordinates: [
          { lon: -75.2, lat: 39.95 },
          { lon: -75.1, lat: 39.96 },
        ],
      },
    });

    const collection = changedSpanFeatureCollection(drawn);

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [-75.2, 39.95],
        [-75.1, 39.96],
      ],
    });
    // The emphasis is not a selectable object, so it carries no selection state.
    expect(collection.features[0]?.properties).toEqual({ id: "changed-span" });
    // One vertex is not a section, and no span at all is not an emphasis.
    expect(
      changedSpanFeatureCollection(
        scene({ changedSpan: { coordinates: [{ lon: -75.2, lat: 39.95 }] } }),
      ).features,
    ).toEqual([]);
    expect(changedSpanFeatureCollection(scene()).features).toEqual([]);
  });

  it("marks the selected object among points, areas, spans and the sketch", () => {
    const drawn = scene({
      points: [START],
      avoidAreas: [
        {
          id: asAvoidAreaId("avoid_1"),
          rings: [
            [
              { lon: -75.3, lat: 39.9 },
              { lon: -75.25, lat: 39.9 },
              { lon: -75.25, lat: 39.94 },
            ],
          ],
          enabled: true,
        },
      ],
      roadSpans: [
        {
          id: asRoadSpanId("span_1"),
          mode: "avoid",
          direction: "either",
          geometry: [
            { lon: -75.22, lat: 39.94 },
            { lon: -75.18, lat: 39.95 },
          ],
        },
      ],
      sketch: {
        corridorRef: "geo_sketch" as GeometryRef,
        endpointPolicy: "derive",
        geometry: [
          { lon: -75.24, lat: 39.93 },
          { lon: -75.19, lat: 39.97 },
        ],
      },
      selectedObject: { kind: "stop", stopId: "stop_1" as never },
    });

    expect(pointFeatureCollection(drawn).features[0]?.properties).toEqual({
      id: "pt_start",
      kind: "start",
      label: "Home",
      selected: false,
    });
    expect(avoidAreaFeatureCollection(drawn).features[0]?.properties).toEqual({
      id: "avoid_1",
      selected: false,
    });
    expect(roadSpanFeatureCollection(drawn).features[0]?.properties).toEqual({
      id: "span_1",
      mode: "avoid",
      // 05 §20: a span carries its direction, so a one-way constraint cannot
      // read as a two-way one.
      direction: "either",
      selected: false,
    });
    expect(sketchFeatureCollection(drawn).features[0]?.properties).toEqual({
      id: "sketch",
      selected: false,
    });

    const selected = scene({
      ...drawn,
      selectedObject: { kind: "point", pointId: asPointId("pt_start") },
    });
    expect(pointFeatureCollection(selected).features[0]?.properties.selected).toBe(true);
  });

  it("omits a disabled avoid area and a sketch with no corridor geometry", () => {
    const disabled = scene({
      avoidAreas: [
        {
          id: asAvoidAreaId("avoid_1"),
          rings: [
            [
              { lon: -75.3, lat: 39.9 },
              { lon: -75.25, lat: 39.9 },
              { lon: -75.25, lat: 39.94 },
            ],
          ],
          enabled: false,
        },
      ],
      sketch: {
        corridorRef: "geo_sketch" as GeometryRef,
        endpointPolicy: "derive",
        geometry: [],
      },
    });

    expect(avoidAreaFeatureCollection(disabled).features).toEqual([]);
    expect(sketchFeatureCollection(disabled).features).toEqual([]);
  });

  it("carries the selected area's vertex handles in the area source (05 §21)", () => {
    const withHandles = scene({
      avoidAreas: [
        {
          id: asAvoidAreaId("avoid_1"),
          rings: [
            [
              { lon: -75.3, lat: 39.9 },
              { lon: -75.25, lat: 39.9 },
              { lon: -75.25, lat: 39.94 },
              { lon: -75.3, lat: 39.9 },
            ],
          ],
          enabled: true,
        },
      ],
      avoidHandles: [
        { areaId: asAvoidAreaId("avoid_1"), ringIndex: 0, vertexIndex: 0, coordinate: { lon: -75.3, lat: 39.9 } },
        { areaId: asAvoidAreaId("avoid_1"), ringIndex: 0, vertexIndex: 1, coordinate: { lon: -75.25, lat: 39.9 } },
        { areaId: asAvoidAreaId("avoid_1"), ringIndex: 0, vertexIndex: 2, coordinate: { lon: -75.25, lat: 39.94 } },
      ],
    });

    const features = avoidAreaFeatureCollection(withHandles).features;
    expect(features).toHaveLength(4);
    expect(features[0]?.geometry.type).toBe("Polygon");
    // Handle features carry `kind: "handle"` so the fill and outline layers never
    // paint them and the circle layer never paints the polygon.
    expect(features[1]?.properties).toEqual({
      id: "avoid_1",
      kind: "handle",
      ringIndex: 0,
      vertexIndex: 0,
      selected: true,
    });
    expect(features[1]?.geometry).toEqual({
      type: "Point",
      coordinates: [-75.3, 39.9],
    });
    // The closing duplicate is not a fourth handle: moving it is moving vertex 0.
    expect(features.filter((feature) => feature.properties["kind"] === "handle")).toHaveLength(3);
  });

  it("projects the in-flight avoid-area gesture from its own source", () => {
    const idle = scene({ previewArea: null });
    expect(avoidPreviewFeatureCollection(idle).features).toEqual([]);

    const dragging = scene({
      previewArea: {
        valid: true,
        rings: [
          [
            { lon: -75.3, lat: 39.9 },
            { lon: -75.25, lat: 39.9 },
            { lon: -75.25, lat: 39.94 },
            { lon: -75.3, lat: 39.9 },
          ],
        ],
      },
    });

    const features = avoidPreviewFeatureCollection(dragging).features;
    expect(features).toHaveLength(1);
    expect(features[0]?.geometry.type).toBe("Polygon");
    expect(features[0]?.properties).toEqual({ id: "avoid-preview", valid: true });
  });

  it("projects the in-flight road-span draft with its endpoints and direction arrow", () => {
    const idle = scene({ roadSpanPreview: null });
    expect(roadSpanPreviewFeatureCollection(idle).features).toEqual([]);

    const geometry = [
      { lon: -75.3, lat: 39.9 },
      { lon: -75.28, lat: 39.9 },
      { lon: -75.26, lat: 39.9 },
    ];
    const dragging = scene({
      roadSpanPreview: {
        geometry,
        direction: "forward",
        start: geometry[0]!,
        end: geometry[2]!,
      },
    });

    const features = roadSpanPreviewFeatureCollection(dragging).features;
    const handles = features.filter((feature) => feature.properties["kind"] === "handle");
    const arrows = features.filter((feature) => feature.properties["kind"] === "arrow");
    expect(features).toHaveLength(5);
    expect(handles).toHaveLength(2);
    // Both chevron arms start at the exit, so the arrow points along the draft's
    // own order — the direction the constraint will declare (04 §17, 05 §20).
    expect(arrows).toHaveLength(2);
    for (const arm of arrows) {
      expect(arm.geometry).toMatchObject({ type: "LineString" });
      const coordinates = (arm.geometry as { readonly coordinates: readonly (readonly number[])[] })
        .coordinates;
      expect(coordinates[0]).toEqual([geometry[2]!.lon, geometry[2]!.lat]);
      expect(coordinates[1]).not.toEqual(coordinates[0]);
    }
    const span = features[0];
    expect(span?.geometry).toEqual({
      type: "LineString",
      coordinates: geometry.map(({ lon, lat }) => [lon, lat]),
    });
  });

  it("draws no draft arrow for a selection with no usable segment", () => {
    const onePoint = scene({
      roadSpanPreview: {
        geometry: [{ lon: -75.3, lat: 39.9 }],
        direction: "forward",
        start: { lon: -75.3, lat: 39.9 },
        end: { lon: -75.3, lat: 39.9 },
      },
    });
    // A one-point selection is not drawable at all: nothing is fabricated.
    expect(roadSpanPreviewFeatureCollection(onePoint).features).toEqual([]);
  });
});

/**
 * Hit resolution (05 §5–§6): which object a tap selects.
 *
 * The renderer resolves a tap against its own layers, and the object it reports
 * must be the *same* object the projection marked as selected — otherwise the
 * selection is stored and the highlight never moves. Finding 7 of the 4.0 review
 * was exactly that: the finish layer resolved as a stop, while the finish feature
 * is written as a point, so selecting the destination could never light it up.
 */
describe("hit resolution — the object a tap selects (05 §5–§6)", () => {
  const COORDINATE = { lon: -75.2, lat: 39.95 };
  const hit = (layerId: string, id: string) => ({
    layer: { id: layerId },
    properties: { id } as Record<string, unknown>,
  });

  it("resolves start and finish as points, and a stop as a stop", () => {
    expect(resolveIntent([hit(MAP_LAYER_IDS.pointStart, "pt_start")], COORDINATE)).toEqual({
      type: "object-click",
      ref: { kind: "point", pointId: "pt_start" },
      coordinate: COORDINATE,
    });
    // 05 §5: the destination is one map object kind — a point — exactly like the
    // start, because the renderer draws them as one layer and the rider selects
    // one thing.
    expect(resolveIntent([hit(MAP_LAYER_IDS.pointFinish, "pt_finish")], COORDINATE)).toEqual({
      type: "object-click",
      ref: { kind: "point", pointId: "pt_finish" },
      coordinate: COORDINATE,
    });
    expect(resolveIntent([hit(MAP_LAYER_IDS.pointStop, "stop_1")], COORDINATE)).toEqual({
      type: "object-click",
      ref: { kind: "stop", stopId: "stop_1" },
      coordinate: COORDINATE,
    });
  });

  it("resolves the finish to the ref its own feature is selected by", () => {
    const finish = {
      id: asPointId("pt_finish"),
      kind: "finish" as const,
      coordinate: COORDINATE,
      label: null,
    };
    const drawn = scene({
      points: [finish],
      selectedObject: { kind: "point", pointId: asPointId("pt_finish") },
    });
    const intent = resolveIntent([hit(MAP_LAYER_IDS.pointFinish, "pt_finish")], COORDINATE);
    if (intent.type !== "object-click") throw new Error("expected an object hit");

    // The feature reports itself as selected because the projection wrote that
    // property from the point ref; the hit test must resolve to the same ref, or
    // the tap stores a selection nothing on screen answers to.
    expect(drawn.selectedObject).toEqual(intent.ref);
    expect(pointFeatureCollection(drawn).features[0]?.properties.selected).toBe(true);
  });

  it("resolves shaping anchors as points, areas and spans by their own brand", () => {
    expect(resolveIntent([hit(MAP_LAYER_IDS.pointShaping, "shp_1")], COORDINATE)).toEqual({
      type: "object-click",
      ref: { kind: "point", pointId: "shp_1" },
      coordinate: COORDINATE,
    });
    expect(resolveIntent([hit(MAP_LAYER_IDS.avoidFill, "avoid_1")], COORDINATE)).toEqual({
      type: "object-click",
      ref: { kind: "avoid-area", avoidAreaId: "avoid_1" },
      coordinate: COORDINATE,
    });
    expect(resolveIntent([hit(MAP_LAYER_IDS.roadSpanAvoid, "span_1")], COORDINATE)).toEqual({
      type: "object-click",
      ref: { kind: "road-span", roadSpanId: "span_1" },
      coordinate: COORDINATE,
    });
  });

  it("ignores the selection halo, so the same point can be re-selected", () => {
    // `ogv-point-selected` draws the halo of whichever point is highlighted: it
    // is a second feature under the same pixel, not a second object.
    expect(resolveIntent([hit(MAP_LAYER_IDS.pointSelected, "pt_start")], COORDINATE)).toEqual({
      type: "map-click",
      coordinate: COORDINATE,
    });
  });

  it("resolves several overlapping routes to the 05 §6 chooser", () => {
    const intent = resolveIntent(
      [
        hit(MAP_LAYER_IDS.routeCasing, "route_a"),
        hit(MAP_LAYER_IDS.routeSelected, "route_b"),
      ],
      COORDINATE,
    );

    expect(intent).toEqual({
      type: "overlap-click",
      candidates: [
        { kind: "route", routeId: "route_a" },
        { kind: "route", routeId: "route_b" },
      ],
      coordinate: COORDINATE,
    });
  });

  it("prefers a point over a route under the same pixel", () => {
    // A point over a line is one object, and the point wins: it is the smaller,
    // on-top target the rider aimed at.
    const intent = resolveIntent(
      [hit(MAP_LAYER_IDS.routeCasing, "route_a"), hit(MAP_LAYER_IDS.pointStart, "pt_start")],
      COORDINATE,
    );

    expect(intent).toEqual({
      type: "object-click",
      ref: { kind: "point", pointId: "pt_start" },
      coordinate: COORDINATE,
    });
  });

  it("resolves an empty hit list to a plain surface click", () => {
    expect(resolveIntent([], COORDINATE)).toEqual({ type: "map-click", coordinate: COORDINATE });
  });
});

describe("the scene diff", () => {
  it("asks for a full draw when there is no previous scene", () => {
    const plan = planSceneSync(null, scene({ routes: [route(SELECTED, "selected")] }));

    expect(plan.all).toBe(true);
    expect(plan.routes).toBe(true);
    expect(plan.points).toBe(true);
    expect(plan.avoidPreview).toBe(true);
    expect(plan.selection).toBe(true);
  });

  it("re-sets nothing when the scene did not change", () => {
    const drawn = scene({
      routes: [route(SELECTED, "selected"), route(ALTERNATIVE, "alternative")],
      points: [START],
      selectedRouteId: SELECTED,
    });
    const plan = planSceneSync(fingerprintScene(drawn), drawn);

    expect(plan.all).toBe(false);
    expect([
      plan.routes,
      plan.points,
      plan.avoidAreas,
      plan.avoidPreview,
      plan.roadSpans,
      plan.sketch,
      plan.selection,
    ]).toEqual([false, false, false, false, false, false, false]);
  });

  it("re-sets the avoid-area source when the selected area gains handles", () => {
    const area = {
      id: asAvoidAreaId("avoid_1"),
      rings: [
        [
          { lon: -75.3, lat: 39.9 },
          { lon: -75.25, lat: 39.9 },
          { lon: -75.25, lat: 39.94 },
          { lon: -75.3, lat: 39.9 },
        ],
      ],
      enabled: true,
    };
    const before = scene({ avoidAreas: [area], selectedObject: null });
    const after = scene({
      avoidAreas: [area],
      selectedObject: { kind: "avoid-area", avoidAreaId: asAvoidAreaId("avoid_1") },
      avoidHandles: [
        { areaId: asAvoidAreaId("avoid_1"), ringIndex: 0, vertexIndex: 0, coordinate: { lon: -75.3, lat: 39.9 } },
      ],
    });

    const plan = planSceneSync(fingerprintScene(before), after);
    expect(plan.avoidAreas).toBe(true);
    // A handle is a feature of the area source, so nothing else re-uploads.
    expect(plan.avoidPreview).toBe(false);
    expect(plan.routes).toBe(false);
    expect(plan.points).toBe(false);
  });

  it("re-sets only the preview source while an area gesture is in flight", () => {
    const before = scene({ previewArea: null });
    const after = scene({
      previewArea: {
        valid: false,
        rings: [
          [
            { lon: -75.3, lat: 39.9 },
            { lon: -75.25, lat: 39.9 },
            { lon: -75.25, lat: 39.94 },
            { lon: -75.3, lat: 39.9 },
          ],
        ],
      },
    });

    const plan = planSceneSync(fingerprintScene(before), after);
    expect(plan.avoidPreview).toBe(true);
    expect(plan.avoidAreas).toBe(false);
    expect(plan.points).toBe(false);
    expect(plan.selection).toBe(false);
  });

  it("re-sets the preview when only its validity changes", () => {
    const rings = [
      [
        { lon: -75.3, lat: 39.9 },
        { lon: -75.25, lat: 39.9 },
        { lon: -75.25, lat: 39.94 },
        { lon: -75.3, lat: 39.9 },
      ],
    ];
    const before = scene({ previewArea: { valid: true, rings } });
    const after = scene({ previewArea: { valid: false, rings } });

    expect(planSceneSync(fingerprintScene(before), after).avoidPreview).toBe(true);
  });

  it("re-sets only the routes when a selection moves between them", () => {
    const before = scene({
      routes: [route(SELECTED, "selected"), route(ALTERNATIVE, "alternative")],
      selectedRouteId: SELECTED,
    });
    const after = scene({
      routes: [route(SELECTED, "alternative"), route(ALTERNATIVE, "selected")],
      selectedRouteId: ALTERNATIVE,
    });
    const plan = planSceneSync(fingerprintScene(before), after);

    expect(plan.routes).toBe(true);
    expect(plan.points).toBe(false);
    expect(plan.avoidAreas).toBe(false);
    expect(plan.sketch).toBe(false);
  });

  it("re-sets only the emphasis when the changed span moves (05 §12)", () => {
    const before = scene({
      changedSpan: { coordinates: [{ lon: -75.2, lat: 39.95 }, { lon: -75.1, lat: 39.96 }] },
    });
    const after = scene({
      changedSpan: { coordinates: [{ lon: -75.2, lat: 39.95 }, { lon: -75.05, lat: 40.0 }] },
    });

    const plan = planSceneSync(fingerprintScene(before), after);

    expect(plan.changedSpan).toBe(true);
    expect(plan.routes).toBe(false);
    expect(plan.points).toBe(false);
    expect(plan.selection).toBe(false);
  });

  it("re-sets the emphasis when only its deadline is renewed", () => {
    const coordinates = [{ lon: -75.2, lat: 39.95 }, { lon: -75.1, lat: 39.96 }];
    const before = scene({ changedSpan: { coordinates, untilIso: "2026-09-17T00:00:12.000Z" } });
    const after = scene({ changedSpan: { coordinates, untilIso: "2026-09-17T00:00:24.000Z" } });

    // A fresh interval over the same section is a new emphasis: a fingerprint that
    // ignored the deadline would leave the renderer holding the old one.
    expect(planSceneSync(fingerprintScene(before), after).changedSpan).toBe(true);
  });

  it("clears the emphasis when the scene stops carrying one", () => {
    const before = scene({
      changedSpan: { coordinates: [{ lon: -75.2, lat: 39.95 }, { lon: -75.1, lat: 39.96 }] },
    });

    expect(planSceneSync(fingerprintScene(before), scene()).changedSpan).toBe(true);
  });

  it("re-sets only the points when a point is added", () => {
    const before = scene({ points: [] });
    const after = scene({ points: [START] });
    const plan = planSceneSync(fingerprintScene(before), after);

    expect(plan.points).toBe(true);
    expect(plan.routes).toBe(false);
    expect(plan.selection).toBe(false);
  });

  it("re-sets only the source that draws the object being selected", () => {
    const before = scene({
      points: [START],
      selectedObject: null,
    });
    const after = scene({
      points: [START],
      selectedObject: { kind: "stop", stopId: "stop_1" as never },
    });
    const plan = planSceneSync(fingerprintScene(before), after);

    // The highlight is a feature property, so the source that draws the object
    // must be re-set; a route selection is a route-state change and re-sets the
    // routes whether or not the selection part also moved.
    expect(plan.selection).toBe(true);
    expect(plan.points).toBe(true);
    expect(plan.routes).toBe(false);
  });

  it("ignores coordinate noise below the renderer's precision", () => {
    const before = scene({
      routes: [route(SELECTED, "selected", [{ lon: -75.2, lat: 39.95 }, { lon: -75.1, lat: 39.96 }])],
    });
    const after = scene({
      routes: [
        route(SELECTED, "selected", [
          { lon: -75.2 + 1e-9, lat: 39.95 - 1e-9 },
          { lon: -75.1, lat: 39.96 },
        ]),
      ],
    });

    expect(planSceneSync(fingerprintScene(before), after).routes).toBe(false);
  });

  it("re-sets the routes when a vertex actually moves", () => {
    const before = scene({ routes: [route(SELECTED, "selected")] });
    const after = scene({
      routes: [route(SELECTED, "selected", [{ lon: -75.2, lat: 39.95 }, { lon: -75.0, lat: 39.96 }])],
    });

    expect(planSceneSync(fingerprintScene(before), after).routes).toBe(true);
  });

  it("re-sets the routes when a candidate disappears", () => {
    const before = scene({ routes: [route(SELECTED, "selected")] });
    const after = scene({ routes: [] });

    expect(planSceneSync(fingerprintScene(before), after).routes).toBe(true);
  });
});

describe("the cartography table", () => {
  it("draws the empty basemap from the palette with no network source", () => {
    const style = emptyBasemapStyle(DEFAULT_MAP_PALETTE);

    expect(style.version).toBe(8);
    expect(style.sources).toEqual({});
    expect(style.layers).toEqual([
      {
        id: MAP_LAYER_IDS.background,
        type: "background",
        paint: { "background-color": DEFAULT_MAP_PALETTE.canvas },
      },
    ]);
  });

  it("draws avoid-area handles above the area and keeps them out of hit-testing", () => {
    const layers = overlayLayers(DEFAULT_MAP_PALETTE);
    const ids = layers.map((layer) => layer.id);
    const handle = layers.find((layer) => layer.id === MAP_LAYER_IDS.avoidHandle);

    expect(handle?.type).toBe("circle");
    expect(handle?.source).toBe(MAP_SOURCE_IDS.avoidAreas);
    expect(handle?.filter).toEqual(["==", ["get", "kind"], "handle"]);
    expect(ids.indexOf(MAP_LAYER_IDS.avoidHandle)).toBeGreaterThan(
      ids.indexOf(MAP_LAYER_IDS.avoidSelected),
    );
    // 05 §4: a handle is not a selectable object. It must be absent from the hit
    // table, or a tap aimed at the area would report geometry the rider cannot
    // name — and the vertex a *drag* grabs is resolved by the workspace.
    expect(HIT_LAYER_IDS).not.toContain(MAP_LAYER_IDS.avoidHandle);
  });

  it("draws the in-flight area gesture from its own source, muted when invalid", () => {
    const layers = overlayLayers(DEFAULT_MAP_PALETTE);
    const outline = layers.find((layer) => layer.id === MAP_LAYER_IDS.avoidPreviewOutline);

    expect(outline?.source).toBe(MAP_SOURCE_IDS.avoidPreview);
    expect(outline?.paint?.["line-dasharray"]).toEqual([2, 2]);
    // The valid/invalid distinction is a data-driven colour, so one layer serves
    // both states.
    const colour = outline?.paint?.["line-color"];
    expect(Array.isArray(colour) ? colour[0] : null).toBe("case");
    expect(HIT_LAYER_IDS).not.toContain(MAP_LAYER_IDS.avoidPreviewOutline);
    expect(HIT_LAYER_IDS).not.toContain(MAP_LAYER_IDS.avoidPreviewFill);
  });

  it("draws a sunlight ride with a dark casing and heavier line and arrow when the palette asks", () => {
    const sun = { ...DEFAULT_MAP_PALETTE, routeCasing: "#1d0b05", emphasis: "1.25" };
    const route = new Map(routeLayers(sun).map((layer) => [layer.id, layer]));
    const casing = route.get(MAP_LAYER_IDS.routeCasing)?.paint;
    expect(casing?.["line-color"]).toBe("#1d0b05");
    expect((casing?.["line-width"] as unknown[]).at(-1)).toBe(25);
    const plain = new Map(routeLayers(DEFAULT_MAP_PALETTE).map((layer) => [layer.id, layer]));
    expect((plain.get(MAP_LAYER_IDS.routeCasing)?.paint?.["line-width"] as unknown[]).at(-1)).toBe(20);
    const arrow = riderPositionLayers(sun).find((layer) => layer.id === MAP_LAYER_IDS.riderHeading);
    expect(arrow?.layout?.["icon-size"]).toBeCloseTo(1.625);
    // An unreadable multiplier never shrinks or explodes the scene.
    const odd = riderPositionLayers({ ...DEFAULT_MAP_PALETTE, emphasis: "banana" })
      .find((layer) => layer.id === MAP_LAYER_IDS.riderHeading);
    expect(odd?.layout?.["icon-size"]).toBeCloseTo(1.3);
  });

  it("colours each route by its candidate slot, Ember first, over a stronger casing (05 §11)", () => {
    const layers = routeLayers(DEFAULT_MAP_PALETTE);
    const byId = new Map(layers.map((layer) => [layer.id, layer]));

    const casing = byId.get(MAP_LAYER_IDS.routeCasing);
    const selected = byId.get(MAP_LAYER_IDS.routeSelected);
    const alternative = byId.get(MAP_LAYER_IDS.routeAlternative);
    expect(casing?.filter).toEqual(["==", ["get", "state"], "selected"]);
    // A line and its card share a colour whichever is selected (UX rework
    // phase 2): the first candidate is Ember, the others their own tints, and a
    // candidate past the palette is the neutral Slate.
    const tints = (layer: { paint?: Record<string, unknown> } | undefined): unknown[] =>
      layer?.paint?.["line-color"] as unknown[];
    expect(tints(selected)).toEqual([
      "match",
      ["get", "tint"],
      0,
      DEFAULT_MAP_PALETTE.ember,
      1,
      DEFAULT_MAP_PALETTE.routePlum,
      2,
      DEFAULT_MAP_PALETTE.deepSpruce,
      DEFAULT_MAP_PALETTE.slate,
    ]);
    expect(tints(alternative)).toEqual(tints(selected));
    expect(tints(casing)?.[3]).toBe(DEFAULT_MAP_PALETTE.emberStrong);
    expect(tints(selected)).not.toContain(DEFAULT_MAP_PALETTE.signalBlue);

    // The selected line must carry the most visual weight, and the alternatives
    // must be visibly secondary rather than a second highlight.
    const width = (layer: { paint?: Record<string, unknown> } | undefined): number =>
      lineWidthAtLeast(layer?.paint?.["line-width"]);
    expect(width(selected)).toBeGreaterThan(width(alternative));
    expect(Number(alternative?.paint?.["line-opacity"] ?? 1)).toBeLessThan(1);
  });

  it("keeps preview, previous and proposed routes distinguishable (05 §11)", () => {
    const layers = routeLayers(DEFAULT_MAP_PALETTE);
    const byId = new Map(layers.map((layer) => [layer.id, layer]));

    expect(byId.get(MAP_LAYER_IDS.routePreview)?.paint?.["line-dasharray"]).toBeDefined();
    expect(byId.get(MAP_LAYER_IDS.routeProposed)?.paint?.["line-dasharray"]).toBeDefined();
    expect(byId.get(MAP_LAYER_IDS.routePrevious)?.paint?.["line-opacity"]).toBeLessThan(1);
    expect(byId.get(MAP_LAYER_IDS.routePrevious)?.paint?.["line-dasharray"]).toBeUndefined();
  });

  it("reads every colour from the palette it is given", () => {
    const palette: MapPalette = {
      ink: "#000001",
      paper: "#000002",
      canvas: "#000003",
      ember: "#000004",
      emberStrong: "#000005",
      slate: "#000006",
      topoSage: "#000007",
      signalBlue: "#000008",
      goldenHour: "#000009",
      trailBrown: "#00000a",
      deepSpruce: "#00000b",
      routePlum: "#00000c",
      routePlumStrong: "#00000d",
      routeCasing: "auto",
      emphasis: "1",
    };

    for (const layer of routeLayers(palette)) {
      const colour = layer.paint?.["line-color"];
      if (typeof colour === "string" && colour.startsWith("#")) {
        expect(Object.values(palette)).toContain(colour);
      }
    }
  });

  it("draws the changed-span emphasis above the selected route and outside hit-testing (05 §12)", () => {
    const layers = overlayLayers(DEFAULT_MAP_PALETTE);
    const ids = layers.map((layer) => layer.id);
    const emphasis = changedSpanLayers(DEFAULT_MAP_PALETTE)[0];

    expect(emphasis?.id).toBe(MAP_LAYER_IDS.changedSpan);
    expect(emphasis?.type).toBe("line");
    expect(emphasis?.source).toBe(MAP_SOURCE_IDS.changedSpan);
    // Dashed and bright: an annotation on the route, never a sixth route treatment.
    expect(emphasis?.paint?.["line-dasharray"]).toBeDefined();
    expect(emphasis?.paint?.["line-color"]).toBe(DEFAULT_MAP_PALETTE.paper);
    // The overlay table is what the host actually adds, so it must carry the same
    // layer, under the same id.
    expect(layers.find((layer) => layer.id === MAP_LAYER_IDS.changedSpan)).toBeDefined();
    // It must be drawn after the casing *and* the core of the selected route: the
    // whole point is that the rider can see which part of the line changed.
    expect(ids.indexOf(MAP_LAYER_IDS.changedSpan)).toBeGreaterThan(
      ids.indexOf(MAP_LAYER_IDS.routeCasing),
    );
    expect(ids.indexOf(MAP_LAYER_IDS.changedSpan)).toBeGreaterThan(
      ids.indexOf(MAP_LAYER_IDS.routeSelected),
    );
    // Presentation state is not a selectable object: a tap on the emphasis is a tap
    // on the route beneath it.
    expect(HIT_LAYER_IDS).not.toContain(MAP_LAYER_IDS.changedSpan);
  });

  it("names every source and layer the host syncs", () => {
    expect(new Set(Object.values(MAP_SOURCE_IDS)).size).toBe(
      Object.keys(MAP_SOURCE_IDS).length,
    );
    expect(new Set(Object.values(MAP_LAYER_IDS)).size).toBe(
      Object.keys(MAP_LAYER_IDS).length,
    );
  });
});

/** A width, or a zoom ramp's thinnest stop: the weight the line never drops below. */
function lineWidthAtLeast(value: unknown): number {
  if (Array.isArray(value) && value[0] === "interpolate") {
    return Math.min(...value.slice(3).filter((_, index) => index % 2 === 1).map(Number));
  }
  return Number(value ?? 0);
}
