import { describe, expect, it } from "vitest";

import {
  opportunityFromInterestingPlace,
  opportunityFromNearbyPlace,
  rankRiderOpportunities,
} from "@/application/discover/rider-opportunities";
import { asPlaceId } from "@/application/places";
import type { InterestingPlace } from "@/application/discover";
import type { NearbyPlace } from "@/application/places";

const NOW = "2026-10-02T16:00:00.000Z";

function nearby(overrides: Partial<NearbyPlace> = {}): NearbyPlace {
  return {
    id: asPlaceId("event:test"),
    kind: "event",
    name: "Bike Night",
    coordinate: { lon: -75.2, lat: 40 },
    category: "Motorcycle",
    label: "Sat 6 PM",
    status: "upcoming",
    city: "Town",
    address: "1 Main St",
    specials: [],
    schedule: null,
    startUtc: "2026-10-03T22:00:00.000Z",
    endUtc: "2026-10-04T02:00:00.000Z",
    timeZone: "America/New_York",
    rating: 4.7,
    popular: true,
    dogFriendly: null,
    patio: null,
    url: "https://events.henning.rodeo/event/test",
    mapsUrl: null,
    offRouteMiles: 0.4,
    routeMile: 31,
    ...overrides,
  };
}

function place(overrides: Partial<InterestingPlace> = {}): InterestingPlace {
  return {
    id: "osm:w1",
    name: "Covered Bridge",
    category: "bridge",
    categories: ["bridge", "history"],
    coordinate: { lon: -75.5, lat: 40.2 },
    description: "A historic covered bridge worth a short detour.",
    image: null,
    wikidataId: "Q1",
    facts: {},
    tags: [],
    confidence: 0.85,
    provenance: [{ sourceId: "osm", sourceLabel: "OpenStreetMap", recordId: "osm:w1", url: "https://www.openstreetmap.org/way/1", retrievedAt: NOW }],
    distanceFromRouteMeters: 1200,
    detourMinutes: 4,
    ...overrides,
  };
}

describe("rider opportunity ranking", () => {
  it("rewards time-limited popular events that barely leave the planned route", () => {
    const event = opportunityFromNearbyPlace(nearby(), { now: NOW, routeAware: true });
    const staticPlace = opportunityFromInterestingPlace(place(), { now: NOW, routeAware: true });
    expect(event.reason).toMatch(/route|soon/i);
    expect(event.score).toBeGreaterThan(staticPlace.score);
  });

  it("does not reduce browse mode to nearest-first", () => {
    const nearGeneric = opportunityFromInterestingPlace(place({
      id: "osm:w2",
      category: "recreation",
      categories: ["recreation"],
      coordinate: { lon: -75.01, lat: 40 },
      wikidataId: null,
      provenance: [{ sourceId: "osm", sourceLabel: "OpenStreetMap", recordId: "osm:w2", url: null, retrievedAt: NOW }],
    }), { now: NOW, routeAware: false, center: { lon: -75, lat: 40 } });
    const fartherBridge = opportunityFromInterestingPlace(place({
      coordinate: { lon: -75.6, lat: 40 },
    }), { now: NOW, routeAware: false, center: { lon: -75, lat: 40 } });
    expect(fartherBridge.score).toBeGreaterThan(nearGeneric.score);
  });

  it("keeps the final list small and varied instead of flooding it with one event category", () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      opportunityFromNearbyPlace(nearby({
        id: asPlaceId(`event:${index}`),
        name: `Event ${index}`,
        category: "Concert",
        popular: index < 2,
      }), { now: NOW, routeAware: true }));
    const scenic = opportunityFromInterestingPlace(place(), { now: NOW, routeAware: true });
    const ranked = rankRiderOpportunities([...items, scenic], 9);
    expect(ranked).toHaveLength(5);
    expect(ranked.filter((item) => item.kind === "event")).toHaveLength(4);
    expect(ranked.some((item) => item.kind === "place")).toBe(true);
  });
});
