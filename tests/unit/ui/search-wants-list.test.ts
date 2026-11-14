import { describe, expect, it } from "vitest";

import type { PlaceMatch } from "@/application/geocoding/place-search";
import { wantsList } from "@/ui/planner/PlaceSearchField";

const place = (name: string, id = name): PlaceMatch => ({
  id, name, label: name, context: "PA", provider: "test", coordinate: { lat: 40, lon: -75 },
});

describe("Enter in the top search: list or place (Google's behaviour)", () => {
  it("opens the one place whose name is what was typed", () => {
    expect(wantsList("Jim Thorpe", [place("Jim Thorpe"), place("Jim Thorpe Station")])).toBe(false);
    expect(wantsList("Horsham, PA", [place("Horsham"), place("Horsham Township")])).toBe(false);
    // A bare trailing state is not part of the town's name (QA-16): Enter on
    // "Jim Thorpe PA" must go to Jim Thorpe, not list realtors near the rider.
    expect(wantsList("Jim Thorpe PA", [place("Jim Thorpe"), place("Jim Thorpe Station")])).toBe(false);
    expect(wantsList("Deals Gap NC", [place("Deals Gap"), place("Deals Gap Motorcycle Resort")])).toBe(false);
  });

  it("still lists when the typed name is not the town's name", () => {
    // "Jim Thorpe PA" names the town; "Jim Thorpe realtors" does not.
    expect(wantsList("Jim Thorpe realtors", [place("Jim McCormick Realtor"), place("Jim Heath Realtor")])).toBe(true);
  });

  it("lists a category or a chain", () => {
    expect(wantsList("coffee", [place("Starbucks"), place("Dunkin'")])).toBe(true);
    expect(wantsList("wawa", [place("Wawa", "a"), place("Wawa", "b")])).toBe(true);
  });

  it("opens a lone match", () => {
    expect(wantsList("coffee", [place("Starbucks")])).toBe(false);
  });
});
