import "fake-indexeddb/auto";

import Dexie, { type DbCoreTransactionOptions } from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRideDocument } from "@/domain/ride/create";
import { createRideRepository, rideIsValid } from "@/infrastructure/storage/ride-repository";
import { createIndexedDbGeometryStore } from "@/infrastructure/storage/indexeddb-geometry-store";
import { asGeometryRef, newAvoidAreaId, type GeometryRef } from "@/domain/ride/ids";
import { VNextDatabase } from "@/infrastructure/storage/db";
import { createLocalStorageBootstrapPointer } from "@/infrastructure/storage/bootstrap-pointer";
import { createLibraryService } from "@/application/library/library-service";
import {
  createRideDocumentStore,
  placeFinishCommand,
  placeStartCommand,
} from "@/ui/stores/ride-document-store";

let sequence = 0;

function databaseName(): string {
  sequence += 1;
  return `opengravel-vnext-repository-${sequence}`;
}

/** The object stores each core transaction actually declared. */
function recordTransactionScopes(database: VNextDatabase): string[][] {
  const scopes: string[][] = [];
  database.use({
    stack: "dbcore",
    name: "test-transaction-scope-recorder",
    create: (core) => ({
      ...core,
      transaction: (
        stores: string[],
        mode: "readonly" | "readwrite",
        options?: DbCoreTransactionOptions,
      ) => {
        scopes.push([...stores]);
        return core.transaction(stores, mode, options);
      },
    }),
  });
  return scopes;
}

function hasOriginalRideId(value: unknown): boolean {
  return typeof value === "object" && value !== null && "originalRideId" in value;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("RideRepository", () => {
  it("validates a document with the domain intent validator without throwing", () => {
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });

    expect(rideIsValid(document)).toBe(true);
    expect(rideIsValid({ ...document, intent: null })).toBe(false);
  });

  it("accepts the SwitchBack import provenance label and rejects other source labels", () => {
    const document = createRideDocument({
      now: "2026-09-17T12:00:00.000Z",
      provenance: { type: "import", sourceId: "import_fixture" },
    });

    expect(rideIsValid({
      ...document,
      provenance: { ...document.provenance, source: "SwitchBack" },
    })).toBe(true);
    expect(rideIsValid({
      ...document,
      provenance: { ...document.provenance, source: "UnrecognizedApp" },
    })).toBe(false);
    expect(rideIsValid({
      ...document,
      provenance: { type: "new", source: "SwitchBack" },
    })).toBe(false);
    expect(rideIsValid({
      ...document,
      provenance: { type: "import", source: "SwitchBack" },
    })).toBe(false);
  });

  it("round-trips a ride and sets the active draft pointer in one save", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });

    expect(await repository.saveRide(document, { writerToken: "tab-a" })).toEqual({
      ok: true,
    });
    expect(await repository.loadRide(document.rideId)).toEqual({
      ok: true,
      document,
    });
    expect(await repository.loadDraftPointer()).toEqual({
      id: "active",
      rideId: document.rideId,
      updatedAt: document.updatedAt,
    });
  });

  it("preserves the last valid checkpoint when IndexedDB reports quota", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const first = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const next = { ...first, revision: 1, updatedAt: "2026-09-17T12:01:00.000Z" };

    await repository.saveRide(first, { writerToken: "tab-a" });
    const quotaError = new Error("storage quota exceeded");
    Object.defineProperty(quotaError, "name", { value: "QuotaExceededError" });
    vi.spyOn(repository.database.rides, "put").mockRejectedValueOnce(quotaError);

    await expect(repository.saveRide(next, { writerToken: "tab-a" })).resolves.toEqual({
      ok: false,
      reason: "quota",
      preservedRevision: first.revision,
    });
    expect(await repository.loadRide(first.rideId)).toEqual({
      ok: true,
      document: first,
    });
  });

  it("does not leave a new ride row when the draft pointer write fails", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const first = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const next = { ...first, revision: 1, updatedAt: "2026-09-17T12:01:00.000Z" };

    await repository.saveRide(first, { writerToken: "tab-a" });
    const writeError = new Error("draft write failed");
    vi.spyOn(repository.database.draft, "put").mockRejectedValueOnce(writeError);

    await expect(repository.saveRide(next, { writerToken: "tab-a" })).resolves.toEqual({
      ok: false,
      reason: "write-failed",
      error: expect.anything(),
    });
    expect(await repository.loadRide(first.rideId)).toEqual({
      ok: true,
      document: first,
    });
  });

  it("atomically rejects a newer external revision instead of last-writer-winning", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const first = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const external = { ...first, revision: 1, updatedAt: "2026-09-17T12:01:00.000Z" };
    const next = { ...first, revision: 2, updatedAt: "2026-09-17T12:02:00.000Z" };

    await repository.saveRide(first, { writerToken: "tab-a" });
    await repository.saveRide(external, { writerToken: "tab-a" });
    const result = await repository.saveRide(next, {
      writerToken: "tab-b",
      baseRevision: 0,
    });

    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      conflict: { storedRevision: 1, ourRevision: 2 },
    });
    expect(await repository.loadRide(first.rideId)).toEqual({
      ok: true,
      document: external,
    });
  });

  it("accepts this tab's own newer revision while its own checkpoint already advanced the store", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const first = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const second = { ...first, revision: 1, updatedAt: "2026-09-17T12:01:00.000Z" };
    const third = { ...first, revision: 2, updatedAt: "2026-09-17T12:02:00.000Z" };

    await repository.saveRide(first, { writerToken: "tab-a" });
    // This tab's own checkpoint advanced the store while the store still held the
    // base it started from. That is not a foreign advance: the tab's own newer
    // revision must be accepted, or a superseding lifecycle flush is refused.
    await repository.saveRide(second, { writerToken: "tab-a", baseRevision: 0 });
    await expect(
      repository.saveRide(third, { writerToken: "tab-a", baseRevision: 0 }),
    ).resolves.toEqual({ ok: true });
    await expect(repository.loadRide(first.rideId)).resolves.toEqual({
      ok: true,
      document: third,
    });
  });

  it("keeps the newest revision durable when a lifecycle flush supersedes an in-flight checkpoint", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const NOW = "2026-09-17T12:00:00.000Z";

    // Hold the first checkpoint open inside its own transaction, so the flush below
    // really does run while a save is in flight over the real persistence stack.
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const originalDraftPut = database.draft.put.bind(database.draft);
    let draftPuts = 0;
    vi.spyOn(database.draft, "put").mockImplementation((async (row: unknown, key?: unknown) => {
      draftPuts += 1;
      if (draftPuts === 1) await Dexie.waitFor(firstGate);
      return originalDraftPut(row as never, key as never);
    }) as never);

    const store = createRideDocumentStore({
      repository,
      now: (): string => NOW,
      document,
    });
    store
      .getState()
      .dispatch(placeStartCommand(document, { lon: -75.2, lat: 39.95 }, (): string => NOW));
    await vi.waitFor(() => expect(draftPuts).toBe(1), { timeout: 2_000 });

    const withStart = store.getState().document;
    store
      .getState()
      .dispatch(placeFinishCommand(withStart, { lon: -74.8, lat: 40.2 }, (): string => NOW));
    window.dispatchEvent(new Event("pagehide"));

    releaseFirst();

    // The flush write was issued with the base the store held before its own
    // in-flight checkpoint committed, so it must still be accepted and become the
    // durable row (the newest revision is the one that survives).
    await vi.waitFor(
      async () => {
        const durable = await repository.loadRide(document.rideId);
        expect(durable).toMatchObject({ ok: true });
        if (durable === null || !durable.ok) return;
        // The finished ride overrides the finished endpoint, so the finish intent
        // is the observable that distinguishes the newest snapshot.
        expect(durable.document.revision).toBe(withStart.revision + 1);
        expect(durable.document.intent.finish).not.toBeNull();
      },
      { timeout: 3_000 },
    );
    expect(store.getState().saveStatus.state).toBe("saved");
  });

  it("rejects a stale same-writer revision and preserves the newer row", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const first = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const newer = { ...first, revision: 2, updatedAt: "2026-09-17T12:02:00.000Z" };
    const stale = { ...first, revision: 1, updatedAt: "2026-09-17T12:01:00.000Z" };

    await repository.saveRide(first, { writerToken: "same-writer" });
    await repository.saveRide(newer, { writerToken: "same-writer", baseRevision: 0 });
    await expect(
      repository.saveRide(stale, { writerToken: "same-writer", baseRevision: 0 }),
    ).resolves.toEqual({
      ok: false,
      reason: "conflict",
      conflict: { storedRevision: 2, ourRevision: 1 },
    });
    await expect(repository.loadRide(first.rideId)).resolves.toEqual({
      ok: true,
      document: newer,
    });
  });

  it("isolates a malformed ride row instead of returning it as authored truth", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });

    await database.rides.put({
      rideId: document.rideId,
      revision: document.revision,
      updatedAt: document.updatedAt,
      writerToken: "tab-a",
      document: {
        ...document,
        intent: { ...document.intent, shape: "not-a-shape" as never },
      },
    });

    await expect(repository.loadRide(document.rideId)).resolves.toEqual({
      ok: false,
      reason: "corrupt",
    });
    expect(await database.rides.get(`rides.corrupt.${document.rideId}`)).toBeDefined();
    expect(await database.rides.get(document.rideId)).toBeUndefined();
  });

  it("leaves the corrupt row intact when quarantine storage fails", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const corrupt = {
      rideId: document.rideId,
      revision: document.revision,
      updatedAt: document.updatedAt,
      writerToken: "tab-a",
      document: { ...document, intent: { ...document.intent, shape: "broken" } },
    };
    await database.rides.put(corrupt as never);
    const quarantineError = new Error("quarantine unavailable");
    vi.spyOn(database.rides, "put").mockRejectedValueOnce(quarantineError);

    await expect(repository.loadRide(document.rideId)).rejects.toThrow("quarantine unavailable");
    expect(await database.rides.get(document.rideId)).toEqual(corrupt);
  });

  it("does not delete a valid replacement committed after the quarantine re-read", async () => {
    const name = databaseName();
    const database = new VNextDatabase(name);
    const replacementDatabase = new VNextDatabase(name);
    const repository = createRideRepository({ database });
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const replacement = {
      ...document,
      revision: 1,
      updatedAt: "2026-09-17T12:01:00.000Z",
    };
    await database.rides.put({ rideId: document.rideId, corrupted: true } as never);
    const replacementRecord = {
      rideId: document.rideId,
      revision: 1,
      updatedAt: replacement.updatedAt,
      writerToken: "replacement",
      document: replacement,
    };

    // The replacement is staged during the corrupt read but held behind an explicit
    // barrier, so the ordering this test depends on does not rest on fake-indexeddb
    // happening to schedule two connections the way the test hopes. The write runs
    // in its own task, outside the quarantining transaction's zone.
    let releaseReplacement!: () => void;
    let replacementWrite: Promise<void> = Promise.resolve();
    const replacementBarrier = new Promise<void>((resolve) => {
      releaseReplacement = resolve;
    });
    void (async (): Promise<void> => {
      await replacementBarrier;
      replacementWrite = new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          void replacementDatabase.rides.put(replacementRecord as never).then(
            () => resolve(),
            (error: unknown) => reject(error),
          );
        }, 0);
      });
    })();

    const originalGet = database.rides.get.bind(database.rides) as (
      key: string,
    ) => Promise<unknown>;
    let reads = 0;
    let secondRead: unknown;
    let secondReadInsideTransaction = false;
    vi.spyOn(database.rides, "get").mockImplementation((async (key: string) => {
      const value = await originalGet(key);
      reads += 1;
      if (reads > 1) {
        // A real read, never a mocked return value: whatever the re-read observes is
        // what the delete decision has to respect.
        secondRead = value;
        secondReadInsideTransaction = Dexie.currentTransaction !== undefined;
        releaseReplacement();
      }
      return value;
    }) as never);

    await expect(repository.loadRide(document.rideId)).resolves.toEqual({
      ok: false,
      reason: "corrupt",
    });
    releaseReplacement();
    await replacementWrite;

    // The quarantining transaction performed a real second read, and that read saw
    // the still-corrupt row: the replacement was not yet committed, so nothing was
    // deleted from under it.
    expect(secondReadInsideTransaction).toBe(true);
    expect(secondRead).toMatchObject({ corrupted: true });
    await expect(repository.loadRide(document.rideId)).resolves.toEqual({
      ok: true,
      document: replacement,
    });
    replacementDatabase.close();
  });

  it("keeps a replacement the quarantine transaction's second read observes", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const replacement = {
      ...document,
      revision: 1,
      updatedAt: "2026-09-17T12:01:00.000Z",
    };
    const replacementRecord = {
      rideId: document.rideId,
      revision: 1,
      updatedAt: replacement.updatedAt,
      writerToken: "replacement",
      document: replacement,
    };
    await database.rides.put({ rideId: document.rideId, corrupted: true } as never);

    // A replacement can become visible to the transaction's own re-read. Deleting
    // then would destroy a newer authored row, which is exactly what the conditional
    // delete exists to prevent: an unconditional delete fails this test.
    const originalPut = database.rides.put.bind(database.rides);
    // The injection is what makes this test about a *replacement*: if the quarantine
    // write ever moves off `rides.put` with an `originalRideId`, this asserts it
    // instead of silently degrading into the pre-existing corrupt-row case.
    let injected = false;
    vi.spyOn(database.rides, "put").mockImplementation((async (row: unknown) => {
      const result = await originalPut(row as never);
      if (hasOriginalRideId(row)) {
        injected = true;
        await originalPut(replacementRecord as never);
      }
      return result;
    }) as never);
    const originalGet = database.rides.get.bind(database.rides) as (
      key: string,
    ) => Promise<unknown>;
    let reads = 0;
    let secondRead: unknown;
    vi.spyOn(database.rides, "get").mockImplementation((async (key: string) => {
      const value = await originalGet(key);
      reads += 1;
      if (reads === 2) secondRead = value;
      return value;
    }) as never);

    await expect(repository.loadRide(document.rideId)).resolves.toEqual({
      ok: false,
      reason: "corrupt",
    });

    expect(injected).toBe(true);
    expect(secondRead).toMatchObject({ revision: 1, writerToken: "replacement" });
    expect(await database.rides.get(document.rideId)).toMatchObject({
      revision: 1,
      writerToken: "replacement",
    });
    expect(await database.rides.get(`rides.corrupt.${document.rideId}`)).toBeDefined();
  });

  it("treats a row re-serialized with a different key order as the same row", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    await database.rides.put({
      rideId: document.rideId,
      corrupted: true,
      nested: { alpha: 1, beta: 2 },
    } as never);

    // Structured-clone round trips do not promise property order. The re-read sees
    // the same row with its keys reordered: a stringified comparison calls that a
    // replacement and silently never reclaims the quarantined key.
    const originalPut = database.rides.put.bind(database.rides);
    let injected = false;
    vi.spyOn(database.rides, "put").mockImplementation((async (row: unknown) => {
      const result = await originalPut(row as never);
      if (hasOriginalRideId(row)) {
        injected = true;
        await originalPut({
          nested: { beta: 2, alpha: 1 },
          corrupted: true,
          rideId: document.rideId,
        } as never);
      }
      return result;
    }) as never);

    await expect(repository.loadRide(document.rideId)).resolves.toEqual({
      ok: false,
      reason: "corrupt",
    });
    expect(injected).toBe(true);
    expect(await database.rides.get(document.rideId)).toBeUndefined();
    expect(await database.rides.get(`rides.corrupt.${document.rideId}`)).toBeDefined();
  });

  it("treats a nested Date change as a replacement instead of as the same re-serialized row", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    await database.rides.put({
      rideId: document.rideId,
      corrupted: true,
      touchedAt: new Date(1_000),
    } as never);

    // `Object.keys(new Date(...))` is `[]`, so an own-key walk calls two distinct
    // Dates equal and deletes a replacement that really did change the row.
    const originalPut = database.rides.put.bind(database.rides);
    let injected = false;
    vi.spyOn(database.rides, "put").mockImplementation((async (row: unknown) => {
      const result = await originalPut(row as never);
      if (hasOriginalRideId(row)) {
        injected = true;
        await originalPut({
          rideId: document.rideId,
          corrupted: true,
          touchedAt: new Date(2_000),
        } as never);
      }
      return result;
    }) as never);

    await expect(repository.loadRide(document.rideId)).resolves.toEqual({
      ok: false,
      reason: "corrupt",
    });
    expect(injected).toBe(true);
    expect(await database.rides.get(document.rideId)).toMatchObject({
      touchedAt: new Date(2_000),
    });
    expect(await database.rides.get(`rides.corrupt.${document.rideId}`)).toBeDefined();
  });

  it("locks geometry in the checkpoint transaction so a sweep cannot interleave", async () => {
    const database = new VNextDatabase(databaseName());
    const scopes = recordTransactionScopes(database);
    const repository = createRideRepository({ database });
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });

    // Let the constructor's startup sweep finish, then record only the checkpoint.
    await vi.waitFor(() => expect(scopes).not.toHaveLength(0));
    scopes.length = 0;
    await repository.saveRide(document, { writerToken: "tab-a" });

    // Liveness during a sweep is computed from committed rows plus the draft
    // pointer, so the checkpoint has to hold the geometry store: otherwise a sweep
    // started while this write is in flight can reclaim blobs the write references.
    // Only the scope *containment* is pinned: splitting the write into more
    // transactions is a legitimate refactor, losing the geometry lock is not.
    expect(scopes.flat()).toEqual(
      expect.arrayContaining(["rides", "draft", "geometry"]),
    );
  });

  it("reclaims only genuinely unreferenced geometry while a checkpoint carrying a fresh blob is in flight", async () => {
    const name = databaseName();
    const database = new VNextDatabase(name);
    const repository = createRideRepository({ database });
    // The constructor's startup cleanup is queued first on this connection, so this
    // awaited sweep resolving proves it is done; the blobs below are created after it.
    await repository.sweepUnreferencedGeometry();
    const geometryStore = createIndexedDbGeometryStore({ databaseName: name });
    const orphan = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }] },
      { kind: "route", now: "2026-09-17T12:00:00.000Z" },
    );
    const fresh = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.8, lat: 40.2 }] },
      { kind: "avoid-area", now: "2026-09-17T12:00:00.000Z" },
    );
    const base = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const document = {
      ...base,
      intent: {
        ...base.intent,
        avoidAreas: [
          {
            id: newAvoidAreaId(),
            name: "fresh",
            geometryRef: fresh.geometryRef,
            enabled: true,
            createdBy: "drawing" as const,
          },
        ],
      },
    };

    // Hold the checkpoint transaction open at its first request, so the sweep below
    // is initiated while the save genuinely is in flight.
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let held = false;
    const originalGet = database.rides.get.bind(database.rides) as (
      key: string,
    ) => Promise<unknown>;
    vi.spyOn(database.rides, "get").mockImplementationOnce((async (key: string) => {
      const row = await originalGet(key);
      held = true;
      await Dexie.waitFor(saveGate);
      return row;
    }) as never);

    // Every geometry delete the repository issues is recorded. A read through a
    // second connection would deadlock behind the held write transaction, so the
    // observable probe is what the sweep itself manages to do.
    const deleted: GeometryRef[] = [];
    const originalDelete = database.geometry.delete.bind(database.geometry) as (
      key: GeometryRef,
    ) => Promise<void>;
    vi.spyOn(database.geometry, "delete").mockImplementation((async (key: GeometryRef) => {
      deleted.push(key);
      return originalDelete(key);
    }) as never);

    const save = repository.saveRide(document, { writerToken: "tab-a" });
    await vi.waitFor(() => expect(held).toBe(true));

    const sweep = repository.sweepUnreferencedGeometry();

    // An explicit probe rather than a microtask guess: while the checkpoint holds the
    // write transaction the sweep cannot reach its deletes at all, so a sweep that was
    // merely slow would already have reclaimed the orphan and failed this assertion.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(deleted).toEqual([]);

    releaseSave();
    await save;

    // The committed save is the liveness the sweep must respect, and the orphan is
    // the only key it may reclaim.
    await expect(sweep).resolves.toBe(1);
    expect(deleted).toEqual([orphan.geometryRef]);
    expect(await geometryStore.get(orphan.geometryRef)).toBeNull();
    expect(await geometryStore.get(fresh.geometryRef)).not.toBeNull();
    expect(await repository.loadDraftPointer()).toMatchObject({
      geometryRefs: [fresh.geometryRef],
    });
  });

  it("sweeps liveness and deletes in one read-write transaction over rides, draft and geometry", async () => {
    const database = new VNextDatabase(databaseName());
    const scopes = recordTransactionScopes(database);
    const repository = createRideRepository({ database });

    // Let the constructor's startup cleanup finish, then record only the sweep: the two
    // halves of a sweep have to share one transaction, because a save can commit liveness
    // between a separate read and a separate delete (5.1s finding 2).
    await repository.sweepUnreferencedGeometry();
    scopes.length = 0;
    await repository.sweepUnreferencedGeometry();

    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toEqual(expect.arrayContaining(["rides", "draft", "geometry"]));
  });

  it("does not reclaim the first checkpoint's geometry when the startup sweep ran before it", async () => {
    const name = databaseName();
    const database = new VNextDatabase(name);
    const geometryStore = createIndexedDbGeometryStore({ databaseName: name });
    const staleOrphan = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }] },
      { kind: "route", now: "2026-09-17T12:00:00.000Z" },
    );

    // The constructor starts the bounded startup cleanup, and on a page load it is the
    // first writer to reach the store; its delete becoming visible on another
    // connection is what proves that cleanup committed.
    const repository = createRideRepository({ database });
    await vi.waitFor(async () => {
      expect(await geometryStore.get(staleOrphan.geometryRef)).toBeNull();
    });

    const fresh = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.8, lat: 40.2 }] },
      { kind: "avoid-area", now: "2026-09-17T12:00:00.000Z" },
    );
    const base = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const document = {
      ...base,
      intent: {
        ...base.intent,
        avoidAreas: [
          {
            id: newAvoidAreaId(),
            name: "first",
            geometryRef: fresh.geometryRef,
            enabled: true,
            createdBy: "drawing" as const,
          },
        ],
      },
    };

    await expect(repository.saveRide(document, { writerToken: "tab-a" })).resolves.toEqual({
      ok: true,
    });
    expect(await repository.loadDraftPointer()).toMatchObject({
      geometryRefs: [fresh.geometryRef],
    });
    expect(await geometryStore.get(fresh.geometryRef)).not.toBeNull();
  });

  it("serializes concurrent sweeps without losing an orphan or reclaiming a referenced blob", async () => {
    const name = databaseName();
    const database = new VNextDatabase(name);
    const repository = createRideRepository({ database });
    await repository.sweepUnreferencedGeometry();
    const geometryStore = createIndexedDbGeometryStore({ databaseName: name });
    const kept = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.7, lat: 40.3 }] },
      { kind: "avoid-area", now: "2026-09-17T12:00:00.000Z" },
    );
    const firstOrphan = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }] },
      { kind: "route", now: "2026-09-17T12:00:00.000Z" },
    );
    const secondOrphan = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.8, lat: 40.2 }] },
      { kind: "sketch-stroke", now: "2026-09-17T12:00:00.000Z" },
    );
    const base = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    await repository.saveRide(
      {
        ...base,
        intent: {
          ...base.intent,
          avoidAreas: [
            {
              id: newAvoidAreaId(),
              name: "kept",
              geometryRef: kept.geometryRef,
              enabled: true,
              createdBy: "drawing" as const,
            },
          ],
        },
      },
      { writerToken: "tab-a" },
    );

    const [left, right] = await Promise.all([
      repository.sweepUnreferencedGeometry(),
      repository.sweepUnreferencedGeometry(),
    ]);

    // The two sweeps serialize on the same transaction: each orphan is reclaimed
    // exactly once, and neither sweep touches the blob the ride still references.
    expect(left + right).toBe(2);
    expect(await geometryStore.get(firstOrphan.geometryRef)).toBeNull();
    expect(await geometryStore.get(secondOrphan.geometryRef)).toBeNull();
    expect(await geometryStore.get(kept.geometryRef)).not.toBeNull();
  });

  it("deletes the ride and its active draft pointer", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });

    await repository.saveRide(document, { writerToken: "tab-a" });
    await repository.deleteRide(document.rideId);

    expect(await repository.loadRide(document.rideId)).toBeNull();
    expect(await repository.loadDraftPointer()).toBeNull();
  });

  it("invalidates the bootstrap hint naming a deleted ride and leaves an unrelated hint alone", async () => {
    const database = new VNextDatabase(databaseName());
    const bootstrapPointer = createLocalStorageBootstrapPointer();
    bootstrapPointer.invalidate();
    const repository = createRideRepository({ database, bootstrapPointer });
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const other = createRideDocument({ now: "2026-09-17T11:00:00.000Z" });

    await repository.saveRide(document, { writerToken: "tab-a" });
    bootstrapPointer.write({ rideId: document.rideId, updatedAt: document.updatedAt });
    await repository.deleteRide(document.rideId);
    expect(bootstrapPointer.read()).toEqual({ status: "absent" });

    // The hint is dropped only when it names the ride that went away: an unrelated
    // lead (the live draft) must survive, or deleting an old library ride would
    // destroy the only remaining handle on work in progress.
    bootstrapPointer.write({ rideId: other.rideId, updatedAt: other.updatedAt });
    await repository.deleteRide(document.rideId);
    expect(bootstrapPointer.read()).toMatchObject({
      status: "found",
      hint: { rideId: other.rideId },
    });
    bootstrapPointer.invalidate();
  });

  it("invalidates the bootstrap hint when the library deletes the ride it names", async () => {
    const database = new VNextDatabase(databaseName());
    const bootstrapPointer = createLocalStorageBootstrapPointer();
    bootstrapPointer.invalidate();
    const repository = createRideRepository({ database, bootstrapPointer });
    const library = createLibraryService(repository, {
      now: () => "2026-09-17T12:01:00.000Z",
    });
    const named = await library.saveNamed(
      createRideDocument({ now: "2026-09-17T12:00:00.000Z" }),
      { title: "Named ride" },
    );
    bootstrapPointer.write({
      rideId: named.document.rideId,
      updatedAt: named.document.updatedAt,
    });

    await library.deleteRide(named.document.rideId);

    // The library delete path is one of the two delete callers; both go through the
    // repository, so a hint naming the deleted ride is gone before the next boot.
    expect(bootstrapPointer.read()).toEqual({ status: "absent" });
  });

  it("never resurrects a deleted ride from a stale bootstrap hint", async () => {
    const name = databaseName();
    const database = new VNextDatabase(name);
    const bootstrapPointer = createLocalStorageBootstrapPointer();
    bootstrapPointer.invalidate();
    const repository = createRideRepository({ database, bootstrapPointer });
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });

    await repository.saveRide(document, { writerToken: "tab-a" });
    await repository.deleteRide(document.rideId);
    // The row is really gone (a hard delete, not a mock returning null), and a hint
    // that survived it (another tab, or a pre-fix cache) is the only lead left.
    expect(await repository.loadRide(document.rideId)).toBeNull();
    bootstrapPointer.write({ rideId: document.rideId, updatedAt: document.updatedAt });

    const saveRide = vi.spyOn(repository, "saveRide");
    const store = createRideDocumentStore({
      repository,
      bootstrapPointer,
      now: () => "2026-09-17T12:05:00.000Z",
    });

    await vi.waitFor(() => {
      expect(bootstrapPointer.read()).toEqual({ status: "absent" });
    });
    expect(store.getState().document.rideId).not.toBe(document.rideId);
    expect(store.getState().restoreStatus).toEqual({ state: "idle", message: null });
    // The recovery path must never write: a save carrying `baseRevision` would be the
    // write that resurrects the tombstoned id.
    expect(saveRide).not.toHaveBeenCalled();
    expect(await repository.loadRide(document.rideId)).toBeNull();
  });

  it("refuses a checkpoint with no writer token instead of reading it as its own newer revision", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const first = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const newer = { ...first, revision: 3, updatedAt: "2026-09-17T12:03:00.000Z" };
    await repository.saveRide(first, { writerToken: "tab-a" });

    // `undefined === undefined` must never read as "the same writer": with both tokens
    // absent, any strictly newer revision would supersede the stored row and re-open
    // the cross-tab clobber the conflict check exists to prevent.
    await expect(
      repository.saveRide(newer, { writerToken: undefined as unknown as string }),
    ).resolves.toMatchObject({ ok: false, reason: "write-failed" });
    await expect(repository.saveRide(newer, { writerToken: "" })).resolves.toMatchObject({
      ok: false,
      reason: "write-failed",
    });
    expect(await repository.loadRide(first.rideId)).toEqual({ ok: true, document: first });
  });

  it("garbage-collects unshared geometry but keeps geometry shared by another ride", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const geometryStore = createIndexedDbGeometryStore({ databaseName: database.name });
    const shared = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }] },
      { kind: "avoid-area", now: "2026-09-17T12:00:00.000Z" },
    );
    const unshared = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.8, lat: 40.2 }] },
      { kind: "avoid-area", now: "2026-09-17T12:00:00.000Z" },
    );
    const base = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const first = {
      ...base,
      intent: {
        ...base.intent,
        avoidAreas: [
          { id: newAvoidAreaId(), name: "shared", geometryRef: shared.geometryRef, enabled: true, createdBy: "drawing" as const },
          { id: newAvoidAreaId(), name: "unshared", geometryRef: unshared.geometryRef, enabled: true, createdBy: "drawing" as const },
        ],
      },
    };
    const second = {
      ...base,
      rideId: `${base.rideId}-second` as typeof base.rideId,
      intent: {
        ...base.intent,
        avoidAreas: [{ id: newAvoidAreaId(), name: "shared", geometryRef: shared.geometryRef, enabled: true, createdBy: "drawing" as const }],
      },
    };

    await repository.saveRide(first, { writerToken: "tab-a" });
    await repository.saveRide(second, { writerToken: "tab-b" });
    await repository.deleteRide(first.rideId);
    expect(await geometryStore.get(unshared.geometryRef)).toBeNull();
    expect(await geometryStore.get(shared.geometryRef)).not.toBeNull();
    await repository.deleteRide(second.rideId);
    expect(await geometryStore.get(shared.geometryRef)).toBeNull();
  });

  it("sweeps startup orphans once while preserving geometry referenced by a ride", async () => {
    const database = new VNextDatabase(databaseName());
    const geometryStore = createIndexedDbGeometryStore({ databaseName: database.name });
    const orphan = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }] },
      { kind: "route", now: "2026-09-17T12:00:00.000Z" },
    );
    const referenced = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.8, lat: 40.2 }] },
      { kind: "avoid-area", now: "2026-09-17T12:00:00.000Z" },
    );
    const base = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const document = {
      ...base,
      intent: {
        ...base.intent,
        avoidAreas: [{ id: newAvoidAreaId(), name: "kept", geometryRef: referenced.geometryRef, enabled: true, createdBy: "drawing" as const }],
      },
    };
    await database.rides.put({
      rideId: document.rideId,
      revision: document.revision,
      updatedAt: document.updatedAt,
      writerToken: "seed",
      document,
    });

    createRideRepository({ database });
    await vi.waitFor(async () => {
      expect(await geometryStore.get(orphan.geometryRef)).toBeNull();
    });
    expect(await geometryStore.get(referenced.geometryRef)).not.toBeNull();
  });

  it("keeps RideSession geometry alive while sweeping unrelated startup orphans", async () => {
    const database = new VNextDatabase(databaseName());
    const geometryStore = createIndexedDbGeometryStore({ databaseName: database.name });
    const route = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }] },
      { kind: "route", now: "2026-09-17T12:00:00.000Z" },
    );
    const orphan = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.8, lat: 40.2 }] },
      { kind: "route", now: "2026-09-17T12:00:00.000Z" },
    );
    const removeGeometry = vi.spyOn(database.geometry, "delete");

    createRideRepository({ database, protectedGeometryRefs: () => [route.geometryRef] });
    await vi.waitFor(async () => {
      expect(await geometryStore.get(orphan.geometryRef)).toBeNull();
    });

    expect(removeGeometry).toHaveBeenCalledExactlyOnceWith(orphan.geometryRef);
    expect(await geometryStore.get(route.geometryRef)).not.toBeNull();
  });

  it("defers geometry reclamation when a RideSession reference cannot be read", async () => {
    const database = new VNextDatabase(databaseName());
    const geometryStore = createIndexedDbGeometryStore({ databaseName: database.name });
    const route = await geometryStore.put(
      { kind: "line", coordinates: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }] },
      { kind: "route", now: "2026-09-17T12:00:00.000Z" },
    );
    const readReferences = vi.fn(() => null);

    createRideRepository({ database, protectedGeometryRefs: readReferences });
    await vi.waitFor(() => expect(readReferences).toHaveBeenCalledOnce());

    expect(await geometryStore.get(route.geometryRef)).not.toBeNull();
  });

  it("persists two forked rides with both durable ids", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRideRepository({ database });
    const library = createLibraryService(repository, { now: () => "2026-09-17T12:01:00.000Z" });
    const original = await library.saveNamed(
      createRideDocument({ now: "2026-09-17T12:00:00.000Z" }),
      { title: "Original" },
    );
    const fork = await library.openRide(original.document.rideId);

    expect(fork.rideId).not.toBe(original.document.rideId);
    expect(await repository.loadRide(original.document.rideId)).toMatchObject({ ok: true, document: original.document });
    expect(await repository.loadRide(fork.rideId)).toMatchObject({ ok: true, document: fork });
  });

  it("reopens the database and retains the durable ride", async () => {
    const name = databaseName();
    const writer = new VNextDatabase(name);
    const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    await createRideRepository({ database: writer }).saveRide(document, { writerToken: "tab-a" });
    writer.close();

    const reopened = new VNextDatabase(name);
    await expect(createRideRepository({ database: reopened }).loadRide(document.rideId)).resolves.toEqual({
      ok: true,
      document,
    });
    reopened.close();
  });

  it("upgrades a real v1 database with geometry and journals the schema migration", async () => {
    const name = databaseName();
    const legacy = new Dexie(name);
    legacy.version(1).stores({ geometry: "geometryRef" });
    await legacy.open();
    const geometry = {
      geometryRef: "geo_v1-row",
      kind: "route" as const,
      payload: { kind: "line" as const, coordinates: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }] },
      pointCount: 2,
      createdAt: "2026-09-17T12:00:00.000Z",
    };
    await legacy.table("geometry").put(geometry);
    legacy.close();

    const upgraded = new VNextDatabase(name);
    await upgraded.open();
    expect(await upgraded.geometry.get(asGeometryRef(geometry.geometryRef))).toEqual(geometry);
    expect(await upgraded.migrationJournal.get("schema-1-to-2")).toMatchObject({
      from: 1,
      to: 2,
      completedAt: expect.any(String),
    });
    // The chain runs through every version, so a v1 database reaches the
    // physical-activity tables (v5, Task 8.1) and recording tables (v6,
    // Task 8.3) with both upgrades journaled.
    expect(await upgraded.migrationJournal.get("schema-4-to-5")).toMatchObject({
      from: 4,
      to: 5,
      completedAt: expect.any(String),
      counts: { rideSessions: 0, rideSessionJournal: 0 },
    });
    expect(await upgraded.migrationJournal.get("schema-5-to-6")).toMatchObject({
      from: 5,
      to: 6,
      completedAt: expect.any(String),
      counts: { recordings: 0, recordingBatches: 0 },
    });
    upgraded.close();
  });

  it("keeps a 10,000-point geometry payload outside the ride record", async () => {
    const name = databaseName();
    const database = new VNextDatabase(name);
    const repository = createRideRepository({ database });
    const geometryStore = createIndexedDbGeometryStore({ databaseName: name });
    const geometry = await geometryStore.put(
      {
        kind: "line",
        coordinates: Array.from({ length: 10_000 }, (_, index) => ({
          lon: -75 + index * 0.00001,
          lat: 40 + index * 0.00001,
        })),
      },
      { kind: "route", now: "2026-09-17T12:00:00.000Z" },
    );
    const base = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
    const document = {
      ...base,
      intent: {
        ...base.intent,
        avoidAreas: [
          {
            id: newAvoidAreaId(),
            name: "large area",
            geometryRef: geometry.geometryRef,
            enabled: true,
            createdBy: "drawing" as const,
          },
        ],
      },
    };

    await repository.saveRide(document, { writerToken: "tab-a" });
    const stored = await database.rides.get(document.rideId);

    expect(JSON.stringify(stored).length).toBeLessThan(10_000);
    expect(await geometryStore.get(geometry.geometryRef)).toEqual(geometry);
  });
});
