import { describe, expect, it, vi } from "vitest";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import { ImportCancelledError, importBlobBytes, type ImportBlobRecord, type ImportBlobStore, type ImportFile } from "@/application/import/import-artifact";
import { createImportService } from "@/application/import/import-service";
import { UniqueRideAlreadyExistsError } from "@/application/library/library-service";
import type { LibraryServicePort, NamedRide } from "@/application/library/library-service";
import { createRideDocument } from "@/domain/ride/create";
import type { ParsedImport } from "@/application/import/types";

const GPX = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Morning</name><trkseg><trkpt lat="40" lon="-75"/><trkpt lat="40.001" lon="-75.001"/></trkseg></trk></gpx>`;
const parsed: ParsedImport = {
  tracks: [{
    name: "Morning",
    segments: [[{ lon: -75, lat: 40 }, { lon: -75.001, lat: 40.001 }]],
    timestamps: [[null, null]],
    elevation: [[null, null]],
  }],
  warnings: [],
};

const switchBackParsed = {
  tracks: [{
    name: "Synthetic saved loop",
    sourceKind: "track",
    sourceType: "motorcycle",
    segments: [[
      { lon: 0, lat: 0 },
      { lon: 0.001, lat: 0.001 },
      { lon: 0.002, lat: 0.0015 },
      { lon: 0.003, lat: 0 },
    ]],
    timestamps: [[null, null, null, null]],
    elevation: [[null, null, null, null]],
  }],
  waypoints: [
    { name: "Start", coordinate: { lon: 0, lat: 0 }, elevation: null, timestamp: null },
    { name: "Named pass", coordinate: { lon: 0.001, lat: 0.001 }, elevation: null, timestamp: null },
    { name: "Scenic bend", coordinate: { lon: 0.002, lat: 0.0015 }, elevation: null, timestamp: null },
    { name: "Finish", coordinate: { lon: 0.003, lat: 0 }, elevation: null, timestamp: null },
  ],
  warnings: [],
} as unknown as ParsedImport;

function file(value = GPX, type = "application/gpx+xml", name = "morning.gpx"): ImportFile {
  const bytes = new TextEncoder().encode(value);
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function blobStore(records: Map<string, ImportBlobRecord>): ImportBlobStore {
  return {
    put: vi.fn(async (record) => { records.set(record.originalRef, record); }),
    get: vi.fn(async (ref) => records.get(ref) ?? null),
    remove: vi.fn(async (ref) => { records.delete(ref); }),
  };
}

function library(saved: NamedRide[] = []): LibraryServicePort {
  const sourceHashes = new Map<string, string>();
  return {
    saveRecorded: vi.fn().mockRejectedValue(new Error("recorded ride save is not used by import tests")),
    findRecorded: vi.fn().mockResolvedValue(null),
    saveNamed: vi.fn(async (document, options) => {
      const named = { document: { ...document, rideId: `ride_saved_${saved.length}` as typeof document.rideId }, savedAt: "2026-09-17T12:00:00.000Z" };
      saved.push(named);
      if (options.importData?.sourceContentHash !== undefined) {
        sourceHashes.set(options.importData.sourceContentHash, named.document.title ?? "SwitchBack ride");
      }
      return named;
    }),
    findImportedContentHash: vi.fn(async (hash) => {
      const title = sourceHashes.get(hash);
      return title === undefined ? null : { title };
    }),
    listRides: vi.fn().mockResolvedValue([]),
    renameRide: vi.fn().mockResolvedValue(undefined),
    deleteRide: vi.fn().mockResolvedValue(undefined),
    createDerivative: vi.fn().mockResolvedValue(createRideDocument()),
    openRide: vi.fn().mockResolvedValue(createRideDocument()),
  };
}

describe("ImportService", () => {
  it("imports a batch independently and reports two good files around one corrupt file", async () => {
    const saved: NamedRide[] = [];
    const service = createImportService({
      blobStore: blobStore(new Map()),
      geometryStore: createMemoryGeometryStore(),
      libraryService: library(saved),
      parse: {
        parse: vi.fn(async (_bytes, filename) => {
          if (filename === "corrupt.gpx") throw new Error("malformed XML input");
          return {
            ...switchBackParsed,
            tracks: [{ ...switchBackParsed.tracks[0]!, name: filename.replace(/\.gpx$/i, "") }],
          };
        }),
      },
    });

    const report = await service.importSwitchBackBatch([
      file(GPX.replace("Morning", "North loop"), "application/gpx+xml", "north-loop.gpx"),
      file("<gpx><trk>", "application/gpx+xml", "corrupt.gpx"),
      file(GPX.replace("Morning", "South loop"), "application/gpx+xml", "south-loop.gpx"),
    ]);

    expect(report).toMatchObject({ totalCount: 3, importedCount: 2 });
    expect(report.files.map(({ title, status }) => ({ title, status }))).toEqual([
      { title: "north-loop", status: "imported" },
      { title: "corrupt", status: "skipped" },
      { title: "south-loop", status: "imported" },
    ]);
    expect(report.files[1]?.reason).toMatch(/malformed XML/i);
    expect(report.files[0]?.warnings).toHaveLength(3);
    expect(saved).toHaveLength(2);
  });

  it("reports an already-imported SwitchBack content hash without saving a duplicate", async () => {
    const saved: NamedRide[] = [];
    const libraryService = library(saved);
    const service = createImportService({
      blobStore: blobStore(new Map()),
      geometryStore: createMemoryGeometryStore(),
      libraryService,
      parse: { parse: vi.fn(async () => switchBackParsed) },
    });

    await service.importFile(file(), { source: "SwitchBack" });
    const report = await service.importSwitchBackBatch([file()]);

    expect(report.importedCount).toBe(0);
    expect(report.files[0]).toMatchObject({
      title: "Synthetic saved loop",
      status: "already-imported",
      reason: expect.stringMatching(/same content/i),
    });
    expect(saved).toHaveLength(1);
    expect(libraryService.saveNamed).toHaveBeenCalledTimes(1);
  });

  it("keeps the parsed route title when a SwitchBack shape is skipped", async () => {
    const service = createImportService({
      blobStore: blobStore(new Map()),
      geometryStore: createMemoryGeometryStore(),
      libraryService: library(),
      parse: {
        parse: vi.fn(async () => ({
          ...switchBackParsed,
          tracks: [{ ...switchBackParsed.tracks[0]!, name: "Redacted route-only title", sourceKind: "route" as const }],
        })),
      },
    });

    const report = await service.importSwitchBackBatch([file(GPX, "application/gpx+xml", "route-export.gpx")]);

    expect(report.files[0]).toMatchObject({ title: "Redacted route-only title", status: "skipped" });
  });

  it("cleans provisional data when the atomic library save reports a concurrent duplicate", async () => {
    const records = new Map<string, ImportBlobRecord>();
    const blobs = blobStore(records);
    const geometryStore = createMemoryGeometryStore();
    const writtenRefs: string[] = [];
    const put = geometryStore.put.bind(geometryStore);
    vi.spyOn(geometryStore, "put").mockImplementation(async (...args) => {
      const record = await put(...args);
      writtenRefs.push(record.geometryRef);
      return record;
    });
    const libraryService = library();
    vi.mocked(libraryService.saveNamed).mockRejectedValueOnce(new UniqueRideAlreadyExistsError("Existing saved loop"));
    const service = createImportService({
      blobStore: blobs,
      geometryStore,
      libraryService,
      parse: { parse: vi.fn(async () => switchBackParsed) },
    });

    const report = await service.importSwitchBackBatch([file()]);

    expect(report.files[0]).toMatchObject({
      title: "Existing saved loop",
      status: "already-imported",
      reason: expect.stringMatching(/same content/i),
    });
    expect(records.size).toBe(0);
    expect(writtenRefs).toHaveLength(1);
    expect(await geometryStore.has(writtenRefs[0] as never)).toBe(false);
  });

  it("labels a SwitchBack import and reports ride intent the GPX file cannot carry", async () => {
    const service = createImportService({
      blobStore: blobStore(new Map()),
      geometryStore: createMemoryGeometryStore(),
      libraryService: library(),
      parse: { parse: vi.fn(async () => switchBackParsed) },
      now: () => "2026-09-24T12:00:00.000Z",
    });

    const outcome = await service.importFile(file(GPX, "application/gpx+xml;charset=utf-8"), { source: "SwitchBack" });

    expect(outcome.document.provenance).toMatchObject({ type: "import", source: "SwitchBack" });
    expect(outcome.document.intent.shaping.map((point) => point.coordinate)).toEqual([
      { lon: 0.001, lat: 0.001 },
      { lon: 0.002, lat: 0.0015 },
    ]);
    expect(outcome.importData.waypoints.map((point) => point.name)).toContain("Named pass");
    expect(outcome.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("avoid areas"),
      expect.stringContaining("bike profile"),
      expect.stringContaining("stop-versus-shaping"),
    ]));
  });

  it("rejects a SwitchBack route-only export because it has no saved route line", async () => {
    const routeOnly: ParsedImport = {
      ...parsed,
      tracks: [{ ...parsed.tracks[0]!, sourceKind: "route" } as never],
    };
    const records = new Map<string, ImportBlobRecord>();
    const libraryService = library();
    const service = createImportService({
      blobStore: blobStore(records),
      geometryStore: createMemoryGeometryStore(),
      libraryService,
      parse: { parse: vi.fn(async () => routeOnly) },
    });

    await expect(service.importFile(file(), { source: "SwitchBack" }))
      .rejects.toMatchObject({ code: "unsupported-source-shape" });
    expect(records.size).toBe(0);
    expect(libraryService.saveNamed).not.toHaveBeenCalled();
  });

  it("previews before persistence and persists original bytes, track geometry, and a library derivative", async () => {
    const records = new Map<string, ImportBlobRecord>();
    const saved: NamedRide[] = [];
    const service = createImportService({
      blobStore: blobStore(records),
      geometryStore: createMemoryGeometryStore(),
      libraryService: library(saved),
      parse: { parse: vi.fn(async () => parsed) },
      now: () => "2026-09-17T12:00:00.000Z",
    });

    const preview = await service.previewFile(file());
    expect(preview.parsed.tracks).toHaveLength(1);
    expect(preview.sizeBytes).toBe(new TextEncoder().encode(GPX).byteLength);
    expect(records).toHaveLength(0);

    const outcome = await service.importFile(file(), { trackRoute: "follow" });
    expect(outcome.namedRides).toHaveLength(1);
    expect(outcome.namedRides[0]?.document.provenance.type).toBe("import");
    expect(outcome.artifact.originalRef.startsWith("geo_")).toBe(true);
    expect(records).toHaveLength(1);
    expect(saved).toHaveLength(1);
    expect(outcome.importData.tracks[0]?.segments[0]?.geometryRef).toMatch(/^geo_/);
  });

  it("names the ride after its track and keeps its length and notes for the library card", async () => {
    const lib = library();
    const timed: ParsedImport = {
      tracks: [{ ...parsed.tracks[0]!, name: "Redacted sample loop", timestamps: [["2026-09-17T10:00:00Z", "2026-09-17T10:05:00Z"]] }],
      warnings: ["Preserved 4 GPX waypoints as metadata."],
    };
    const service = createImportService({
      blobStore: blobStore(new Map()),
      geometryStore: createMemoryGeometryStore(),
      libraryService: lib,
      parse: { parse: vi.fn(async () => timed) },
      now: () => "2026-09-17T12:00:00.000Z",
    });
    const outcome = await service.importFile(file(GPX, "application/gpx+xml", "switchback-track-waypoints.gpx"), { trackRoute: "follow" });
    expect(outcome.document.title).toBe("Redacted sample loop");
    const options = vi.mocked(lib.saveNamed).mock.calls[0]?.[1];
    expect(options?.bundleSummary?.distanceMeters).toBeGreaterThan(130);
    expect(options?.bundleSummary?.distanceMeters).toBeLessThan(145);
    expect(options?.bundleSummary?.durationSeconds).toBe(300);
    expect(options?.importData?.warnings).toEqual(["Preserved 4 GPX waypoints as metadata."]);
  });

  it("cleans every partial write when a later library save fails", async () => {
    const records = new Map<string, ImportBlobRecord>();
    const blobs = blobStore(records);
    const saved: NamedRide[] = [];
    const libraryService = library(saved);
    vi.mocked(libraryService.saveNamed)
      .mockImplementationOnce(async (document) => {
        const named = { document: { ...document, rideId: "ride_saved_first" as typeof document.rideId }, savedAt: "2026-09-17T12:00:00.000Z" };
        saved.push(named);
        return named;
      })
      .mockRejectedValueOnce(new Error("quota"));
    const geometryStore = createMemoryGeometryStore();
    const writtenRefs: string[] = [];
    const put = geometryStore.put.bind(geometryStore);
    vi.spyOn(geometryStore, "put").mockImplementation(async (...args) => {
      const record = await put(...args);
      writtenRefs.push(record.geometryRef);
      return record;
    });
    const multiTrack: ParsedImport = {
      ...parsed,
      tracks: [parsed.tracks[0]!, { ...parsed.tracks[0]!, name: "Evening" }],
    };
    const multiService = createImportService({
      blobStore: blobs,
      geometryStore,
      libraryService,
      parse: { parse: vi.fn(async () => multiTrack) },
    });

    await expect(multiService.importFile(file(), { trackRoute: "follow", trackIndices: [0, 1], importSeparately: true })).rejects.toThrow("quota");
    expect(records).toHaveLength(0);
    expect(writtenRefs).toHaveLength(2);
    for (const ref of writtenRefs) expect(await geometryStore.has(ref as never)).toBe(false);
    expect(libraryService.deleteRide).toHaveBeenCalledWith(saved[0]?.document.rideId);
    expect(blobs.remove).toHaveBeenCalled();
  });

  it("reports rollback residue when a partial geometry cleanup fails", async () => {
    const records = new Map<string, ImportBlobRecord>();
    const geometryStore = createMemoryGeometryStore();
    vi.spyOn(geometryStore, "remove").mockRejectedValueOnce(new Error("geometry delete unavailable"));
    const libraryService = library();
    vi.mocked(libraryService.saveNamed).mockRejectedValueOnce(new Error("quota"));
    const service = createImportService({
      blobStore: blobStore(records),
      geometryStore,
      libraryService,
      parse: { parse: vi.fn(async () => parsed) },
    });

    await expect(service.importFile(file(), { trackRoute: "follow" })).rejects.toThrow(/cleanup failed|partial data may remain/i);
  });

  it("uses selection-required for a missing multi-track decision", async () => {
    const multiTrack: ParsedImport = {
      ...parsed,
      tracks: [parsed.tracks[0]!, { ...parsed.tracks[0]!, name: "Evening" }],
    };
    const service = createImportService({
      blobStore: blobStore(new Map()),
      geometryStore: createMemoryGeometryStore(),
      libraryService: library(),
      parse: { parse: vi.fn(async () => multiTrack) },
    });

    await expect(service.importFile(file(), { trackRoute: "follow" })).rejects.toMatchObject({ code: "selection-required" });
  });

  it("uses option-unavailable for a typed but deferred import option", async () => {
    const service = createImportService({
      blobStore: blobStore(new Map()),
      geometryStore: createMemoryGeometryStore(),
      libraryService: library(),
      parse: { parse: vi.fn(async () => parsed) },
    });

    await expect(service.importFile(file(), { trackRoute: "sketch" })).rejects.toMatchObject({ code: "option-unavailable" });
  });

  it("cancels without persisting and discards a cancellation after a blob write", async () => {
    const records = new Map<string, ImportBlobRecord>();
    const controller = new AbortController();
    const blobs = blobStore(records);
    const originalPut = blobs.put;
    vi.mocked(originalPut).mockImplementationOnce(async (record) => {
      records.set(record.originalRef, record);
      controller.abort();
    });
    const libraryService = library();
    const service = createImportService({
      blobStore: blobs,
      geometryStore: createMemoryGeometryStore(),
      libraryService,
      parse: { parse: vi.fn(async () => parsed) },
    });

    await expect(service.importFile(file(), { signal: controller.signal, trackRoute: "follow" })).rejects.toBeInstanceOf(ImportCancelledError);
    expect(records).toHaveLength(0);
    expect(libraryService.saveNamed).not.toHaveBeenCalled();
  });

  it("retains source bytes when a worker transfers and detaches its parse buffer", async () => {
    const records = new Map<string, ImportBlobRecord>();
    const service = createImportService({
      blobStore: blobStore(records),
      geometryStore: createMemoryGeometryStore(),
      libraryService: library(),
      parse: {
        parse: vi.fn(async (bytes) => {
          structuredClone(bytes, { transfer: [bytes] });
          return parsed;
        }),
      },
    });

    await service.importFile(file(), { trackRoute: "follow" });
    const record = Array.from(records.values())[0];
    expect(record).toBeDefined();
    expect(new TextDecoder().decode(importBlobBytes(record!))).toBe(GPX);
  });

  it("turns route-along into bounded shaping anchors and explains the semantic change", async () => {
    const routeParsed: ParsedImport = {
      ...parsed,
      tracks: [{
        ...parsed.tracks[0]!,
        segments: [[
          { lon: -75, lat: 40 },
          { lon: -75.001, lat: 40.001 },
          { lon: -75.002, lat: 40.002 },
          { lon: -75.003, lat: 40.003 },
        ]],
        timestamps: [[null, null, null, null]],
        elevation: [[null, null, null, null]],
      }],
    };
    const saved: NamedRide[] = [];
    const service = createImportService({
      blobStore: blobStore(new Map()),
      geometryStore: createMemoryGeometryStore(),
      libraryService: library(saved),
      parse: { parse: vi.fn(async () => routeParsed) },
    });

    const outcome = await service.importFile(file(), { trackRoute: "route-along" });
    expect(outcome.document.intent.shaping).toHaveLength(2);
    expect(outcome.warnings.at(-1)).toMatch(/may deviate from the original track/);
  });
});
