import { describe, expect, it } from "vitest";

import { buildCatalogRecords, decodeCatalogPolyline } from "@/application/explore/catalog-build";

const gpx = (points: readonly (readonly [number, number])[]) =>
  `<gpx>${points.map(([lon, lat]) => `<trkpt lon="${lon}" lat="${lat}"/>`).join("")}</gpx>`;

describe("catalog build", () => {
  it("keeps valid attributed GPX routes, measures miles and bounds, and caps previews at 200 points", () => {
    const points = Array.from({ length: 260 }, (_, index) => [-75.5 + index * 0.0005, 40.5 + Math.sin(index / 8) * 0.01] as const);
    const records = buildCatalogRecords([
      {
        id: "ride-valid",
        name: "Pine Ridge Loop",
        sourceProject: "OpenGravel archive",
        sourceFile: "Pine Ridge Loop.gpx",
        author: "Rider 17",
        license: "CC BY 4.0",
        gpx: gpx(points),
      },
      {
        id: "ride-forbidden",
        name: "All rights reserved",
        sourceProject: "Source archive",
        sourceFile: "locked.gpx",
        redistribution: "forbidden",
        gpx: gpx([[-75.5, 40.5], [-75.4, 40.6]]),
      },
      {
        id: "ride-no-source",
        name: "Unattributed",
        gpx: gpx([[-75.5, 40.5], [-75.4, 40.6]]),
      },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "ride-valid",
      name: "Pine Ridge Loop",
      region: "Pennsylvania",
      provenance: "OpenGravel archive · Pine Ridge Loop.gpx",
      provenanceDetail: "Author: Rider 17 · License: CC BY 4.0",
      bounds: { west: -75.5, east: -75.3705, south: expect.any(Number), north: expect.any(Number) },
      evidenceNote: "Road surface and curvature have not been measured for this catalog route.",
    });
    expect(records[0]?.distanceMiles).toBeGreaterThan(1);
    expect(records[0]?.geometry).toHaveLength(200);
    const fullGeometry = decodeCatalogPolyline(records[0]!.geometryPolyline);
    expect(fullGeometry).toHaveLength(points.length);
    expect(fullGeometry[0]).toMatchObject({ lat: 40.5, lon: -75.5 });
    expect(fullGeometry.at(-1)?.lon).toBeCloseTo(points.at(-1)![0], 5);
  });

  it("rejects malformed or too-short GPX geometry", () => {
    expect(buildCatalogRecords([
      { id: "bad", name: "Bad", sourceProject: "archive", sourceFile: "bad.gpx", gpx: "<gpx><trkpt>" },
      { id: "one", name: "One point", sourceProject: "archive", sourceFile: "one.gpx", gpx: gpx([[-75.5, 40.5]]) },
    ])).toEqual([]);
  });

  it("cleans donor attribution and version suffixes while preserving the original title", () => {
    const records = buildCatalogRecords([
      {
        id: "armstrong-old--t1",
        name: "000 Armstrong County Loops - created by 54warrior on ADVHub.net",
        sourceProject: "rideplanner",
        sourceFile: "armstrong-old.gpx",
        gpx: "",
        geometry: [[-79.5, 40.8], [-79.4, 40.9]],
      },
      {
        id: "armstrong-new--t1",
        name: "001 Armstrong County Loops 06-2025 - created by 54warrior on ADVHub.net",
        sourceProject: "rideplanner",
        sourceFile: "armstrong-new.gpx",
        gpx: "",
        geometry: [[-79.5, 40.8], [-79.4, 40.9]],
      },
    ]);

    expect(records.map((record) => record.name)).toEqual([
      "Armstrong County Loops",
      "Armstrong County Loops",
    ]);
    expect(records[0]?.catalogGroupId).toBe(records[1]?.catalogGroupId);
    expect(records[0]?.provenanceDetail).toContain("Author: 54warrior");
    expect(records[0]?.provenanceDetail).toContain("Source site: ADVHub.net");
    expect(records[0]?.provenanceDetail).toContain("Original title: 000 Armstrong County Loops - created by 54warrior on ADVHub.net");
    expect(records[1]?.provenanceDetail).toContain("Original title: 001 Armstrong County Loops 06-2025 - created by 54warrior on ADVHub.net");
  });

  it("generates a named loop or one-way route for timestamp and filename titles", () => {
    const records = buildCatalogRecords([
      {
        id: "date-track--t1",
        name: "2016-07-23 08:58:57",
        sourceProject: "rideplanner",
        sourceFile: "2016-07-23.gpx",
        startPlaceName: "Jim Thorpe",
        gpx: "",
        geometry: [[-75.7, 40.8], [-75.65, 40.85], [-75.7, 40.8]],
      },
      {
        id: "track_12",
        name: "track_12",
        sourceProject: "Roost",
        sourceFile: "track_12.gpx",
        gpx: "",
        geometry: [[-75.7, 40.8], [-75.65, 40.85]],
      },
    ]);

    expect(records[0]?.name).toMatch(/^Jim Thorpe loop · \d+ mi$/);
    expect(records[0]?.nameIsGenerated).toBe(true);
    expect(records[0]?.provenanceDetail).toContain("Original title: 2016-07-23 08:58:57");
    expect(records[1]?.name).toMatch(/^Pennsylvania one-way · \d+ mi$/);
    expect(records[1]?.nameIsGenerated).toBe(true);
    expect(records[1]?.provenanceDetail).toContain("Original title: track_12");
  });

  it("keeps every input track while grouping equivalent names and similar preview lines", () => {
    const base = [[-75.5, 40.5], [-75.45, 40.55], [-75.4, 40.5], [-75.5, 40.5]] as const;
    const nearby = base.map(([lon, lat]) => [lon + 0.0005, lat + 0.0005] as const);
    const far = base.map(([lon, lat]) => [lon + 0.4, lat + 0.4] as const);
    const records = buildCatalogRecords([
      { id: "route-a--t1", name: "000 Pine Ridge Loop", sourceProject: "archive", sourceFile: "one.gpx", gpx: "", geometry: base },
      { id: "route-b--t1", name: "Pine Ridge Loop 06-2025", sourceProject: "archive", sourceFile: "two.gpx", gpx: "", geometry: nearby },
      { id: "route-c--t1", name: "Another route", sourceProject: "archive", sourceFile: "three.gpx", gpx: "", geometry: far },
    ]);

    expect(records).toHaveLength(3);
    expect(records[0]?.catalogGroupId).toBe(records[1]?.catalogGroupId);
    expect(records[0]?.trackGroupId).toBe(records[1]?.trackGroupId);
    expect(records[2]?.catalogGroupId).not.toBe(records[0]?.catalogGroupId);
  });

  it("does not merge distinct routes through a chain of adjacent near-lines", () => {
    const base = [[-75.5, 40.5], [-75.45, 40.55], [-75.4, 40.5], [-75.5, 40.5]] as const;
    const shifted = (offset: number) => base.map(([lon, lat]) => [lon + offset, lat + offset] as const);
    const records = buildCatalogRecords([
      { id: "chain-a", name: "Route Alpha", sourceProject: "archive", sourceFile: "a.gpx", gpx: "", geometry: shifted(0) },
      { id: "chain-b", name: "Route Beta", sourceProject: "archive", sourceFile: "b.gpx", gpx: "", geometry: shifted(0.0008) },
      { id: "chain-c", name: "Route Gamma", sourceProject: "archive", sourceFile: "c.gpx", gpx: "", geometry: shifted(0.0016) },
    ]);

    expect(records[0]?.catalogGroupId).toBe(records[1]?.catalogGroupId);
    expect(records[1]?.catalogGroupId).not.toBe(records[2]?.catalogGroupId);
  });

  it("recognizes the same loop exported from a different start vertex", () => {
    const loop = [[-75.5, 40.5], [-75.44, 40.55], [-75.38, 40.5], [-75.44, 40.45], [-75.5, 40.5]] as const;
    const shiftedStart = [...loop.slice(1, -1), loop[0]!, loop[1]!];
    const records = buildCatalogRecords([
      { id: "loop-export-a", name: "Old summer ride", sourceProject: "archive", sourceFile: "a.gpx", gpx: "", geometry: loop },
      { id: "loop-export-b", name: "New summer ride", sourceProject: "archive", sourceFile: "b.gpx", gpx: "", geometry: shiftedStart },
    ]);

    expect(records).toHaveLength(2);
    expect(records[0]?.catalogGroupId).toBe(records[1]?.catalogGroupId);
    expect(records[0]?.trackGroupId).toBe(records[1]?.trackGroupId);
  });
});
