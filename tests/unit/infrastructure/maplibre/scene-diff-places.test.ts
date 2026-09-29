import { describe, expect, it } from "vitest";

import type { MapScene } from "@/application/map/types";
import { asPlaceId } from "@/application/places/types";
import { fingerprintScene, planSceneSync } from "@/infrastructure/map/maplibre/scene-diff";

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

const PLACE = {
  id: asPlaceId("ev:festival"),
  kind: "event" as const,
  coordinate: { lon: -75.25, lat: 39.97 },
  pill: "Sat 7p",
  tone: "soon" as const,
  priority: 210,
  selected: false,
};

describe("place scene diff", () => {
  it("keys place presentation and position independently from routes", () => {
    const before = fingerprintScene({ ...BASE_SCENE, places: [PLACE] });
    const changedPlace = fingerprintScene({
      ...BASE_SCENE,
      places: [{ ...PLACE, pill: "Sat 8p", selected: true }],
    });
    const plan = planSceneSync(before, {
      ...BASE_SCENE,
      places: [{ ...PLACE, pill: "Sat 8p", selected: true }],
    });

    expect(changedPlace.places).not.toBe(before.places);
    expect(plan.places).toBe(true);
    expect(plan.routes).toBe(false);
  });

  it("does not re-upload places for unrelated route and camera scene changes", () => {
    const previous = fingerprintScene({ ...BASE_SCENE, places: [PLACE] });
    const next = planSceneSync(previous, {
      ...BASE_SCENE,
      places: [PLACE],
      riderPosition: { coordinate: { lon: -75.2, lat: 39.9 }, confidence: "good" },
    });

    expect(next.places).toBe(false);
    expect(next.routes).toBe(false);
    expect(next.riderPosition).toBe(true);
  });
});
