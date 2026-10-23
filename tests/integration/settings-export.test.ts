import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import type { GeometryRef } from "@/domain/ride/ids";
import { asRecordingId } from "@/domain/recording/ids";
import { createRideDocument } from "@/domain/ride/create";
import { createLibraryService } from "@/application/library/library-service";
import type { ImportRideData } from "@/application/import/types";
import { createSettingsLibraryService } from "@/app/settings-library";
import { VNextDatabase } from "@/infrastructure/storage/db";
import { createIndexedDbGeometryStore } from "@/infrastructure/storage/indexeddb-geometry-store";
import { createIndexedDbImportBlobStore } from "@/infrastructure/storage/indexeddb-import-blob-store";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";

const NOW = "2026-10-05T12:00:00.000Z";

/**
 * Settings' library composition must carry the same durable stores as the ride
 * screens. Without them `loadExportSource` threw for every recorded ride and
 * silently dropped an import's route line and original file — so "Export all
 * data" was unusable or incomplete for exactly the riders who needed a backup.
 */
describe("settings data export", () => {
  it("exports a recorded ride's full trace through the settings composition", async () => {
    const name = `opengravel-settings-export-recorded-${crypto.randomUUID()}`;
    const repository = createRideRepository({ database: new VNextDatabase(name) });
    const geometryStore = createIndexedDbGeometryStore({ databaseName: name });
    const writer = createLibraryService(repository, { geometryStore });
    const coordinates = [
      { lon: -75.5, lat: 40 },
      { lon: -75.4, lat: 40.1 },
      { lon: -75.3, lat: 40.2 },
    ] as const;
    const saved = await writer.saveRecorded({
      recordingId: asRecordingId("rec_settings-export"),
      coordinates,
      timestamps: [NOW, "2026-10-05T12:10:00.000Z", "2026-10-05T12:20:00.000Z"],
      summary: { distanceMeters: 20_000, elapsedSeconds: 1_200, movingSeconds: 1_000, pointCount: 3 },
    });

    const settings = createSettingsLibraryService(repository, { databaseName: name });
    const source = await settings.loadExportSource(saved.rideId);

    expect(source.recordedTrack?.coordinates).toEqual(coordinates);
  });

  it("exports an imported ride's route line and original file through the settings composition", async () => {
    const name = `opengravel-settings-export-imported-${crypto.randomUUID()}`;
    const database = new VNextDatabase(name);
    const repository = createRideRepository({ database });
    const geometryStore = createIndexedDbGeometryStore({ databaseName: name });
    const blobStore = createIndexedDbImportBlobStore({ database });
    const writer = createLibraryService(repository, { geometryStore, blobStore });
    const route = [
      { lon: -75.1, lat: 40.3 },
      { lon: -75.05, lat: 40.35 },
    ] as const;
    const stored = await geometryStore.put(
      { kind: "line", coordinates: route.map((coordinate) => ({ ...coordinate })) },
      { kind: "import-track", now: NOW },
    );
    const originalRef = "geo_original_settings-export" as GeometryRef;
    await blobStore.put({
      originalRef,
      filename: "planned.gpx",
      mime: "application/gpx+xml",
      sizeBytes: 3,
      importedAt: NOW,
      bytesBase64: btoa("abc"),
    });
    const importData: ImportRideData = {
      originalRef,
      tracks: [{
        name: "Planned",
        segments: [{ geometryRef: stored.geometryRef, timestamps: [null, null], elevation: [null, null] }],
      }],
      waypoints: [],
    };
    const named = await writer.saveNamed(
      createRideDocument({ now: NOW, title: "Planned import", provenance: { type: "import", sourceId: "import_settings-export" } }),
      { title: "Planned import", importData, originalsRef: originalRef },
    );

    const settings = createSettingsLibraryService(repository, { databaseName: name });
    const source = await settings.loadExportSource(named.document.rideId);

    expect(source.plannedRoute?.geometry).toEqual(route);
    expect(Array.from(source.originalBytes ?? [])).toEqual(Array.from(new TextEncoder().encode("abc")));
    expect(source.originalFilename).toBe("planned.gpx");
  });
});
