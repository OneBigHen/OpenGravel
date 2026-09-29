import { describe, expect, it } from "vitest";

import type { MapScene } from "@/application/map/types";
import { asPlaceId } from "@/application/places/types";
import { placesFeatureCollection } from "@/infrastructure/map/maplibre/geojson";

const BASE_SCENE: MapScene = {
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
};

describe("placesFeatureCollection", () => {
  it("returns an empty collection when the scene has no places", () => {
    expect(placesFeatureCollection(BASE_SCENE)).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });

  it("projects place coordinates and renderer properties without ride-object fields", () => {
    const place = {
      id: asPlaceId("hh:venue-1"),
      kind: "happy_hour" as const,
      coordinate: { lon: -75.25, lat: 39.97 },
      pill: "$3 · til 10p",
      tone: "live" as const,
      priority: 325,
      selected: true,
    };

    expect(placesFeatureCollection({ ...BASE_SCENE, places: [place] })).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: 0,
          geometry: { type: "Point", coordinates: [-75.25, 39.97] },
          properties: {
            id: "hh:venue-1",
            kind: "happy_hour",
            pill: "$3 · til 10p",
            tone: "live",
            priority: 325,
            selected: true,
          },
        },
      ],
    });
  });
});
