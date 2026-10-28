/**
 * Daylight on the route line (docs/vnext/design/MAP-EXPERIENCE-NEXT.md Wave 2,
 * item 8).
 *
 * The split is a claim about which part of a ride the sun has set on, so the
 * tests are about the four answers it can give and the two ways it could lie:
 * reading the sunset off the UTC date (which rolls over at 8 PM ET, and would
 * compare an evening ride with tomorrow's sunset) and turning an unresolvable
 * sun calculation into "daylight" or "dark".
 */

import { describe, expect, it } from "vitest";

import { calculateSunset, sunsetOnDepartureDay } from "@/application/long-trip";
import {
  proportionalEtaProfile,
  routeDaylightScene,
  splitRouteByDaylight,
  sunsetMarkerLabel,
} from "@/application/map/route-daylight";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

/** Jim Thorpe, PA: the valley town whose almanac sunsets the long-trip tests use. */
const JIM_THORPE: Coordinate = { lat: 40.8676, lon: -75.7327 };

/** About 25 km east of Jim Thorpe, four vertices. */
const LINE: readonly Coordinate[] = [
  JIM_THORPE,
  { lat: 40.8676, lon: -75.6327 },
  { lat: 40.8676, lon: -75.5327 },
  { lat: 40.8676, lon: -75.4327 },
];

const FOUR_HOURS = 4 * 3_600;

function minutesBetween(firstIso: string, secondIso: string): number {
  return Math.round((Date.parse(secondIso) - Date.parse(firstIso)) / 60_000);
}

function lengthOf(line: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 1; index < line.length; index += 1) total += haversine(line[index - 1]!, line[index]!);
  return total;
}

describe("splitRouteByDaylight", () => {
  it("keeps a whole ride in daylight in one piece, with nothing to mark", () => {
    const split = splitRouteByDaylight(LINE, proportionalEtaProfile(LINE, 3_600)!, "2026-09-17T14:00:00.000Z");

    expect(split.outcome).toBe("all-daylight");
    expect(split.afterSunset).toEqual([]);
    expect(split.inDaylight).toEqual(LINE);
    expect(split.sunsetAt).toBeNull();
    expect(split.sunsetIso).toBeNull();
  });

  it("cuts a ride that crosses sunset, and both halves meet where the light ran out", () => {
    const departure = "2026-09-17T21:30:00.000Z";
    const split = splitRouteByDaylight(LINE, proportionalEtaProfile(LINE, FOUR_HOURS)!, departure);

    expect(split.outcome).toBe("crosses-sunset");
    expect(split.inDaylight.length).toBeGreaterThanOrEqual(2);
    expect(split.afterSunset.length).toBeGreaterThanOrEqual(2);
    // One line, cut once: the halves share the split point exactly.
    expect(split.inDaylight.at(-1)).toEqual(split.afterSunset[0]);
    expect(split.inDaylight[0]).toEqual(LINE[0]);
    expect(split.afterSunset.at(-1)).toEqual(LINE.at(-1));
    expect(split.sunsetAt).toEqual(split.afterSunset[0]);
    // The ride heads east, so the split is somewhere along it, never at either end.
    expect(split.sunsetAt!.lon).toBeGreaterThan(LINE[0]!.lon);
    expect(split.sunsetAt!.lon).toBeLessThan(LINE.at(-1)!.lon);
    // The reported sunset is the one that ends this ride's daylight.
    const sunset = sunsetOnDepartureDay(JIM_THORPE, departure);
    expect(sunset).not.toBeNull();
    expect(Math.abs(minutesBetween(split.sunsetIso!, sunset!.sunset))).toBeLessThanOrEqual(2);
    // About six in the evening, ten minutes before the sun goes down.
    expect(minutesBetween(departure, split.sunsetIso!)).toBeLessThan(FOUR_HOURS / 60);
    expect(minutesBetween(departure, split.sunsetIso!)).toBeGreaterThan(0);
  });

  it("puts a ride that left after dark wholly in the dark, marked at its start", () => {
    const departure = "2026-09-17T23:30:00.000Z";
    const split = splitRouteByDaylight(LINE, proportionalEtaProfile(LINE, 3_600)!, departure);

    expect(split.outcome).toBe("after-dark");
    expect(split.inDaylight).toEqual([]);
    expect(split.afterSunset).toEqual(LINE);
    expect(split.sunsetAt).toEqual(LINE[0]);
    const sunset = sunsetOnDepartureDay(JIM_THORPE, departure);
    expect(split.sunsetIso).toBe(sunset!.sunset);
    expect(Date.parse(split.sunsetIso!)).toBeLessThan(Date.parse(departure));
  });

  it("reads the sunset of the rider's own solar day, not the UTC one", () => {
    // A 10 AM EDT start is 14:00 UTC, whose UTC date's sunset instant has already
    // passed (the NOAA calculation reports that day's crossing with its UTC hour
    // put back inside the same date). Asking `calculateSunset` for the UTC date
    // therefore says the ride starts after dark; the rider's own solar day puts
    // sunset that evening, hours away. 21 June 2026, Jim Thorpe.
    const departure = "2026-06-21T14:00:00.000Z";
    const naive = calculateSunset(JIM_THORPE, departure);
    expect(naive).not.toBeNull();
    expect(Date.parse(naive!.sunset)).toBeLessThan(Date.parse(departure));

    const local = sunsetOnDepartureDay(JIM_THORPE, departure);
    expect(local).not.toBeNull();
    expect(Date.parse(local!.sunset)).toBeGreaterThan(Date.parse(departure));

    const split = splitRouteByDaylight(LINE, proportionalEtaProfile(LINE, 3_600)!, departure);
    expect(split.outcome).toBe("all-daylight");
    expect(split.sunsetIso).toBeNull();
  });

  it("still puts an evening ride after the UTC date rolls over in the dark", () => {
    // 10:30 PM EDT on 21 June is 22 June in UTC: the UTC date now names a sunset
    // that is still hours away, and reading it would paint the ride as daylight.
    const departure = "2026-06-22T02:30:00.000Z";
    const local = sunsetOnDepartureDay(JIM_THORPE, departure);
    expect(local).not.toBeNull();
    expect(Date.parse(local!.sunset)).toBeLessThan(Date.parse(departure));

    const split = splitRouteByDaylight(LINE, proportionalEtaProfile(LINE, 3_600)!, departure);
    expect(split.outcome).toBe("after-dark");
    expect(split.sunsetIso).toBe(local!.sunset);
  });

  it("claims neither half when the sun calculation cannot answer", () => {
    // Polar day: no horizon crossing to compare an ETA against.
    const polar: readonly Coordinate[] = [
      { lat: 78, lon: 15 },
      { lat: 78.05, lon: 15.1 },
    ];
    const split = splitRouteByDaylight(polar, proportionalEtaProfile(polar, 3_600)!, "2026-06-21T12:00:00.000Z");

    expect(split.outcome).toBe("unknown");
    expect(split.inDaylight).toEqual([]);
    expect(split.afterSunset).toEqual([]);
    expect(split.sunsetAt).toBeNull();
    expect(split.sunsetIso).toBeNull();
  });

  it("refuses a profile or a departure it cannot stand behind", () => {
    const short = { offsetsSeconds: [0, 600] };
    expect(splitRouteByDaylight(LINE, short, "2026-09-17T21:30:00.000Z").outcome).toBe("unknown");
    expect(splitRouteByDaylight(LINE, proportionalEtaProfile(LINE, FOUR_HOURS)!, "not a date").outcome).toBe("unknown");
    expect(
      splitRouteByDaylight(LINE, { offsetsSeconds: [0, 60, 30, 90] }, "2026-09-17T21:30:00.000Z").outcome,
    ).toBe("unknown");
    expect(splitRouteByDaylight([JIM_THORPE], { offsetsSeconds: [0] }, "2026-09-17T21:30:00.000Z").outcome).toBe("unknown");
  });

  it("reports the split point's own sunset, not the start point's", () => {
    // A line running far enough west that local sunset is minutes later at its end.
    const west: readonly Coordinate[] = [
      { lat: 40.8, lon: -75.8 },
      { lat: 40.8, lon: -76.8 },
      { lat: 40.8, lon: -77.8 },
    ];
    const split = splitRouteByDaylight(west, proportionalEtaProfile(west, FOUR_HOURS)!, "2026-09-17T21:30:00.000Z");

    expect(split.outcome).toBe("crosses-sunset");
    const atStart = sunsetOnDepartureDay(west[0]!, split.sunsetIso!)!;
    const atSplit = sunsetOnDepartureDay(split.sunsetAt!, split.sunsetIso!)!;
    expect(atStart.sunset).not.toBe(split.sunsetIso);
    expect(atSplit.sunset).toBe(split.sunsetIso);
  });
});

describe("proportionalEtaProfile", () => {
  it("spreads the engine's duration over the drawn line by ground distance", () => {
    const profile = proportionalEtaProfile(LINE, FOUR_HOURS);
    expect(profile).not.toBeNull();
    const offsets = profile!.offsetsSeconds;

    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBeCloseTo(FOUR_HOURS, 6);
    for (let index = 1; index < offsets.length; index += 1) {
      expect(offsets[index]!).toBeGreaterThanOrEqual(offsets[index - 1]!);
    }
    const total = lengthOf(LINE);
    const firstLeg = haversine(LINE[0]!, LINE[1]!);
    expect(offsets[1]!).toBeCloseTo((firstLeg / total) * FOUR_HOURS, 6);
  });

  it("has nothing to spread when there is no line or no duration", () => {
    expect(proportionalEtaProfile([JIM_THORPE], FOUR_HOURS)).toBeNull();
    expect(proportionalEtaProfile(LINE, -1)).toBeNull();
    expect(proportionalEtaProfile(LINE, Number.NaN)).toBeNull();
    expect(proportionalEtaProfile([JIM_THORPE, JIM_THORPE], FOUR_HOURS)).toBeNull();
  });
});

describe("sunsetMarkerLabel", () => {
  it("names the sunset on the rider's own clock", () => {
    expect(sunsetMarkerLabel("2026-09-17T22:12:00.000Z", "America/New_York")).toBe("Sunset around 6:12 PM");
  });

  it("says nothing for an instant it cannot read", () => {
    expect(sunsetMarkerLabel("not a date")).toBeNull();
    // An unknown zone falls back to the device's own rather than throwing.
    expect(sunsetMarkerLabel("2026-09-17T22:12:00.000Z", "Mars/Olympus_Mons")).toMatch(/^Sunset around /);
  });
});

describe("routeDaylightScene", () => {
  it("hands the map the dark stretch, the split point and the marker's words", () => {
    const scene = routeDaylightScene(LINE, FOUR_HOURS, "2026-09-17T21:30:00.000Z", "America/New_York");

    expect(scene).not.toBeNull();
    expect(scene!.afterSunset.length).toBeGreaterThanOrEqual(2);
    expect(scene!.afterSunset[0]).toEqual(scene!.sunsetAt);
    expect(scene!.label).toBe(sunsetMarkerLabel(scene!.sunsetIso, "America/New_York"));
    expect(scene!.label).toMatch(/^Sunset around \d{1,2}:\d{2} [AP]M$/);
  });

  it("says nothing for a ride wholly in daylight", () => {
    expect(routeDaylightScene(LINE, 3_600, "2026-09-17T14:00:00.000Z", "America/New_York")).toBeNull();
  });

  it("says nothing when the sun calculation cannot answer", () => {
    const polar: readonly Coordinate[] = [
      { lat: 78, lon: 15 },
      { lat: 78.05, lon: 15.1 },
    ];
    expect(routeDaylightScene(polar, 3_600, "2026-06-21T12:00:00.000Z")).toBeNull();
    expect(routeDaylightScene([JIM_THORPE], FOUR_HOURS, "2026-09-17T21:30:00.000Z")).toBeNull();
  });
});
