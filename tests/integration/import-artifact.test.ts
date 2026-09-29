import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { createImportArtifact, importBlobBytes, importToRideDocument, type ImportFile } from "@/application/import/import-artifact";
import { asGeometryRef } from "@/domain/ride/ids";
import { createIndexedDbImportBlobStore } from "@/infrastructure/storage/indexeddb-import-blob-store";
import { VNextDatabase } from "@/infrastructure/storage/db";
import type { ParsedImport } from "@/infrastructure/import/types";

let sequence = 0;

function file(): ImportFile {
  const bytes = new TextEncoder().encode("<gpx version=\"1.1\" />");
  return {
    name: "original.gpx",
    type: "application/gpx+xml",
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const parsed: ParsedImport = {
  tracks: [{
    name: "Gapped track",
    segments: [
      [{ lon: -75, lat: 40 }, { lon: -75.001, lat: 40.001 }],
      [{ lon: -76, lat: 41 }, { lon: -76.001, lat: 41.001 }],
    ],
    timestamps: [[null, null], [null, null]],
    elevation: [[null, null], [null, null]],
  }],
  warnings: [],
};

describe("import artifacts and derivatives", () => {
  it("stores original bytes in the v3 blob table and creates a follow derivative", async () => {
    sequence += 1;
    const database = new VNextDatabase(`opengravel-import-${sequence}`);
    const blobStore = createIndexedDbImportBlobStore({ database });
    const artifact = await createImportArtifact(file(), parsed, {
      blobStore,
      now: "2026-09-17T12:00:00.000Z",
    });

    expect(database.tables.map((table) => table.name)).toContain("blobs");
    expect(artifact.originalRef.startsWith("geo_")).toBe(true);
    const original = await blobStore.get(artifact.originalRef);
    expect(original?.filename).toBe("original.gpx");
    expect(original?.bytesBase64).toBeTruthy();
    const roundTrip = importBlobBytes(original!);
    const expectedBytes = new TextEncoder().encode("<gpx version=\"1.1\" />");
    expect(Array.from(roundTrip)).toEqual(Array.from(expectedBytes));

    const derivative = importToRideDocument(artifact, parsed, { trackRoute: "follow" });
    expect(derivative.provenance).toEqual({ type: "import", sourceId: artifact.artifactId });
    expect(derivative.intent.start?.provenance).toEqual({ type: "import", sourceId: artifact.artifactId });
    expect(derivative.intent.finish?.coordinate).toEqual({ lon: -76.001, lat: 41.001 });
    expect(parsed.tracks[0]?.segments).toHaveLength(2);
  });

  it("does not derive endpoints unless follow is explicitly selected", async () => {
    sequence += 1;
    const database = new VNextDatabase(`opengravel-import-${sequence}`);
    const artifact = await createImportArtifact(file(), parsed, {
      blobStore: createIndexedDbImportBlobStore({ database }),
    });
    expect(importToRideDocument(artifact, parsed).intent.start).toBeNull();
    expect(importToRideDocument(artifact, parsed).intent.finish).toBeNull();
  });

  it("requires an explicit chooser decision for multiple tracks", async () => {
    sequence += 1;
    const database = new VNextDatabase(`opengravel-import-${sequence}`);
    const artifact = await createImportArtifact(file(), parsed, {
      blobStore: createIndexedDbImportBlobStore({ database }),
    });
    const secondTrack: ParsedImport["tracks"][number] = {
      name: "Adjacent track",
      segments: [[{ lon: -76.001, lat: 41.001 }, { lon: -76.002, lat: 41.002 }]],
      timestamps: [[null, null]],
      elevation: [[null, null]],
    };
    const multiple = { ...parsed, tracks: [...parsed.tracks, secondTrack] };
    expect(() => importToRideDocument(artifact, multiple, { trackRoute: "follow" })).toThrow(/choose/i);
    const combined = importToRideDocument(artifact, multiple, { trackRoute: "follow", combine: true });
    expect(combined.intent.start?.coordinate).toEqual({ lon: -75, lat: 40 });
    expect(combined.intent.finish?.coordinate).toEqual({ lon: -76.002, lat: 41.002 });
  });

  it("implements route-along anchors while keeping sketch explicitly deferred", async () => {
    sequence += 1;
    const artifact = await createImportArtifact(file(), parsed, {
      blobStore: createIndexedDbImportBlobStore({ database: new VNextDatabase(`opengravel-import-${sequence}`) }),
    });
    const routeAlong = importToRideDocument(artifact, parsed, { trackRoute: "route-along" });
    expect(routeAlong.intent.start).toMatchObject({ coordinate: { lon: -75, lat: 40 } });
    expect(routeAlong.intent.finish).toMatchObject({ coordinate: { lon: -76.001, lat: 41.001 } });
    expect(routeAlong.intent.shaping.length).toBeGreaterThan(0);
    expect(routeAlong.intent.shaping.length).toBeLessThanOrEqual(32);
    expect(() => importToRideDocument(artifact, parsed, { trackRoute: "sketch" })).toThrow(/sketch/i);
  });

  it("does not accidentally accept arbitrary original references", () => {
    expect(asGeometryRef("geo_original")).toBe("geo_original");
  });
});
