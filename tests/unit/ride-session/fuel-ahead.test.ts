/**
 * "Next gas" on the ride: the maths behind the sheet's one fuel line
 * (`src/application/ride-session/fuel-ahead.ts`).
 *
 * What matters to a rider is the direction of every error: an unknown range
 * must never read as a full tank, and a gap in the position stream must never
 * make the tank look fuller than it is.
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_FUEL_ODOMETER,
  FREE_RIDE_FUEL_MILES,
  FUEL_LOOK_AHEAD_MILES,
  advanceFuelOdometer,
  bearingDegrees,
  bearingGapDegrees,
  fuelAhead,
  fuelSearchBounds,
  gasStopToAdd,
  nearestGasAhead,
  rangeLeftMiles,
  resetFuelOdometer,
  usableRangeMiles,
  wholeMiles,
  wholeRangeMiles,
  type FuelOdometer,
  type GasAhead,
  type GasStation,
} from "@/application/ride-session/fuel-ahead";

/** One degree of latitude, in miles, close enough for a fixture. */
const MILE = 1 / 69.055;

function station(id: string, name: string, aheadMiles: number, lat = 40): GasAhead {
  return { id, name, coordinate: { lon: -75, lat }, aheadMiles };
}

describe("usableRangeMiles", () => {
  it("is the range before the reserve, as the planner reads it", () => {
    expect(usableRangeMiles(150, 30)).toBe(120);
    expect(usableRangeMiles(150, 0)).toBe(150);
  });

  it("treats a missing reserve as none, and a missing range as unknown", () => {
    expect(usableRangeMiles(150, null)).toBe(150);
    expect(usableRangeMiles(undefined, 30)).toBeNull();
    expect(usableRangeMiles(Number.NaN, 30)).toBeNull();
  });

  it("calls a bike with no usable range unknown rather than empty", () => {
    expect(usableRangeMiles(30, 30)).toBeNull();
    expect(usableRangeMiles(20, 40)).toBeNull();
  });
});

describe("rangeLeftMiles", () => {
  it("subtracts the miles ridden since the fill-up", () => {
    expect(rangeLeftMiles(120, 40)).toBe(80);
    expect(rangeLeftMiles(120, 0)).toBe(120);
  });

  it("never goes negative, so a dry tank reads as 0 rather than a credit", () => {
    expect(rangeLeftMiles(120, 200)).toBe(0);
  });

  it("is unknown when either side is unknown", () => {
    expect(rangeLeftMiles(null, 10)).toBeNull();
    expect(rangeLeftMiles(120, null)).toBeNull();
    expect(rangeLeftMiles(120, Number.NaN)).toBeNull();
  });
});

describe("advanceFuelOdometer", () => {
  it("counts the distance already ridden on the first measurement", () => {
    // A ride screen opened mid-ride has no earlier sample; the route starts where
    // the ride started, so mile 10 along it is ten miles of tank already used.
    expect(advanceFuelOdometer(EMPTY_FUEL_ODOMETER, { routeKey: "r1", alongMiles: 10 }).riddenMiles).toBe(10);
  });

  it("adds forward steps on the same route", () => {
    const first = advanceFuelOdometer(EMPTY_FUEL_ODOMETER, { routeKey: "r1", alongMiles: 10 });
    const second = advanceFuelOdometer(first, { routeKey: "r1", alongMiles: 14.5 });
    expect(second.riddenMiles).toBe(14.5);
    expect(second.alongMiles).toBe(14.5);
  });

  it("ignores a measurement it does not have, and returns the same object", () => {
    const state: FuelOdometer = { routeKey: "r1", alongMiles: 10, riddenMiles: 5 };
    expect(advanceFuelOdometer(state, { routeKey: "r1", alongMiles: null })).toBe(state);
    expect(advanceFuelOdometer(state, { routeKey: "r1", alongMiles: 10 })).toBe(state);
  });

  it("rebases on a new route without adding, so a reroute is not ridden miles", () => {
    const state: FuelOdometer = { routeKey: "r1", alongMiles: 40, riddenMiles: 30 };
    const rerouted = advanceFuelOdometer(state, { routeKey: "r2", alongMiles: 2 });
    expect(rerouted.riddenMiles).toBe(30);
    expect(rerouted.routeKey).toBe("r2");
    expect(advanceFuelOdometer(rerouted, { routeKey: "r2", alongMiles: 5 }).riddenMiles).toBe(33);
  });

  it("never subtracts when the projection jumps backwards", () => {
    const state: FuelOdometer = { routeKey: "r1", alongMiles: 40, riddenMiles: 30 };
    const jumped = advanceFuelOdometer(state, { routeKey: "r1", alongMiles: 12 });
    expect(jumped.riddenMiles).toBe(30);
    expect(jumped.alongMiles).toBe(12);
  });

  it("counts a gap in the position stream in full, never the other way", () => {
    const state: FuelOdometer = { routeKey: "r1", alongMiles: 0, riddenMiles: 0 };
    // Nothing measured for twenty miles: the tank must look emptier than it is.
    expect(advanceFuelOdometer(state, { routeKey: "r1", alongMiles: 60 }).riddenMiles).toBe(60);
  });

  it("a fill-up starts the count again from the same place", () => {
    const state: FuelOdometer = { routeKey: "r1", alongMiles: 40, riddenMiles: 30 };
    const filled = resetFuelOdometer(state);
    expect(filled.riddenMiles).toBe(0);
    expect(advanceFuelOdometer(filled, { routeKey: "r1", alongMiles: 45 }).riddenMiles).toBe(5);
    expect(resetFuelOdometer(filled)).toBe(filled);
  });
});

describe("fuelAhead", () => {
  it("names the next station when the range reaches it", () => {
    const verdict = fuelAhead([station("b", "Sheetz", 14), station("a", "BP", 40)], 120);
    expect(verdict).toEqual({
      kind: "next",
      station: expect.objectContaining({ name: "Sheetz" }),
      rangeLeftMiles: 120,
    });
  });

  it("sorts by distance so a provider's order cannot change the answer", () => {
    const verdict = fuelAhead([station("far", "Far Fuel", 40), station("near", "Near Fuel", 14)], 120);
    expect(verdict.kind).toBe("next");
    expect(verdict.kind === "next" ? verdict.station.name : null).toBe("Near Fuel");
  });

  it("says the range is short, and only then", () => {
    const verdict = fuelAhead([station("a", "Sheetz", 38)], 30);
    expect(verdict).toEqual({
      kind: "short",
      station: expect.objectContaining({ name: "Sheetz" }),
      rangeLeftMiles: 30,
      stop: expect.objectContaining({ name: "Sheetz" }),
    });
  });

  it("never claims a range it does not have", () => {
    const verdict = fuelAhead([station("a", "Sheetz", 38)], null);
    expect(verdict).toEqual({
      kind: "next",
      station: expect.objectContaining({ name: "Sheetz" }),
      rangeLeftMiles: null,
    });
  });

  it("is 'none' when the search found no station ahead", () => {
    expect(fuelAhead([], 120)).toEqual({ kind: "none" });
  });

  it("reaches the station at exactly the range left", () => {
    expect(fuelAhead([station("a", "Edge", 30)], 30).kind).toBe("next");
  });
});

describe("gasStopToAdd", () => {
  it("picks the last station the range still reaches, not the last one found", () => {
    const stations = [station("a", "Near", 10), station("b", "Better", 28), station("c", "Far", 60)];
    expect(gasStopToAdd(stations, 30)?.name).toBe("Better");
  });

  it("falls back to the next station when the range reaches none of them", () => {
    expect(gasStopToAdd([station("a", "Near", 38)], 30)?.name).toBe("Near");
  });

  it("has nothing to add with no stations", () => {
    expect(gasStopToAdd([], 30)).toBeNull();
  });
});

describe("bearingDegrees / bearingGapDegrees", () => {
  it("reads north, east and south in true bearings", () => {
    const from = { lon: 0, lat: 0 };
    expect(Math.round(bearingDegrees(from, { lon: 0, lat: 1 }))).toBe(0);
    expect(Math.round(bearingDegrees(from, { lon: 1, lat: 0 }))).toBe(90);
    expect(Math.round(bearingDegrees(from, { lon: 0, lat: -1 }))).toBe(180);
  });

  it("measures the gap without a wrap-around surprise", () => {
    expect(bearingGapDegrees(350, 10)).toBe(20);
    expect(bearingGapDegrees(10, 350)).toBe(20);
    expect(bearingGapDegrees(0, 180)).toBe(180);
    expect(bearingGapDegrees(90, 90)).toBe(0);
  });
});

describe("nearestGasAhead", () => {
  const from = { lon: -75, lat: 40 };
  const north: GasStation = { id: "north", name: "North Gas", coordinate: { lon: -75, lat: 40 + 5 * MILE } };
  const south: GasStation = { id: "south", name: "South Gas", coordinate: { lon: -75, lat: 40 - 6 * MILE } };

  it("finds the nearest station ahead, not merely the nearest", () => {
    const found = nearestGasAhead([south, north], from, 0);
    expect(found?.name).toBe("North Gas");
    expect(found?.aheadMiles).toBeCloseTo(5, 1);
  });

  it("says nothing without a heading: there is no 'ahead' to judge", () => {
    expect(nearestGasAhead([north, south], from, null)).toBeNull();
  });

  it("leaves out stations beyond the search and behind the rider", () => {
    expect(nearestGasAhead([north], from, 180)).toBeNull();
    const far: GasStation = { id: "far", name: "Far", coordinate: { lon: -75, lat: 40 + (FREE_RIDE_FUEL_MILES + 5) * MILE } };
    expect(nearestGasAhead([far], from, 0)).toBeNull();
  });

  it("leaves out the station the rider is standing at", () => {
    const here: GasStation = { id: "here", name: "Here", coordinate: { lon: -75, lat: 40.00001 } };
    expect(nearestGasAhead([here], from, 0)).toBeNull();
  });

  it("takes a wider cone when asked", () => {
    const east: GasStation = { id: "east", name: "East", coordinate: { lon: -75 + 4 * MILE, lat: 40 } };
    // Ninety degrees off a northward heading: outside the default cone, inside a wider one.
    expect(nearestGasAhead([east], from, 0)).toBeNull();
    expect(nearestGasAhead([east], from, 0, { coneDegrees: 120 })?.name).toBe("East");
  });
});

describe("fuelSearchBounds", () => {
  it("covers the search distance on the ground, widened across longitude", () => {
    const bounds = fuelSearchBounds({ lon: -75, lat: 60 });
    const northMiles = (bounds.north - 60) * 69.055;
    const eastMiles = (bounds.east - -75) * 69.055 * Math.cos((60 * Math.PI) / 180);
    expect(northMiles).toBeCloseTo(FREE_RIDE_FUEL_MILES, 0);
    expect(eastMiles).toBeCloseTo(FREE_RIDE_FUEL_MILES, 0);
  });
});

describe("wholeMiles", () => {
  it("reads as a rider says it", () => {
    expect(wholeMiles(14.4)).toBe(14);
    expect(wholeMiles(0.3)).toBe(1);
    expect(wholeMiles(0)).toBe(1);
    expect(wholeMiles(Number.NaN)).toBe(1);
  });
});

describe("wholeRangeMiles", () => {
  it("never rounds a range up: a dry tank is 0, not 1", () => {
    expect(wholeRangeMiles(0)).toBe(0);
    expect(wholeRangeMiles(0.4)).toBe(0);
    expect(wholeRangeMiles(29.6)).toBe(30);
    expect(wholeRangeMiles(Number.NaN)).toBe(0);
  });
});

describe("look-ahead distances", () => {
  it("are stated in miles a rider can plan a tank around", () => {
    expect(FUEL_LOOK_AHEAD_MILES).toBe(120);
    expect(FREE_RIDE_FUEL_MILES).toBe(25);
  });
});
