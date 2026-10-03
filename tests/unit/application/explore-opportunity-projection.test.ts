import { describe, expect, it } from "vitest";
import {
  alongRideSuggestions,
  roadWindowsForTime,
  thingsForTime,
} from "@/application/explore/opportunity-projection";
import type { RoadOpeningSummary } from "@/application/route-intelligence/opening-calendar-contract";
import type { RiderOpportunity } from "@/application/discover/rider-opportunities";
const line = [
  { lon: -77.4, lat: 40.9 },
  { lon: -77.3, lat: 41 },
];
const road: RoadOpeningSummary = {
  id: "road",
  sourceId: "dcnr",
  roadName: "Forest road",
  description: "Published opening",
  startsAt: "2026-10-01T00:00:00Z",
  endsAt: "2026-10-05T00:00:00Z",
  certainty: "published-window",
  anchor: [-77.4, 40.9],
  line,
};
const stop: RiderOpportunity = {
  id: "stop",
  kind: "place",
  name: "Forest overlook",
  category: "viewpoint",
  coordinate: line[0]!,
  description: null,
  startsAt: null,
  endsAt: null,
  url: null,
  sourceLabel: "OpenStreetMap",
  motorcycleSpecific: false,
  popular: false,
  rating: null,
  distanceMeters: null,
  distanceFromRouteMeters: 0,
  detourMinutes: 0,
  routeMile: 0,
  estimatedArrivalAt: null,
  timingFit: "unknown",
  score: 1,
  reason: "On route",
};
const context = {
  line,
  durationSeconds: 1800,
  departAt: "2026-10-03T12:00:00Z",
  stops: [],
};
describe("Explore opportunity projections", () => {
  it("keeps invalid dates, missing geometry and closed windows out of road actions", () => {
    expect(
      alongRideSuggestions({
        ...context,
        roads: [
          { ...road, startsAt: "unknown" },
          { ...road, endsAt: "unknown" },
          { ...road, line: [] },
          { ...road, startsAt: "2026-10-04T00:00:00Z" },
          { ...road, endsAt: "2026-10-03T12:10:00Z" },
          { ...road, anchor: [-76, 40] },
        ],
      }),
    ).toEqual([]);
  });
  it("separates closing soon without duplicating the road card", () => {
    const projection = roadWindowsForTime(
      [road],
      "now",
      "",
      new Date(context.departAt),
    );
    expect(projection.open).toEqual([]);
    expect(projection.closing).toEqual([road]);
  });
  it("filters events by civil weekend while retaining durable destinations in ranked order", () => {
    const now = new Date(2026, 9, 3, 12);
    const event = {
      ...stop,
      id: "event",
      kind: "event" as const,
      startsAt: new Date(2026, 9, 10, 12).toISOString(),
      endsAt: new Date(2026, 9, 10, 18).toISOString(),
    };
    expect(thingsForTime([event, stop], "weekend", now)).toEqual([stop]);
    expect(thingsForTime([event, stop], "next-weekend", now)).toEqual([
      event,
      stop,
    ]);
  });
});
