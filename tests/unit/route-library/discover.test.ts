import { describe, expect, it } from "vitest";

import { awayWords, bestNear, narrowed, resultsTitle, ridesNear, searchRows, stateFromText, stateTiles } from "@/application/route-library/discover";
import { FLAG, type IndexRow } from "@/application/route-library/types";

function row(id: string, patch: Partial<IndexRow> = {}): IndexRow {
  return { id, n: id, k: "road", t: "twisty", q: 3, mi: 40, st: ["NC"], p: [35.5, -83.5], pp: "start", bb: null, f: FLAG.line, s: 0, c: null, sf: "p", ...patch };
}

const asheville: readonly [number, number] = [35.6, -82.55];

describe("searchRows", () => {
  const rows = [
    row("dragon", { n: "Tail of the Dragon", q: 5, st: ["TN", "NC"] }),
    row("dragon-al", { n: "Dragon Tail AL", q: 4, st: ["AL"] }),
    row("blue", { n: "Blue Ridge Parkway", q: 5, st: ["VA", "NC"] }),
    row("needles", { n: "Needles Highway", q: 5, st: ["SD"] }),
    row("cafe", { n: "Café Loop", q: 3, st: ["TX"] }),
  ];

  it("finds by name, ignoring case and accents, a name that starts with the text first", () => {
    expect(searchRows(rows, "DRAGON").map((r) => r.id)).toEqual(["dragon-al", "dragon"]);
    expect(searchRows(rows, "cafe").map((r) => r.id)).toEqual(["cafe"]);
  });

  it("a typed state name or code lists that whole state", () => {
    expect(searchRows(rows, "north carolina").map((r) => r.id).sort()).toEqual(["blue", "dragon"]);
    expect(searchRows(rows, "SD").map((r) => r.id)).toEqual(["needles"]);
  });

  it("a name and a state together narrow to both", () => {
    expect(searchRows(rows, "dragon tn").map((r) => r.id)).toEqual(["dragon"]);
  });

  it("returns every row for empty text and none for text nothing matches", () => {
    expect(searchRows(rows, "  ")).toHaveLength(5);
    expect(searchRows(rows, "zzzz")).toEqual([]);
  });
});

describe("stateFromText", () => {
  it("reads names and codes", () => {
    expect(stateFromText("West Virginia")).toBe("WV");
    expect(stateFromText("nc")).toBe("NC");
    expect(stateFromText("dragon")).toBeNull();
  });
});

describe("ridesNear", () => {
  const near = [
    row("a", { q: 3, p: [35.7, -82.5] }),
    row("b", { q: 5, p: [35.9, -82.4] }),
    row("c", { q: 4, p: [35.55, -82.6] }),
    row("d", { q: 4, p: [35.5, -82.2] }),
    row("e", { q: 3, p: [35.4, -82.7] }),
    row("far", { q: 5, p: [44.0, -100.0] }),
    row("nowhere", { q: 5, p: null, pp: null }),
  ];

  it("takes rides within 75 mi, best score first, then the nearer", () => {
    const result = ridesNear(near, asheville);
    expect(result.radiusMiles).toBe(75);
    expect(result.rows.map((r) => r.id)).toEqual(["b", "c", "d", "a", "e"]);
  });

  it("with fewer than five inside, takes the nearest twenty, nearest first", () => {
    const result = ridesNear(near.slice(0, 3).concat(row("far", { p: [44, -100] })), asheville);
    expect(result.radiusMiles).toBeNull();
    expect(result.rows.map((r) => r.id)).toEqual(["c", "a", "b", "far"]);
  });

  it("leaves out rides with no place", () => {
    expect(ridesNear(near, asheville).rows.map((r) => r.id)).not.toContain("nowhere");
  });
});

describe("awayWords", () => {
  it("rounds like a rider says it, and hedges when the place is only the area", () => {
    expect(awayWords(row("x", { p: [35.6, -82.55] }), asheville)).toBe("Starts near you");
    expect(awayWords(row("x", { p: [35.7, -82.5] }), asheville)).toBe("7 mi away");
    expect(awayWords(row("x", { p: [35.9, -82.4] }), asheville)).toBe("20 mi away");
    expect(awayWords(row("x", { p: [35.9, -82.4], pp: "area" }), asheville)).toBe("About 20 mi away");
    expect(awayWords(row("x", { p: null, pp: null }), asheville)).toBeNull();
    expect(awayWords(row("x"), undefined)).toBeNull();
  });
});

describe("bestNear", () => {
  const all = [
    row("five-far", { q: 5, p: [30, -90] }),
    row("five-near", { q: 5, p: [35.6, -82.5] }),
    row("four-near", { q: 4, p: [35.6, -82.5] }),
    row("three-near", { q: 3, p: [35.6, -82.5] }),
    row("five-nowhere", { q: 5, p: null, pp: null }),
  ];

  it("lists only Standout and Great ride, best score first, then nearest the view, never a ride with no place", () => {
    expect(bestNear(all, asheville).map((r) => r.id)).toEqual(["five-near", "five-far", "four-near"]);
  });

  it("stops at the count asked for", () => {
    expect(bestNear(all, asheville, 1).map((r) => r.id)).toEqual(["five-near"]);
  });
});

describe("stateTiles", () => {
  it("counts a ride in every state it crosses, by name", () => {
    const tiles = stateTiles([row("a", { st: ["TN", "NC"] }), row("b", { st: ["NC"] }), row("c", { st: ["AL"] })]);
    expect(tiles).toEqual([
      { code: "AL", name: "Alabama", count: 1 },
      { code: "NC", name: "North Carolina", count: 2 },
      { code: "TN", name: "Tennessee", count: 1 },
    ]);
  });
});

describe("narrowed and resultsTitle", () => {
  const none = { types: [], standout: false, state: undefined, search: "", near: false } as const;

  it("is not narrowed until the rider picks something", () => {
    expect(narrowed(none)).toBe(false);
    expect(narrowed({ ...none, search: " " })).toBe(false);
    expect(narrowed({ ...none, state: "NC" })).toBe(true);
    expect(narrowed({ ...none, near: true })).toBe(true);
  });

  it("says what is listed in rider words", () => {
    expect(resultsTitle({ ...none, state: "NC" })).toBe("Rides in North Carolina");
    expect(resultsTitle({ ...none, types: ["twisty"], state: "NC" })).toBe("Twisty rides in North Carolina");
    expect(resultsTitle({ ...none, types: ["twisty", "scenic"], standout: true })).toBe("Standout Twisty or Scenic rides");
    expect(resultsTitle({ ...none, near: true })).toBe("Rides near you");
    expect(resultsTitle({ ...none, types: ["trips"] })).toBe("Big trips");
    expect(resultsTitle({ ...none, search: "dragon" })).toBe("Rides matching “dragon”");
  });
});
