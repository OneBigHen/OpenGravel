import { describe, expect, it } from "vitest";

import {
  describeNearestRoad,
  emergencyCardModel,
  formatAccuracy,
  formatAltitude,
  formatRoadDistance,
} from "@/application/safety/emergency-card";
import { nearestRoad, type RoadLine } from "@/domain/geometry/nearest-road";
import type { Coordinate } from "@/domain/ride/types";

const WASHINGTON_MONUMENT: Coordinate = { lat: 38.8895, lon: -77.0353 };
const AT = new Date("2026-10-28T14:05:00.000Z");

const METRES_PER_DEGREE_LAT = 111_320;
const METRES_PER_DEGREE_LON =
  METRES_PER_DEGREE_LAT * Math.cos((WASHINGTON_MONUMENT.lat * Math.PI) / 180);
const at = (east: number, north: number): Coordinate => ({
  lon: WASHINGTON_MONUMENT.lon + east / METRES_PER_DEGREE_LON,
  lat: WASHINGTON_MONUMENT.lat + north / METRES_PER_DEGREE_LAT,
});

const RIDGE_ROAD: RoadLine = {
  id: "curvy:ridge",
  name: "Ridge Road",
  line: [at(-500, 100), at(500, 100)],
};

describe("formatAltitude", () => {
  it("prints the device altitude in feet with thousands grouped", () => {
    expect(formatAltitude(377.952)).toBe("1,240 ft");
    expect(formatAltitude(0)).toBe("0 ft");
    expect(formatAltitude(-12)).toBe("-39 ft");
  });

  it("is unknown, not zero, when the device reported nothing", () => {
    expect(formatAltitude(null)).toBeNull();
    expect(formatAltitude(undefined)).toBeNull();
    expect(formatAltitude(Number.NaN)).toBeNull();
  });
});

describe("formatAccuracy", () => {
  it("prints a whole-metre radius", () => {
    expect(formatAccuracy(8.4)).toBe("±8 m");
    expect(formatAccuracy(0.2)).toBe("±1 m");
  });

  it("is unknown when the fix carried no accuracy", () => {
    expect(formatAccuracy(null)).toBeNull();
    expect(formatAccuracy(-1)).toBeNull();
  });
});

describe("formatRoadDistance", () => {
  it("uses feet while a road is a walk away, then miles", () => {
    expect(formatRoadDistance(30)).toBe("100 ft");
    expect(formatRoadDistance(100)).toBe("330 ft");
    expect(formatRoadDistance(304)).toBe("1000 ft");
    expect(formatRoadDistance(304.9)).toBe("0.2 mi");
    // Whole tenths lose their trailing zero, as every other distance in the
    // app does (`application/planner/measurements`).
    expect(formatRoadDistance(3_218)).toBe("2 mi");
    expect(formatRoadDistance(32_000)).toBe("20 mi");
  });

  it("refuses a distance that is not a measurement", () => {
    expect(formatRoadDistance(Number.NaN)).toBeNull();
    expect(formatRoadDistance(-5)).toBeNull();
  });
});

describe("describeNearestRoad", () => {
  const nearest = nearestRoad(WASHINGTON_MONUMENT, [RIDGE_ROAD]);

  it("names the road and gives distance and direction", () => {
    expect(nearest).not.toBeNull();
    expect(describeNearestRoad(nearest, true)).toEqual({
      text: "Ridge Road",
      detail: "330 ft north",
      known: true,
    });
  });

  it("says unnamed rather than inventing a name", () => {
    const unnamed = nearestRoad(WASHINGTON_MONUMENT, [{ ...RIDGE_ROAD, name: "" }]);
    expect(describeNearestRoad(unnamed, true).text).toBe("Unnamed road");
  });

  it("distinguishes no loaded road data from no road in range", () => {
    expect(describeNearestRoad(null, false)).toEqual({
      text: "Unknown",
      detail: "No road data available here",
      known: false,
    });
    expect(describeNearestRoad(null, true)).toEqual({
      text: "Unknown",
      detail: "No mapped road in range",
      known: false,
    });
  });
});

describe("emergencyCardModel", () => {
  const nearest = nearestRoad(WASHINGTON_MONUMENT, [RIDGE_ROAD]);

  it("gives one row per notation and never two grid references that disagree", () => {
    const model = emergencyCardModel({
      coordinate: WASHINGTON_MONUMENT,
      altitudeMeters: 30.5,
      accuracyMeters: 8,
      nearestRoad: nearest,
      roadsLoaded: true,
      at: AT,
    });
    expect(model.formats.map((row) => row.id)).toEqual(["decimal", "dms", "usng"]);
    expect(model.formats.map((row) => row.value)).toEqual([
      "38.88950, -77.03530",
      "38°53′22.2″ N, 77°02′07.1″ W",
      "18S UJ 23478 06483",
    ]);
    expect(model.altitude).toBe("100 ft");
    expect(model.accuracy).toBe("±8 m");
    expect(model.road).toMatchObject({ text: "Ridge Road", known: true });
  });

  it("shares the same numbers the card prints, with the altitude and road", () => {
    const model = emergencyCardModel({
      coordinate: WASHINGTON_MONUMENT,
      altitudeMeters: 30.5,
      accuracyMeters: 8,
      nearestRoad: nearest,
      roadsLoaded: true,
      at: AT,
    });
    expect(model.shareText.split("\n")).toEqual([
      "OpenGravel emergency location",
      "38.88950, -77.03530",
      "38°53′22.2″ N, 77°02′07.1″ W",
      "18S UJ 23478 06483",
      "Altitude 100 ft",
      "GPS accuracy ±8 m",
      "Nearest road: Ridge Road — 330 ft north",
      "Recorded 2026-10-28T14:05:00.000Z",
    ]);
  });

  it("says unknown for a device that reported nothing", () => {
    const model = emergencyCardModel({
      coordinate: WASHINGTON_MONUMENT,
      altitudeMeters: null,
      accuracyMeters: null,
      nearestRoad: null,
      roadsLoaded: false,
      at: AT,
    });
    expect(model.altitude).toBe("Unknown");
    expect(model.altitudeKnown).toBe(false);
    expect(model.accuracy).toBeNull();
    expect(model.road.known).toBe(false);
    // Nothing invented in the shared text either.
    expect(model.shareText).not.toContain("Altitude");
    expect(model.shareText).toContain("Nearest road: unknown");
  });

  it("prints no coordinates at all without a fix, and says so", () => {
    const model = emergencyCardModel({
      coordinate: null,
      nearestRoad: null,
      roadsLoaded: false,
      at: AT,
    });
    expect(model.formats).toEqual([]);
    expect(model.coordinate).toBeNull();
    expect(model.shareText.split("\n")[1]).toBe("No GPS fix yet.");
  });

  it("keeps decimal and DMS outside the UTM bands instead of hiding the position", () => {
    const polar = emergencyCardModel({
      coordinate: { lat: 85, lon: 20 },
      nearestRoad: null,
      roadsLoaded: false,
      at: AT,
    });
    expect(polar.formats.map((row) => row.id)).toEqual(["decimal", "dms", "usng"]);
    expect(polar.formats[0]?.value).toBe("85.00000, 20.00000");
    expect(polar.formats[2]?.value).toBe("Not covered by the grid");
    expect(polar.formats[2]?.copyValue).toBeNull();
    expect(polar.shareText).not.toContain("Not covered by the grid");
    expect(polar.shareText).toContain("85.00000, 20.00000");
  });
});
