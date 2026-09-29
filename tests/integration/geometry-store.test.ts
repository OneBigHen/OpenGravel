import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import {
  GeometryValidationError,
  type GeometryStore,
} from "@/application/geometry/geometry-store";
import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import { createIndexedDbGeometryStore } from "@/infrastructure/storage/indexeddb-geometry-store";
import { VNEXT_DB_NAME, VNextDatabase } from "@/infrastructure/storage/db";
import { applyRideCommand } from "@/domain/ride/reducer";
import type { RideCommandResult } from "@/domain/ride/commands";
import { newAvoidAreaId, newCommandId } from "@/domain/ride/ids";
import { createRideDocument } from "@/domain/ride/create";
import type { GeometryPayload, PolygonGeometry } from "@/domain/geometry/types";
import type { AvoidArea, Coordinate, RideDocument } from "@/domain/ride/types";

/**
 * GeometryStore contract (Task 1.4, 02-ARCHITECTURE-CONTRACT §4, OGV-ARC-007,
 * OGV-MIG-002 partial).
 *
 * Both adapters must satisfy the same behavioral contract, because the planner
 * and the ride history do not know which one they were handed:
 *
 * - large geometry is written once and read back through a stable handle;
 * - `put` is immutable — it always mints a new `GeometryRef`, so there is no
 *   update path that could silently rewrite geometry a history entry still
 *   refers to;
 * - a returned record is deep-frozen plain data, so a consumer cannot mutate
 *   stored geometry or hand a live object to a Dexie transaction;
 * - a missing handle is `null`, never an error;
 * - invalid payloads are rejected with the domain validator's issues.
 *
 * The IndexedDB adapter runs against `fake-indexeddb`, which is what makes the
 * Dexie path (schema, transaction, structured clone round-trip) testable in
 * CI. The last suite is the Rule G regression: documents and history keep
 * `GeometryRef`s, never payloads.
 */

const NOW = "2026-06-01T09:00:00.000Z";

function coordinate(index: number): Coordinate {
  return { lon: -74.07 + (index % 300) * 1e-4, lat: 4.71 + Math.floor(index / 300) * 1e-4 };
}

function lineOf(length: number): GeometryPayload {
  return {
    kind: "line",
    coordinates: Array.from({ length }, (_, index) => coordinate(index)),
  };
}

function closedRing(distinct: number): readonly Coordinate[] {
  const first = coordinate(0);
  return [
    ...Array.from({ length: distinct }, (_, index) => coordinate(index)),
    first,
  ];
}

/** A closed ring of exactly `ringLength` coordinates (last repeats the first). */
function polygonOf(ringLength: number): PolygonGeometry {
  const first = coordinate(0);
  const ring: Coordinate[] = [first];
  for (let index = 1; index < ringLength - 1; index += 1) {
    ring.push(coordinate(index));
  }
  ring.push(first);
  return { kind: "polygon", rings: [ring] };
}

let uniqueDatabase = 0;

interface Adapter {
  readonly name: string;
  readonly create: () => GeometryStore;
}

const ADAPTERS: readonly Adapter[] = [
  { name: "memory", create: () => createMemoryGeometryStore() },
  {
    name: "indexeddb",
    create: () => {
      uniqueDatabase += 1;
      return createIndexedDbGeometryStore({
        databaseName: `${VNEXT_DB_NAME}-test-${String(uniqueDatabase)}`,
      });
    },
  },
];

/** Every object/array reachable from `value` that is not frozen, by path. */
function unfrozenNodes(value: unknown, path = "$"): string[] {
  if (typeof value !== "object" || value === null) return [];
  const here = Object.isFrozen(value) ? [] : [path];
  if (Array.isArray(value)) {
    return [
      ...here,
      ...value.flatMap((entry, index) => unfrozenNodes(entry, `${path}[${index}]`)),
    ];
  }
  return [
    ...here,
    ...Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      unfrozenNodes(entry, `${path}.${key}`),
    ),
  ];
}

describe.each(ADAPTERS)("GeometryStore contract — $name adapter", ({ create }) => {
  it("round-trips a line payload through a minted handle", async () => {
    const store = create();
    const payload = lineOf(3);

    const record = await store.put(payload, { kind: "route", now: NOW });

    expect(record.geometryRef.startsWith("geo_")).toBe(true);
    expect(record.kind).toBe("route");
    expect(record.pointCount).toBe(3);
    expect(record.createdAt).toBe(NOW);
    expect(record.payload).toEqual(payload);
    expect(await store.get(record.geometryRef)).toEqual(record);
  });

  it("round-trips a polygon payload unchanged", async () => {
    const store = create();
    const payload: GeometryPayload = {
      kind: "polygon",
      rings: [closedRing(4), closedRing(3)],
    };

    const record = await store.put(payload, { kind: "avoid-area", now: NOW });
    const fetched = await store.get(record.geometryRef);

    expect(fetched?.payload).toEqual(payload);
    expect(fetched?.pointCount).toBe(5 + 4);
    expect(fetched?.kind).toBe("avoid-area");
  });

  it("returns a deeply frozen record", async () => {
    const store = create();
    const record = await store.put(polygonOf(4), {
      kind: "sketch-corridor",
      now: NOW,
    });

    expect(unfrozenNodes(record)).toEqual([]);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("freezes the caller's payload, so a later mutation cannot corrupt stored geometry", async () => {
    const store = create();
    const payload = polygonOf(4);

    const record = await store.put(payload, { kind: "avoid-area", now: NOW });

    expect(Object.isFrozen(payload)).toBe(true);
    expect(() => {
      (payload.rings as Coordinate[][]).push([coordinate(1)]);
    }).toThrow(TypeError);
    expect((await store.get(record.geometryRef))?.payload).toEqual(polygonOf(4));
  });

  it("keeps records structured-clone-safe plain data", async () => {
    const store = create();
    const payload = polygonOf(4);

    const record = await store.put(payload, { kind: "avoid-area", now: NOW });

    expect(structuredClone(record)).toEqual(record);
  });

  it("mints a new ref on every put, even for an identical payload", async () => {
    const store = create();
    const payload = lineOf(2);

    const first = await store.put(payload, { kind: "recording", now: NOW });
    const second = await store.put(payload, { kind: "recording", now: NOW });

    expect(first.geometryRef).not.toBe(second.geometryRef);
    expect(await store.get(first.geometryRef)).toEqual(first);
    expect(await store.get(second.geometryRef)).toEqual(second);
  });

  it("treats a missing handle as null, not an error", async () => {
    const store = create();
    const orphan = await (async (): Promise<string> => {
      const record = await store.put(lineOf(2), { kind: "import-track", now: NOW });
      await store.remove(record.geometryRef);
      return record.geometryRef;
    })();

    await expect(store.get(orphan as never)).resolves.toBeNull();
  });

  it("reports has for a stored, removed and never-stored handle", async () => {
    const store = create();
    const stored = await store.put(lineOf(2), { kind: "road-entity", now: NOW });

    expect(await store.has(stored.geometryRef)).toBe(true);

    await store.remove(stored.geometryRef);

    expect(await store.has(stored.geometryRef)).toBe(false);
    expect(await store.has(stored.geometryRef)).toBe(false);
  });

  it("removes idempotently", async () => {
    const store = create();
    const record = await store.put(lineOf(2), { kind: "road-span", now: NOW });

    await expect(store.remove(record.geometryRef)).resolves.toBeUndefined();
    await expect(store.remove(record.geometryRef)).resolves.toBeUndefined();
  });

  it("holds several kinds side by side", async () => {
    const store = create();
    const route = await store.put(lineOf(2), { kind: "route", now: NOW });
    const area = await store.put(polygonOf(4), { kind: "avoid-area", now: NOW });
    const stroke = await store.put(lineOf(5), { kind: "sketch-stroke", now: NOW });

    const records = await Promise.all(
      [route, area, stroke].map((record) => store.get(record.geometryRef)),
    );

    expect(records.map((record) => record?.kind)).toEqual([
      "route",
      "avoid-area",
      "sketch-stroke",
    ]);
  });

  it("rejects an invalid line with the domain validator's issues", async () => {
    const store = create();

    const failure = await store
      .put(lineOf(1), { kind: "route", now: NOW })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GeometryValidationError);
    expect((failure as GeometryValidationError).issues.join(" ")).toMatch(
      /at least 2 points/,
    );
  });

  it("rejects an unclosed polygon ring", async () => {
    const store = create();
    const unclosed: GeometryPayload = {
      kind: "polygon",
      rings: [closedRing(3).slice(0, 3)],
    };

    const failure = await store
      .put(unclosed, { kind: "avoid-area", now: NOW })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GeometryValidationError);
    expect((failure as GeometryValidationError).issues.join(" ")).toMatch(
      /closed/,
    );
  });

  it("rejects an unknown geometry kind at runtime", async () => {
    const store = create();

    const failure = await store
      .put(lineOf(2), { kind: "surface" as never, now: NOW })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GeometryValidationError);
    expect((failure as GeometryValidationError).issues.join(" ")).toMatch(
      /not a known geometry kind/,
    );
  });

  it("rejects before writing anything: a refused payload is never consumed", async () => {
    const store = create();
    const invalid = lineOf(1);

    await expect(store.put(invalid, { kind: "route", now: NOW })).rejects.toThrow(
      GeometryValidationError,
    );
    // The gate is read-only: a rejected payload is not frozen into a record and
    // the caller keeps ownership of it.
    expect(Object.isFrozen(invalid)).toBe(false);
    expect(Object.isFrozen(invalid.kind === "line" ? invalid.coordinates : [])).toBe(
      false,
    );
  });
});

describe("IndexedDB adapter — VNext storage namespace (OGV-MIG-002 partial)", () => {
  it("uses the opengravel-vnext database, keyed by geometryRef on one geometry table", async () => {
    expect(VNEXT_DB_NAME).toBe("opengravel-vnext");

    const store = createIndexedDbGeometryStore();
    const record = await store.put(lineOf(2), { kind: "route", now: NOW });

    const inspection = new VNextDatabase();

    expect(inspection.name).toBe("opengravel-vnext");
    expect(inspection.tables.map((table) => table.name)).toEqual([
      "geometry",
      "rides",
      "draft",
      "settings",
      "migrationJournal",
      "blobs",
      "roadEntities",
      "roadSpans",
      "roadEvidence",
      "rideSessions",
      "rideSessionJournal",
      "recordings",
      "recordingBatches",
      "shares",
    ]);
    expect(inspection.geometry.schema.primKey.keyPath).toBe("geometryRef");

    const persisted = await inspection.geometry.get(record.geometryRef);

    expect(persisted?.geometryRef).toBe(record.geometryRef);
    expect(persisted?.payload).toEqual(record.payload);

    await inspection.geometry.delete(record.geometryRef);
    inspection.close();
  });

  it("persists across adapter instances of the same database", async () => {
    const databaseName = `${VNEXT_DB_NAME}-shared`;

    const writer = createIndexedDbGeometryStore({ databaseName });
    const record = await writer.put(polygonOf(5), {
      kind: "avoid-area",
      now: NOW,
    });

    const reader = createIndexedDbGeometryStore({ databaseName });

    expect(await reader.get(record.geometryRef)).toEqual(record);
    expect(await reader.has(record.geometryRef)).toBe(true);

    await reader.remove(record.geometryRef);
    expect(await writer.get(record.geometryRef)).toBeNull();
  });

  it("keeps the legacy namespace untouched: the VNext name is not a legacy key", async () => {
    const inspection = new VNextDatabase();

    expect(inspection.name.startsWith("opengravel-vnext")).toBe(true);
    expect(inspection.name === "opengravel").toBe(false);

    inspection.close();
  });
});

describe("history holds geometry references, not payloads (OGV-ARC-007, Rule G)", () => {
  const HUGE_RING_POINTS = 10_000;

  function created(result: RideCommandResult): RideDocument {
    if (result.outcome !== "applied") {
      throw new Error(`expected applied, got ${result.outcome}`);
    }
    return result.document;
  }

  it("keeps a 10,000-point avoid-area polygon out of the document and its history", async () => {
    const store = createMemoryGeometryStore();
    const huge = await store.put(polygonOf(HUGE_RING_POINTS), {
      kind: "avoid-area",
      now: NOW,
    });

    expect(huge.pointCount).toBe(HUGE_RING_POINTS);

    const area: AvoidArea = {
      id: newAvoidAreaId(),
      name: "military range",
      geometryRef: huge.geometryRef,
      enabled: true,
      createdBy: "drawing",
    };

    let document = createRideDocument({ now: NOW });
    document = created(
      applyRideCommand(document, {
        type: "avoidArea.create",
        commandId: newCommandId(),
        rideId: document.rideId,
        baseRevision: document.revision,
        source: "drawing",
        label: "Add avoid area",
        area,
      }),
    );
    document = created(
      applyRideCommand(document, {
        type: "surface.set",
        commandId: newCommandId(),
        rideId: document.rideId,
        baseRevision: document.revision,
        source: "rider",
        label: "Prefer pavement",
        surface: { preference: "pavement", unknownSurfacePolicy: "allow-with-warning" },
      }),
    );
    document = created(
      applyRideCommand(document, {
        type: "roadCharacter.set",
        commandId: newCommandId(),
        rideId: document.rideId,
        baseRevision: document.revision,
        source: "rider",
        label: "More curves",
        roadCharacter: "curvy",
      }),
    );
    document = created(
      applyRideCommand(document, {
        type: "tollPolicy.set",
        commandId: newCommandId(),
        rideId: document.rideId,
        baseRevision: document.revision,
        source: "rider",
        label: "Allow tolls with a warning",
        tollPolicy: "allow-with-warning",
      }),
    );

    expect(document.history.entries).toHaveLength(4);
    expect(document.intent.avoidAreas[0]?.geometryRef).toBe(huge.geometryRef);
    expect(JSON.stringify(document).length).toBeLessThan(10_000);

    // The handle still resolves to the whole payload: the payload was moved
    // out of the document, not lost.
    const fetched = await store.get(huge.geometryRef);
    expect(fetched?.pointCount).toBe(HUGE_RING_POINTS);
    expect(fetched?.payload.kind).toBe("polygon");
  });
});
