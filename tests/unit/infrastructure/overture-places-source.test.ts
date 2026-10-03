import { describe, expect, it } from "vitest";

import {
  createOverturePlacesSource,
  overtureInterestingPlace,
  type OverturePlacesIndex,
} from "@/infrastructure/discover/overture-places-source";

const INDEX: OverturePlacesIndex = {
  version: 1,
  release: "2026-09-23.1",
  schema: "v2.0.0",
  builtAt: "2026-10-02T12:00:00.000Z",
  places: [{
    id: "gers-test",
    name: "Rider Museum",
    c: ["museum"],
    at: [-75.4, 40.2],
    confidence: 0.91,
    website: "https://example.test/museum",
  }],
};

describe("Overture regional Discover source", () => {
  it("maps one indexed place into provider-neutral Discover provenance", () => {
    expect(overtureInterestingPlace(INDEX.places[0]!, INDEX.builtAt)).toMatchObject({
      id: "overture:gers-test",
      name: "Rider Museum",
      category: "museum",
      confidence: 0.91,
      provenance: [{
        sourceId: "overture",
        sourceLabel: "Overture Maps",
        recordId: "overture:gers-test",
      }],
    });
  });

  it("answers locally from the regional grid and respects search radius", async () => {
    const source = createOverturePlacesSource({ load: async () => INDEX });
    const near = await source.search({
      samples: [{ center: { lon: -75.4, lat: 40.2 }, radiusMeters: 2_000 }],
    }, new AbortController().signal);
    const far = await source.search({
      samples: [{ center: { lon: -76.4, lat: 41.2 }, radiusMeters: 2_000 }],
    }, new AbortController().signal);

    expect(near.status).toBe("ok");
    expect(near.places.map((place) => place.name)).toEqual(["Rider Museum"]);
    expect(far.places).toEqual([]);
  });

  it("does not turn an invalid website into a rider link", () => {
    const place = overtureInterestingPlace({
      ...INDEX.places[0]!,
      website: "javascript:alert(1)",
    }, INDEX.builtAt);
    expect(place?.provenance[0]?.url).toBeNull();
  });
});
