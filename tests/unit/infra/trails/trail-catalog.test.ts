import { describe, expect, it } from "vitest";

import {
  assembleLines,
  isContainedIn,
  linesFromGeometry,
  pointFromGeometry,
  polygonCentre,
  undirectedLineSignature,
} from "../../../../infra/trails/lib/geometry";
import { ingestOsm, osmiumCommands, readFeatureFile, readOplRelations } from "../../../../infra/trails/lib/osm-input";
import { USFS_TRAILS, ingestExternal } from "../../../../infra/trails/lib/external";
import { clusterCandidates, mergeTrails } from "../../../../infra/trails/lib/merge";
import { PlaceGrid, attachTrailheads } from "../../../../infra/trails/lib/trailhead";
import type { OsmFeature } from "../../../../infra/trails/lib/osm-input";
import type { Coordinate } from "../../../../src/domain/ride/types";
import type { TrailAttributes, TrailCandidate, TrailSourceId } from "../../../../infra/trails/lib/types";

const line = (coordinates: readonly (readonly [number, number])[]): Coordinate[] =>
  coordinates.map(([lon, lat]) => ({ lon, lat }));

const UNKNOWN: TrailAttributes = {
  name: null,
  ref: null,
  operator: null,
  sacScale: null,
  surface: null,
  trailVisibility: null,
  dog: null,
  access: null,
};

function trail(
  recordId: string,
  coordinates: readonly (readonly [number, number])[],
  attributes: Partial<TrailAttributes> = {},
  sourceId: TrailSourceId = "osm",
): TrailCandidate {
  return {
    sourceId,
    recordId,
    url: null,
    lines: [line(coordinates)],
    attributes: { ...UNKNOWN, ...attributes },
  };
}

function osmFeature(type: "node" | "way" | "relation", id: number, geometry: unknown, tags: Record<string, string>, extra: Record<string, unknown> = {}): OsmFeature {
  return { properties: { "@type": type, "@id": id, ...tags, ...extra }, geometry };
}

describe("relation assembly", () => {
  it("recursively expands nested relations in member order and terminates cycles/missing members", () => {
    const features: OsmFeature[] = [
      osmFeature("way", 1, { type: "LineString", coordinates: [[0, 0], [0.001, 0]] }, { highway: "path" }),
      osmFeature("way", 2, { type: "LineString", coordinates: [[0.001, 0], [0.002, 0]] }, { highway: "path" }),
      osmFeature("relation", 10, null, { type: "superroute", route: "hiking", name: "Parent" }, {
        members: [{ type: "relation", ref: 11 }, { type: "way", ref: 2 }, { type: "relation", ref: 999 }],
      }),
      osmFeature("relation", 11, null, { type: "route" }, {
        members: [{ type: "way", ref: 1 }, { type: "relation", ref: 10 }, { type: "way", ref: 999 }],
      }),
    ];
    const result = ingestOsm(features);
    expect(result.trails[0]?.lines).toEqual([line([[0, 0], [0.001, 0], [0.002, 0]])]);
    expect(result.relationIssues).toEqual({ cycles: 1, missingRelations: 1, missingWays: 1 });
  });

  it("expands a repeated sibling without mistaking it for a cycle and preserves disconnected parts", () => {
    const result = ingestOsm([
      osmFeature("way", 1, { type: "LineString", coordinates: [[0, 0], [0.001, 0]] }, { highway: "path" }),
      osmFeature("way", 2, { type: "LineString", coordinates: [[1, 0], [1.001, 0]] }, { highway: "path" }),
      osmFeature("relation", 11, null, {}, { members: [{ type: "way", ref: 1 }] }),
      osmFeature("relation", 10, null, { route: "foot" }, { members: [
        { type: "relation", ref: 11 }, { type: "way", ref: 2 }, { type: "relation", ref: 11, role: "backward" },
      ] }),
    ]);
    expect(result.trails[0]?.lines).toHaveLength(3);
    expect(result.trails[0]?.lines[2]).toEqual(line([[0.001, 0], [0, 0]]));
    expect(result.relationIssues.cycles).toBe(0);
  });

  it("joins member ways through a shared node and leaves a real gap as two lines", () => {
    const joined = assembleLines([line([[0, 0], [0.001, 0]]), line([[0.001, 0], [0.002, 0]])]);
    expect(joined).toHaveLength(1);
    expect(joined[0]?.map((coordinate) => coordinate.lon)).toEqual([0, 0.001, 0.002]);

    // A member stored the other way round still continues the line.
    const reversed = assembleLines([line([[0, 0], [0.001, 0]]), line([[0.002, 0], [0.001, 0]])]);
    expect(reversed).toHaveLength(1);
    expect(reversed[0]?.map((coordinate) => coordinate.lon)).toEqual([0, 0.001, 0.002]);

    // Members that do not touch are never bridged: a gap stays a gap.
    const gapped = assembleLines([line([[0, 0], [0.001, 0]]), line([[0.002, 0], [0.003, 0]])]);
    expect(gapped).toHaveLength(2);
  });

  it("assembles a relation from its member ways when the export carries member ids", () => {
    const features: OsmFeature[] = [
      osmFeature("way", 1, { type: "LineString", coordinates: [[0, 0], [0.001, 0]] }, { highway: "path", name: "Lower Trail" }),
      osmFeature("way", 2, { type: "LineString", coordinates: [[0.001, 0], [0.002, 0]] }, { highway: "path", name: "Upper Trail" }),
      osmFeature("relation", 9, { type: "MultiLineString", coordinates: [[[0, 0], [0.001, 0]], [[0.001, 0], [0.002, 0]]] }, { route: "hiking", name: "Ridge Route" }, {
        members: [{ type: "way", ref: 1 }, { type: "way", ref: 2 }],
      }),
    ];
    const ingest = ingestOsm(features);
    expect(ingest.trails.map((candidate) => candidate.recordId)).toEqual(["relation/9"]);
    expect(ingest.trails[0]?.lines).toHaveLength(1);
    expect(ingest.trails[0]?.lines[0]).toHaveLength(3);
  });

  it("absorbs a sub-relation of a longer route and a way covered by a single-member relation", () => {
    const features: OsmFeature[] = [
      // A route relation that spans both halves. OSM sub-relations are built
      // from the same member ways, so they share the parent's nodes exactly.
      osmFeature("relation", 1, { type: "MultiLineString", coordinates: [[[0, 0], [0.001, 0], [0.002, 0]]] }, { route: "hiking", name: "Long Route" }),
      // A shorter route on the same ground must not be listed twice.
      osmFeature("relation", 2, { type: "MultiLineString", coordinates: [[[0, 0], [0.001, 0]]] }, { route: "hiking", name: "First Half" }),
      // A way covered exactly by a route of the same length is still absorbed.
      osmFeature("way", 3, { type: "LineString", coordinates: [[0.003, 0], [0.004, 0]] }, { highway: "path", name: "Exact Way" }),
      osmFeature("relation", 4, { type: "LineString", coordinates: [[0.003, 0], [0.004, 0]] }, { route: "foot", name: "Exact Route" }),
    ];
    expect(ingestOsm(features).trails.map((candidate) => candidate.recordId)).toEqual(["relation/1", "relation/4"]);
  });

  it("falls back to the exported geometry when member ids are absent", () => {
    const features: OsmFeature[] = [
      osmFeature("relation", 9, { type: "MultiLineString", coordinates: [[[0, 0], [0.001, 0]], [[0.002, 0], [0.003, 0]]] }, { route: "foot", name: "Ridge Route" }),
    ];
    expect(ingestOsm(features).trails[0]?.lines).toHaveLength(2);
  });

  it("recognizes a member way inside a relation line, either direction", () => {
    const route = line([[0, 0], [0.001, 0], [0.002, 0]]);
    expect(isContainedIn(line([[0.001, 0], [0.002, 0]]), route)).toBe(true);
    expect(isContainedIn(line([[0.002, 0], [0.001, 0]]), route)).toBe(true);
    expect(isContainedIn(line([[0, 0], [0.002, 0]]), route)).toBe(false);
  });
});

describe("OSM ingestion", () => {
  it("keeps named walking ways and drops unnamed, bridleway and loopless features", () => {
    const features: OsmFeature[] = [
      osmFeature("way", 1, { type: "LineString", coordinates: [[0, 0], [0.001, 0]] }, { highway: "path", name: "Kept" }),
      osmFeature("way", 2, { type: "LineString", coordinates: [[0, 0], [0.001, 0]] }, { highway: "path" }),
      osmFeature("way", 3, { type: "LineString", coordinates: [[0, 0], [0.001, 0]] }, { highway: "bridleway", name: "Dropped" }),
      osmFeature("way", 4, { type: "LineString", coordinates: [[0, 0], [0.001, 0]] }, { highway: "track", name: "Track" }),
    ];
    expect(ingestOsm(features).trails.map((candidate) => candidate.recordId)).toEqual(["way/1", "way/4"]);
  });

  it("reads trailhead nodes, parking nodes and parking areas as places", () => {
    const features: OsmFeature[] = [
      osmFeature("node", 10, { type: "Point", coordinates: [0.0002, 0] }, { highway: "trailhead", name: "Trailhead" }),
      osmFeature("node", 11, { type: "Point", coordinates: [0.01, 0] }, { amenity: "parking", name: "Lot" }),
      osmFeature("way", 12, {
        type: "Polygon",
        coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
      }, { amenity: "parking", name: "Area Lot" }),
    ];
    const ingest = ingestOsm(features);
    expect(ingest.trails).toEqual([]);
    expect(ingest.places.map((place) => [place.recordId, place.kind, place.name])).toEqual([
      ["node/10", "trailhead", "Trailhead"],
      ["node/11", "parking", "Lot"],
      ["way/12", "parking", "Area Lot"],
    ]);
    // A closed ring counts its first vertex once: the centre is the middle of the square.
    expect(ingest.places[2]?.coordinate.lon).toBeCloseTo(0.0005, 6);
    expect(ingest.places[2]?.coordinate.lat).toBeCloseTo(0.0005, 6);
  });

  it("keeps unknown tags unknown and maps only the curated fields", () => {
    const [candidate] = ingestOsm([
      osmFeature("way", 1, { type: "LineString", coordinates: [[0, 0], [0.001, 0]] }, {
        highway: "path", name: "Named Way", sac_scale: "mountain_hiking", trail_visibility: "intermediate", dog: "no",
      }),
    ]).trails;
    expect(candidate?.attributes).toEqual({
      name: "Named Way",
      ref: null,
      operator: null,
      sacScale: "mountain_hiking",
      surface: null,
      trailVisibility: "intermediate",
      dog: "no",
      access: null,
    });
  });

  it("parses point, line and polygon geometry", () => {
    expect(pointFromGeometry({ type: "Point", coordinates: [1, 2] })).toEqual({ lon: 1, lat: 2 });
    expect(linesFromGeometry({ type: "LineString", coordinates: [[0, 0], [1, 1]] })).toHaveLength(1);
    expect(linesFromGeometry({ type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] })).toHaveLength(2);
    expect(polygonCentre(linesFromGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }))).toEqual({ lon: 2 / 3, lat: 1 / 3 });
    // A one-vertex trace is not a trail line.
    expect(linesFromGeometry({ type: "LineString", coordinates: [[0, 0]] })).toEqual([]);
  });

  it("documents the osmium commands it would run for a PBF", () => {
    const commands = osmiumCommands("pa.osm.pbf", "/tmp/work").map((command) => command.join(" "));
    expect(commands).toHaveLength(5);
    expect(commands[0]).toContain("tags-filter");
    expect(commands[0]).not.toContain("--omit-referenced");
    expect(commands[0]).toContain("r/route=hiking,foot");
    expect(commands[1]).toContain("relations.opl");
    expect(commands[2]).toContain("--geometry-types=linestring");
    expect(commands[3]).toContain("n/highway=trailhead");
    expect(commands[4]).toContain("--geometry-types=point,polygon");
  });

  it("reads real OPL relations and assembles their member ways", async () => {
    const relations = await readOplRelations("tests/fixtures/trails/relations.opl");
    const trails = ingestOsm([...relations, {
      properties: { "@type": "way", "@id": 12 },
      geometry: { type: "LineString", coordinates: [[-76, 40], [-75.99, 40]] },
    }, {
      properties: { "@type": "way", "@id": 13 },
      geometry: { type: "LineString", coordinates: [[-75.99, 40], [-75.98, 40]] },
    }]).trails;
    expect(trails).toHaveLength(1);
    expect(trails[0]?.attributes.name).toBe("Ridge Trail");
    expect(trails[0]?.lines[0]).toHaveLength(3);
  });

  it("reads the sequence fixture and refuses nothing silently", async () => {
    const features = await readFeatureFile("tests/fixtures/trails/osm-trails.geojsonseq");
    expect(features.length).toBeGreaterThan(0);
    expect(features.every((feature) => typeof feature.properties === "object")).toBe(true);
  });
});

describe("agency ingestion", () => {
  it("maps the USFS attribute spelling and skips alignments that are not on the ground", () => {
    const features: OsmFeature[] = [
      { properties: { TRAIL_NAME: "Ridge Trail", TRAIL_NO: "F-1", ADMIN_ORG: "Forest", TRAIL_STATUS: "EXISTING" }, geometry: { type: "LineString", coordinates: [[0, 0], [0.001, 0]] } },
      { properties: { TRAIL_NAME: "Future Trail", TRAIL_STATUS: "PROPOSED" }, geometry: { type: "LineString", coordinates: [[0, 0], [0.001, 0]] } },
      { properties: { TRAIL_NO: "F-3" }, geometry: { type: "LineString", coordinates: [[0, 0], [0.001, 0]] } },
    ];
    const ingest = ingestExternal(features, USFS_TRAILS);
    expect(ingest.skippedNotOnGround).toBe(1);
    expect(ingest.trails.map((candidate) => [candidate.recordId, candidate.attributes.name, candidate.attributes.ref, candidate.attributes.surface])).toEqual([
      ["F-1", "Ridge Trail", "F-1", null],
      ["F-3", null, "F-3", null],
    ]);
  });
});

describe("duplicate detection", () => {
  it("merges an exact duplicate and the same line walked backwards", () => {
    const clusters = clusterCandidates([
      trail("way/1", [[0, 0], [0.001, 0]]),
      trail("F-1", [[0.001, 0], [0, 0]], {}, "usfs"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(undirectedLineSignature(line([[0, 0], [0.001, 0]]))).toBe(undirectedLineSignature(line([[0.001, 0], [0, 0]])));
  });

  it("merges a near-duplicate digitization within 75 m at both ends and 10 % length", () => {
    const clusters = clusterCandidates([
      trail("way/1", [[0, 0], [0.001, 0]]),
      trail("F-1", [[0.0002, 0.0002], [0.0012, 0.0001]], {}, "usfs"),
    ]);
    expect(clusters).toHaveLength(1);
  });

  it("keeps trails apart when the length, the ends or the shape disagree", () => {
    const clusters = clusterCandidates([
      trail("way/1", [[0, 0], [0.001, 0]]),
      // Same start, different ground: a spur is not the same trail.
      trail("way/2", [[0, 0], [0.0003, 0.0003]]),
      // Same length, 330 m away.
      trail("way/3", [[0.003, 0], [0.004, 0]]),
      // Same ends, twice the length: a loop is not an out-and-back.
      trail("way/4", [[0, 0], [0.001, 0.01], [0.001, 0]]),
    ]);
    expect(clusters).toHaveLength(4);
  });

  it("merges the same trail across three sources into one record keeping all of them", () => {
    const [merged] = mergeTrails([
      trail("way/1", [[0, 0], [0.001, 0]], { name: "Ridge", surface: "ground", dog: "leashed" }),
      trail("F-1", [[0, 0], [0.001, 0]], { name: "Ridge Trail", ref: "F-1" }, "usfs"),
      trail("4242", [[0, 0], [0.001, 0]], { name: "Ridge", surface: "GRAVEL", trailVisibility: "good" }, "nps"),
    ]);
    expect(merged?.id).toBe("osm:way/1");
    expect(merged?.sources.map((source) => source.sourceId)).toEqual(["osm", "usfs", "nps"]);
    // Highest priority wins, and every disagreement is kept.
    expect(merged?.attributes.surface).toBe("ground");
    expect(merged?.conflicts).toEqual([
      { field: "surface", kept: { sourceId: "osm", value: "ground" }, other: { sourceId: "nps", value: "GRAVEL" } },
    ]);
    // An unknown on the top source falls through to the source that knew.
    expect(merged?.attributes.trailVisibility).toBe("good");
    expect(merged?.attributes.ref).toBe("F-1");
    // The name follows the highest-priority source, not the longest string.
    expect(merged?.attributes.name).toBe("Ridge");
    expect(merged?.lengthMeters).toBe(111);
  });

  it("takes the agency name when OSM did not name the trail", () => {
    const [merged] = mergeTrails([
      trail("way/1", [[0, 0], [0.001, 0]]),
      trail("F-1", [[0, 0], [0.001, 0]], { name: "Ridge Trail" }, "usfs"),
    ]);
    expect(merged?.attributes.name).toBe("Ridge Trail");
  });

  it("prefers the longer name when two records from the same source disagree", () => {
    const [merged] = mergeTrails([
      trail("way/1", [[0, 0], [0.001, 0]], { name: "Hawk Mtn Tr" }),
      trail("way/2", [[0, 0], [0.001, 0]], { name: "Hawk Mountain Trail" }),
    ]);
    expect(merged?.attributes.name).toBe("Hawk Mountain Trail");
  });

  it("never emits two trails with one source id", () => {
    const merged = mergeTrails([
      trail("way/1", [[0, 0], [0.001, 0]]),
      // The same record arriving twice with a different trace: one trail, longer line.
      trail("way/1", [[0, 0], [0.0005, 0.0001], [0.001, 0]]),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.lines[0]).toHaveLength(3);
  });

  it("keeps the more complete geometry while the id stays with the higher-priority source", () => {
    const [merged] = mergeTrails([
      trail("way/1", [[0, 0], [0.001, 0]]),
      trail("F-1", [[0, 0], [0.0005, 0.0001], [0.001, 0]], {}, "usfs"),
    ]);
    expect(merged?.id).toBe("osm:way/1");
    expect(merged?.lines[0]).toHaveLength(3);
    expect(merged?.sources).toHaveLength(2);
  });
});

describe("trailheads", () => {
  const route = line([[0, 0], [0.01, 0]]);

  function place(recordId: string, lon: number, lat: number, kind: "trailhead" | "parking" = "trailhead") {
    return { sourceId: "osm" as const, recordId, url: null, kind, name: recordId, coordinate: { lon, lat } };
  }

  it("matches places near either end and measures the real distance", () => {
    const grid = new PlaceGrid([place("node/1", 0, 0.0002), place("node/2", 0.01, 0.0002, "parking")]);
    const trailheads = attachTrailheads([route], grid);
    expect(trailheads.map((trailhead) => [trailhead.name, trailhead.end, trailhead.distanceMeters, trailhead.kind])).toEqual([
      ["node/1", "start", 22, "trailhead"],
      ["node/2", "end", 22, "parking"],
    ]);
  });

  it("ignores parking in the middle of the line and places beyond the radius", () => {
    const grid = new PlaceGrid([place("node/1", 0.005, 0.0002, "parking"), place("node/2", 0, 0.01, "parking")]);
    expect(attachTrailheads([route], grid)).toEqual([]);
    // A shorter radius is honoured too, and never bumps an unknown to "no parking".
    expect(attachTrailheads([route], new PlaceGrid([place("node/3", 0, 0.0002)]), 10)).toEqual([]);
  });

  it("labels the place with its source so the rider can see where it came from", () => {
    const [trailhead] = attachTrailheads([route], new PlaceGrid([place("node/1", 0, 0.0002)]));
    expect(trailhead?.sources).toEqual([
      { sourceId: "osm", sourceLabel: "OpenStreetMap", recordId: "node/1", url: null, licence: "ODbL 1.0", licenceUrl: "https://www.openstreetmap.org/copyright" },
    ]);
  });
});

describe("catalog shape", () => {
  it("classifies a continuous loop and leaves disconnected lines unknown", async () => {
    const { toHikeRecord } = await import("../../../../infra/trails/lib/output");
    const candidate = trail("loop", [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]);
    const merged = mergeTrails([candidate], [])[0]!;
    expect(toHikeRecord(merged)?.shape).toBe("loop");
    expect(toHikeRecord({ ...merged, lines: [candidate.lines[0]!, line([[1, 1], [1.01, 1]])] })?.shape).toBe("unknown");
  });
});
