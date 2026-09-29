import { describe, expect, it } from "vitest";

import {
  isOfflineGraphTile,
  isOfflineRegionManifest,
  tilesCovering,
  type GraphPosition,
  type OfflineGraphEdge,
  type OfflineGraphTile,
  type OfflineTurnRestriction,
} from "@/domain/offline/graph-tile";
import { offlineProfileFor, routeOffline } from "@/domain/offline/offline-router";

/*
 * A small grid, 0.01° apart (~1.1 km north-south, ~0.85 km east-west at 40°N):
 *
 *   C ── D ── E        row lat 40.02
 *   |         |
 *   A ── m ── B        row lat 40.00, "m" a plain vertex on way 1
 *
 * A–m–B is way 1 (asphalt), A–C, C–D–E, E–B are way 2..5.
 */
const NODES: Record<string, GraphPosition> = {
  A: [-75.0, 40.0],
  m: [-74.99, 40.0],
  B: [-74.98, 40.0],
  C: [-75.0, 40.02],
  D: [-74.99, 40.02],
  E: [-74.98, 40.02],
};

function metres(a: GraphPosition, b: GraphPosition): number {
  return Math.hypot((a[0] - b[0]) * 85_000, (a[1] - b[1]) * 111_000);
}

function way(id: string, osmWayId: string, from: string, to: string, extra: Partial<OfflineGraphEdge> = {}): OfflineGraphEdge[] {
  const length = metres(NODES[from]!, NODES[to]!);
  const base = {
    osmWayId,
    motorcycleAccess: "permitted",
    access: "permitted",
    roadClass: "tertiary",
    surface: "asphalt",
    profileWeights: { quick: length, twisty: length, scenic: length, adventure: length },
    uncertainty: [],
    ...extra,
  } as const;
  return [
    { ...base, id: `${id}f`, fromNodeId: from, toNodeId: to, geometry: [NODES[from]!, NODES[to]!] },
    { ...base, id: `${id}r`, fromNodeId: to, toNodeId: from, geometry: [NODES[to]!, NODES[from]!] },
  ];
}

function tile(edges: OfflineGraphEdge[], turnRestrictions: OfflineTurnRestriction[] = []): OfflineGraphTile {
  return {
    schemaVersion: 2,
    tileId: "t-test",
    bounds: { minLon: -75.1, minLat: 39.9, maxLon: -74.9, maxLat: 40.1 },
    nodes: Object.entries(NODES).map(([id, coordinate]) => ({ id, coordinate })),
    edges,
    turnRestrictions,
  };
}

const at = (id: string) => ({ lon: NODES[id]![0], lat: NODES[id]![1] });
const GRID = [
  ...way("w1a", "1", "A", "m"),
  ...way("w1b", "1", "m", "B"),
  ...way("w2", "2", "A", "C"),
  ...way("w3", "3", "C", "D"),
  ...way("w4", "4", "D", "E"),
  ...way("w5", "5", "E", "B"),
];

describe("offline graph tile contract", () => {
  it("accepts a well-formed tile and rejects a dangling edge", () => {
    expect(isOfflineGraphTile(tile(GRID))).toBe(true);
    const dangling = { ...GRID[0]!, id: "x", toNodeId: "nowhere" };
    expect(isOfflineGraphTile(tile([...GRID, dangling]))).toBe(false);
    expect(isOfflineGraphTile({ ...tile(GRID), schemaVersion: 3 })).toBe(false);
  });

  it("rejects a restriction whose via node does not join its edges", () => {
    const bad = { incomingEdgeId: "w2f", viaNodeId: "B", outgoingEdgeId: "w5r", restriction: "no_turn" } as const;
    expect(isOfflineGraphTile(tile(GRID, [bad]))).toBe(false);
  });

  it("checks a manifest's byte inventory and picks the tiles an area needs", () => {
    const entry = (tileId: string, minLon: number) => ({
      tileId,
      bounds: { minLon, minLat: 40, maxLon: minLon + 0.25, maxLat: 40.25 },
      bytes: 10,
      sha256: "a".repeat(64),
      nodeCount: 1,
      edgeCount: 1,
    });
    const manifest = {
      schemaVersion: 2,
      regionId: "pennsylvania",
      regionName: "Pennsylvania",
      version: "2026-07-22-x",
      compression: "gzip-json",
      buildDate: "2026-07-22",
      sourceDataDate: "2026-07-13",
      snapshotUrl: "https://example.org/pa.pbf",
      sourceUrl: "https://example.org/pa",
      bounds: { minLon: -76, minLat: 40, maxLon: -75.5, maxLat: 40.25 },
      checksums: { inventorySha256: "b".repeat(64) },
      attribution: "© OpenStreetMap contributors, ODbL 1.0",
      tiles: [entry("t-a", -76), entry("t-b", -75.75)],
      tileByteTotal: 20,
    };
    expect(isOfflineRegionManifest(manifest)).toBe(true);
    expect(isOfflineRegionManifest({ ...manifest, tileByteTotal: 21 })).toBe(false);
    const picked = tilesCovering(manifest, { minLon: -75.7, minLat: 40.1, maxLon: -75.6, maxLat: 40.2 });
    expect(picked.map((t) => t.tileId)).toEqual(["t-b"]);
  });
});

describe("routeOffline", () => {
  it("takes the direct way and reports the built edges it used", () => {
    const result = routeOffline([tile(GRID)], { waypoints: [at("A"), at("B")], profile: "quick", bike: "street" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The plain vertex m was contracted, yet both built edges come back.
    expect(result.edgeIds).toEqual(["w1af", "w1bf"]);
    expect(result.osmWayIds).toEqual(["1"]);
    expect(result.geometry).toEqual([at("A"), at("m"), at("B")]);
    expect(result.distanceMeters).toBeGreaterThan(1_600);
  });

  it("honours an avoid lock and a turn restriction on a contracted chain", () => {
    const avoid = routeOffline([tile(GRID)], {
      waypoints: [at("A"), at("B")],
      profile: "quick",
      bike: "street",
      roadLocks: [{ osmWayId: "1", mode: "avoid" }],
    });
    expect(avoid.ok && avoid.osmWayIds).toEqual(["2", "3", "4", "5"]);

    // Coming up from A, no right turn at C onto C–D: nothing else leaves C.
    const noTurn = { incomingEdgeId: "w2f", viaNodeId: "C", outgoingEdgeId: "w3f", restriction: "no_turn" } as const;
    const blocked = routeOffline([tile(GRID, [noTurn])], {
      waypoints: [at("A"), at("B")],
      profile: "quick",
      bike: "street",
      roadLocks: [{ osmWayId: "1", mode: "avoid" }],
    });
    expect(blocked).toMatchObject({ ok: false, kind: "no_path" });
  });

  it("goes round by a required road", () => {
    const result = routeOffline([tile(GRID)], {
      waypoints: [at("A"), at("B")],
      profile: "quick",
      bike: "street",
      roadLocks: [{ osmWayId: "4", mode: "must" }],
    });
    expect(result.ok && result.osmWayIds).toEqual(["2", "3", "4", "5"]);
  });

  it("keeps a street bike off gravel but lets an adventure bike use it", () => {
    const gravel = [
      ...GRID.filter((e) => e.osmWayId !== "1"),
      ...way("w1a", "1", "A", "m", { surface: "gravel" }),
      ...way("w1b", "1", "m", "B", { surface: "gravel" }),
    ];
    const street = routeOffline([tile(gravel)], { waypoints: [at("A"), at("B")], profile: "quick", bike: "street" });
    expect(street.ok && street.osmWayIds).toEqual(["2", "3", "4", "5"]);
    const adventure = routeOffline([tile(gravel)], { waypoints: [at("A"), at("B")], profile: "gravel", bike: "adventure" });
    expect(adventure.ok && adventure.osmWayIds).toEqual(["1"]);
  });

  it("visits a stop in the middle of a way it would otherwise pass through", () => {
    const result = routeOffline([tile(GRID)], { waypoints: [at("C"), at("m"), at("E")], profile: "quick", bike: "street" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.geometry).toContainEqual(at("m"));
    expect(result.geometry.at(-1)).toEqual(at("E"));
  });

  it("says when a point lies outside the downloaded roads", () => {
    const result = routeOffline([tile(GRID)], {
      waypoints: [at("A"), { lon: -70, lat: 44 }],
      profile: "quick",
      bike: "street",
    });
    expect(result).toMatchObject({ ok: false, kind: "out_of_coverage" });
  });

  it("stops when cancelled", () => {
    const result = routeOffline([tile(GRID)], { waypoints: [at("A"), at("B")], profile: "quick", bike: "street" }, { isCancelled: () => true });
    expect(result).toMatchObject({ ok: false, kind: "cancelled" });
  });
});

describe("offlineProfileFor", () => {
  it("maps the rider's road character and surface onto an offline profile", () => {
    expect(offlineProfileFor("curvy", "pavement")).toEqual({ profile: "twisty", bike: "street" });
    expect(offlineProfileFor("efficient", "mostly-pavement")).toEqual({ profile: "quick", bike: "adventure" });
    expect(offlineProfileFor("backroads", "dirt-preferred")).toEqual({ profile: "gravel", bike: "adventure" });
  });
});
