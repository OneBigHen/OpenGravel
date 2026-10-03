import { describe, expect, it } from "vitest";

import { buildRoadOpeningCalendar } from "@/application/route-intelligence/opening-calendar";
import { roadAuthorityEffect } from "@/application/route-intelligence/policy";
import type { RoadAuthorityRecord } from "@/application/route-intelligence/types";
import { parseDcnrSeasonalRoads } from "@/infrastructure/route-intelligence/pa-dcnr/dcnr-seasonal-source";
import { parsePgcSeasonalRoads } from "@/infrastructure/route-intelligence/pa-pgc/pgc-source";
import { parseNjWmaRoads } from "@/infrastructure/route-intelligence/nj-wma/wma-road-source";

const geometry = { type: "line" as const, coordinates: [{ lon: -75.9, lat: 40.55 }, { lon: -75.89, lat: 40.56 }] };

function record(overrides: Partial<RoadAuthorityRecord> = {}): RoadAuthorityRecord {
  return {
    sourceId: "authority",
    sourceRecordId: "1",
    kind: "motor-vehicle-designation",
    geometry,
    roadName: "Season Road",
    description: "Seasonal access.",
    validFrom: null,
    validUntil: null,
    motorcycleAccess: { status: "open", seasons: null },
    ...overrides,
  };
}

describe("road opening calendar", () => {
  it("expands recurring seasons into dated calendar events", () => {
    const calendar = buildRoadOpeningCalendar([
      record({ motorcycleAccess: { status: "open", seasons: [{ startMonth: 10, startDay: 1, endMonth: 11, endDay: 30 }] } }),
    ], {
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-12-31T00:00:00.000Z",
    });
    expect(calendar.events).toHaveLength(1);
    expect(calendar.events[0]).toMatchObject({
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-12-01T00:00:00.000Z",
      certainty: "recurring-season",
    });
  });

  it("keeps seasonal roads with unpublished dates separate instead of inventing dates", () => {
    const calendar = buildRoadOpeningCalendar([
      record({ motorcycleAccess: { status: "open", seasons: [] } }),
    ], {
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-12-31T00:00:00.000Z",
    });
    expect(calendar.events).toEqual([]);
    expect(calendar.undated).toHaveLength(1);
  });

  it("uses year-specific authority windows without making them recur next year", () => {
    const dated = record({
      motorcycleAccess: {
        status: "open",
        seasons: null,
        windows: [{ validFrom: "2026-10-03T00:00:00.000Z", validUntil: "2026-11-22T00:00:00.000Z" }],
        outsideWindowStatus: "closed",
      },
    });
    expect(buildRoadOpeningCalendar([dated], {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-12-01T00:00:00.000Z",
    }).events).toHaveLength(1);
    expect(buildRoadOpeningCalendar([dated], {
      from: "2027-10-01T00:00:00.000Z",
      to: "2027-12-01T00:00:00.000Z",
    }).events).toEqual([]);
  });
});

describe("dated access policy", () => {
  const traverses = { strength: "traverses" as const, overlapMeters: 2_000 };
  const dated = record({
    motorcycleAccess: {
      status: "open",
      seasons: null,
      windows: [{ validFrom: "2026-10-03T00:00:00.000Z", validUntil: "2026-11-22T00:00:00.000Z" }],
      outsideWindowStatus: "closed",
    },
  });

  it("allows a route inside a published opening and rejects it outside", () => {
    expect(roadAuthorityEffect(dated, "authoritative-operational", traverses, "2026-10-10T12:00:00.000Z").effect).toBe("none");
    expect(roadAuthorityEffect(dated, "authoritative-operational", traverses, "2026-12-01T12:00:00.000Z"))
      .toMatchObject({ effect: "reject", code: "access-prohibited" });
  });
});

describe("PA Game Commission seasonal roads", () => {
  it("normalizes open, seasonal and closed Game Lands roads", () => {
    const parsed = parsePgcSeasonalRoads({
      type: "FeatureCollection",
      features: [
        { id: 1, properties: { OBJECTID: 1, SGL: 110, STNAME: "Mountain Road", USE_TYPE: "G", SURFACE: "D", MAINTENANC: "N", CURRENT_: "Y" }, geometry: { type: "LineString", coordinates: [[-76, 40.5], [-75.9, 40.6]] } },
        { id: 2, properties: { OBJECTID: 2, SGL: 110, STNAME: "Season Road", USE_TYPE: "S", CURRENT_: "Y" }, geometry: { type: "LineString", coordinates: [[-76, 40.5], [-75.9, 40.6]] } },
        { id: 3, properties: { OBJECTID: 3, SGL: 110, STNAME: "Admin Road", USE_TYPE: "A", CURRENT_: "Y" }, geometry: { type: "LineString", coordinates: [[-76, 40.5], [-75.9, 40.6]] } },
      ],
    });
    expect(parsed[0]).toMatchObject({ roadName: "Mountain Road", motorcycleAccess: { status: "open", seasons: null } });
    expect(parsed[0]?.description).toMatch(/dirt.*not maintained/);
    expect(parsed[1]).toMatchObject({ motorcycleAccess: { status: "open", seasons: [] } });
    expect(parsed[2]).toMatchObject({ motorcycleAccess: { status: "closed", seasons: null } });
  });
});

describe("PA DCNR seasonal forest roads", () => {
  it("preserves the authority's exact year-specific opening windows", () => {
    const parsed = parseDcnrSeasonalRoads({
      type: "FeatureCollection",
      features: [{
        id: 7,
        properties: {
          OBJECTID: 7,
          Name: "Ridge Road",
          DistrictNumber: 18,
          Date_Opened: Date.parse("2026-10-03T00:00:00.000Z"),
          Date_Closed: Date.parse("2026-11-22T00:00:00.000Z"),
        },
        geometry: { type: "LineString", coordinates: [[-77, 40.5], [-76.9, 40.6]] },
      }],
    });
    expect(parsed[0]).toMatchObject({
      roadName: "Ridge Road",
      motorcycleAccess: {
        status: "open",
        outsideWindowStatus: "closed",
        windows: [{ validFrom: "2026-10-03T00:00:00.000Z", validUntil: "2026-11-22T00:00:00.000Z" }],
      },
    });
  });
});

describe("NJ Fish & Wildlife WMA roads", () => {
  it("hard-gates explicit closed roads, admits public roads, and leaves restricted roads unknown", () => {
    const parsed = parseNjWmaRoads({
      type: "FeatureCollection",
      features: [
        { id: 1, properties: { OBJECTID: 1, PRIMENAME: "Public Road", DFW_TYPE: "Road", DFW_ACCESS: "PUB", SURFACE: "Unpaved" }, geometry: { type: "LineString", coordinates: [[-74.7, 40.1], [-74.69, 40.11]] } },
        { id: 2, properties: { OBJECTID: 2, PRIMENAME: "Closed Road", DFW_TYPE: "Road", DFW_ACCESS: "Closed" }, geometry: { type: "LineString", coordinates: [[-74.7, 40.1], [-74.69, 40.11]] } },
        { id: 3, properties: { OBJECTID: 3, PRIMENAME: "Restricted Road", DFW_TYPE: "Road", DFW_ACCESS: "R" }, geometry: { type: "LineString", coordinates: [[-74.7, 40.1], [-74.69, 40.11]] } },
      ],
    });
    expect(parsed.map((item) => item.motorcycleAccess?.status)).toEqual(["open", "closed", "unknown"]);
  });
});
