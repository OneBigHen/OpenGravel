import { describe, expect, it } from "vitest";

import { parseCatalogEntry, type CatalogEntry } from "@/application/explore/catalog";
import { buildCatalogRecords } from "@/application/explore/catalog-build";
import { parseRideStory, storySummary, type CatalogRideStory } from "@/application/explore/ride-story";
import { handleCatalogDetail, handleCatalogList } from "@/server/explore/catalog-http";

const story: CatalogRideStory = {
  source: { name: "PA Adventure Bike Rides", kind: "Facebook group", url: "https://www.facebook.com/groups/1/permalink/2/" },
  sharedBy: "Scott Lepping",
  sharedAt: "2024-03-31T13:03:56.000Z",
  description: "Updated Bake Oven Knob Loop with more gravel. Designed to be ridden clockwise from Green Lane Park.",
  comments: [{ text: "Sacks Road is legal as far as I know.", postedAt: "2025-09-01T00:00:00.000Z" }],
  photos: [{ src: "/catalog-media/pa-adventure-bike-rides/bok-abc123.webp", width: 1200, height: 800 }],
  stops: [{ name: "Unsafe left turn onto PA 66", kind: "hazard", mile: 12.4, lat: 40.6, lon: -75.6 }],
  optionalLegs: [{ name: "Epic Loop ALT1", miles: 2.2 }],
};

const entry: CatalogEntry = {
  id: "route-story", source: "catalog", name: "Bake Oven Knob Loop", region: "Pennsylvania", summary: "Updated loop",
  distanceKm: 276, bounds: null, geometry: [{ lon: -75.6, lat: 40.5 }, { lon: -75.5, lat: 40.6 }],
  provenance: "PA Adventure Bike Rides · BOK24.GPX", story,
};

describe("ride stories", () => {
  it("round-trips a well-formed story through catalog parsing", () => {
    expect(parseCatalogEntry(entry)?.story).toEqual(story);
  });

  it("rejects a catalog entry whose story carries off-site media or script links", () => {
    expect(parseCatalogEntry({ ...entry, story: { ...story, photos: [{ src: "https://evil.example/x.jpg", width: 1, height: 1 }] } })).toBeNull();
    expect(parseCatalogEntry({ ...entry, story: { ...story, photos: [{ src: "/catalog-media/../secret", width: 1, height: 1 }] } })).toBeNull();
    expect(parseRideStory({ ...story, source: { ...story.source, url: "javascript:alert(1)" } })).toBeNull();
    expect(parseRideStory({ ...story, stops: [{ ...story.stops[0], kind: "teleport" }] })).toBeNull();
  });

  it("keeps the heavy story off the list and gives cards a byline-sized teaser instead", () => {
    const list = handleCatalogList(new URL("http://localhost/api/catalog"), [entry]);
    const route = (list.body.routes as Record<string, unknown>[])[0]!;
    expect(route.story).toBeUndefined();
    expect(route.storyTeaser).toEqual({ sourceName: "PA Adventure Bike Rides", sharedBy: "Scott Lepping", commentCount: 1, photoCount: 1 });
    expect(parseCatalogEntry({ ...route, geometry: entry.geometry })?.storyTeaser?.sharedBy).toBe("Scott Lepping");
    expect(handleCatalogDetail("route-story", [entry]).body).toEqual({ route: entry });
  });

  it("finds routes by words in the rider's post", () => {
    const hit = handleCatalogList(new URL("http://localhost/api/catalog?search=clockwise"), [entry]);
    expect(hit.body).toMatchObject({ count: 1 });
  });

  it("trims a post to a card line on sentence boundaries", () => {
    expect(storySummary(undefined)).toBeUndefined();
    expect(storySummary("Short and sweet.")).toBe("Short and sweet.");
    const long = "First sentence is here and it sets the scene. Second sentence adds some more detail about the loop. Third sentence runs well past the limit that a card can hold without wrapping.";
    expect(storySummary(long, 100)).toBe("First sentence is here and it sets the scene. Second sentence adds some more detail about the loop.");
    expect(storySummary("x".repeat(20) + " " + "word ".repeat(60), 80)!.endsWith("…")).toBe(true);
  });

  it("builds records that carry the story, the post line and explicit track labels", () => {
    const points = [[-75.6, 40.5], [-75.55, 40.55], [-75.5, 40.6]] as const;
    const [record] = buildCatalogRecords([{
      id: "fb-abc--t2", name: "Armstrong County Loops", sourceProject: "PA Adventure Bike Rides", sourceFile: "armstrong.gpx",
      author: "Jason Fleming", gpx: "", geometry: points, trackLabel: "Outer loop · 215 mi", summary: "Updated loops.", story,
    }]);
    expect(record).toMatchObject({ trackLabel: "Outer loop · 215 mi", summary: "Updated loops.", story });
    const [unlabelled] = buildCatalogRecords([{
      id: "fb-abc--t2", name: "Loop", sourceProject: "PA Adventure Bike Rides", sourceFile: "loop.gpx", gpx: "", geometry: points, trackLabel: null,
    }]);
    expect(unlabelled?.trackLabel).toBeUndefined();
    expect(unlabelled?.summary).toMatch(/mi route$/);
  });
});
