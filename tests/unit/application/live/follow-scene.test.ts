import { describe, expect, it } from "vitest";

import { buildFollowScene, followCameraFor, followConfidence, plannedLine } from "@/application/live/follow-scene";
import { RIDE_CAMERA_PITCH } from "@/application/map/ride-camera";
import type { LiveFollowSnapshot, LivePoint } from "@/domain/live/types";

const NOW = Date.UTC(2026, 9, 3, 19, 41, 0);

function point(t: number, overrides: Partial<LivePoint> = {}): LivePoint {
  return { t, lat: 40.1, lon: -75.4, speed: 17, heading: 180, accuracy: 8, battery: 0.5, ...overrides };
}

function snapshot(overrides: Partial<LiveFollowSnapshot> = {}): LiveFollowSnapshot {
  return {
    riderName: "Sam",
    status: "riding",
    alert: null,
    updatedAt: NOW - 10_000,
    last: point(NOW - 10_000),
    trail: [
      { t: NOW - 20_000, lat: 40.09, lon: -75.39, speed: 17 },
      { t: NOW - 10_000, lat: 40.1, lon: -75.4, speed: 17 },
    ],
    route: {
      segments: [
        [{ lon: -75.4, lat: 40.1 }, { lon: -75.41, lat: 40.2 }, { lon: -75.42, lat: 40.3 }],
        [{ lon: -75.5, lat: 40.4 }, { lon: -75.51, lat: 40.5 }],
      ],
    },
    ...overrides,
  };
}

describe("follower map scene", () => {
  it("draws the plan as the chosen line, one route per planned segment", () => {
    const scene = buildFollowScene(snapshot(), NOW);
    const planned = scene.routes.filter((route) => route.state === "selected");
    expect(planned.map((route) => route.id)).toEqual(["live-planned-0", "live-planned-1"]);
    expect(planned[0]?.geometry).toHaveLength(3);
    expect(scene.selectedRouteId).toBe("live-planned-0");
    // Nothing is tappable into an edit on a follower's map.
    expect(scene.selectedObject).toBeNull();
    expect(scene.points).toEqual([]);
  });

  it("draws the ridden breadcrumb in the travelled treatment, under the plan", () => {
    const scene = buildFollowScene(snapshot(), NOW);
    const trail = scene.routes.find((route) => route.id === "live-trail");
    expect(trail?.state).toBe("travelled");
    expect(trail?.geometry).toEqual([{ lon: -75.39, lat: 40.09 }, { lon: -75.4, lat: 40.1 }]);
    // The plan is drawn after the trail, so the road ahead reads heaviest.
    expect(scene.routes.map((route) => route.id)).toEqual(["live-planned-0", "live-planned-1", "live-trail"]);
  });

  it("marks the newest fix with how much of it may be presented as current", () => {
    const scene = buildFollowScene(snapshot(), NOW);
    expect(scene.riderPosition).toEqual({
      coordinate: { lon: -75.4, lat: 40.1 },
      confidence: "good",
      heading: 180,
    });
  });

  it("has no rider mark and no trail line before the first point", () => {
    const scene = buildFollowScene(snapshot({ last: null, trail: [] }), NOW);
    expect(scene.riderPosition).toBeNull();
    expect(scene.routes.map((route) => route.id)).toEqual(["live-planned-0", "live-planned-1"]);
  });

  it("draws neither line when nothing is shareable or nothing is drawable", () => {
    const scene = buildFollowScene(snapshot({ route: null, trail: [] }), NOW);
    expect(scene.routes).toEqual([]);
    expect(scene.selectedRouteId).toBeNull();
  });

  it("degrades a coarse fix and marks an old one stale", () => {
    const coarse = point(NOW - 5_000, { accuracy: 80 });
    expect(followConfidence(snapshot({ last: coarse }), NOW)).toBe("degraded");
    const old = point(NOW - 4 * 60_000);
    expect(followConfidence(snapshot({ last: old }), NOW)).toBe("stale");
    expect(followConfidence(snapshot({ last: null }), NOW)).toBe("stale");
  });

  it("follows the rider heading-up while they move, and asks the map to keep its bearing when they stop", () => {
    const moving = followCameraFor(snapshot());
    expect(moving).toEqual({ center: { lon: -75.4, lat: 40.1 }, bearing: 180, zoom: 15.4, pitch: RIDE_CAMERA_PITCH });

    const stoppedPoint = point(NOW - 5_000, { speed: 0, heading: 42 });
    // Nothing says which way the rider faces, so the host keeps the bearing the
    // map already has: a stopped rider's compass noise must not spin it.
    expect(followCameraFor(snapshot({ last: stoppedPoint, route: null }))?.bearing).toBeNull();
    expect(followCameraFor(snapshot({ last: null }))).toBeNull();
  });

  it("reads the direction from the longest planned segment when the fix has no heading", () => {
    const noHeading = point(NOW - 5_000, { heading: null, speed: 20 });
    const bearing = followCameraFor(snapshot({ last: noHeading }))?.bearing ?? null;
    expect(bearing).not.toBeNull();
    // The plan runs north from the rider, so the camera points just west of north.
    expect(bearing).toBeGreaterThan(340);
    expect(bearing).toBeLessThan(360);
    expect(plannedLine(snapshot().route).length).toBe(3);
    expect(plannedLine(null)).toEqual([]);
  });
});
