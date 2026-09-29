import { describe, expect, it } from "vitest";

import type { CatalogEntry } from "@/application/explore/catalog";
import { routeMetadata } from "@/server/explore/route-metadata";

const entry = {
  id: "fb-1",
  source: "catalog",
  name: "Hawk Mountain Loop",
  region: "Pennsylvania",
  summary: "A loop over the ridge",
  distanceKm: 80.5,
  bounds: null,
  geometry: [{ lon: -75.9, lat: 40.6 }, { lon: -75.8, lat: 40.7 }],
  provenance: "PA Adventure Bike Rides",
  surfaceSummary: "Mostly paved",
  storyTeaser: { sourceName: "PA Adventure Bike Rides", sharedBy: "Seth", commentCount: 0, photoCount: 1 },
} as unknown as CatalogEntry;

describe("route link previews", () => {
  it("unfurls a route as its name, distance, story line and map", () => {
    const meta = routeMetadata("fb-1", [entry], "pk.test");
    expect(meta.title).toBe("Hawk Mountain Loop · 50 mi · OpenGravel");
    expect(meta.description).toContain("Shared by Seth in PA Adventure Bike Rides");
    expect(meta.description).toContain("Mostly paved");
    const images = meta.openGraph?.images as readonly { url: string }[];
    expect(images[0]?.url).toContain("api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/");
  });

  it("keeps the site card for an unknown route and has no image without a map key", () => {
    expect(routeMetadata("nope", [entry], "pk.test")).toEqual({});
    const meta = routeMetadata("fb-1", [entry], undefined);
    expect(meta.openGraph?.images).toBeUndefined();
    expect((meta.twitter as { card?: string }).card).toBe("summary");
  });
});
