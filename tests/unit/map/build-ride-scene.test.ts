import { describe, expect, it } from "vitest";
import { buildRideScene } from "@/application/map/build-ride-scene";
import { asRouteCandidateId } from "@/domain/route/ids";

const LINE = [
  { lon: -77.2, lat: 40.1 },
  { lon: -77.19, lat: 40.11 },
] as const;

describe("buildRideScene Free Ride candidate preview", () => {
  it("draws an offered suggestion as a preview without selecting or binding it", () => {
    const routeId = asRouteCandidateId("route_suggestion_preview");
    const scene = buildRideScene({
      routeId: null,
      routeLine: [],
      suggestionPreview: { routeId, routeLine: LINE },
      position: { coordinate: LINE[0], quality: "fresh-good" },
    });

    expect(scene.routes).toEqual([{
      id: routeId,
      role: null,
      geometry: LINE,
      state: "preview",
    }]);
    expect(scene.selectedRouteId).toBeNull();
    expect(scene.riderPosition?.coordinate).toEqual(LINE[0]);
  });

  it("keeps the active route treatment when a bound route replaces its preview", () => {
    const routeId = asRouteCandidateId("route_suggestion_preview");
    const scene = buildRideScene({
      routeId,
      routeLine: LINE,
      suggestionPreview: { routeId, routeLine: LINE },
      position: { coordinate: LINE[0], quality: "fresh-good" },
    });

    expect(scene.routes).toHaveLength(1);
    expect(scene.routes[0]?.state).toBe("selected");
    expect(scene.selectedRouteId).toBe(routeId);
  });
});
