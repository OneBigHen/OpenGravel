import { describe, expect, it } from "vitest";

import { ridesAlongRoute, ALONG_ROUTE_LIMIT } from "@/application/route-library/along-route";
import { FLAG, type IndexRow } from "@/application/route-library/types";
import type { Coordinate } from "@/domain/ride/types";

/** A straight east–west line in Pennsylvania, about 53 mi long. */
const LINE: readonly Coordinate[] = [
  { lon: -76, lat: 40 },
  { lon: -75, lat: 40 },
];

function row(id: string, patch: Partial<IndexRow> = {}): IndexRow {
  return { id, n: id, k: "road", t: "twisty", q: 3, mi: 20, st: ["PA"], p: [40, -75.5], pp: "start", bb: null, f: FLAG.line, s: 0, c: null, sf: "p", ...patch };
}

describe("ridesAlongRoute", () => {
  it("keeps a ride whose start is within 15 mi of the line, and leaves the rest out", () => {
    const near = row("near", { p: [40.05, -75.5] });
    const edge = row("edge", { p: [40.2, -75.5] });
    const far = row("far", { p: [40.3, -75.5] });
    const nowhere = row("nowhere", { p: null, pp: null });
    const found = ridesAlongRoute([near, edge, far, nowhere], LINE);
    expect(found.map((hit) => hit.row.id)).toEqual(["near", "edge"]);
    expect(found[0]?.offRouteMeters).toBeLessThan(found[1]?.offRouteMeters ?? 0);
  });

  it("says where along the route the nearest point sits", () => {
    const [hit] = ridesAlongRoute([row("middle", { p: [40, -75.5] })], LINE);
    expect(hit?.offRouteMeters).toBeLessThan(1);
    expect(hit?.routeMile).toBeCloseTo(26.5, 0);
  });

  it("puts the better ride first, then the one with a line, then the nearer start", () => {
    const bestFar = row("best-far", { q: 5, p: [40.18, -75.5] });
    const bestLine = row("best-line", { q: 5, p: [40.1, -75.5], f: FLAG.line });
    const goodNear = row("good-near", { q: 4, p: [40, -75.5] });
    const found = ridesAlongRoute([bestFar, goodNear, bestLine], LINE);
    expect(found.map((hit) => hit.row.id)).toEqual(["best-line", "best-far", "good-near"]);
  });

  it("offers three by default: a choice, not a second list", () => {
    const many = Array.from({ length: 6 }, (_, index) => row(`r-${index}`, { q: 3, p: [40, -75.9 + index * 0.1] }));
    expect(ridesAlongRoute(many, LINE)).toHaveLength(ALONG_ROUTE_LIMIT);
    expect(ridesAlongRoute(many, LINE, { limit: 5 })).toHaveLength(5);
    expect(ridesAlongRoute(many, LINE, { limit: 0 })).toEqual([]);
  });

  it("does not offer the ride the line came from", () => {
    const self = row("self", { p: [40, -75.5] });
    const other = row("other", { p: [40.05, -75.5] });
    const found = ridesAlongRoute([self, other], LINE, { excludeIds: new Set(["self"]) });
    expect(found.map((hit) => hit.row.id)).toEqual(["other"]);
  });

  it("says nothing for a line that is not drawn, or a reach of zero", () => {
    expect(ridesAlongRoute([row("a")], [])).toEqual([]);
    expect(ridesAlongRoute([row("a")], LINE, { maxMeters: 0 })).toEqual([]);
  });

  it("answers a 6,000-ride library on a route without walking every segment for every ride", () => {
    const many = Array.from({ length: 6000 }, (_, index) => row(`r-${index}`, {
      p: [30 + (index % 200) / 10, -120 + (index % 500) / 10],
      q: 2 + (index % 4),
    }));
    many.push(row("near", { p: [40, -75.5], q: 5 }));
    const long: readonly Coordinate[] = Array.from({ length: 1200 }, (_, index) => ({ lon: -76 + index * 0.0008, lat: 40 + Math.sin(index / 40) * 0.02 }));
    const started = performance.now();
    const found = ridesAlongRoute(many, long);
    expect(found.map((hit) => hit.row.id)).toContain("near");
    expect(performance.now() - started).toBeLessThan(150);
  });
});
