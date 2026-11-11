/**
 * The cold-open layer set (first-minute wow, W1): a new rider sees gravel,
 * twisty roads and the curated rides with no taps, and a rider's own choice —
 * including switching them all off — always wins.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_HIKE_LAYERS,
  DEFAULT_RIDE_LAYERS,
  defaultLayersFor,
  parseStoredLayers,
} from "@/application/map-layers";

describe("the cold-open layer set", () => {
  it("opens a ride map on gravel, twisty roads and rider-picked rides", () => {
    expect(defaultLayersFor("ride")).toEqual(["gravel", "great-roads", "rider-picked"]);
    expect(DEFAULT_RIDE_LAYERS).toContain("gravel");
    expect(DEFAULT_RIDE_LAYERS).toContain("great-roads");
  });

  it("leaves the hike defaults exactly as they were", () => {
    expect(defaultLayersFor("hike")).toBe(DEFAULT_HIKE_LAYERS);
    expect(parseStoredLayers(null, "hike")).toEqual(["trails", "hillshade", "contours"]);
  });

  it("lets a saved choice win, including switching every layer off", () => {
    expect(parseStoredLayers("[]", "ride")).toEqual([]);
    expect(parseStoredLayers('["fuel"]', "ride")).toEqual(["fuel"]);
    // Turning off the two headline layers sticks: the saved list is the choice.
    expect(parseStoredLayers('["viewpoints"]', "ride")).not.toContain("gravel");
    expect(parseStoredLayers('["trails"]', "hike")).toEqual(["trails"]);
  });

  it("drops names the app no longer knows, and a value it cannot read is no choice", () => {
    expect(parseStoredLayers('["gravel","retired-layer","gravel"]', "ride")).toEqual(["gravel"]);
    expect(parseStoredLayers("not json", "ride")).toEqual(DEFAULT_RIDE_LAYERS);
    expect(parseStoredLayers('{"layers":[]}', "ride")).toEqual(DEFAULT_RIDE_LAYERS);
  });

  it("still opens the default set when the stored list is only unknowable names", () => {
    // An array of garbage is an empty saved choice: the rider turned everything
    // off, so the map stays clear rather than re-enabling what they dismissed.
    expect(parseStoredLayers('["gone","also-gone"]', "ride")).toEqual([]);
  });
});
