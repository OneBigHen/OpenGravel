/**
 * Known roads a route rides (M3, OGV-D-264): geometric overlap, named curvy
 * roads, surveyed gravel, and the SQLite adapter that reads the catalogues.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterAll, describe, expect, it } from "vitest";

import {
  knownRoadEvidence,
  namedRoadsSentence,
  ratingWord,
  verifiedGravelSentence,
  type KnownRoadsPort,
} from "@/application/roads/known-roads";
import { indexRoute, lineOverlap } from "@/application/roads/route-overlap";
import type { Coordinate } from "@/domain/ride/types";
import { createKnownRoadsDb } from "@/server/roads/known-roads-db";

/** A straight east-west line, one point every ~85 m. */
function eastward(fromLon: number, steps: number, lat = 40.5): Coordinate[] {
  return Array.from({ length: steps + 1 }, (_, index) => ({ lon: fromLon + index * 0.001, lat }));
}

const ROUTE = eastward(-75.0, 40); // ~3.4 km

function port(roads: Partial<KnownRoadsPort> = {}): KnownRoadsPort {
  return {
    curvyRoadsNear: () => [],
    gravelCorridorsNear: () => [],
    ...roads,
  };
}

describe("route overlap", () => {
  it("measures the metres of a line that lie along the route", () => {
    const index = indexRoute(ROUTE);
    const along = lineOverlap(index, eastward(-74.99, 10));
    expect(along.riddenMeters).toBeCloseTo(along.lineMeters, 3);
    expect(along.lineMeters).toBeGreaterThan(800);

    // A parallel road 200 m north is not ridden.
    expect(lineOverlap(index, eastward(-74.99, 10, 40.5018)).riddenMeters).toBe(0);

    // A crossing road rides ~nothing: only one of its points touches the route.
    const crossing = [
      { lon: -74.98, lat: 40.49 },
      { lon: -74.98, lat: 40.5 },
      { lon: -74.98, lat: 40.51 },
    ];
    expect(lineOverlap(index, crossing).riddenMeters).toBe(0);
  });
});

describe("knownRoadEvidence", () => {
  it("names the ridden curvy roads, longest first, summing a road's segments", () => {
    const evidence = knownRoadEvidence(
      ROUTE,
      port({
        curvyRoadsNear: () => [
          { id: "a", name: "Decker Road", rating: 1500, line: eastward(-75.0, 12) },
          { id: "b", name: "Decker Road", rating: 900, line: eastward(-74.988, 6) },
          { id: "c", name: "Smith Gap Road", rating: 700, line: eastward(-74.97, 10) },
          { id: "d", name: "Oak Court", rating: 400, line: eastward(-74.98, 10, 40.51) },
          { id: "e", name: "678304272", rating: 1500, line: eastward(-74.965, 3) },
        ],
      }),
    );
    const sentence = namedRoadsSentence(evidence["namedRoads"]);
    expect(sentence).toBe("Rides Decker Road (very twisty, 0.9 mi) and Smith Gap Road (twisty, 0.5 mi).");
    expect(evidence["namedRoads"]?.status).toBe("estimated");
  });

  it("reports surveyed gravel as known surface evidence", () => {
    const evidence = knownRoadEvidence(
      ROUTE,
      port({
        gravelCorridorsNear: () => [
          { id: "g", label: "Shamong Road", line: eastward(-74.99, 20), confidence: 0.95 },
        ],
      }),
    );
    expect(evidence["verifiedGravel"]?.status).toBe("known");
    expect(verifiedGravelSentence(evidence["verifiedGravel"])).toBe("1.1 mi of surveyed gravel (Shamong Road).");
  });

  it("says nothing when no catalogue road is ridden", () => {
    expect(knownRoadEvidence(ROUTE, port())).toEqual({});
    expect(ratingWord(300)).toBe("curvy");
  });
});

describe("known-roads SQLite adapter", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ogv-known-roads-"));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it("reads both catalogues by bounds and survives a missing file", () => {
    const curvaturePath = path.join(directory, "segments.db");
    const curvature = new DatabaseSync(curvaturePath);
    curvature.exec(
      "create table segments (id text primary key, name text, score real, mid_lat real, mid_lon real, surface text, geometry text)",
    );
    curvature
      .prepare("insert into segments values (?, ?, ?, ?, ?, 'unknown', ?)")
      .run("s1", "Decker Road", 1500, 40.5, -74.99, JSON.stringify([[-75.0, 40.5], [-74.98, 40.5]]));
    curvature
      .prepare("insert into segments values (?, ?, ?, ?, ?, 'unknown', ?)")
      .run("s2", "Far Road", 800, 42.0, -74.0, JSON.stringify([[-74.0, 42.0], [-73.99, 42.0]]));
    curvature.close();

    const atlasPath = path.join(directory, "atlas.sqlite");
    const atlas = new DatabaseSync(atlasPath);
    atlas.exec(
      "create table gravel_atlas_corridors (id text, label text, geometry text, confidence real, verification_status text, west real, south real, east real, north real)",
    );
    atlas
      .prepare("insert into gravel_atlas_corridors values (?, ?, ?, ?, 'routable', ?, ?, ?, ?)")
      .run("g1", "Shamong Road", JSON.stringify([[-75.0, 40.5], [-74.99, 40.5]]), 0.9, -75.0, 40.5, -74.99, 40.5);
    atlas.close();

    const db = createKnownRoadsDb({ curvatureDbPath: curvaturePath, gravelAtlasDbPath: atlasPath });
    const bounds = { west: -75.1, south: 40.4, east: -74.9, north: 40.6 };
    expect(db.curvyRoadsNear(bounds).map((road) => road.name)).toEqual(["Decker Road"]);
    expect(db.gravelCorridorsNear(bounds).map((corridor) => corridor.label)).toEqual(["Shamong Road"]);

    const missing = createKnownRoadsDb({ curvatureDbPath: path.join(directory, "nope.db") });
    expect(missing.curvyRoadsNear(bounds)).toEqual([]);
    expect(missing.gravelCorridorsNear(bounds)).toEqual([]);
  });
});
