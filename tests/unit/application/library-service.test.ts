import "fake-indexeddb/auto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createRideDocument } from "@/domain/ride/create";
import { createLibraryService } from "@/application/library/library-service";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";
import { VNextDatabase } from "@/infrastructure/storage/db";
import { buildCorridorPackManifest } from "@/domain/offline/capabilities";
import { createIndexedDbGeometryStore } from "@/infrastructure/storage/indexeddb-geometry-store";
import { asRecordingId } from "@/domain/recording/ids";

let sequence = 0;

function database(): VNextDatabase {
  sequence += 1;
  return new VNextDatabase(`opengravel-vnext-library-${sequence}`);
}

const NOW = "2026-09-17T12:00:00.000Z";
const LATER = "2026-09-18T12:00:00.000Z";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LibraryService", () => {
  it("saves a named copy without moving the active draft pointer", async () => {
    const repository = createRideRepository({ database: database() });
    const draft = createRideDocument({ now: NOW });
    await repository.saveRide(draft, { writerToken: "draft" });
    const service = createLibraryService(repository, { now: () => LATER });

    const named = await service.saveNamed(draft, { title: "Pine Barrens Sunday" });

    expect(named.document.rideId).not.toBe(draft.rideId);
    expect(named.document.title).toBe("Pine Barrens Sunday");
    expect(named.savedAt).toBe(LATER);
    expect(await repository.loadDraftPointer()).toMatchObject({ rideId: draft.rideId });
    expect((await service.listRides())[0]).toMatchObject({
      rideId: named.document.rideId,
      title: "Pine Barrens Sunday",
      type: "planned",
      savedAt: LATER,
    });
  });

  it("finds an imported source hash only on saved SwitchBack rides", async () => {
    const repository = createRideRepository({ database: database() });
    const service = createLibraryService(repository, { now: () => LATER });
    const sourceContentHash = "a".repeat(64);
    const switchBack = createRideDocument({
      now: NOW,
      title: "Saved loop",
      provenance: { type: "import", sourceId: "import_switchback", source: "SwitchBack" },
    });
    const otherImport = createRideDocument({
      now: NOW,
      title: "Other source",
      provenance: { type: "import", sourceId: "import_other" },
    });
    const importData = {
      originalRef: "geo_import_hash" as never,
      sourceContentHash,
      tracks: [],
      waypoints: [],
    } as const;
    const otherImportData = { ...importData, sourceContentHash: "b".repeat(64) };

    await service.saveNamed(switchBack, { title: "Saved loop", importData });
    await service.saveNamed(otherImport, { title: "Other source", importData: otherImportData });

    expect(await service.findImportedContentHash(sourceContentHash)).toEqual({ title: "Saved loop" });
    expect(await service.findImportedContentHash("b".repeat(64))).toBeNull();
  });

  it("atomically refuses concurrent saves with the same SwitchBack content hash", async () => {
    const repository = createRideRepository({ database: database() });
    const firstService = createLibraryService(repository, { now: () => LATER });
    const secondService = createLibraryService(repository, { now: () => LATER });
    const importData = {
      originalRef: "geo_import_race" as never,
      sourceContentHash: "c".repeat(64),
      tracks: [],
      waypoints: [],
    } as const;
    const uniqueKey = `switchback-import:${importData.sourceContentHash}`;
    const first = createRideDocument({
      now: NOW,
      title: "First title",
      provenance: { type: "import", sourceId: "import_race_first", source: "SwitchBack" },
    });
    const second = createRideDocument({
      now: NOW,
      title: "Second title",
      provenance: { type: "import", sourceId: "import_race_second", source: "SwitchBack" },
    });

    const results = await Promise.allSettled([
      firstService.saveNamed(first, { title: "First title", importData, uniqueKey }),
      secondService.saveNamed(second, { title: "Second title", importData, uniqueKey }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason)
      .toMatchObject({ name: "UniqueRideAlreadyExistsError" });
    const rows = await repository.listRideRecords();
    expect(rows).toHaveLength(1);
    await firstService.renameRide(rows[0]!.rideId, "Renamed ride");
    expect((await repository.listRideRecords())[0]?.document.title).toBe("Renamed ride");
    await expect(secondService.saveNamed(createRideDocument({ now: LATER }), {
      title: "Retry duplicate",
      importData,
      uniqueKey,
    })).rejects.toMatchObject({ name: "UniqueRideAlreadyExistsError" });
    expect(await repository.listRideRecords()).toHaveLength(1);
  });

  it("persists corridor pack presence with the saved ride and rebinds its ride identity", async () => {
    const repository = createRideRepository({ database: database() });
    const service = createLibraryService(repository, { now: () => LATER });
    const draft = createRideDocument({ now: NOW });
    const pack = buildCorridorPackManifest({
      rideId: draft.rideId,
      routeRevision: draft.revision,
      geometry: [{ lon: -75.5, lat: 40 }, { lon: -75.4, lat: 40 }],
      createdAt: NOW,
    });

    const named = await service.saveNamed(draft, { title: "Packed ride", offlinePack: pack });
    const stored = await repository.loadRideRecord(named.document.rideId);

    expect(stored?.offlinePack).toMatchObject({ rideId: named.document.rideId, routeRevision: draft.revision });
    expect((await service.listRides())[0]).toMatchObject({ offlinePack: "present" });
  });

  it("saves one recorded envelope idempotently and exports its aligned trace", async () => {
    const name = `opengravel-vnext-recorded-library-${crypto.randomUUID()}`;
    const db = new VNextDatabase(name);
    const repository = createRideRepository({ database: db });
    const geometryStore = createIndexedDbGeometryStore({ databaseName: name });
    const service = createLibraryService(repository, { now: () => LATER, geometryStore });
    const input = {
      recordingId: asRecordingId("rec_library-idempotent"),
      coordinates: [
        { lon: -75.5, lat: 40 },
        { lon: -75.4, lat: 40.1 },
        { lon: -75.3, lat: 40.2 },
      ],
      timestamps: [NOW, LATER, "2026-09-19T12:00:00.000Z"],
      summary: { distanceMeters: 20_000, elapsedSeconds: 3_600, movingSeconds: 3_000, pointCount: 3 },
    } as const;

    const first = await service.saveRecorded(input);
    const second = await service.saveRecorded(input);
    const rows = await repository.listRideRecords();
    const listed = await service.listRides({ type: "recorded" });
    const explored = await service.listExploreRides?.();
    const exported = await service.loadExportSource?.(first.rideId);

    expect(second).toEqual(first);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.document.provenance).toEqual({ type: "recorded", sourceId: input.recordingId });
    expect(rows[0]?.recordedTrack?.timestamps).toEqual(input.timestamps);
    expect(listed[0]?.recordedTrack?.previewGeometry).toEqual(input.coordinates);
    expect(explored?.[0]?.geometry).toEqual(input.coordinates);
    expect(explored?.[0]?.riddenAt).toBe(input.timestamps.at(-1));
    expect(exported?.recordedTrack).toEqual({
      coordinates: input.coordinates,
      timestamps: input.timestamps,
      summary: input.summary,
    });
  });

  it("reports a missing store instead of exporting geometry as if there were none", async () => {
    const repository = createRideRepository({ database: database() });
    const writer = createLibraryService(repository, { now: () => LATER });
    const importData = {
      originalRef: "geo_original_missing-store" as never,
      tracks: [{
        name: "Planned",
        segments: [{ geometryRef: "geo_missing-store" as never, timestamps: [null, null], elevation: [null, null] }],
      }],
      waypoints: [],
    } as const;
    const named = await writer.saveNamed(createRideDocument({ now: NOW }), {
      title: "Imported without stores",
      importData,
      originalsRef: importData.originalRef,
    });

    const withoutStores = createLibraryService(repository, { now: () => LATER });

    await expect(withoutStores.loadExportSource(named.document.rideId)).rejects.toThrow(
      "Imported ride geometry storage is unavailable.",
    );
  });

  it("renames, filters, and deletes a named ride without touching another record", async () => {
    const repository = createRideRepository({ database: database() });
    const service = createLibraryService(repository, { now: () => LATER });
    const first = await service.saveNamed(createRideDocument({ now: NOW }), {
      title: "Pine Loop",
    });
    const second = await service.saveNamed(createRideDocument({ now: LATER }), {
      title: "River Road",
    });

    await service.renameRide(first.document.rideId, "Pine Loop Renamed");
    expect(
      await service.listRides({ text: "renamed", dateRange: { from: LATER, to: LATER } }),
    ).toHaveLength(1);

    await service.deleteRide(first.document.rideId);
    expect(await repository.loadRide(second.document.rideId)).toMatchObject({
      ok: true,
      document: second.document,
    });
    expect(await repository.loadRide(first.document.rideId)).toBeNull();
  });

  it("creates a derivative with provenance and leaves its source untouched", async () => {
    const repository = createRideRepository({ database: database() });
    const service = createLibraryService(repository, { now: () => LATER });
    const source = createRideDocument({
      now: NOW,
      provenance: { type: "catalog", sourceId: "catalog-7" },
      title: "Catalog source",
    });
    const named = await service.saveNamed(source, { title: "Catalog source" });
    const before = await repository.loadRide(named.document.rideId);

    const derivative = await service.createDerivative(
      "catalog",
      named.document.rideId,
      named.document,
    );

    expect(derivative.rideId).not.toBe(named.document.rideId);
    expect(derivative.provenance).toEqual({
      type: "catalog",
      sourceId: named.document.rideId,
    });
    expect(await repository.loadRide(named.document.rideId)).toEqual(before);
    expect(await repository.loadDraftPointer()).toMatchObject({ rideId: derivative.rideId });
  });

  it("refuses to delete a catalog source while allowing its derivative", async () => {
    const repository = createRideRepository({ database: database() });
    const service = createLibraryService(repository, { now: () => LATER });
    const sourceDocument = createRideDocument({
      now: NOW,
      provenance: { type: "catalog", sourceId: "catalog-source" },
      title: "Protected source",
    });
    await repository.saveLibraryRide(sourceDocument, {
      writerToken: "catalog",
      savedAt: NOW,
    });

    await expect(service.deleteRide(sourceDocument.rideId)).rejects.toThrow(
      "Catalog source rides cannot be deleted",
    );
  });
});

describe("LibraryService planned-route geometry", () => {
  const geometry = [
    { lon: -75.5, lat: 40 },
    { lon: -75.4, lat: 40.1 },
    { lon: -75.3, lat: 40.2 },
  ] as const;

  it("saves the selected route line so My rides can export it later", async () => {
    const name = `opengravel-vnext-planned-route-${crypto.randomUUID()}`;
    const db = new VNextDatabase(name);
    const repository = createRideRepository({ database: db });
    const geometryStore = createIndexedDbGeometryStore({ databaseName: name });
    const service = createLibraryService(repository, { now: () => LATER, geometryStore });

    const named = await service.saveNamed(createRideDocument({ now: NOW }), {
      title: "Pine Barrens Sunday",
      plannedRoute: { geometry },
    });

    const [listed] = await service.listRides();
    const exported = await service.loadExportSource(named.document.rideId);

    expect(listed?.exportCapabilities?.plannedRoute).toBe(true);
    expect(exported.plannedRoute?.geometry).toEqual(geometry);
    expect(listed?.mapPreview?.line.length).toBeGreaterThan(1);
  });

  it("keeps the planned route through a rename and a geometry sweep", async () => {
    const name = `opengravel-vnext-planned-route-sweep-${crypto.randomUUID()}`;
    const db = new VNextDatabase(name);
    const repository = createRideRepository({ database: db });
    const geometryStore = createIndexedDbGeometryStore({ databaseName: name });
    const service = createLibraryService(repository, { now: () => LATER, geometryStore });

    const named = await service.saveNamed(createRideDocument({ now: NOW }), {
      title: "Pine Loop",
      plannedRoute: { geometry },
    });
    await service.renameRide(named.document.rideId, "Pine Loop Renamed");
    await repository.sweepUnreferencedGeometry();

    const exported = await service.loadExportSource(named.document.rideId);
    expect(exported.title).toBe("Pine Loop Renamed");
    expect(exported.plannedRoute?.geometry).toEqual(geometry);
  });

  it("rebuilds planned-route waypoints from the ride intent", async () => {
    const name = `opengravel-vnext-planned-route-waypoints-${crypto.randomUUID()}`;
    const db = new VNextDatabase(name);
    const repository = createRideRepository({ database: db });
    const geometryStore = createIndexedDbGeometryStore({ databaseName: name });
    const service = createLibraryService(repository, { now: () => LATER, geometryStore });
    const base = createRideDocument({ now: NOW });
    const document = {
      ...base,
      intent: {
        ...base.intent,
        start: {
          id: "pt_start" as never,
          kind: "start" as const,
          coordinate: geometry[0],
          label: "Ranger station",
          provenance: { type: "search" as const, provider: "test", query: "ranger" },
        },
        stops: [{
          id: "stop_fuel" as never,
          kind: "stop" as const,
          coordinate: geometry[1],
          label: "Fuel",
          provenance: { type: "search" as const, provider: "test", query: "fuel" },
        }],
        finish: {
          id: "pt_finish" as never,
          kind: "finish" as const,
          coordinate: geometry[2],
          provenance: { type: "map" as const, selectedAt: NOW },
        },
      },
    };

    const named = await service.saveNamed(document, { title: "Waypoint ride", plannedRoute: { geometry } });
    const exported = await service.loadExportSource(named.document.rideId);

    expect(exported.plannedRoute?.waypoints).toEqual([
      { name: "Ranger station", coordinate: geometry[0] },
      { name: "Fuel", coordinate: geometry[1] },
      { name: null, coordinate: geometry[2] },
    ]);
  });

  it("reports missing planned-route storage instead of pretending there is no line", async () => {
    const name = `opengravel-vnext-planned-route-no-store-${crypto.randomUUID()}`;
    const db = new VNextDatabase(name);
    const repository = createRideRepository({ database: db });
    const geometryStore = createIndexedDbGeometryStore({ databaseName: name });
    const writer = createLibraryService(repository, { now: () => LATER, geometryStore });
    const named = await writer.saveNamed(createRideDocument({ now: NOW }), {
      title: "Stored line",
      plannedRoute: { geometry },
    });

    const withoutStore = createLibraryService(repository, { now: () => LATER });
    await expect(withoutStore.loadExportSource(named.document.rideId)).rejects.toThrow(
      "Planned route geometry storage is unavailable.",
    );
  });

  it("refuses a planned route shorter than two points", async () => {
    const repository = createRideRepository({ database: database() });
    const service = createLibraryService(repository, { now: () => LATER });

    await expect(service.saveNamed(createRideDocument({ now: NOW }), {
      title: "No line",
      plannedRoute: { geometry: [{ lon: -75, lat: 40 }] },
    })).rejects.toThrow(/at least two/i);
  });

  it("keeps older rows without a planned route readable", async () => {
    const repository = createRideRepository({ database: database() });
    const service = createLibraryService(repository, { now: () => LATER });
    const named = await service.saveNamed(createRideDocument({ now: NOW }), { title: "Old row" });

    const record = await repository.loadRideRecord(named.document.rideId);
    const [listed] = await service.listRides();

    expect(record?.plannedRoute).toBeUndefined();
    expect(listed?.exportCapabilities?.plannedRoute).toBe(false);
    expect(listed?.title).toBe("Old row");
  });
});
