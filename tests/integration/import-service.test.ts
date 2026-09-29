import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import { createImportService } from "@/application/import/import-service";
import { buildTrackGpx, exportFilename, originalFileBytes } from "@/application/export/gpx-export";
import { createLibraryService } from "@/application/library/library-service";
import { ImportCancelledError, type ImportFile } from "@/application/import/import-artifact";
import { parseImportBytes } from "@/infrastructure/import/import-bytes";
import { createIndexedDbGeometryStore } from "@/infrastructure/storage/indexeddb-geometry-store";
import { createIndexedDbImportBlobStore } from "@/infrastructure/storage/indexeddb-import-blob-store";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";
import { VNextDatabase } from "@/infrastructure/storage/db";

let sequence = 0;

const GPX = `<?xml version="1.0"?><gpx version="1.1"><wpt lat="40" lon="-75"><name>Trailhead</name></wpt><trk><name>Connected</name><trkseg><trkpt lat="40" lon="-75"><time>2026-09-17T12:00:00Z</time></trkpt><trkpt lat="40.001" lon="-75.001"><time>2026-09-17T12:01:00Z</time></trkpt></trkseg></trk></gpx>`;

function sourceFile(): ImportFile {
  const bytes = new TextEncoder().encode(GPX);
  return {
    name: "connected.gpx",
    type: "application/gpx+xml",
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe("import service with durable adapters", () => {
  it("can export the saved derivative's track and exact original", async () => {
    sequence += 1;
    const database = new VNextDatabase(`opengravel-import-service-${sequence}`);
    const blobStore = createIndexedDbImportBlobStore({ database });
    const geometryStore = createIndexedDbGeometryStore({ databaseName: database.name });
    const repository = createRideRepository({ database });
    const library = createLibraryService(repository, {
      now: () => "2026-09-17T12:00:00.000Z",
      blobStore,
      geometryStore,
    });
    const imports = createImportService({
      blobStore,
      geometryStore,
      libraryService: library,
      parse: { parse: (bytes, filename, options) => parseImportBytes(bytes, filename, options) },
      now: () => "2026-09-17T12:00:00.000Z",
    });

    const outcome = await imports.importFile(sourceFile(), { trackRoute: "follow" });
    const source = await library.loadExportSource?.(outcome.namedRide.document.rideId);

    expect(source?.plannedRoute?.geometry).toEqual([
      { lon: -75, lat: 40 },
      { lon: -75.001, lat: 40.001 },
    ]);
    expect(source?.tracks[0]?.segments).toHaveLength(1);
    expect(source?.waypoints).toEqual([{ name: "Trailhead", coordinate: { lon: -75, lat: 40 } }]);
    expect(source?.plannedRoute?.waypoints).toEqual([
      { name: "Trailhead", coordinate: { lon: -75, lat: 40 } },
      { name: null, coordinate: { lon: -75, lat: 40 } },
      { name: null, coordinate: { lon: -75.001, lat: 40.001 } },
    ]);
    const trackXml = buildTrackGpx({
      title: source?.title ?? "Imported ride",
      tracks: [{ name: "Connected", segments: [{ coordinates: source?.plannedRoute?.geometry ?? [] }] }],
      waypoints: source?.waypoints,
    });
    expect(trackXml.match(/<wpt\b/g)).toHaveLength(1);
    expect(trackXml).not.toContain("Start");
    expect(trackXml).not.toContain("Finish");
    expect(source?.waypoints.some((waypoint) => waypoint.name === "Start" || waypoint.name === "Finish")).toBe(false);
    expect(source?.originalFilename).toBe("connected.gpx");
    expect(source?.originalMime).toBe("application/gpx+xml");
    expect(source?.originalBytes?.byteLength).toBe(new TextEncoder().encode(GPX).byteLength);
    expect(Array.from(source?.originalBytes ?? [])).toEqual(Array.from(new TextEncoder().encode(GPX)));
  });

  it("cancels after a geometry write and removes every durable artifact", async () => {
    sequence += 1;
    const database = new VNextDatabase(`opengravel-import-service-cancel-${sequence}`);
    const blobStore = createIndexedDbImportBlobStore({ database });
    const baseGeometryStore = createIndexedDbGeometryStore({ databaseName: database.name });
    const controller = new AbortController();
    let writtenRef: string | null = null;
    const geometryStore = {
      put: async (...args: Parameters<typeof baseGeometryStore.put>) => {
        const record = await baseGeometryStore.put(...args);
        writtenRef = record.geometryRef;
        controller.abort();
        return record;
      },
      get: baseGeometryStore.get,
      has: baseGeometryStore.has,
      remove: baseGeometryStore.remove,
    };
    const repository = createRideRepository({ database });
    const library = createLibraryService(repository, { blobStore, geometryStore });
    const imports = createImportService({
      blobStore,
      geometryStore,
      libraryService: library,
      parse: { parse: (bytes, filename, options) => parseImportBytes(bytes, filename, options) },
    });

    await expect(imports.importFile(sourceFile(), { signal: controller.signal, trackRoute: "follow" })).rejects.toBeInstanceOf(ImportCancelledError);
    expect(writtenRef).not.toBeNull();
    expect(await baseGeometryStore.get(writtenRef as never)).toBeNull();
    expect(await database.blobs.toArray()).toHaveLength(0);
    expect(await library.listRides()).toHaveLength(0);
  });

  it("preserves KMZ original bytes and derives a KMZ download name", async () => {
    sequence += 1;
    const database = new VNextDatabase(`opengravel-import-service-kmz-${sequence}`);
    const blobStore = createIndexedDbImportBlobStore({ database });
    const geometryStore = createIndexedDbGeometryStore({ databaseName: database.name });
    const repository = createRideRepository({ database });
    const library = createLibraryService(repository, { blobStore, geometryStore });
    const original = Uint8Array.from([0, 3, 255, 1]);
    const parsed = {
      tracks: [{ name: "KMZ ride", segments: [[{ lon: -75, lat: 40 }, { lon: -75.001, lat: 40.001 }]], timestamps: [[null, null]], elevation: [[null, null]] }],
      warnings: [],
    } as const;
    const file: ImportFile = {
      name: "morning.KMZ",
      type: "application/vnd.google-earth.kmz",
      size: original.byteLength,
      arrayBuffer: async () => original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength),
    };
    const imports = createImportService({
      blobStore,
      geometryStore,
      libraryService: library,
      parse: { parse: vi.fn(async () => parsed) },
    });

    const outcome = await imports.importFile(file, { trackRoute: "follow" });
    const source = await library.loadExportSource?.(outcome.namedRide.document.rideId);
    expect(source?.originalFilename).toBe("morning.KMZ");
    expect(source?.originalMime).toBe("application/vnd.google-earth.kmz");
    expect(exportFilename(source?.title ?? "", "original", { extension: "kmz" })).toMatch(/\.kmz$/);
    expect(Array.from(originalFileBytes(source?.originalBytes ?? new Uint8Array()))).toEqual(Array.from(original));
  });
});
