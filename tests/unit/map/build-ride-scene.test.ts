import { describe, expect, it } from "vitest";
import { buildRideScene, splitRouteAtProgress } from "@/application/map/build-ride-scene";
import { asRouteCandidateId } from "@/domain/route/ids";

const LINE = [
  { lon: -77.2, lat: 40.1 },
  { lon: -77.19, lat: 40.11 },
] as const;

/** Ten even steps along the equator, so length and longitude agree. */
const EQUATOR = Array.from({ length: 11 }, (_, index) => ({ lon: index / 10, lat: 0 }));

const ROUTE_ID = asRouteCandidateId("route_followed");

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

describe("buildRideScene splits the followed line at the matcher's progress point", () => {
  const guided = (progressFraction: number | null, onRoute = true, quality: "fresh-good" | "fresh-poor" | "stale" | "unavailable" = "fresh-good") =>
    buildRideScene({
      routeId: ROUTE_ID,
      routeLine: EQUATOR,
      progressFraction,
      onRoute,
      position: { coordinate: { lon: 0.3, lat: 0 }, quality },
    });

  it("draws the ridden half as travelled and the rest as the selected line", () => {
    const scene = guided(0.35);

    expect(scene.routes.map((route) => route.state)).toEqual(["selected", "travelled"]);
    expect(scene.routes.map((route) => route.id)).toEqual([ROUTE_ID, ROUTE_ID]);
    expect(scene.selectedRouteId).toBe(ROUTE_ID);
    const [ahead, travelled] = scene.routes;
    // The split point is at 35 % of this line's own length, on the equator the
    // ten even steps were built on.
    expect(travelled?.geometry.at(-1)?.lon).toBeCloseTo(0.35, 3);
    expect(travelled?.geometry.at(-1)?.lat).toBeCloseTo(0, 6);
    // The two halves meet exactly, so the rider never sees a gap where they are.
    expect(ahead?.geometry[0]).toEqual(travelled?.geometry.at(-1));
    // Travel order is preserved on both sides.
    expect(travelled?.geometry[0]).toEqual(EQUATOR[0]);
    expect(ahead?.geometry.at(-1)).toEqual(EQUATOR.at(-1));
    // The ridden line is never drawn as the "previous answer" treatment.
    expect(scene.routes.some((route) => route.state === "previous")).toBe(false);
  });

  it("lands the split on a vertex when the progress point is one", () => {
    const scene = buildRideScene({
      routeId: ROUTE_ID,
      routeLine: EQUATOR,
      progressFraction: 0.5,
      onRoute: true,
      position: { coordinate: { lon: 0.5, lat: 0 }, quality: "fresh-poor" },
    });

    const travelled = scene.routes.find((route) => route.state === "travelled")?.geometry ?? [];
    const ahead = scene.routes.find((route) => route.state === "selected")?.geometry ?? [];
    expect(travelled).toHaveLength(6);
    expect(ahead).toHaveLength(6);
    expect(travelled.at(-1)?.lon).toBeCloseTo(0.5, 3);
    expect(ahead[0]).toEqual(travelled.at(-1));
  });

  it("keeps the whole line ahead when progress is not known", () => {
    const cases: readonly [string, number | null, boolean, "fresh-good" | "fresh-poor" | "stale" | "unavailable"][] = [
      ["the matcher has not answered", null, true, "fresh-good"],
      ["the match is off the line", 0.35, false, "fresh-good"],
      ["the fix is stale", 0.35, true, "stale"],
      ["there is no fix", 0.35, true, "unavailable"],
      ["the fraction is not finite", Number.NaN, true, "fresh-good"],
      ["the rider has not started", 0, true, "fresh-good"],
      ["the rider has finished the line", 1, true, "fresh-good"],
    ];

    for (const [reason, fraction, onRoute, quality] of cases) {
      const scene = guided(fraction, onRoute, quality);
      expect(scene.routes, reason).toHaveLength(1);
      expect(scene.routes[0]?.state, reason).toBe("selected");
      expect(scene.routes[0]?.geometry, reason).toEqual(EQUATOR);
    }
  });

  it("never splits a line into a half too short to draw", () => {
    // A 1e-6 fraction on a two-position line is half a millimetre of progress:
    // the ridden half would be a single position, which MapLibre rejects.
    const scene = buildRideScene({
      routeId: ROUTE_ID,
      routeLine: LINE,
      progressFraction: 1e-6,
      onRoute: true,
      position: { coordinate: LINE[0], quality: "fresh-good" },
    });

    expect(scene.routes).toEqual([{
      id: ROUTE_ID,
      role: null,
      geometry: LINE,
      state: "selected",
    }]);
  });

  it("draws nothing when the followed line did not resolve", () => {
    const scene = buildRideScene({
      routeId: ROUTE_ID,
      routeLine: [],
      progressFraction: 0.35,
      onRoute: true,
      position: { coordinate: LINE[0], quality: "fresh-good" },
    });

    expect(scene.routes).toEqual([]);
    expect(scene.selectedRouteId).toBe(ROUTE_ID);
  });
});

describe("splitRouteAtProgress", () => {
  it("refuses anything that is not a fraction strictly inside the line", () => {
    for (const fraction of [null, 0, 1, -0.2, 1.4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(splitRouteAtProgress(EQUATOR, fraction)).toBeNull();
    }
    expect(splitRouteAtProgress([{ lon: 0, lat: 0 }], 0.5)).toBeNull();
    expect(splitRouteAtProgress([], 0.5)).toBeNull();
  });

  it("measures along the geometry as drawn, not along longitude", () => {
    // At this latitude the first segment of a two-position line is the whole
    // line, so half of the total is its own midpoint.
    const line = [{ lon: -77.2, lat: 40.1 }, { lon: -77.0, lat: 40.2 }];
    const split = splitRouteAtProgress(line, 0.5);
    const middle = split?.travelled.at(-1);

    expect(middle?.lon).toBeCloseTo(-77.1, 2);
    expect(middle?.lat).toBeCloseTo(40.15, 2);
    expect(split?.ahead[0]).toEqual(middle);
  });
});
