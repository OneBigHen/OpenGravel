import { describe, expect, it } from "vitest";

import { encodePolyline, staticPointsMapUrl, staticRouteMapUrl } from "@/application/map/static-map";

describe("static route map", () => {
  it("encodes the polyline the way the API reads it", () => {
    // Google's documented example.
    expect(encodePolyline([
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ])).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });

  it("builds a bounded Outdoors image URL with the route over a casing", () => {
    const line = Array.from({ length: 500 }, (_, index) => ({ lon: -75 + index / 1000, lat: 40 + Math.sin(index / 50) / 100 }));
    const url = staticRouteMapUrl(line, { token: "pk.test-token-123", width: 192, height: 128 });
    expect(url).toMatch(/^https:\/\/api\.mapbox\.com\/styles\/v1\/mapbox\/outdoors-v12\/static\/path-6\+ffffff/);
    expect(url).toContain("/auto/192x128@2x?");
    expect(url).toContain("access_token=pk.test-token-123");
    expect(url!.length).toBeLessThan(8000);
    expect(staticRouteMapUrl([], { token: "pk.x", width: 10, height: 10 })).toBeNull();
  });

  it("draws a Night list on the dark style, with a dark casing", () => {
    const line = [{ lon: -75.5, lat: 40.5 }, { lon: -75.2, lat: 40.7 }];
    const url = staticRouteMapUrl(line, { token: "pk.test-token-123", width: 256, height: 256, night: true });
    expect(url).toContain("/styles/v1/mapbox/navigation-night-v1/static/path-6+1b2421");
    const points = staticPointsMapUrl(line, { token: "pk.test-token-123", width: 400, height: 225, night: true });
    expect(points).toContain("/styles/v1/mapbox/navigation-night-v1/static/");
    // Day is unchanged.
    expect(staticPointsMapUrl(line, { token: "pk.test-token-123", width: 400, height: 225 }))
      .toContain("/styles/v1/mapbox/outdoors-v12/static/");
  });

  it("pins a planned ride's points, start blue and finish ember", () => {
    const url = staticPointsMapUrl([{ lon: -75.28, lat: 40.24 }, { lon: -75.13, lat: 40.31 }], { token: "pk.t", width: 400, height: 170 });
    expect(url).toContain("pin-s+397c96(-75.28000,40.24000),pin-s+d65a36(-75.13000,40.31000)/auto/400x170@2x");
    // One point: a town-level view around it.
    expect(staticPointsMapUrl([{ lon: -75.28, lat: 40.24 }], { token: "pk.t", width: 400, height: 170 })).toContain("/-75.28000,40.24000,11/");
    expect(staticPointsMapUrl([], { token: "pk.t", width: 400, height: 170 })).toBeNull();
  });
});
