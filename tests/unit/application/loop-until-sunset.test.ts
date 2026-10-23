/**
 * "Back by sunset" loop time.
 *
 * The chip is only as trustworthy as the sunset it reads and the daylight it
 * promises to leave: the NOAA instant has to match the published local sunset,
 * the margin has to survive rounding, and no sunset (or no start point) has to
 * hide the offer instead of inventing a duration.
 */

import { describe, expect, it } from "vitest";

import { sunsetOnDepartureDay } from "@/application/long-trip";
import {
  loopMinutesUntilSunset,
  SUNSET_LOOP_MINIMUM_MINUTES,
} from "@/application/planner/loop-until-sunset";

/** Jim Thorpe, PA — a valley town whose sunsets the local almanac states. */
const JIM_THORPE = { lat: 40.8676, lon: -75.7327 };
/** Longest loop the ride-time picker offers. */
const MAX_MINUTES = 360;

describe("sunset at the ride's start point", () => {
  it("matches the published Jim Thorpe sunset on 2026-10-23 within three minutes", () => {
    // 18:13 EDT is 22:13 UTC.
    const fact = sunsetOnDepartureDay(JIM_THORPE, "2026-10-23T16:00:00.000Z");

    if (fact === null) throw new Error("expected a sunset for Jim Thorpe");
    const minutes = Math.round((Date.parse(fact.sunset) - Date.parse("2026-10-23T22:13:00.000Z")) / 60_000);
    expect(Math.abs(minutes)).toBeLessThanOrEqual(3);
  });

  it("still gives a summer evening a long way before dark", () => {
    const fact = sunsetOnDepartureDay(JIM_THORPE, "2026-06-21T16:00:00.000Z");

    if (fact === null) throw new Error("expected a summer sunset for Jim Thorpe");
    // 20:38 EDT on the summer solstice.
    expect(Date.parse(fact.sunset)).toBeGreaterThan(Date.parse("2026-06-22T00:30:00.000Z"));
  });

  it("reports no sunset when the sun does not set, or does not rise", () => {
    expect(sunsetOnDepartureDay({ lat: 78, lon: 15 }, "2026-06-21T12:00:00.000Z")).toBeNull();
    expect(sunsetOnDepartureDay({ lat: 78, lon: 15 }, "2026-12-21T12:00:00.000Z")).toBeNull();
  });
});

describe("loop minutes until sunset", () => {
  it("leaves the margin, rounds down to five minutes", () => {
    // 17:00Z is 13:00 EDT; Jim Thorpe sunset is 22:11Z, so 311 minutes of light.
    // 311 - 20 minutes of margin is 291, rounded down to 290.
    expect(loopMinutesUntilSunset({
      coordinate: JIM_THORPE,
      now: new Date("2026-10-23T17:00:00.000Z"),
      maxMinutes: MAX_MINUTES,
    })).toBe(290);
  });

  it("caps a long afternoon at the picker's longest loop", () => {
    expect(loopMinutesUntilSunset({
      coordinate: JIM_THORPE,
      now: new Date("2026-10-23T13:00:00.000Z"),
      maxMinutes: MAX_MINUTES,
    })).toBe(MAX_MINUTES);
  });

  it("offers nothing once the daylight left is too short for a loop", () => {
    // 21:40Z is 17:40 EDT: about half an hour before sunset.
    expect(loopMinutesUntilSunset({
      coordinate: JIM_THORPE,
      now: new Date("2026-10-23T21:40:00.000Z"),
      maxMinutes: MAX_MINUTES,
    })).toBeNull();
    expect(loopMinutesUntilSunset({
      coordinate: JIM_THORPE,
      now: new Date("2026-10-23T23:30:00.000Z"),
      maxMinutes: MAX_MINUTES,
    })).toBeNull();
  });

  it("hides when the start point is unknown or the sun never sets", () => {
    expect(loopMinutesUntilSunset({
      coordinate: null,
      now: new Date("2026-10-23T17:00:00.000Z"),
      maxMinutes: MAX_MINUTES,
    })).toBeNull();
    expect(loopMinutesUntilSunset({
      coordinate: { lat: 78, lon: 15 },
      now: new Date("2026-06-21T12:00:00.000Z"),
      maxMinutes: MAX_MINUTES,
    })).toBeNull();
  });

  it("never comes back under the shortest loop it would offer", () => {
    const minutes = loopMinutesUntilSunset({
      coordinate: JIM_THORPE,
      now: new Date("2026-10-23T17:00:00.000Z"),
      maxMinutes: MAX_MINUTES,
    });

    expect(minutes).not.toBeNull();
    expect(minutes ?? 0).toBeGreaterThanOrEqual(SUNSET_LOOP_MINIMUM_MINUTES);
    expect((minutes ?? 0) % 5).toBe(0);
  });
});
