import { describe, expect, it, vi } from "vitest";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type { GeometryStore } from "@/application/geometry/geometry-store";
import {
  authorAvoidArea,
  createAvoidAreaCommand,
  removeAvoidAreaCommand,
  renameAvoidAreaCommand,
  setAvoidAreaEnabledCommand,
  updateAvoidAreaGeometry,
  updateAvoidAreaGeometryCommand,
} from "@/application/planner/avoid-area-authoring";
import { rectangleRing } from "@/application/planner/avoid-area-geometry";
import { createRideDocument } from "@/domain/ride/create";
import type { RideCommand, RideCommandResult } from "@/domain/ride/commands";
import { applyRideCommand } from "@/domain/ride/reducer";
import { asGeometryRef, newAvoidAreaId, type AvoidAreaId, type GeometryRef } from "@/domain/ride/ids";
import type { Coordinate, RideDocument } from "@/domain/ride/types";

/**
 * Authoring an avoid area is **two async steps** (04 §18, 02 §4): the polygon
 * goes into the GeometryStore, and the command carries the handle it returned.
 *
 * That split has one failure mode worth a test rather than a comment: the write
 * succeeds and the command is refused, leaving a payload nothing references.
 * The store's own immutability contract makes orphans a normal cost (there is no
 * in-place update), so the authoring path is the one place that has to reclaim
 * the ref it just minted — and "no silent geometry drops" is the rule it is
 * reclaiming it under.
 */

const BASE: Coordinate = { lon: -75.44, lat: 40.14 };
const ONE_METER_LAT = 1 / 111_320;
const ONE_METER_LON = 1 / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));

function metres(lonMeters: number, latMeters: number): Coordinate {
  return {
    lon: BASE.lon + lonMeters * ONE_METER_LON,
    lat: BASE.lat + latMeters * ONE_METER_LAT,
  };
}

function square(sizeMeters = 300): readonly Coordinate[] {
  return rectangleRing(metres(0, 0), metres(sizeMeters, sizeMeters));
}

function injectedStore(): GeometryStore {
  return createMemoryGeometryStore();
}

/** A document with one authored area, for the update/rename/remove paths. */
async function documentWithArea(
  store: GeometryStore,
): Promise<{ readonly document: RideDocument; readonly areaId: AvoidAreaId }> {
  const document = createRideDocument();
  const created = await authorAvoidArea({
    document,
    rings: [square()],
    geometryStore: store,
    dispatch: (command) => applyRideCommand(document, command),
  });
  if (created.outcome !== "applied") throw new Error(created.outcome);
  return { document: created.document, areaId: created.areaId };
}

describe("authorAvoidArea", () => {
  it("stores the polygon first and applies a command carrying the handle", async () => {
    const store = injectedStore();
    const document = createRideDocument();
    let dispatched: RideCommand | null = null;

    const result = await authorAvoidArea({
      document,
      rings: [square()],
      geometryStore: store,
      dispatch: (command) => {
        dispatched = command;
        return applyRideCommand(document, command);
      },
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") return;
    expect(result.document.intent.avoidAreas).toHaveLength(1);
    const area = result.document.intent.avoidAreas[0];
    expect(area?.geometryRef).toBe(result.geometryRef);
    expect(area?.enabled).toBe(true);
    // The payload really is in the store the command's handle addresses.
    const record = await store.get(result.geometryRef);
    expect(record?.kind).toBe("avoid-area");
    expect(record?.payload.kind).toBe("polygon");
    expect(dispatched).not.toBeNull();
  });

  it("refuses an invalid ring before writing anything", async () => {
    const store = injectedStore();
    const dispatch = vi.fn();
    const tiny = rectangleRing(metres(0, 0), metres(5, 5));

    const result = await authorAvoidArea({
      document: createRideDocument(),
      rings: [tiny],
      geometryStore: store,
      dispatch,
    });

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.message).toMatch(/too small/i);
    }
    // Nothing was written: "store.put then validate" would leave a payload behind
    // for a gesture the rider never committed.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("removes the orphan ref when the command is refused", async () => {
    const store = injectedStore();
    const document = createRideDocument();
    // A reducer refusal (a stale revision) is the documented case: the geometry is
    // already written and must not survive as an unreferenced payload.
    const stale: RideCommandResult = { outcome: "stale", currentRevision: document.revision + 5 };
    let mintedRef: GeometryRef | null = null;

    const result = await authorAvoidArea({
      document,
      rings: [square()],
      geometryStore: store,
      dispatch: (command) => {
        if (command.type === "avoidArea.create") mintedRef = command.area.geometryRef;
        return stale;
      },
    });

    expect(result).toEqual({ outcome: "stale", currentRevision: document.revision + 5 });
    expect(mintedRef).not.toBeNull();
    expect(await store.has(asGeometryRef(mintedRef ?? ""))).toBe(false);
  });

  it("reports an invalid command's code and removes the orphan ref", async () => {
    const store = injectedStore();
    const document = createRideDocument();
    let mintedRef: GeometryRef | null = null;

    const result = await authorAvoidArea({
      document,
      rings: [square()],
      geometryStore: store,
      dispatch: (command) => {
        if (command.type === "avoidArea.create") mintedRef = command.area.geometryRef;
        return { outcome: "invalid", code: "duplicate-avoid-area-id", message: "dup" };
      },
    });

    expect(result).toEqual({
      outcome: "invalid",
      code: "duplicate-avoid-area-id",
      message: "dup",
    });
    expect(mintedRef).not.toBeNull();
    expect(await store.has(asGeometryRef(mintedRef ?? ""))).toBe(false);
  });

  it("names the area when a name is supplied, and leaves it unnamed otherwise", async () => {
    const store = injectedStore();
    const document = createRideDocument();
    const named = await authorAvoidArea({
      document,
      rings: [square()],
      geometryStore: store,
      name: "Route 206",
      dispatch: (command) => applyRideCommand(document, command),
    });

    expect(named.outcome).toBe("applied");
    if (named.outcome !== "applied") return;
    expect(named.document.intent.avoidAreas[0]?.name).toBe("Route 206");
    // The history label carries the name the rider gave it (04 §20).
    expect(named.label).toBe("Avoided Route 206");

    const unnamed = await authorAvoidArea({
      document,
      rings: [square()],
      geometryStore: store,
      dispatch: (command) => applyRideCommand(document, command),
    });
    if (unnamed.outcome !== "applied") throw new Error(unnamed.outcome);
    expect(unnamed.document.intent.avoidAreas[0]?.name).toBeNull();
    expect(unnamed.label).toBe("Drew avoid area");
  });
});

describe("updateAvoidAreaGeometry", () => {
  it("writes the new polygon, dispatches its handle, and keeps the old one", async () => {
    const store = injectedStore();
    const { document, areaId } = await documentWithArea(store);
    const previousRef = document.intent.avoidAreas[0]?.geometryRef;
    if (previousRef === undefined) throw new Error("no area");

    const result = await updateAvoidAreaGeometry({
      document,
      areaId,
      rings: [rectangleRing(metres(500, 500), metres(800, 800))],
      geometryStore: store,
      dispatch: (command) => applyRideCommand(document, command),
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") return;
    const nextRef = result.document.intent.avoidAreas[0]?.geometryRef;
    expect(nextRef).toBe(result.geometryRef);
    expect(nextRef).not.toBe(previousRef);
    // Undo restores the previous document, which still names the old ref — so the
    // old payload must stay resolvable. That is why the store has no update.
    expect(await store.has(previousRef)).toBe(true);
  });

  it("removes the orphan ref when the update is refused", async () => {
    const store = injectedStore();
    const { document, areaId } = await documentWithArea(store);
    let mintedRef: GeometryRef | null = null;

    const result = await updateAvoidAreaGeometry({
      document,
      areaId,
      rings: [rectangleRing(metres(500, 500), metres(800, 800))],
      geometryStore: store,
      dispatch: (command) => {
        if (command.type === "avoidArea.update" && command.geometryRef !== undefined) {
          mintedRef = command.geometryRef;
        }
        return { outcome: "invalid", code: "unknown-avoid-area-id", message: "gone" };
      },
    });

    expect(result.outcome).toBe("invalid");
    expect(mintedRef).not.toBeNull();
    expect(await store.has(asGeometryRef(mintedRef ?? ""))).toBe(false);
  });

  it("refuses an invalid ring before writing anything", async () => {
    const store = injectedStore();
    const { document, areaId } = await documentWithArea(store);
    const dispatch = vi.fn();

    const result = await updateAvoidAreaGeometry({
      document,
      areaId,
      rings: [[metres(0, 0), metres(10, 0), metres(0, 10), metres(0, 0)]],
      geometryStore: store,
      dispatch,
    });

    expect(result.outcome).toBe("rejected");
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("the avoid-area command builders", () => {
  const document = createRideDocument();

  it("labels a rename with the new name and does not reroute", () => {
    const command = renameAvoidAreaCommand(document, newAvoidAreaId(), "Route 206");
    expect(command.type).toBe("avoidArea.update");
    expect(command.name).toBe("Route 206");
    expect(command.geometryRef).toBeUndefined();
    expect(command.label).toBe("Renamed avoid area");
    expect(command.source).toBe("map");
    expect(command.baseRevision).toBe(document.revision);
  });

  it("clears a name with null", () => {
    expect(renameAvoidAreaCommand(document, newAvoidAreaId(), null).name).toBeNull();
  });

  it("labels enable and disable distinctly, since they mean opposite things", () => {
    expect(setAvoidAreaEnabledCommand(document, newAvoidAreaId(), false).label).toBe(
      "Disabled avoid area",
    );
    expect(setAvoidAreaEnabledCommand(document, newAvoidAreaId(), true).label).toBe(
      "Enabled avoid area",
    );
  });

  it("builds a create command whose area carries the handle and the source", () => {
    const command = createAvoidAreaCommand(document, asGeometryRef("geo_x"), {
      name: null,
      label: "Drew avoid area",
    });
    expect(command.type).toBe("avoidArea.create");
    expect(command.area.geometryRef).toBe(asGeometryRef("geo_x"));
    expect(command.area.enabled).toBe(true);
    expect(command.area.createdBy).toBe("map");
  });

  it("builds a remove command addressed by id", () => {
    const areaId = newAvoidAreaId();
    const command = removeAvoidAreaCommand(document, areaId);
    expect(command.type).toBe("avoidArea.remove");
    expect(command.areaId).toBe(areaId);
    expect(command.label).toBe("Removed avoid area");
  });

  it("builds an update command that carries only the new handle", () => {
    const command = updateAvoidAreaGeometryCommand(document, newAvoidAreaId(), asGeometryRef("geo_y"));
    expect(command.type).toBe("avoidArea.update");
    expect(command.geometryRef).toBe(asGeometryRef("geo_y"));
    expect(command.label).toBe("Moved avoid area");
  });
});
