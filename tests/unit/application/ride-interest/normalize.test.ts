/**
 * Provider parsing (OGV#13): each source's own shape becomes a
 * `RideInterestPoint`, namespaced by id so a tap can be routed back without
 * the UI knowing which provider answered.
 */

import { describe, expect, it } from "vitest";

import {
  alongStopsToRideInterest,
  discoverCategoryFilter,
  discoverPlacesToRideInterest,
  mapLayerFilter,
  nearbyPlacesToRideInterest,
} from "@/application/ride-interest/normalize";
import type { InterestingPlace } from "@/application/discover/types";
import type { AlongStop } from "@/application/map-layers/along";
import type { InfoFeature } from "@/application/map-layers/types";
import { asPlaceId, type NearbyPlace } from "@/application/places/types";

const AT = "2026-09-27T14:00:00.000Z";

function first<T>(list: readonly T[]): T {
  const value = list[0];
  if (value === undefined) throw new Error("expected at least one result");
  return value;
}

function discoverPlace(overrides: Partial<InterestingPlace> = {}): InterestingPlace {
  return {
    id: "wikidata:Q1",
    name: "Ringing Rocks County Park",
    category: "quirky",
    categories: ["quirky"],
    coordinate: { lon: -75.13, lat: 40.56 },
    description: "A boulder field that rings when struck.",
    image: null,
    wikidataId: "Q1",
    facts: {},
    tags: [],
    confidence: 0.8,
    provenance: [{ sourceId: "wikimedia", sourceLabel: "Wikimedia", recordId: "wikidata:Q1", url: "https://example.test/q1", retrievedAt: AT }],
    ...overrides,
  };
}

function infoFeature(overrides: Partial<InfoFeature> = {}): InfoFeature {
  return {
    id: "osm:node/1",
    layerId: "fuel",
    name: "Sunoco",
    detail: "Open 24 hours",
    weight: null,
    geometry: { type: "Point", coordinates: [-75.2, 40.1] },
    ...overrides,
  };
}

function alongStop(overrides: Partial<AlongStop> = {}): AlongStop {
  return { feature: infoFeature(), alongMeters: 1000, offMeters: 50, ...overrides };
}

function nearbyPlace(overrides: Partial<NearbyPlace> = {}): NearbyPlace {
  return {
    id: asPlaceId("hh:chickies"),
    kind: "happy_hour",
    name: "Chickie's & Pete's",
    coordinate: { lon: -75.2, lat: 40.1 },
    category: "Bar",
    label: "Til 10 PM",
    status: "now",
    city: "Bridgeport",
    address: "",
    specials: ["$3 drafts"],
    schedule: "Mon–Fri 4–7 PM",
    rating: null,
    popular: false,
    dogFriendly: null,
    patio: null,
    url: "https://places.example/chickies",
    mapsUrl: null,
    offRouteMiles: 0.3,
    routeMile: 42,
    ...overrides,
  };
}

describe("discoverCategoryFilter", () => {
  it("buckets an event as Events and everything else as Scenic", () => {
    expect(discoverCategoryFilter("event")).toBe("events");
    for (const category of ["waterfall", "viewpoint", "history", "quirky", "camping", "recreation"] as const) {
      expect(discoverCategoryFilter(category)).toBe("scenic");
    }
  });
});

describe("discoverPlacesToRideInterest", () => {
  it("namespaces the id and carries the name, coordinate and description through", () => {
    const point = first(discoverPlacesToRideInterest([discoverPlace()]));
    expect(point).toMatchObject({
      id: "ri:discover:wikidata:Q1",
      filter: "scenic",
      kind: "quirky",
      name: "Ringing Rocks County Park",
      coordinate: { lon: -75.13, lat: 40.56 },
      summary: "A boulder field that rings when struck.",
      photoUrl: null,
      detailUrl: "https://example.test/q1",
      attribution: "Wikimedia",
    });
  });

  it("takes the image url when the source has one", () => {
    const point = first(discoverPlacesToRideInterest([discoverPlace({
      image: {
        url: "https://upload.wikimedia.org/x.jpg",
        pageUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
        author: "Jane Rider",
        license: "CC BY-SA 4.0",
        licenseUrl: null,
        attributionRequired: true,
      },
    })]));
    expect(point.photoUrl).toBe("https://upload.wikimedia.org/x.jpg");
  });

  it("falls back to a generic attribution and no detail link without provenance", () => {
    const point = first(discoverPlacesToRideInterest([discoverPlace({ provenance: [] })]));
    expect(point.attribution).toBe("Wikimedia");
    expect(point.detailUrl).toBeNull();
  });

  it("buckets an event category as the Events filter", () => {
    const point = first(discoverPlacesToRideInterest([discoverPlace({ category: "event", categories: ["event"] })]));
    expect(point.filter).toBe("events");
  });
});

describe("mapLayerFilter", () => {
  it("buckets fuel, food and coffee as Food & fuel", () => {
    expect(mapLayerFilter("fuel")).toBe("food");
    expect(mapLayerFilter("food")).toBe("food");
    expect(mapLayerFilter("coffee")).toBe("food");
  });

  it("buckets viewpoints and camping as Scenic", () => {
    expect(mapLayerFilter("viewpoints")).toBe("scenic");
    expect(mapLayerFilter("camping")).toBe("scenic");
  });

  it("has no bucket for a layer ride-interest does not show", () => {
    expect(mapLayerFilter("lodging")).toBeNull();
    expect(mapLayerFilter("terrain-3d")).toBeNull();
  });
});

describe("alongStopsToRideInterest", () => {
  it("converts a fuel stop into a Food & fuel point, namespaced by layer", () => {
    const point = first(alongStopsToRideInterest([alongStop()], "fuel"));
    expect(point).toMatchObject({
      id: "ri:layer:fuel:osm:node/1",
      filter: "food",
      kind: "fuel",
      name: "Sunoco",
      coordinate: { lon: -75.2, lat: 40.1 },
      summary: "Open 24 hours",
      attribution: "TomTom Search",
    });
  });

  it("skips a stop whose geometry is not a point", () => {
    const line = alongStop({ feature: infoFeature({ geometry: { type: "LineString", coordinates: [[-75.2, 40.1], [-75.1, 40.2]] } }) });
    expect(alongStopsToRideInterest([line], "fuel")).toEqual([]);
  });

  it("returns nothing for a layer ride-interest has no bucket for", () => {
    expect(alongStopsToRideInterest([alongStop()], "lodging")).toEqual([]);
  });
});

describe("nearbyPlacesToRideInterest", () => {
  it("always buckets as Events, namespaced by place id", () => {
    const point = first(nearbyPlacesToRideInterest([nearbyPlace()]));
    expect(point).toMatchObject({
      id: "ri:place:hh:chickies",
      filter: "events",
      kind: "happy_hour",
      name: "Chickie's & Pete's",
      summary: "Mon–Fri 4–7 PM",
      detailUrl: "https://places.example/chickies",
      attribution: "Places",
    });
  });

  it("falls back to the label when there is no weekly schedule", () => {
    const point = first(nearbyPlacesToRideInterest([nearbyPlace({ schedule: null, label: "Sat 7 PM" })]));
    expect(point.summary).toBe("Sat 7 PM");
  });
});
