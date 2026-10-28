import { describe, expect, it } from "vitest";

import {
  buildAdvisorStopSelectionCommand,
  rankAdvisorStopCandidates,
  routeLengthMiles,
  type AdvisorStopCandidate,
  type AdvisorStopSearchRequest,
} from "@/application/advisor/advisor-stops";
import { asPlaceId, type NearbyPlace } from "@/application/places";
import { createRideDocument } from "@/domain/ride/create";
import { applyRideCommand } from "@/domain/ride/reducer";

const line = [{ lon: -75, lat: 40 }, { lon: -74, lat: 40 }] as const;
const request: AdvisorStopSearchRequest = { category: "coffee", vicinity: null, routePosition: "halfway" };

type PlaceOverrides = Omit<Partial<NearbyPlace>, "id" | "name" | "category"> & {
  readonly id: string;
  readonly name: string;
  readonly category: string;
};

function place(overrides: PlaceOverrides): NearbyPlace {
  const { id, name, category, ...rest } = overrides;
  return {
    id: asPlaceId(id),
    kind: "venue",
    name,
    coordinate: { lon: -74.5, lat: 40 },
    category,
    label: "",
    status: "day",
    city: "Jim Thorpe",
    address: "",
    specials: [],
    schedule: null,
    rating: null,
    popular: false,
    dogFriendly: null,
    patio: null,
    url: "https://places.example/place",
    mapsUrl: null,
    offRouteMiles: 0.5,
    routeMile: 25,
    ...rest,
  };
}

describe("advisor category stops", () => {
  it("filters to the requested category and route position, then ranks by supplied quality, detour and time", () => {
    const ranked = rankAdvisorStopCandidates({
      request,
      routeMiles: 50,
      routeDurationMinutes: 100,
      timeBudgetMinutes: 120,
      attribution: "Test Places",
      places: [
        place({ id: "far-rated", name: "Popular Coffee", category: "Coffee Shop", rating: 5, reviewCount: 200, offRouteMiles: 10 }),
        place({ id: "near-rated", name: "Local Cafe", category: "Cafe", rating: 4.4, reviewCount: 20, offRouteMiles: 0.4 }),
        place({ id: "unrated", name: "Corner Coffee", category: "Coffeehouse", offRouteMiles: 0.1 }),
        place({ id: "diner", name: "A Diner", category: "Diner" }),
        place({ id: "end", name: "End Coffee", category: "Coffee", routeMile: 47 }),
        place({ id: "event", name: "Coffee Event", category: "Coffee", kind: "event" }),
      ],
    });

    expect(ranked.map((candidate) => candidate.place.id)).toEqual([
      asPlaceId("near-rated"),
      asPlaceId("unrated"),
      asPlaceId("far-rated"),
    ]);
    expect(ranked[0]).toMatchObject({
      sourceLabel: "Test Places",
      detourMinutesEstimate: 2,
      qualityEvidence: { rating: 4.4, reviewCount: 20 },
    });
    expect(ranked[1]?.qualityEvidence).toBeUndefined();
    expect(routeLengthMiles(line)).toBeGreaterThan(50);
  });

  it("creates one ordered, rider-authored command for all selected places", () => {
    const document = createRideDocument();
    const selected: AdvisorStopCandidate[] = [
      {
        place: place({ id: "coffee", name: "Route Coffee", category: "Coffee Shop" }),
        sourceLabel: "Test Places",
        detourMinutesEstimate: 2,
        score: 4,
      },
      {
        place: place({ id: "brewery", name: "Hilltop Brewery", category: "Brewery", routeMile: 40 }),
        sourceLabel: "Test Places",
        detourMinutesEstimate: 5,
        score: 3,
      },
    ];
    const command = buildAdvisorStopSelectionCommand(document, selected, 2);

    expect(command?.source).toBe("rider");
    expect(command?.operations.map((operation) => operation.type)).toEqual(["stop.insert", "stop.insert"]);
    expect(command?.operations.map((operation) => operation.type === "stop.insert" ? operation.stop.label : null)).toEqual([
      "Route Coffee, Jim Thorpe",
      "Hilltop Brewery, Jim Thorpe",
    ]);
    expect(command?.operations.map((operation) => operation.type === "stop.insert" ? operation.stop.arrivalIntent : null)).toEqual([
      "food",
      "visit",
    ]);
    if (command === null) throw new Error("expected a command for selected places");
    const applied = applyRideCommand(document, command);
    expect(applied.outcome).toBe("applied");
    if (applied.outcome === "applied") {
      expect(applied.document.revision).toBe(document.revision + 1);
      expect(applied.document.intent.stops.map((stop) => stop.label)).toEqual([
        "Route Coffee, Jim Thorpe",
        "Hilltop Brewery, Jim Thorpe",
      ]);
    }
    expect(buildAdvisorStopSelectionCommand(document, selected.slice(0, 1), 2)?.operations).toHaveLength(1);
    expect(buildAdvisorStopSelectionCommand(document, [], 2)).toBeNull();
    expect(buildAdvisorStopSelectionCommand(document, selected, 1)).toBeNull();
  });
});
