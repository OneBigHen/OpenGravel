import { expect, it } from "vitest";
import { summarizeRoadDetails } from "@/infrastructure/routing/graphhopper/road-details";

it("preserves speed, roughness, access and link facts in travel order", () => {
  const summary = summarizeRoadDetails([{ lat: 40, lon: -75 }, { lat: 40, lon: -74.999 }, { lat: 40, lon: -74.998 }], {
    surface: [[0, 2, "gravel"]], road_class: [[0, 2, "track"]],
    track_type: [[0, 1, "grade2"], [1, 2, "grade3"]], smoothness: [[0, 2, "bad"]],
    max_speed: [[0, 2, 64]], max_speed_estimated: [[0, 2, true]],
    road_class_link: [[0, 2, false]], roundabout: [[0, 2, false]],
    car_access: [[0, 2, true]], road_access: [[0, 2, "yes"]],
  });
  expect(summary?.roadRuns).toHaveLength(2);
  expect(summary?.roadRuns?.[0]).toMatchObject({ trackType: "grade2", smoothness: "bad", maxSpeedKmh: 64, maxSpeedEstimated: true, roadClassLink: false, roundabout: false, carAccess: true, roadAccess: "yes" });
  expect(summary?.roadRuns?.[1]).toMatchObject({ trackType: "grade3" });
});

it("keeps unavailable optional road facts null", () => {
  const summary = summarizeRoadDetails([{ lat: 40, lon: -75 }, { lat: 40, lon: -74.999 }], { surface: [[0, 1, "asphalt"]] });
  expect(summary?.roadRuns?.[0]).toMatchObject({ maxSpeedKmh: null, maxSpeedEstimated: null, trackType: null, smoothness: null, carAccess: null, roadAccess: null });
});
