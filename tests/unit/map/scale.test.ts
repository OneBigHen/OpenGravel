/**
 * The map's scale rule (05 §9).
 *
 * A scale bar is a claim, so what it claims is tested directly: the projection's
 * metres-per-pixel, and the 1-2-5 × 10ⁿ rounding that turns it into a round
 * distance a rider can read. Everything here is pure, which is the point — the
 * ruler can be wrong only in ways a test names, never in a way only a screenshot
 * would catch.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_SCALE_BAR_PX,
  metersPerPixelAt,
  scaleBarFor,
} from "@/application/map/scale";

const METERS_PER_MILE = 1609.344;

describe("metres per pixel", () => {
  it("fits a whole world into 512 pixels at zoom 0 on the equator", () => {
    expect(metersPerPixelAt(0, 0)).toBeCloseTo(40_075_016.686 / 512, 6);
  });

  it("halves the ground distance for every zoom level", () => {
    const atTwelve = metersPerPixelAt(12, 39.95);
    expect(metersPerPixelAt(13, 39.95)).toBeCloseTo(atTwelve / 2, 10);
    expect(metersPerPixelAt(11, 39.95)).toBeCloseTo(atTwelve * 2, 10);
  });

  it("shrinks with latitude, as the Mercator projection stretches a pixel", () => {
    const equator = metersPerPixelAt(14, 0);
    const pennsylvania = metersPerPixelAt(14, 41);
    expect(pennsylvania).toBeLessThan(equator);
    expect(pennsylvania).toBeCloseTo(equator * Math.cos((41 * Math.PI) / 180), 10);
  });

  it("has no answer for an impossible camera", () => {
    expect(metersPerPixelAt(Number.NaN, 40)).toBeNaN();
    expect(metersPerPixelAt(12, Number.NaN)).toBeNaN();
  });
});

describe("the 1-2-5 × 10ⁿ scale ladder", () => {
  it("picks the largest round distance that fits the rule", () => {
    // 88 px at 1 m/px is 88 m (288.7 ft); 200 ft (60.96 m) is the largest step
    // that still fits, and 500 ft would overflow.
    const bar = scaleBarFor(1);
    expect(bar?.label).toBe("200 ft");
    expect(bar?.widthPx).toBe(61);
  });

  it("steps up to miles once a mile fits the rule", () => {
    // 88 px at 20 m/px is 1,760 m, just past a mile, so the rule reads one mile.
    const bar = scaleBarFor(20);
    expect(bar?.label).toBe("1 mi");
    expect(bar?.meters).toBeCloseTo(METERS_PER_MILE, 6);
    expect(bar?.widthPx).toBeLessThanOrEqual(MAX_SCALE_BAR_PX);
  });

  it("keeps the rule inside its maximum width, and rounds down rather than up", () => {
    for (const metersPerPixel of [0.05, 0.13, 0.4, 1, 2.7, 4.8, 9, 20, 37, 61, 120, 400]) {
      const bar = scaleBarFor(metersPerPixel);
      expect(bar, `no rule at ${metersPerPixel} m/px`).not.toBeNull();
      if (bar === null) continue;
      expect(bar.widthPx).toBeLessThanOrEqual(MAX_SCALE_BAR_PX);
      // The next step up would not have fitted: that is what "largest" means.
      const wider = bar.widthPx * 2.5;
      expect(wider).toBeGreaterThan(MAX_SCALE_BAR_PX * 0.75);
      expect(bar.meters / metersPerPixel).toBeCloseTo(bar.widthPx, 1);
    }
  });

  it("has no answer without a camera reading", () => {
    // An unknown reading draws nothing rather than a ruler that might be wrong.
    expect(scaleBarFor(Number.NaN)).toBeNull();
    expect(scaleBarFor(0)).toBeNull();
    expect(scaleBarFor(-4)).toBeNull();
    expect(scaleBarFor(4, 0)).toBeNull();
  });

  it("would rather draw nothing than a bar wider than its box", () => {
    // One foot at 0.02 m/px is ~15 px: it does not fit a 10 px box, and nothing
    // smaller is on the ladder, so the rule is not drawn at all.
    expect(scaleBarFor(0.02, 10)).toBeNull();
    expect(scaleBarFor(0.02)).not.toBeNull();
  });
});
