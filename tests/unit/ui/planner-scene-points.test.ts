import { describe, expect, it } from "vitest";

import type { MapScene } from "@/application/map/types";
import { sceneAtRest } from "@/ui/planner/scene-points";

const scene: MapScene = {
  mode: "plan",
  routes: [],
  selectedRouteId: null,
  points: [
    { id: "p_start" as never, kind: "start", coordinate: { lat: 40, lon: -75 }, label: null },
    { id: "p_stop" as never, kind: "stop", coordinate: { lat: 40.1, lon: -75 }, label: "Fuel" },
    { id: "p_shape" as never, kind: "shaping", coordinate: { lat: 40.2, lon: -75 }, label: null },
    { id: "p_finish" as never, kind: "finish", coordinate: { lat: 40.3, lon: -75 }, label: null },
  ],
  preview: null,
  avoidAreas: [],
  roadSpans: [],
  roadSpanPreview: null,
  sketch: null,
  sketchDraft: null,
  avoidHandles: [],
  previewArea: null,
  changedSpan: null,
  riderPosition: null,
  selectedObject: null,
};

describe("sceneAtRest", () => {
  it("keeps only the ride's places when the rider is not editing", () => {
    expect(sceneAtRest(scene, false).points.map((point) => point.kind)).toEqual([
      "start",
      "stop",
      "finish",
    ]);
  });

  it("shows shaping handles while the rider is editing", () => {
    expect(sceneAtRest(scene, true)).toBe(scene);
  });

  it("returns the same scene when there was no shaping handle to hide", () => {
    const withoutShaping = { ...scene, points: scene.points.filter((point) => point.kind !== "shaping") };
    expect(sceneAtRest(withoutShaping, false)).toBe(withoutShaping);
  });
});
