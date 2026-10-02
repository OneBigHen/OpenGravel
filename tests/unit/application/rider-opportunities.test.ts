import { describe, expect, it } from "vitest";

import {
  rankRiderOpportunities,
  type RiderOpportunity,
  type RiderOpportunityKind,
} from "@/application/discover/rider-opportunities";

function opportunity(
  id: string,
  kind: RiderOpportunityKind,
  category: string,
  score: number,
  overrides: Partial<RiderOpportunity> = {},
): RiderOpportunity {
  return {
    id,
    kind,
    name: id,
    category,
    coordinate: { lon: -75.9, lat: 40.55 },
    description: null,
    startsAt: null,
    endsAt: null,
    url: null,
    sourceLabel: "test",
    popular: false,
    rating: null,
    distanceMeters: null,
    distanceFromRouteMeters: null,
    detourMinutes: null,
    routeMile: null,
    score,
    reason: "test",
    ...overrides,
  };
}

describe("rankRiderOpportunities", () => {
  it("keeps a dense event feed from burying useful rider stops", () => {
    const candidates: RiderOpportunity[] = [
      ...Array.from({ length: 8 }, (_, index) =>
        opportunity(`event-${index}`, "event", "festival", 10 - index * 0.1)),
      opportunity("viewpoint", "place", "viewpoint", 8.5),
      opportunity("waterfall", "place", "waterfall", 8.4),
      opportunity("happy-hour", "happy-hour", "bar", 8.3),
    ];

    const ranked = rankRiderOpportunities(candidates, 9);
    expect(ranked.filter((item) => item.kind === "event")).toHaveLength(4);
    expect(ranked.some((item) => item.id === "viewpoint")).toBe(true);
    expect(ranked.some((item) => item.id === "waterfall")).toBe(true);
    expect(ranked.some((item) => item.id === "happy-hour")).toBe(true);
  });

  it("penalizes repeated categories so the weekend list stays varied", () => {
    const ranked = rankRiderOpportunities([
      opportunity("festival-a", "event", "festival", 9),
      opportunity("festival-b", "event", "festival", 8.9),
      opportunity("festival-c", "event", "festival", 8.8),
      opportunity("scenic", "place", "viewpoint", 8.55),
    ], 3);

    expect(ranked.map((item) => item.id)).toEqual(["festival-a", "scenic", "festival-b"]);
  });

  it("keeps score ordering deterministic for ties", () => {
    const ranked = rankRiderOpportunities([
      opportunity("z-stop", "place", "scenic", 5),
      opportunity("a-stop", "place", "nature", 5),
    ], 2);

    expect(ranked.map((item) => item.id)).toEqual(["a-stop", "z-stop"]);
  });
});
