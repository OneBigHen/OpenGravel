/**
 * The curated rides layer (first-minute wow, W5): the provider contracts.
 *
 * What is proved here is what a rider is promised: only the curated catalog
 * set is drawn, a line is simplified to a few hundred points without losing its
 * shape, the same view is answered from cache, and a surface the source does
 * not state is "unknown" — never paved.
 */

import { describe, expect, it, vi } from "vitest";

import {
  MAX_CURATED_ROUTE_POINTS,
  curatedRideFeature,
  curatedRideIntersects,
  curatedRideItems,
  curatedRideSurface,
  curatedRideSurfaceLine,
  simplifyCuratedLine,
  type CuratedRideSeed,
} from "@/application/map-layers";
import { curatedRidesProvider } from "@/server/map-layers/providers";

const VIEW = { west: -76.9, south: 41.3, east: -76.5, north: 41.6 };

function seed(overrides: Partial<CuratedRideSeed> = {}): CuratedRideSeed {
  return {
    id: "fb-loop",
    name: "Loyalsock State Forest Loop",
    provenance: "PA Adventure Bike Rides · Loyalsock_Forest_.gpx",
    distanceKm: 154.478,
    bounds: { west: -76.86, south: 41.32, east: -76.5, north: 41.54 },
    geometry: Array.from({ length: 1_200 }, (_, index) => ({
      lon: -76.8 + (index / 1_200) * 0.3,
      lat: 41.4 + Math.sin(index / 40) * 0.05,
    })),
    surfaceSummary: "Mixed · 24 mi unpaved",
    ...overrides,
  };
}

describe("the curated ride line", () => {
  it("is simplified to a few hundred points, keeping both ends and the order", () => {
    const line = seed().geometry.map((point) => [point.lon, point.lat] as const);
    const simplified = simplifyCuratedLine(line);
    expect(simplified.length).toBeLessThanOrEqual(MAX_CURATED_ROUTE_POINTS);
    expect(simplified.length).toBeGreaterThan(20);
    expect(simplified[0]).toEqual(line[0]);
    expect(simplified.at(-1)).toEqual(line.at(-1));
    for (let index = 1; index < simplified.length; index += 1) {
      expect(simplified[index]![0]).toBeGreaterThan(simplified[index - 1]![0]);
    }
  });

  it("keeps a short line as it is and never invents a point", () => {
    const line = [[-76.8, 41.4], [-76.7, 41.45]] as const;
    expect(simplifyCuratedLine(line)).toEqual(line);
  });
});

describe("the curated ride's surface line", () => {
  it("says unknown when the source states no surface, and never says paved", () => {
    const unknown = curatedRideSurfaceLine({ miles: 96, surface: curatedRideSurface(undefined) });
    expect(unknown).toBe("Surface unknown");
    expect(unknown).not.toMatch(/paved/i);
    // An unrecognised sentence is unknown too: the card may not guess.
    expect(curatedRideSurfaceLine({ miles: 96, surface: curatedRideSurface("Gravelly, probably") })).toBe("Surface unknown");
  });

  it("reports a stated gravel share from the route's own distance", () => {
    const line = curatedRideSurfaceLine({
      miles: 100,
      surface: curatedRideSurface("Mostly paved · 25 mi gravel"),
    });
    expect(line).toBe("25% gravel · 25 mi");
  });

  it("reads a stated mixed surface, and 'Paved' as all paved", () => {
    expect(curatedRideSurfaceLine({ miles: 96, surface: curatedRideSurface("Mixed · 24 mi unpaved") }))
      .toBe("25% unpaved · 24 mi");
    expect(curatedRideSurfaceLine({ miles: 40, surface: curatedRideSurface("Paved") })).toBe("All paved");
  });
});

describe("the curated rides provider", () => {
  it("draws only the PA Adventure Bike Rides set", () => {
    const items = curatedRideItems([
      seed(),
      seed({ id: "roost", provenance: "Roost · Roost/roostlocker_gpx/NW_PA/Allegheny-all.gpx" }),
      seed({ id: "demo", provenance: "Synthetic demo route — not a real or recommended ride." }),
    ]);
    expect(items.map((item) => item.feature.id)).toEqual(["catalog:fb-loop"]);
  });

  it("carries the facts the card shows, with the id 'Ride this' opens", () => {
    const feature = curatedRideFeature(seed())?.feature;
    expect(feature).toMatchObject({
      id: "catalog:fb-loop",
      layerId: "rider-picked",
      name: "Loyalsock State Forest Loop",
      catalogRide: {
        routeId: "fb-loop",
        surface: { unpavedMiles: 24, unpavedKind: "unpaved" },
      },
    });
    expect(feature?.catalogRide?.miles).toBeCloseTo(96, 1);
    expect(feature?.geometry.type).toBe("LineString");
  });

  it("answers a view from cache, and asks the catalog only once", async () => {
    const entries = vi.fn(async () => [seed()]);
    const provider = curatedRidesProvider(entries);
    const context = { fetch: vi.fn() as unknown as typeof fetch, env: {} };
    const first = await provider.load(VIEW, ["rider-picked"], context);
    const second = await provider.load(VIEW, ["rider-picked"], context);
    expect(first).toHaveLength(1);
    expect(second).toBe(first);
    expect(entries).toHaveBeenCalledTimes(1);
    expect(provider.ttlMs).toBeGreaterThanOrEqual(60 * 60_000);
  });

  it("leaves out a ride whose box is outside the view", async () => {
    const provider = curatedRidesProvider(async () => [seed()]);
    const features = await provider.load(
      { west: -70, south: 38, east: -69, north: 39 },
      ["rider-picked"],
      { fetch: vi.fn() as unknown as typeof fetch, env: {} },
    );
    expect(features).toEqual([]);
  });

  it("counts a route that crosses the view without a vertex inside", () => {
    expect(curatedRideIntersects(
      { west: -76, south: 41.4, east: -75.9, north: 41.5 },
      { west: -77, south: 41.0, east: -75.8, north: 42.0 },
    )).toBe(true);
  });
});
