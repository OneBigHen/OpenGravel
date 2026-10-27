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
  });

  it("lists a category or a chain", () => {
    expect(wantsList("coffee", [place("Starbucks"), place("Dunkin'")])).toBe(true);
    expect(wantsList("wawa", [place("Wawa", "a"), place("Wawa", "b")])).toBe(true);
  });

  it("opens a lone match", () => {
    expect(wantsList("coffee", [place("Starbucks")])).toBe(false);
  });
});
