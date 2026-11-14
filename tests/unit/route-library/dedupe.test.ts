import { describe, expect, it } from "vitest";

import { findSameRoad, nameTokens, sameName, type DedupeItem } from "@/application/route-library/dedupe";
import type { Coordinate } from "@/domain/ride/types";

/** A straight east-west road: `km` long, a point every `stepM` meters, shifted north by `northM`. */
function road(startLon: number, km: number, stepM: number, northM = 0, lat = 40): Coordinate[] {
  const perLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const points: Coordinate[] = [];
  for (let m = 0; m <= km * 1000; m += stepM) points.push({ lat: lat + northM / 111_320, lon: startLon + m / perLon });
  return points;
}

function boxOf(line: readonly Coordinate[]) {
  const lats = line.map((p) => p.lat);
  const lons = line.map((p) => p.lon);
  // A real ride is never a zero-height box; pad by about 500 m.
  return { west: Math.min(...lons) - 0.005, east: Math.max(...lons) + 0.005, south: Math.min(...lats) - 0.005, north: Math.max(...lats) + 0.005 };
}

function withLine(id: string, name: string, line: Coordinate[], states: string[] = ["PA"]): DedupeItem {
  return { id, name, source: id.startsWith("b") ? "Site B" : "Site A", states, line, bounds: boxOf(line), miles: null };
}

function listOnly(id: string, name: string, states: string[], bounds: DedupeItem["bounds"], miles: number | null): DedupeItem {
  return { id, name, source: id.startsWith("b") || id.startsWith("z") ? "Site B" : "Site A", states, line: null, bounds, miles };
}

describe("names", () => {
  it("reads the same road through different spellings", () => {
    expect(sameName("US 220 Pennsdale - Athens", "U.S. Highway 220: Pennsdale - Athens")).toBe(true);
    expect(sameName("PA-231 Prosperity to Avella", "PA 231 Prosperity Avella")).toBe(true);
    expect(nameTokens("The Cherohala Skyway")).toEqual(["cherohala", "skyway"]);
  });

  it("keeps different roads apart", () => {
    expect(sameName("PA 231 Loop", "PA 221 Loop")).toBe(false);
    expect(sameName("Skyline Drive", "Blue Ridge Parkway")).toBe(false);
    expect(sameName("Loop", "Loop")).toBe(true);
    expect(sameName("Mountain Loop", "Loop")).toBe(false);
  });
});

describe("the same road from two sites", () => {
  const a = withLine("a-hosted", "Ridge Road", road(-77, 12, 40));
  const b = withLine("b-other", "A very different name", road(-77, 12, 90, 20));

  it("merges two lines on top of each other, whatever the point spacing and names", () => {
    const result = findSameRoad([a, b]);
    expect(result.groups).toEqual([["a-hosted", "b-other"]]);
    expect(result.pairs[0]).toMatchObject({ method: "line" });
    expect(result.pairs[0]!.score).toBeGreaterThan(0.95);
  });

  it("merges a ride whose line starts and ends a little differently", () => {
    const trimmed = withLine("c-trimmed", "Ridge Road, short version", road(-77 + 0.002, 11.6, 70, 10));
    expect(findSameRoad([a, trimmed]).groups).toEqual([["a-hosted", "c-trimmed"]]);
  });

  it("joins three listings of one road into one group", () => {
    const c = withLine("c-third", "Ridge", road(-77, 12, 55, -15));
    expect(findSameRoad([a, b, c]).groups).toEqual([["a-hosted", "b-other", "c-third"]]);
  });

  it("merges a list-only listing with the same name, state, box and miles", () => {
    const link = listOnly("z-link", "Ridge Road", ["PA"], boxOf(road(-77, 12, 90, 30)), 7.5);
    const named = { ...a, miles: 7.4 };
    expect(findSameRoad([named, link]).groups).toEqual([["a-hosted", "z-link"]]);
    expect(findSameRoad([named, link]).pairs[0]).toMatchObject({ method: "box" });
  });
});

describe("near misses stay separate cards", () => {
  const base = withLine("a-base", "Ridge Road", road(-77, 12, 40));

  it("parallel roads 400 m apart", () => {
    expect(findSameRoad([base, withLine("b-parallel", "Ridge Road", road(-77, 12, 40, 400))]).groups).toEqual([]);
  });

  it("parallel roads 150 m apart", () => {
    expect(findSameRoad([base, withLine("b-close", "Ridge Road", road(-77, 12, 40, 150))]).groups).toEqual([]);
  });

  it("one road that is much longer than the other (a part of it)", () => {
    expect(findSameRoad([base, withLine("b-long", "Ridge Road Grand Tour", road(-77, 24, 40))]).groups).toEqual([]);
  });

  it("two lines that cross or touch but run apart", () => {
    const cross: Coordinate[] = [];
    for (let i = 0; i <= 100; i += 1) cross.push({ lat: 39.95 + i * 0.001, lon: -76.92 });
    expect(findSameRoad([base, withLine("b-cross", "Ridge Road", cross)]).groups).toEqual([]);
  });

  it("the same name in different states, even with identical boxes", () => {
    const box = boxOf(road(-77, 12, 90));
    const left = listOnly("a-pa", "Skyline Drive", ["PA"], box, 8);
    const right = listOnly("b-oh", "Skyline Drive", ["OH"], box, 8);
    expect(findSameRoad([left, right]).groups).toEqual([]);
  });

  it("the same name in the same state but a different place", () => {
    const left = listOnly("a-one", "Mountain Road", ["PA"], boxOf(road(-77, 12, 90)), 8);
    const right = listOnly("b-two", "Mountain Road", ["PA"], boxOf(road(-75, 12, 90)), 8);
    expect(findSameRoad([left, right]).groups).toEqual([]);
  });

  it("the same box but a different road number or name", () => {
    const box = boxOf(road(-77, 12, 90));
    expect(findSameRoad([listOnly("a-1", "PA 231 Loop", ["PA"], box, 8), listOnly("b-1", "PA 221 Loop", ["PA"], box, 8)]).groups).toEqual([]);
    expect(findSameRoad([listOnly("a-2", "Ridge Road", ["PA"], box, 8), listOnly("b-2", "Valley Road", ["PA"], box, 8)]).groups).toEqual([]);
  });

  it("the same name and box but miles that disagree", () => {
    const box = boxOf(road(-77, 12, 90));
    expect(findSameRoad([listOnly("a-3", "Ridge Road", ["PA"], box, 8), listOnly("b-3", "Ridge Road", ["PA"], box, 14)]).groups).toEqual([]);
  });

  it("two real lines that differ are not merged because their names agree", () => {
    const left = withLine("a-l", "Ridge Road", road(-77, 12, 40));
    const right = withLine("b-l", "Ridge Road", road(-77, 12, 40, 500));
    expect(findSameRoad([left, right]).groups).toEqual([]);
  });

  it("two pages of one site with unlike names and the same line are left alone", () => {
    const left = withLine("a-one", "High Heaven Ride", road(-77, 12, 40));
    const right = withLine("a-two", "Waterfall Byway Gorge", road(-77, 12, 60, 10));
    expect(findSameRoad([left, right]).groups).toEqual([]);
  });

  it("a group that grows past the cap is reported, not merged", () => {
    const many = Array.from({ length: 14 }, (_, index) => withLine(`m-${String(index).padStart(2, "0")}`, "Ridge Road", road(-77, 12, 40 + index, index % 3)));
    const result = findSameRoad(many);
    expect(result.groups).toEqual([]);
    expect(result.oversized).toHaveLength(1);
  });
});
