import { describe, expect, it } from "vitest";

import {
  PLACE_CATEGORIES,
  parsePlaceQuery,
} from "@/application/geocoding/place-query";

describe("place query parsing", () => {
  it("splits a brand from the town that follows it", () => {
    const parsed = parsePlaceQuery("Wawa Jim Thorpe");
    expect(parsed.term).toBe("Wawa Jim Thorpe");
    expect(parsed.place).toBeNull();
    expect(parsed.category).toBeNull();
    // The town is the trailing two words; the single word is a fallback, and
    // each candidate carries the term that would remain.
    expect(parsed.placeCandidates).toEqual([
      { term: "Wawa", place: "Jim Thorpe" },
      { term: "Wawa Jim", place: "Thorpe" },
    ]);
  });

  it("reads a category and the town after 'near' or 'in'", () => {
    const parsed = parsePlaceQuery("gas near Lehighton");
    expect(parsed.term).toBe("gas");
    expect(parsed.place).toBe("Lehighton");
    expect(parsed.category).toEqual({ query: "gas station", tomtomCategoryId: "7311" });
    expect(parsed.placeCandidates).toEqual([]);

    expect(parsePlaceQuery("coffee in Jim Thorpe")).toMatchObject({
      term: "coffee",
      place: "Jim Thorpe",
      category: { query: "coffee shop", tomtomCategoryId: "9376" },
    });
  });

  it("treats a bare category as a category around the rider", () => {
    expect(parsePlaceQuery("coffee")).toMatchObject({
      term: "coffee",
      place: null,
      category: { query: "coffee shop", tomtomCategoryId: "9376" },
      placeCandidates: [],
    });
    expect(parsePlaceQuery("food").category?.tomtomCategoryId).toBe("7315");
    expect(parsePlaceQuery("motorcycle shop").category).toEqual({
      query: "motorcycle shop",
      tomtomCategoryId: null,
    });
  });

  it("keeps a plain two-word place name whole", () => {
    // "Jim Thorpe" is a town, not "Jim" near "Thorpe": a two-word query only
    // splits when its first word is a category.
    const parsed = parsePlaceQuery("Jim Thorpe");
    expect(parsed.term).toBe("Jim Thorpe");
    expect(parsed.placeCandidates).toEqual([]);
  });

  it("splits a two-word category and town without a preposition", () => {
    const parsed = parsePlaceQuery("gas Lehighton");
    expect(parsed.term).toBe("gas Lehighton");
    expect(parsed.placeCandidates).toEqual([{ term: "gas", place: "Lehighton" }]);
  });

  it("keeps a half-remembered place name as the search term", () => {
    const parsed = parsePlaceQuery("Blue Mountain Ski");
    expect(parsed.term).toBe("Blue Mountain Ski");
    expect(parsed.category).toBeNull();
    expect(parsed.placeCandidates).toEqual([
      { term: "Blue", place: "Mountain Ski" },
      { term: "Blue Mountain", place: "Ski" },
    ]);
  });

  it("normalizes whitespace and a trailing question mark", () => {
    expect(parsePlaceQuery("  wawa   near   Jim Thorpe? ")).toMatchObject({
      query: "wawa near Jim Thorpe",
      term: "wawa",
      place: "Jim Thorpe",
    });
  });

  it("maps every synonym to a provider-neutral category label", () => {
    for (const [word, category] of PLACE_CATEGORIES) {
      expect(parsePlaceQuery(word).category, word).toEqual(category);
    }
    expect(parsePlaceQuery("fuel station").category).toBe(parsePlaceQuery("gas").category);
  });
});
