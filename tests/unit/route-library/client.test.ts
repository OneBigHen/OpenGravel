import { describe, expect, it } from "vitest";

import { parseExploreQuery, serializeExploreQuery } from "@/application/explore/query";
import { countByState, filterRows, hasLine, loadRouteLibrary, sortBest } from "@/application/route-library/client";
import { creditWord, qualityAndType, qualityWord } from "@/application/route-library/row-words";
import { FLAG, type IndexRow } from "@/application/route-library/types";
import { bubblesFor, extentFromCamera, groupBubbles, stateBubbles, statesInView } from "@/ui/explore/routes-camera";
import { lineFilter } from "@/ui/explore/routes-overlay";

function row(id: string, patch: Partial<IndexRow> = {}): IndexRow {
  return { id, n: id, k: "road", t: "twisty", q: 3, mi: 40, st: ["NC"], p: [35.5, -83.5], pp: "start", bb: null, f: FLAG.line, s: 0, c: null, sf: "p", ...patch };
}

const rows: readonly IndexRow[] = [
  row("a-twisty-5", { q: 5, t: "twisty", p: [35.3, -83.8], st: ["NC", "TN"] }),
  row("b-dirt-4", { q: 4, t: "dirt", p: [36.0, -82.0] }),
  row("c-scenic-3", { q: 3, t: "scenic", p: [44.0, -100.0], st: ["SD"], f: 0 }),
  row("d-trail-3", { q: 3, t: "trail", k: "area", mi: null, p: null, pp: null, st: ["MI"], f: 0 }),
  row("e-trip-5", { q: 5, t: "dirt", k: "trip", mi: null, p: null, pp: null, st: ["AZ"], f: 0 }),
];

describe("filterRows", () => {
  it("filters by type, any of the chosen chips", () => {
    expect(filterRows(rows, { types: ["twisty"] }).map((r) => r.id)).toEqual(["a-twisty-5"]);
    expect(filterRows(rows, { types: ["twisty", "scenic"] }).map((r) => r.id)).toEqual(["a-twisty-5", "c-scenic-3"]);
    expect(filterRows(rows, { types: ["trails"] }).map((r) => r.id)).toEqual(["d-trail-3"]);
  });

  it("Big trips is the trip flag, not a type", () => {
    expect(filterRows(rows, { types: ["trips"] }).map((r) => r.id)).toEqual(["e-trip-5"]);
    expect(filterRows(rows, { types: ["dirt"] }).map((r) => r.id)).toEqual(["b-dirt-4", "e-trip-5"]);
  });

  it("filters by Standout", () => {
    expect(filterRows(rows, { standoutOnly: true }).map((r) => r.id)).toEqual(["a-twisty-5", "e-trip-5"]);
  });

  it("filters by bounds and leaves out rides with no place", () => {
    const smokies = { west: -84.5, south: 35, east: -83, north: 36 };
    expect(filterRows(rows, { bounds: smokies }).map((r) => r.id)).toEqual(["a-twisty-5"]);
    expect(filterRows(rows, { bounds: { west: -180, south: -90, east: 180, north: 90 } })).toHaveLength(3);
  });

  it("passes everything through with no filter", () => {
    expect(filterRows(rows, {})).toBe(rows);
  });

  it("filters 6,000 rows in under 50 ms", () => {
    const many = Array.from({ length: 6000 }, (_, index) => row(`r-${index}`, {
      t: (["twisty", "scenic", "dirt", "trail"] as const)[index % 4]!,
      q: 2 + (index % 4),
      p: [25 + (index % 240) / 10, -120 + (index % 540) / 10],
    }));
    const started = performance.now();
    const found = filterRows(many, { types: ["twisty", "dirt"], standoutOnly: false, bounds: { west: -100, south: 30, east: -80, north: 45 } });
    const took = performance.now() - started;
    expect(found.length).toBeGreaterThan(0);
    expect(took).toBeLessThan(50);
  });
});

describe("sortBest", () => {
  it("puts the higher score first, then rides with a line", () => {
    const list = [row("x", { q: 4, f: 0 }), row("y", { q: 4, f: FLAG.line }), row("z", { q: 5, f: 0 })];
    expect(sortBest(list).map((r) => r.id)).toEqual(["z", "y", "x"]);
  });

  it("breaks ties by distance only when the rider's place is known", () => {
    const near = row("near", { p: [35.5, -83.5] });
    const far = row("far", { p: [40.0, -75.0] });
    const none = row("none", { p: null, pp: null });
    expect(sortBest([far, none, near], [35.6, -83.4]).map((r) => r.id)).toEqual(["near", "far", "none"]);
    // Without a place the order falls back to the name, never to a shuffle.
    expect(sortBest([far, near]).map((r) => r.id)).toEqual(["far", "near"]);
  });

  it("does not change the list it is given", () => {
    const list = [row("b"), row("a")];
    sortBest(list);
    expect(list.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("row words", () => {
  it("says Standout and Great ride, and nothing below", () => {
    expect(qualityWord(5)).toBe("Standout");
    expect(qualityWord(4)).toBe("Great ride");
    expect(qualityWord(3)).toBeNull();
    expect(qualityAndType(rows[0]!)).toBe("Standout · Twisty");
    expect(qualityAndType(rows[2]!)).toBe("Scenic");
    expect(qualityAndType(rows[4]!)).toBe("Standout · Dirt · Big trip");
  });

  it("credits the site, never an author the index does not carry", () => {
    expect(creditWord(row("a", { s: 1 }), ["A", "BestBikingRoads"])).toBe("Route from BestBikingRoads");
    expect(creditWord(row("a", { s: 9 }), ["A"])).toBeNull();
  });

  it("counts a multi-state ride in each state", () => {
    expect(countByState(rows)).toEqual({ NC: 2, TN: 1, SD: 1, MI: 1, AZ: 1 });
    expect(hasLine(rows[0]!)).toBe(true);
  });
});

describe("chips in the address bar", () => {
  it("round-trip through the URL", () => {
    const query = parseExploreQuery("?type=twisty,dirt&view=map&at=35.300,-83.800,7.50");
    expect(query.types).toEqual(["twisty", "dirt"]);
    expect(query.view).toBe("map");
    expect(query.at).toEqual({ lat: 35.3, lon: -83.8, zoom: 7.5 });
    const text = serializeExploreQuery(query);
    expect(text).toBe("?type=twisty,dirt&view=map&at=35.300,-83.800,7.50");
    expect(parseExploreQuery(text)).toEqual(query);
  });

  it("ignores unknown chips and bad numbers", () => {
    expect(parseExploreQuery("?type=sparkly").types).toBeUndefined();
    expect(parseExploreQuery("?type=trails,trips,nope").types).toEqual(["trails", "trips"]);
    expect(parseExploreQuery("?at=1,2").at).toBeUndefined();
    expect(parseExploreQuery("?here=-84,35,-83,36").here).toEqual({ west: -84, south: 35, east: -83, north: 36 });
  });
});

describe("the store", () => {
  it("is off when the manifest is 404", async () => {
    const library = await loadRouteLibrary(async () => new Response("{}", { status: 404 }));
    expect(library).toBeNull();
  });

  it("is off when anything throws", async () => {
    expect(await loadRouteLibrary(async () => { throw new Error("offline"); })).toBeNull();
  });

  it("reads the manifest, then the versioned index, and fetches each state's lines once", async () => {
    const calls: string[] = [];
    const library = await loadRouteLibrary(async (url) => {
      calls.push(url);
      if (url.endsWith("/manifest")) return Response.json({ version: "v1" });
      if (url.endsWith("/index.json")) return Response.json({ version: "v1", precision: 5, sources: ["S"], stateCounts: { NC: 1 }, rows: [row("a")] });
      return Response.json({ state: "NC", precision: 5, lines: [["a", "_p~iF~ps|U_ulLnnqC"]] });
    });
    expect(library?.rows).toHaveLength(1);
    expect(calls).toEqual(["/api/route-library/manifest", "/api/route-library/v1/index.json"]);
    const first = await library!.linesFor("NC");
    await library!.linesFor("NC");
    expect(calls.filter((url) => url.includes("/lines/NC"))).toHaveLength(1);
    expect(first?.get("a")?.[0]?.length).toBe(2);
  });
});

describe("the map's numbers", () => {
  it("shows a bubble per state, then groups of rides, then none", () => {
    const view = { west: -125, south: 24, east: -66, north: 50 };
    expect(stateBubbles(rows).map((b) => `${b.state}:${b.count}`).sort()).toEqual(["AZ:1", "MI:1", "NC:2", "SD:1", "TN:1"]);
    expect(bubblesFor(rows, 3.5, view).every((b) => b.kind === "state")).toBe(true);
    expect(bubblesFor(rows, 6, view).every((b) => b.kind === "group")).toBe(true);
    expect(bubblesFor(rows, 8, view)).toEqual([]);
  });

  it("gathers nearby rides into one bubble and keeps far ones apart", () => {
    const near = [row("p", { p: [35.5, -83.5] }), row("q", { p: [35.51, -83.51] }), row("r", { p: [41, -90] })];
    const groups = groupBubbles(near, 5, { west: -125, south: 24, east: -66, north: 50 });
    expect(groups.map((g) => g.count).sort()).toEqual([1, 2]);
  });

  it("asks for line files only for states near the view", () => {
    const smokies = { west: -84.5, south: 35, east: -83, north: 36 };
    expect([...statesInView(rows, smokies)].sort()).toEqual(["NC", "TN"]);
  });

  it("works out the box a camera shows, and it contains the centre", () => {
    const box = extentFromCamera(35.3, -83.8, 8, 390, 700);
    expect(box.minLon).toBeLessThan(-83.8);
    expect(box.maxLon).toBeGreaterThan(-83.8);
    expect(box.minLat).toBeLessThan(35.3);
    expect(box.maxLat).toBeGreaterThan(35.3);
    expect(box.maxLon - box.minLon).toBeCloseTo((390 * 360) / (512 * 2 ** 8), 3);
  });

  it("builds the dashed and solid line filters from the chips", () => {
    expect(lineFilter([], false, true)).toEqual(["all", ["match", ["get", "t"], ["dirt", "trail"], true, false]]);
    const solid = lineFilter(["dirt", "trips"], true, false);
    expect(JSON.stringify(solid)).toContain('"trip"');
    expect(solid.at(-1)).toEqual([">=", ["get", "q"], 5]);
  });
});
