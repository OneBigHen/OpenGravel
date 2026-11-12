/**
 * R3-1: an imported GPX loop opens in the planner as its own line, named as a
 * loop from its start — never as an A-to-B request whose two ends are the same
 * place ("Planning failed", "To South Water Street").
 */

import "fake-indexeddb/auto";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { openLibraryRide, preparedRouteAnswer, takePreparedRoute, withPreparedRoute, type PreparedRouteStorage } from "@/application/explore/ride-this";
import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type { ImportBlobRecord, ImportBlobStore, ImportFile } from "@/application/import/import-artifact";
import { createImportService } from "@/application/import/import-service";
import { createLibraryService } from "@/application/library/library-service";
import { emptyPlanningSession } from "@/application/planner/planning-session";
import type { ClientPlanningService } from "@/application/planner/client-planning-service";
import { parseGpx } from "@/infrastructure/import/gpx-parser";
import { VNextDatabase } from "@/infrastructure/storage/db";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";

const NOW = "2026-11-11T12:00:00.000Z";
const LOOP_GPX = readFileSync(join(process.cwd(), "tests/fixtures/import/loop.gpx"), "utf8");

function file(text: string, name: string): ImportFile {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    type: "application/gpx+xml",
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function blobStore(): ImportBlobStore {
  const records = new Map<string, ImportBlobRecord>();
  return {
    put: async (record) => { records.set(record.originalRef, record); },
    get: async (ref) => records.get(ref) ?? null,
    remove: async (ref) => { records.delete(ref); },
  };
}

function memoryStorage(): PreparedRouteStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe("an imported loop track", () => {
  it("opens as its own line, a loop from its start, with no router call", async () => {
    const repository = createRideRepository({ database: new VNextDatabase(`og-r3-imported-loop-${crypto.randomUUID()}`) });
    const geometryStore = createMemoryGeometryStore();
    const library = createLibraryService(repository, { now: () => NOW, geometryStore });
    const imports = createImportService({
      blobStore: blobStore(),
      geometryStore,
      libraryService: library,
      parse: { parse: async (bytes, filename) => parseGpx(new TextDecoder().decode(bytes), { filename }) },
      now: () => NOW,
    });

    // The exact options the one-tap import uses: one line, followed as it is.
    const outcome = await imports.importFile(file(LOOP_GPX, "hilltop-loop.gpx"), {
      trackRoute: "follow",
      trackIndices: [0],
      importSeparately: true,
    });
    const storage = memoryStorage();
    const opened = await openLibraryRide(outcome.namedRide.document.rideId, library, geometryStore, { now: () => NOW, storage });

    expect(opened.prepared).toBe(true);
    expect(opened.message).toBeNull();
    const working = await repository.loadRide(opened.rideId);
    expect(working?.ok).toBe(true);
    const document = working?.ok === true ? working.document : null;
    expect(document?.intent.shape).toBe("loop");
    expect(document?.intent.finish).toBeNull();
    expect(document?.title).toBe("Hilltop loop");

    const prepared = takePreparedRoute({ now: () => NOW, storage, keep: memoryStorage() })!;
    expect(prepared.origin).toBe("import");
    const line = await geometryStore.get(prepared.geometryRef);
    expect(line?.payload.kind === "line" ? line.payload.coordinates : []).toHaveLength(8);
    // An import with no timestamps has no stated time: a rounded estimate, never zero.
    expect(prepared.durationSeconds).toBeGreaterThan(0);
    expect(prepared.durationSeconds % 900).toBe(0);
    // Nothing measured its surface here: it stays unknown.
    expect(preparedRouteAnswer(prepared).candidates[0]?.evidence).toEqual({});

    const begin = vi.fn(async () => undefined);
    const routerService: ClientPlanningService = {
      snapshot: () => emptyPlanningSession(),
      begin,
      cancel: () => undefined,
      selectRoute: () => undefined,
      dispose: () => undefined,
      subscribe: () => () => undefined,
      readGeometry: async () => null,
    };
    await withPreparedRoute(routerService, prepared).begin({ rideId: prepared.rideId, rideRevision: prepared.rideRevision, intent: document!.intent });
    expect(begin).not.toHaveBeenCalled();
  });
});
