/**
 * A long ride's daylight verdict has to be about the rider's own evening.
 *
 * `calculateSunset` builds the instant from the departure's UTC calendar day, so
 * a morning departure west of about UTC-6 was compared against the *previous*
 * evening's sunset: every western long ride was reported as finishing hours
 * after dark. The explore long-trip facts now go through the same
 * solar-local-day helper the planner briefing uses.
 */

import { describe, expect, it } from "vitest";

import type { CatalogEntry } from "@/application/explore/catalog";
import { enrichRoutePreparationForLongTrip } from "@/application/explore/long-trip";
import { sunsetOnDepartureDay } from "@/application/long-trip";
import type { RoutePreparation } from "@/application/preparation/prepare-route";

const SAN_FRANCISCO = { lon: -122.42, lat: 37.77 };
/** 06:00 in California, on the day the rider leaves. */
const DEPARTURE = "2026-09-20T13:00:00.000Z";

function californiaRide(): CatalogEntry {
  return {
    distanceKm: 200,
    estimatedTimeMinutes: 360,
    geometry: [SAN_FRANCISCO, { lon: -121.9, lat: 38.2 }],
    sourceDocument: {
      intent: {
        departure: { kind: "future", at: DEPARTURE },
        bike: { fuelRangeMiles: 150, reserveMiles: 30 },
      },
    },
  } as unknown as CatalogEntry;
}

const EMPTY = { items: [] } as unknown as RoutePreparation;

function solarLocalDate(instant: string): string {
  // The NOAA sunset is an instant; the rider's day is that instant shifted by
  // the route's own longitude, exactly as the calculation measures it.
  const offsetMs = (SAN_FRANCISCO.lon / 15) * 3_600_000;
  return new Date(Date.parse(instant) + offsetMs).toISOString().slice(0, 10);
}

describe("long-trip daylight on the departure's own day", () => {
  it("puts the sunset on the rider's local date, not the previous UTC evening", () => {
    const fact = sunsetOnDepartureDay(SAN_FRANCISCO, DEPARTURE);

    if (fact === null) throw new Error("expected a sunset for the California coordinate");
    expect(solarLocalDate(fact.sunset)).toBe("2026-09-20");
    expect(Date.parse(fact.sunset)).toBeGreaterThan(Date.parse(DEPARTURE));
    expect(fact.sourceRef).toContain("daylight:solar:");
  });

  it("does not tell a 6-hour morning ride that it finishes after dark", () => {
    const daylight = enrichRoutePreparationForLongTrip(californiaRide(), EMPTY)
      .considerations?.find((item) => item.kind === "daylight");

    expect(daylight).toBeDefined();
    expect(daylight?.severity).toBe("info");
    expect(daylight?.whyLine).toContain("before sunset");
    expect(daylight?.whyLine).not.toContain("after sunset");
  });
});
