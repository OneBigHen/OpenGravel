import { describe, expect, it } from "vitest";

import type { PlaceMatch } from "@/application/geocoding/place-search";
import {
  applyDistanceSanity,
  mergePlaceResults,
  PLACE_RESULT_LIMIT,
  PLACE_SEARCH_DISTANCE_LIMIT_METERS,
} from "@/application/geocoding/place-merge";

const BIAS = { lat: 40.87, lon: -75.73 };

function place(name: string, lat: number, lon: number, provider = "photon"): PlaceMatch {
  return {
    id: `${provider}:${name}:${lat},${lon}`,
    label: `${name}, PA`,
    name,
    context: "",
    coordinate: { lat, lon },
    provider,
  };
}

describe("place distance sanity", () => {
  it("drops far answers when a nearby one exists", () => {
    const nearby = place("Lehighton", 40.8337, -75.7138);
    const india = place("Lehighton", 17.0, 78.5);
    expect(applyDistanceSanity([nearby, india], BIAS)).toEqual([nearby]);
  });

  it("keeps far answers when nothing is near", () => {
    const utah = place("Moab", 38.57, -109.55);
    const colorado = place("Denver", 39.74, -104.99);
    expect(applyDistanceSanity([utah, colorado], BIAS)).toEqual([utah, colorado]);
  });

  it("does nothing without a bias point", () => {
    const india = place("Lehighton", 17.0, 78.5);
    expect(applyDistanceSanity([india], undefined)).toEqual([india]);
  });

  it("keeps answers inside the limit and drops the ones beyond it", () => {
    // Roughly 250 km north of the bias, and roughly 350 km north.
    const inside = place("Inside", BIAS.lat + 250_000 / 110_540, BIAS.lon);
    const outside = place("Outside", BIAS.lat + 350_000 / 110_540, BIAS.lon);
    expect(applyDistanceSanity([inside], BIAS)).toEqual([inside]);
    expect(applyDistanceSanity([inside, outside], BIAS)).toEqual([inside]);
    // Nothing near: the far answer is all the rider gets.
    expect(applyDistanceSanity([outside], BIAS)).toEqual([outside]);
    expect(PLACE_SEARCH_DISTANCE_LIMIT_METERS).toBe(300_000);
  });
});

describe("merging two place sources", () => {
  it("leads with the POI answers and keeps the place answers after them", () => {
    const wawa = place("Wawa", 40.876, -75.733, "tomtom");
    const town = place("Jim Thorpe", 40.8757, -75.7324);
    const merged = mergePlaceResults([wawa], [town], BIAS);
    expect(merged.map((row) => row.provider)).toEqual(["tomtom", "photon"]);
  });

  it("collapses the same name at the same spot to one row", () => {
    const poi = place("Wawa", 40.876, -75.733, "tomtom");
    const same = place("Wawa", 40.8761, -75.7331);
    const different = place("Wawa", 40.98, -75.6);
    const merged = mergePlaceResults([poi], [same, different], BIAS);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.provider).toBe("tomtom");
  });

  it("ranks a nearer answer first when both are relevant", () => {
    const far = place("Valley Diner", 40.87 + 0.7, -75.73);
    const near = place("Hilltop Diner", 40.87 + 0.1, -75.73);
    expect(mergePlaceResults([far], [near], BIAS).map((row) => row.name)).toEqual([
      "Hilltop Diner",
      "Valley Diner",
    ]);
  });

  it("keeps the provider's own order inside a distance band", () => {
    const first = place("First", 40.87 + 0.35, -75.73);
    const second = place("Second", 40.87 + 0.1, -75.73);
    expect(mergePlaceResults([first, second], [], BIAS).map((row) => row.name)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("stays bounded", () => {
    const many = Array.from({ length: 12 }, (_value, index) =>
      place(`Place ${index}`, 40.87 + index * 0.01, -75.73),
    );
    expect(mergePlaceResults(many, [], BIAS)).toHaveLength(PLACE_RESULT_LIMIT);
  });
});
