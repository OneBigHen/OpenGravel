/**
 * The mapping from a sun position to the renderer's light, sky and hillshade
 * (MAP-EXPERIENCE-NEXT Wave 3, item 10). These are the parameters a rider
 * actually sees, so they are pinned directly rather than through a screenshot.
 */

import { describe, expect, it } from "vitest";

import {
  DAY_ALTITUDE,
  DEFAULT_HILLSHADE_DIRECTION,
  NIGHT_HILLSHADE_DIRECTION,
  sunLighting,
  sunToneAt,
} from "@/infrastructure/map/maplibre/sun-lighting";
import { SUN_LIGHT, skySpec } from "@/infrastructure/map/maplibre/visual-detail";

type Colour = { readonly r: number; readonly g: number; readonly b: number };

function colourOf(value: unknown): Colour {
  const hex = String(value);
  expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
  const parsed = Number.parseInt(hex.slice(1), 16);
  return { r: (parsed >> 16) & 0xff, g: (parsed >> 8) & 0xff, b: parsed & 0xff };
}

function luminance(value: unknown): number {
  const { r, g, b } = colourOf(value);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function position(light: Readonly<Record<string, unknown>>): readonly number[] {
  return light["position"] as readonly number[];
}

describe("sun lighting", () => {
  it("aims the hillshade from the sun's own bearing, anchored to the map", () => {
    const lighting = sunLighting({ azimuth: 268.4, altitude: 12 }, false);
    expect(lighting.hillshade).toEqual({ direction: 268.4, anchor: "map" });
    expect(position(lighting.light)[1]).toBeCloseTo(268.4, 5);
    expect(lighting.light["anchor"]).toBe("map");
  });

  it("wraps a bearing past north instead of writing 372°", () => {
    const lighting = sunLighting({ azimuth: 372.4, altitude: 30 }, false);
    expect(lighting.hillshade.direction).toBeCloseTo(12.4, 5);
    expect(position(lighting.light)[1]).toBeCloseTo(12.4, 5);
  });

  it("names the hour by the sun's altitude", () => {
    expect(sunToneAt(-20)).toBe("night");
    expect(sunToneAt(-6)).toBe("dusk");
    expect(sunToneAt(-0.1)).toBe("dusk");
    expect(sunToneAt(0)).toBe("golden");
    expect(sunToneAt(DAY_ALTITUDE - 0.1)).toBe("golden");
    expect(sunToneAt(DAY_ALTITUDE)).toBe("day");
    expect(sunToneAt(Number.NaN)).toBe("unknown");
  });

  it("lights golden hour from a low, warm sun", () => {
    const golden = sunLighting({ azimuth: 285, altitude: 3 }, false);
    const daylight = sunLighting({ azimuth: 180, altitude: 35 }, false);
    expect(golden.tone).toBe("golden");

    // The 3° sun is a grazing light: a polar angle near the horizon, not overhead.
    expect(position(golden.light)[2]).toBeGreaterThan(85);
    // Warm: clearly more red than blue, where midday light is near-white.
    const { r, b } = colourOf(golden.light["color"]);
    expect(r - b).toBeGreaterThan(40);
    expect(colourOf(daylight.light["color"]).r - colourOf(daylight.light["color"]).b).toBeLessThan(20);

    // The sky follows: a gold horizon and a dimmer, warmer haze than at noon.
    expect(luminance(golden.sky["horizon-color"])).toBeGreaterThan(150);
    expect(colourOf(golden.sky["horizon-color"]).b).toBeLessThan(
      colourOf(daylight.sky["horizon-color"]).b,
    );
    expect(luminance(golden.sky["sky-color"])).toBeLessThan(luminance(daylight.sky["sky-color"]));
    expect(golden.light["intensity"]).toBeLessThan(daylight.light["intensity"] as number);
  });

  it("turns dusk darker and cooler than golden hour, without going black", () => {
    const golden = sunLighting({ azimuth: 290, altitude: 2 }, false);
    const dusk = sunLighting({ azimuth: 295, altitude: -3 }, false);
    expect(dusk.tone).toBe("dusk");
    expect(luminance(dusk.sky["sky-color"])).toBeLessThan(luminance(golden.sky["sky-color"]));
    expect(luminance(dusk.sky["fog-color"])).toBeLessThan(luminance(golden.sky["fog-color"]));
    expect(dusk.light["intensity"]).toBeLessThan(golden.light["intensity"] as number);
    // A horizon still carries the last light: dusk is not the night palette.
    expect(luminance(dusk.sky["horizon-color"])).toBeGreaterThan(
      luminance(skySpec(true)["horizon-color"]),
    );
  });

  it("keeps a full day map on the sky it already had", () => {
    const day = sunLighting({ azimuth: 150, altitude: 35 }, false);
    expect(day.tone).toBe("day");
    expect(day.sky).toMatchObject({
      "sky-color": skySpec(false)["sky-color"],
      "horizon-color": skySpec(false)["horizon-color"],
      "fog-color": skySpec(false)["fog-color"],
    });
  });

  it("keeps the light above the ground however far the sun has set", () => {
    for (const altitude of [-30, -6, 0, 40, 90]) {
      const polar = position(sunLighting({ azimuth: 300, altitude }, false).light)[2] as number;
      expect(polar).toBeGreaterThanOrEqual(0.5);
      expect(polar).toBeLessThanOrEqual(89.5);
    }
  });

  it("does not jump at the sunset boundary", () => {
    const before = sunLighting({ azimuth: 300, altitude: -0.05 }, false);
    const after = sunLighting({ azimuth: 300, altitude: 0.05 }, false);
    for (const key of ["sky-color", "horizon-color", "fog-color"] as const) {
      const a = colourOf(before.sky[key]);
      const b = colourOf(after.sky[key]);
      expect(Math.abs(a.r - b.r)).toBeLessThan(6);
      expect(Math.abs(a.g - b.g)).toBeLessThan(6);
      expect(Math.abs(a.b - b.b)).toBeLessThan(6);
    }
    expect(Math.abs((before.light["intensity"] as number) - (after.light["intensity"] as number)))
      .toBeLessThan(0.05);
  });

  it("keeps a Night map's own palette and a cool light, whatever the sun is doing", () => {
    const night = sunLighting({ azimuth: 280, altitude: 4 }, true);
    expect(night.tone).toBe("night");
    expect(night.sky).toEqual(skySpec(true));
    const { r, b } = colourOf(night.light["color"]);
    expect(b).toBeGreaterThan(r);
    expect(night.light["intensity"]).toBeLessThan(0.3);
    // Relief still follows the real sun while it is up; the palette does not.
    expect(night.hillshade).toEqual({ direction: 280, anchor: "map" });

    const afterDark = sunLighting({ azimuth: 280, altitude: -12 }, true);
    expect(afterDark.hillshade).toEqual({ direction: NIGHT_HILLSHADE_DIRECTION, anchor: "map" });
  });

  it("falls back to the renderer's own light when the sun is unknown", () => {
    for (const night of [false, true]) {
      const unknown = sunLighting(null, night);
      expect(unknown.tone).toBe("unknown");
      expect(unknown.light).toEqual(SUN_LIGHT);
      expect(unknown.sky).toEqual(skySpec(night));
      expect(unknown.hillshade).toEqual({
        direction: DEFAULT_HILLSHADE_DIRECTION,
        anchor: "viewport",
      });
    }
  });
});
