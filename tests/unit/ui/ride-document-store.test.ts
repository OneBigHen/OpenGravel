/**
 * The ride-document container (02-ARCHITECTURE-CONTRACT §5, §8).
 *
 * The container has exactly one mutation path — `dispatch(command)` → the domain
 * reducer — and these tests pin the three things that goes wrong: a stale
 * command must not move the document, a no-op must not bump the revision, and
 * the store must not hand out a raw setter.
 */

import { describe, expect, it, vi } from "vitest";

import { createRideDocument, defaultRideIntent } from "@/domain/ride/create";
import { newRideId, newPointId, type PointId } from "@/domain/ride/ids";
import type { RideCommand } from "@/domain/ride/commands";
import type { Coordinate, RidePoint } from "@/domain/ride/types";
import {
  createRideDocumentStore,
  bikeCommand,
  placeFinishCommand,
  placeStartCommand,
} from "@/ui/stores/ride-document-store";

const FIXED = "2026-09-17T00:00:00.000Z";
const now = (): string => FIXED;
const ORIGIN: Coordinate = { lon: -75.2, lat: 39.95 };
const DESTINATION: Coordinate = { lon: -74.8, lat: 40.2 };

describe("bike command builder", () => {
  it("switches the ride snapshot with one undoable command", () => {
    const store = createRideDocumentStore({ now });
    const snapshot = { ...store.getState().document.intent.bike, bikeId: "bike_short", fuelRangeMiles: 60, reserveMiles: 10 };
    const result = store.getState().dispatch(bikeCommand(store.getState().document, snapshot));
    expect(result.outcome).toBe("applied");
    expect(store.getState().document.intent.bike).toEqual(snapshot);
    expect(store.getState().document.history.entries.at(-1)?.label).toBe("Change bike");
  });
});

function endpoint(id: string, kind: "start" | "finish", coordinate: Coordinate): RidePoint {
  return {
    id: id as PointId,
    kind,
    coordinate,
    provenance: { type: "search", provider: "test", query: "x" },
  };
}

describe("createRideDocumentStore", () => {
  it("builds ride.create with the client active-bike snapshot lazily", () => {
    const bike = { ...defaultRideIntent().bike, bikeId: "bike_active", fuelRangeMiles: 60, reserveMiles: 10 };
    const newRideBike = vi.fn(() => bike);
    const store = createRideDocumentStore({ newRideBike, now });
    expect(newRideBike).not.toHaveBeenCalled();
    const document = store.getState().document;
    const result = store.getState().dispatch({
      type: "ride.create",
      commandId: "cmd_new_ride" as RideCommand["commandId"],
      rideId: document.rideId,
      baseRevision: document.revision,
      source: "rider",
      label: "New ride",
    });
    expect(result.outcome).toBe("applied");
    expect(newRideBike).toHaveBeenCalledOnce();
    expect(store.getState().document.intent.bike).toEqual(bike);
  });

  it("does not read the active bike while building ride.create on the server", () => {
    vi.stubGlobal("window", undefined);
    try {
      const bike = { ...defaultRideIntent().bike, bikeId: "bike_active" };
      const newRideBike = vi.fn(() => bike);
      const store = createRideDocumentStore({ newRideBike, now });
      const document = store.getState().document;

      store.getState().dispatch({
        type: "ride.create",
        commandId: "cmd_server_new_ride" as RideCommand["commandId"],
        rideId: document.rideId,
        baseRevision: document.revision,
        source: "rider",
        label: "New ride",
      });

      expect(newRideBike).not.toHaveBeenCalled();
      expect(store.getState().document.intent.bike).toEqual(defaultRideIntent().bike);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("seeds an untouched draft with the active bike when no durable draft exists", async () => {
    const seed = createRideDocument({ now: now() });
    const bike = { ...defaultRideIntent().bike, bikeId: "bike_active", fuelRangeMiles: 60, reserveMiles: 10 };
    const newRideBike = vi.fn(() => bike);
    const repository = {
      saveRide: vi.fn().mockResolvedValue({ ok: true }),
      loadDraftPointer: vi.fn().mockResolvedValue(null),
      loadRide: vi.fn(),
      deleteRide: vi.fn(),
    };
    const bootstrapPointer = {
      read: vi.fn(() => ({ status: "absent" as const })),
      write: vi.fn(),
      invalidate: vi.fn(),
    };
    const store = createRideDocumentStore({ document: seed, repository, bootstrapPointer, newRideBike, now });

    expect(newRideBike).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(store.getState().document.intent.bike).toEqual(bike));
    expect(store.getState().document).not.toBe(seed);
    expect(store.getState().document.revision).toBe(0);
    expect(store.getState().document.history.entries).toEqual([]);
    expect(newRideBike).toHaveBeenCalledOnce();
  });

  it("restores the persisted draft with its own bike snapshot", async () => {
    const savedBike = { ...defaultRideIntent().bike, bikeId: "bike_saved", fuelRangeMiles: 230, reserveMiles: 20 };
    const saved = createRideDocument({ now: now(), bike: savedBike });
    const seeded = createRideDocument({
      now: now(),
      bike: { ...defaultRideIntent().bike, bikeId: "bike_active", fuelRangeMiles: 60 },
    });
    const repository = {
      saveRide: vi.fn().mockResolvedValue({ ok: true }),
      loadDraftPointer: vi.fn().mockResolvedValue({
        id: "active" as const,
        rideId: saved.rideId,
        updatedAt: saved.updatedAt,
      }),
      loadRide: vi.fn().mockResolvedValue({ ok: true, document: saved }),
      deleteRide: vi.fn(),
    };

    const store = createRideDocumentStore({ document: seeded, repository, now });

    await vi.waitFor(() => expect(store.getState().document.rideId).toBe(saved.rideId));
    expect(store.getState().document.intent.bike).toEqual(savedBike);
    expect(store.getState().restoreStatus.message).toBe("Restored your draft");
  });

  it("bumps the document revision for an applied command", () => {
    const store = createRideDocumentStore({ now });
    const before = store.getState().document;

    const result = store.getState().dispatch(placeStartCommand(before, ORIGIN, now));

    expect(result.outcome).toBe("applied");
    const after = store.getState().document;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.intent.start?.coordinate).toEqual(ORIGIN);
    expect(store.getState().lastResult).toEqual(result);
  });

  it("refuses a stale command and leaves the document where it was", () => {
    const store = createRideDocumentStore({ now });
    const applied = store.getState().document;
    const stale = placeStartCommand(applied, ORIGIN, now);
    store.getState().dispatch(stale);
    const current = store.getState().document;

    // The same command replayed at a newer revision is stale.
    const result = store.getState().dispatch(stale);

    expect(result.outcome).toBe("stale");
    expect(store.getState().document).toBe(current);
    expect(store.getState().document.revision).toBe(1);
  });

  it("does not bump the revision for a no-op", () => {
    const store = createRideDocumentStore({ now });
    const document = store.getState().document;
    const command: RideCommand = {
      type: "ride.create",
      commandId: "cmd_test" as RideCommand["commandId"],
      rideId: document.rideId,
      baseRevision: document.revision,
      source: "rider",
      label: "New ride",
    };

    const result = store.getState().dispatch(command);

    expect(result.outcome).toBe("noop");
    expect(store.getState().document.revision).toBe(document.revision);
  });

  it("surfaces an invalid command without moving the document", () => {
    const store = createRideDocumentStore({ now });
    const document = store.getState().document;
    const command: RideCommand = {
      type: "start.set",
      commandId: "cmd_bad" as RideCommand["commandId"],
      rideId: newRideId(),
      baseRevision: document.revision,
      source: "map",
      label: "Set start",
      point: endpoint("pt_other", "start", ORIGIN),
    };

    const result = store.getState().dispatch(command);

    expect(result.outcome).toBe("invalid");
    expect(store.getState().document).toBe(document);
  });

  it("places a start and a destination as ordinary map-authored commands", () => {
    const store = createRideDocumentStore({ now });
    store.getState().dispatch(placeStartCommand(store.getState().document, ORIGIN, now));
    store.getState().dispatch(
      placeFinishCommand(store.getState().document, DESTINATION, now),
    );

    const { intent } = store.getState().document;
    expect(intent.start?.provenance).toEqual({ type: "map", selectedAt: FIXED });
    expect(intent.finish?.coordinate).toEqual(DESTINATION);
    expect(intent.start?.id).not.toBe(intent.finish?.id);
  });

  it("exposes no raw setter", () => {
    const store = createRideDocumentStore({ now });

    expect(Object.keys(store).sort()).toEqual([
      "getInitialState",
      "getState",
      "subscribe",
    ]);
    expect(store.getState().dispatch).toBeTypeOf("function");
    expect(store.getState().document.intent).toEqual(defaultRideIntent());
  });

  it("notifies subscribers once per applied command", () => {
    const store = createRideDocumentStore({ now });
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.getState().dispatch(
      placeStartCommand(store.getState().document, ORIGIN, now),
    );
    unsubscribe();

    expect(notifications).toBe(1);
  });

  it("mints a fresh point id per placement, never reusing one", () => {
    const store = createRideDocumentStore({ now });
    const first = placeStartCommand(store.getState().document, ORIGIN, now);
    const second = placeStartCommand(store.getState().document, ORIGIN, now);

    expect(newPointId()).not.toBe(first.point.id);
    expect(first.point.id).not.toBe(second.point.id);
  });
});
