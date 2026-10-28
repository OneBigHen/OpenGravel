/**
 * The solar position, against values that come from somewhere other than this
 * implementation: the geometry of the solstices, NOAA's own convention for the
 * sunset azimuth, and the independent sunrise/sunset approximation the
 * long-trip daylight code already ships.
 */

import { describe, expect, it } from "vitest";

import { solarPositionAt } from "@/application/map/solar-position";
import { calculateSunrise, calculateSunset } from "@/application/long-trip";
import { sunState } from "@/application/long-trip/daylight";

/** Jim Thorpe, PA — the regional sample the map's own tests use. */
const JIM_THORPE = { lat: 40.8637, lon: -75.7324 };
/** Tromsø, inside the Arctic Circle, for the midnight sun. */
const TROMSO = { lat: 69.6492, lon: 18.9553 };

function at(coordinate: { lat: number; lon: number }, iso: string): { azimuth: number; altitude: number } {
  const position = solarPositionAt(coordinate, Date.parse(iso));
  if (position === null) throw new Error(`no solar position for ${iso}`);
  return position;
}

describe("solar position", () => {
  it("puts the summer solstice sun at 90° − latitude + obliquity, due south at noon", () => {
    // 90 − 40.8637 + 23.44 = 72.58°: the geometric maximum, independent of any
    // time-equation series.
    const noon = at(JIM_THORPE, "2026-06-21T17:05:00Z");
    expect(noon.altitude).toBeCloseTo(72.58, 1);
    expect(noon.azimuth).toBeCloseTo(180, 0);
  });

  it("puts the winter solstice sun at 90° − latitude − obliquity", () => {
    const noon = at(JIM_THORPE, "2026-12-21T17:01:00Z");
    expect(noon.altitude).toBeCloseTo(25.70, 1);
    expect(noon.azimuth).toBeCloseTo(180, 0);
  });

  it("stands the equinox sun at 90° − latitude at noon", () => {
    const noon = at(JIM_THORPE, "2026-03-20T17:11:00Z");
    expect(noon.altitude).toBeCloseTo(49.14, 0);
    expect(noon.azimuth).toBeCloseTo(180, 0);
  });

  it("moves west of south through the afternoon", () => {
    // 21:00Z is 17:00 EDT, four hours after solar noon. Spherical trigonometry
    // from that hour angle gives about 38.3° altitude and a bearing near due west.
    const afternoon = at(JIM_THORPE, "2026-06-21T21:00:00Z");
    expect(afternoon.altitude).toBeCloseTo(38.3, 1);
    expect(afternoon.azimuth).toBeGreaterThan(265);
    expect(afternoon.azimuth).toBeLessThan(275);
  });

  it("agrees with the independent NOAA sunset calculation about where the sun is then", () => {
    // `calculateSunset` solves for the crossing the sun's centre makes with
    // −0.833° (refraction plus the solar disc); the position calculation knows
    // nothing about that convention, so meeting it there is a real cross-check.
    for (const [iso, azimuth] of [
      ["2026-06-21T12:00:00Z", 302],
      ["2026-03-20T12:00:00Z", 271],
      ["2026-12-21T12:00:00Z", 239],
    ] as const) {
      const sunset = calculateSunset(JIM_THORPE, iso);
      const sunsetAt = at(JIM_THORPE, (sunset as { sunset: string }).sunset);
      expect(sunsetAt.altitude).toBeCloseTo(-0.833, 0);
      expect(Math.abs(sunsetAt.azimuth - azimuth)).toBeLessThan(2);

      const sunrise = calculateSunrise(JIM_THORPE, iso);
      const sunriseAt = at(JIM_THORPE, sunrise as string);
      expect(sunriseAt.altitude).toBeCloseTo(-0.833, 0);
      // The morning mirror: the sun comes up on the opposite side of north.
      expect(Math.abs(sunriseAt.azimuth - (180 - (azimuth - 180) + 360) % 360)).toBeLessThan(2);
    }
  });

  it("puts a southern-hemisphere noon sun in the north", () => {
    const sydney = at({ lat: -33.8688, lon: 151.2093 }, "2026-12-21T02:00:00Z");
    expect(sydney.altitude).toBeGreaterThan(75);
    expect(Math.min(sydney.azimuth, 360 - sydney.azimuth)).toBeLessThan(10);
  });

  it("still has a position during a polar day, where sunState refuses to answer", () => {
    const midnight = at(TROMSO, "2026-06-21T00:00:00Z");
    expect(midnight.altitude).toBeGreaterThan(0);
    expect(Math.min(midnight.azimuth, 360 - midnight.azimuth)).toBeLessThan(25);
    // Unknown daylight is a different question, and it stays unanswered.
    expect(sunState(TROMSO, Date.parse("2026-06-21T00:00:00Z"))).toBeNull();
  });

  it("returns null rather than a position for input that is not real", () => {
    expect(solarPositionAt({ lat: 200, lon: 0 }, Date.parse("2026-06-21T00:00:00Z"))).toBeNull();
    expect(solarPositionAt({ lat: 0, lon: 400 }, Date.parse("2026-06-21T00:00:00Z"))).toBeNull();
    expect(solarPositionAt({ lat: Number.NaN, lon: 0 }, Date.parse("2026-06-21T00:00:00Z"))).toBeNull();
    expect(solarPositionAt(JIM_THORPE, Number.NaN)).toBeNull();
  });
});
