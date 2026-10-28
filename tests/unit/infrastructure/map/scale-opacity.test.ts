import { describe, expect, it } from "vitest";

import { scaleOpacity } from "@/infrastructure/map/maplibre/scale-opacity";

describe("scaleOpacity", () => {
  it("scales plain numbers and defaults a missing value to the factor", () => {
    expect(scaleOpacity(0.75, 0.5)).toBe(0.375);
    expect(scaleOpacity(undefined, 0.55)).toBe(0.55);
  });

  it("scales each output of a zoom step instead of wrapping it", () => {
    expect(scaleOpacity(["step", ["zoom"], 0, 14, 1], 0.5)).toEqual(["step", ["zoom"], 0, 14, 0.5]);
  });

  it("scales each output of a zoom interpolate instead of wrapping it", () => {
    expect(scaleOpacity(["interpolate", ["linear"], ["zoom"], 3, 0, 3.5, 1], 0.5))
      .toEqual(["interpolate", ["linear"], ["zoom"], 3, 0, 3.5, 0.5]);
  });

  it("multiplies other expressions", () => {
    expect(scaleOpacity(["get", "opacity"], 0.5)).toEqual(["*", ["get", "opacity"], 0.5]);
  });
});
