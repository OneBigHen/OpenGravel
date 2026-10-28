import { describe, expect, it } from "vitest";

import {
  coordinateFormats,
  formatDecimalDegrees,
  formatDms,
  formatMgrs,
  formatUsng,
  toMgrsParts,
  toUtm,
  utmBand,
} from "@/domain/geometry/coordinates";

/**
 * Reference points, each an independently published coordinate:
 *
 * - Toronto (43°38′33.24″N 79°23′13.7″W) is the worked UTM example quoted in
 *   the NGA/Snyder documentation: zone 17T, 630084 m E, 4833438 m N.
 * - The Washington Monument (38.8895, -77.0353) is the USNG sample point
 *   printed as `18S UJ 23480 06483` (our input is 2 m west of that sample, and
 *   the square letters are what the sample is for).
 * - (0, 0) and (0, 3) sit on the equator at zone 31's western edge and central
 *   meridian, where the false-easting maths is easy to verify by hand.
 * - Sydney Opera House (-33.8568, 151.2153) is in the southern hemisphere, so
 *   it tests the 10,000,000 m false northing and the `56H LH` square.
 */
const TORONTO = { lat: 43 + 38 / 60 + 33.24 / 3600, lon: -(79 + 23 / 60 + 13.7 / 3600) };
const WASHINGTON_MONUMENT = { lat: 38.8895, lon: -77.0353 };
const EQUATOR_PRIME_MERIDIAN = { lat: 0, lon: 0 };
const EQUATOR_CENTRAL_MERIDIAN = { lat: 0, lon: 3 };
const SYDNEY = { lat: -33.8568, lon: 151.2153 };
const NEW_YORK = { lat: 40.7128, lon: -74.006 };

describe("toUtm", () => {
  it("reproduces the published Toronto UTM reference to a metre", () => {
    const utm = toUtm(TORONTO);
    expect(utm).not.toBeNull();
    expect(utm).toMatchObject({ zone: 17, band: "T", hemisphere: "N" });
    expect(Math.abs((utm?.easting ?? 0) - 630_084)).toBeLessThan(1);
    expect(Math.abs((utm?.northing ?? 0) - 4_833_438)).toBeLessThan(1);
  });

  it("puts the equator on the central meridian at exactly 500 km easting", () => {
    const utm = toUtm(EQUATOR_CENTRAL_MERIDIAN);
    expect(utm).toMatchObject({ zone: 31, band: "N", hemisphere: "N" });
    expect(utm?.easting).toBeCloseTo(500_000, 2);
    expect(utm?.northing).toBeCloseTo(0, 2);
    const edge = toUtm(EQUATOR_PRIME_MERIDIAN);
    expect(edge?.easting).toBeCloseTo(166_021.443, 2);
    expect(edge?.northing).toBeCloseTo(0, 2);
  });

  it("applies the 10,000,000 m false northing south of the equator", () => {
    const utm = toUtm(SYDNEY);
    expect(utm).toMatchObject({ zone: 56, band: "H", hemisphere: "S" });
    expect(utm?.northing).toBeGreaterThan(6_000_000);
    expect(utm?.northing).toBeLessThan(6_500_000);
  });

  it("keeps the documented Norwegian and Svalbard zone exceptions", () => {
    expect(toUtm({ lat: 60.3913, lon: 5.3221 })?.zone).toBe(32);
    expect(toUtm({ lat: 78.2232, lon: 15.6469 })?.zone).toBe(33);
    expect(toUtm({ lat: 78.5, lon: 5 })?.zone).toBe(31);
    expect(toUtm({ lat: 78.5, lon: 25 })?.zone).toBe(35);
  });

  it("wraps the antimeridian into zones 60 and 1", () => {
    expect(toUtm({ lat: 0, lon: 180 })?.zone).toBe(60);
    expect(toUtm({ lat: 0, lon: -180 })?.zone).toBe(1);
    expect(toUtm({ lat: 0, lon: 181 })?.zone).toBe(1);
  });

  it("fails closed outside the UTM bands and for malformed positions", () => {
    expect(toUtm({ lat: 84.1, lon: 0 })).toBeNull();
    expect(toUtm({ lat: -80.1, lon: 0 })).toBeNull();
    expect(toUtm({ lat: Number.NaN, lon: 0 })).toBeNull();
    expect(utmBand(84)).toBe("X");
    expect(utmBand(-80)).toBe("C");
    expect(utmBand(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("MGRS and USNG", () => {
  it("prints the published Toronto square and digits", () => {
    expect(formatUsng(TORONTO)).toBe("17T PJ 30084 33438");
    expect(formatMgrs(TORONTO)).toBe("17TPJ3008433438");
  });

  it("matches the Washington Monument USNG sample square", () => {
    expect(formatUsng(WASHINGTON_MONUMENT)).toBe("18S UJ 23478 06483");
  });

  it("starts even-numbered zones five rows along and odd ones at A", () => {
    // Zone 18 is even: northing rows start at F, so 43 rows of northing is J.
    expect(formatMgrs(WASHINGTON_MONUMENT)).toBe("18SUJ2347806483");
    // Zone 17 is odd: the same 48th row is J from an A start.
    expect(formatMgrs(TORONTO)).toBe("17TPJ3008433438");
    // Zone 56 is even too, which is why Sydney reads LH rather than LC.
    expect(formatMgrs(SYDNEY)).toBe("56HLH3490052288");
  });

  it("prints the equator/prime-meridian grid reference", () => {
    expect(formatUsng(EQUATOR_PRIME_MERIDIAN)).toBe("31N AA 66021 00000");
    expect(formatUsng(EQUATOR_CENTRAL_MERIDIAN)).toBe("31N EA 00000 00000");
  });

  it("honours a coarser precision by truncating each axis", () => {
    // 5-digit 83959/07350 cut to three digits keeps the trailing digits, so
    // the reference stays inside the same 100 m cell rather than moving north.
    expect(toMgrsParts(NEW_YORK, 3)).toEqual({
      zone: "18T",
      square: "WL",
      easting: "959",
      northing: "350",
    });
    expect(formatMgrs(NEW_YORK, 3)).toBe("18TWL959350");
    expect(formatUsng(NEW_YORK, 0)).toBe("18T WL");
  });

  it("refuses precisions it cannot honestly print", () => {
    expect(formatMgrs(NEW_YORK, -1)).toBeNull();
    expect(formatMgrs(NEW_YORK, 6)).toBeNull();
    expect(formatMgrs(NEW_YORK, 2.5)).toBeNull();
  });
});

describe("decimal degrees and DMS", () => {
  it("prints signed decimal degrees at one-metre precision", () => {
    expect(formatDecimalDegrees(NEW_YORK)).toBe("40.71280, -74.00600");
    expect(formatDecimalDegrees({ lat: 0, lon: 0 })).toBe("0.00000, 0.00000");
    expect(formatDecimalDegrees({ lat: 1e-9, lon: -1e-9 })).toBe("0.00000, 0.00000");
  });

  it("prints degrees, minutes and seconds with hemispheres", () => {
    expect(formatDms(NEW_YORK)).toBe("40°42′46.1″ N, 74°00′21.6″ W");
    expect(formatDms(SYDNEY)).toBe("33°51′24.5″ S, 151°12′55.1″ E");
  });

  it("carries rounded seconds into the next minute and degree", () => {
    // 40°59′59.97″ is 0.03″ short of 41°, and must print as 41° not 60.0″.
    expect(formatDms({ lat: 40 + 59 / 60 + 59.97 / 3600, lon: 0 })).toBe(
      "41°00′00.0″ N, 0°00′00.0″ E",
    );
  });

  it("returns null for a malformed position", () => {
    expect(formatDecimalDegrees({ lat: Number.NaN, lon: 0 })).toBeNull();
    expect(formatDms({ lat: 0, lon: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe("coordinateFormats", () => {
  it("gives every notation for one point from one source", () => {
    expect(coordinateFormats(NEW_YORK)).toEqual({
      decimal: "40.71280, -74.00600",
      dms: "40°42′46.1″ N, 74°00′21.6″ W",
      usng: "18T WL 83959 07350",
      mgrs: "18TWL8395907350",
    });
  });

  it("says unknown once, not per format, when the point is outside the grid", () => {
    expect(coordinateFormats({ lat: 85, lon: 20 })).toBeNull();
  });
});
