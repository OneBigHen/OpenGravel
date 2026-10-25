/**
 * The briefing's one daylight statement: whether the ride is in the dark, and
 * when the light comes or goes. Never a count of minutes.
 */

import { describe, expect, it } from "vitest";

import { daylightLine } from "@/application/preparation/daylight-line";
import { sunriseOnDepartureDay, sunsetOnDepartureDay } from "@/application/long-trip";

const JIM_THORPE = { lat: 40.86, lon: -75.7 };

describe("daylightLine", () => {
  it("says when it gets light for a ride that starts before sunrise", () => {
    expect(daylightLine({
      departure: "2026-09-17T05:42:00.000Z",
      tripWindow: { start: "2026-09-17T05:42:00.000Z", end: "2026-09-17T06:45:00.000Z" },
      sunrise: "2026-09-17T11:21:00.000Z",
      sunset: "2026-09-17T22:12:00.000Z",
      riderTimeZone: "America/New_York",
    })).toBe("Dark until 7:21 am");
  });

  it("says when it gets dark instead of leaving a sunset sentence to decode", () => {
    expect(daylightLine({
      sunset: "2026-09-17T22:12:00.000Z",
      tripWindow: { start: "2026-09-17T21:00:00.000Z", end: "2026-09-17T23:00:00.000Z" },
      riderTimeZone: "America/New_York",
    })).toBe("Dark by 6:12 pm");
  });

  it("says it plainly when the sun is already down at the start", () => {
    expect(daylightLine({
      sunrise: "2026-09-17T11:21:00.000Z",
      sunset: "2026-09-17T22:12:00.000Z",
      tripWindow: { start: "2026-09-18T01:42:00.000Z", end: "2026-09-18T02:35:00.000Z" },
      riderTimeZone: "America/New_York",
    })).toBe("Riding in the dark");
  });

  it("says nothing about a ride that sits inside daylight", () => {
    expect(daylightLine({
      sunrise: "2026-09-17T11:21:00.000Z",
      sunset: "2026-09-17T22:12:00.000Z",
      tripWindow: { start: "2026-09-17T18:00:00.000Z", end: "2026-09-17T19:00:00.000Z" },
      riderTimeZone: "America/New_York",
    })).toBeNull();
    // An unknown sunrise or sunset is not turned into a daylight claim.
    expect(daylightLine({ tripWindow: { start: "2026-09-17T18:00:00.000Z", end: "2026-09-17T19:00:00.000Z" } })).toBeNull();
    expect(daylightLine({ sunrise: "2026-09-17T11:21:00.000Z" })).toBeNull();
  });
});

describe("sunriseOnDepartureDay", () => {
  it("finds the sunrise of the rider's own morning, not the UTC date's", () => {
    // 01:42 EDT on the solstice: sunrise is that same morning, ~5:30 EDT.
    const sunrise = sunriseOnDepartureDay(JIM_THORPE, "2026-06-21T05:42:00.000Z");
    expect(sunrise).not.toBeNull();
    const local = new Date(sunrise!).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
    expect(local).toMatch(/^5:\d{2} AM$/);
    const sunset = sunsetOnDepartureDay(JIM_THORPE, "2026-06-21T05:42:00.000Z");
    expect(sunset?.sunset.startsWith("2026-06-22T00:")).toBe(true);
  });

  it("has no sunrise to find where the approximation cannot resolve one", () => {
    expect(sunriseOnDepartureDay({ lat: 78, lon: 15 }, "2026-06-21T12:00:00.000Z")).toBeNull();
  });
});
