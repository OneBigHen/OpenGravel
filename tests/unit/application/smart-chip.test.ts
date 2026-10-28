/**
 * The chip after Gas: the hour and the route decide, and every case is a
 * suggestion. Gas never moves, an unknown fuel gap never raises a warning, and
 * a dry stretch outranks the hour's own wish because running dry is worse.
 */

import { describe, expect, it } from "vitest";

import { METERS_PER_MILE } from "@/application/map-layers/along";
import {
  FUEL_GAP_SUGGESTION_MILES,
  fuelGapMiles,
  smartChip,
} from "@/application/places/smart-chip";

/** A local wall-clock instant, so the hour tested is the hour read. */
function at(hour: number, minute = 0): number {
  return new Date(2026, 0, 15, hour, minute).getTime();
}

function stop(id: string, alongMiles: number) {
  return {
    feature: {
      id,
      layerId: "fuel" as const,
      name: id,
      detail: null,
      weight: null,
      geometry: { type: "Point" as const, coordinates: [-75, 40] as [number, number] },
    },
    alongMeters: alongMiles * METERS_PER_MILE,
    offMeters: 20,
  };
}

describe("smartChip", () => {
  it("suggests coffee through the morning and nothing at lunch", () => {
    expect(smartChip({ now: at(5), sunState: "night" })).toEqual({
      id: "coffee",
      label: "Coffee nearby",
      reason: "morning",
    });
    expect(smartChip({ now: at(10, 59), sunState: "day" })?.id).toBe("coffee");
    expect(smartChip({ now: at(4, 59), sunState: "night" })?.id).not.toBe("coffee");
    expect(smartChip({ now: at(11), sunState: "day" })).toBeNull();
    expect(smartChip({ now: at(13), sunState: "day" })).toBeNull();
  });

  it("suggests fuel when the open route's longest dry stretch passes 60 mi", () => {
    expect(
      smartChip({
        now: at(13),
        sunState: "day",
        route: { fuelGapMiles: FUEL_GAP_SUGGESTION_MILES + 1 },
      }),
    ).toEqual({ id: "gas", label: "Fuel before the gap", reason: "fuel-gap" });
    expect(
      smartChip({ now: at(13), sunState: "day", route: { fuelGapMiles: FUEL_GAP_SUGGESTION_MILES } }),
    ).toBeNull();
    expect(
      smartChip({ now: at(13), sunState: "day", route: { fuelGapMiles: null } }),
    ).toBeNull();
  });

  it("lets the dry stretch outrank a coffee", () => {
    const chip = smartChip({ now: at(7), sunState: "day", route: { fuelGapMiles: 88 } });
    expect(chip?.reason).toBe("fuel-gap");
    expect(chip?.id).toBe("gas");
  });

  it("suggests lodging after 8 PM, past midnight, and once a winter day is dark", () => {
    expect(smartChip({ now: at(20), sunState: "day" })).toEqual({
      id: "lodging",
      label: "Lodging",
      reason: "late",
    });
    expect(smartChip({ now: at(23, 30), sunState: "night" })?.id).toBe("lodging");
    expect(smartChip({ now: at(2), sunState: "night" })?.id).toBe("lodging");
    // A 4:45 PM sunset ends the day at 6, but not at 5.
    expect(smartChip({ now: at(18, 30), sunState: "night" })?.id).toBe("lodging");
    expect(smartChip({ now: at(17), sunState: "night" })).toBeNull();
    // An unknown sun is not treated as night.
    expect(smartChip({ now: at(18, 30), sunState: null })).toBeNull();
  });

  it("offers nothing from a clock that is not real", () => {
    expect(smartChip({ now: Number.NaN, sunState: "day" })).toBeNull();
  });
});

describe("fuelGapMiles", () => {
  it("measures the longest stretch between fuel stops, ends included", () => {
    const miles = fuelGapMiles([stop("a", 10), stop("b", 50)], 100 * METERS_PER_MILE);
    expect(miles).toBeCloseTo(50, 5);
  });

  it("reads a route with no station near it as one long dry stretch", () => {
    expect(fuelGapMiles([], 70 * METERS_PER_MILE)).toBeCloseTo(70, 5);
  });

  it("stays unknown when the route has no measurable length", () => {
    expect(fuelGapMiles([stop("a", 1)], 0)).toBeNull();
    expect(fuelGapMiles([stop("a", 1)], Number.NaN)).toBeNull();
  });
});
