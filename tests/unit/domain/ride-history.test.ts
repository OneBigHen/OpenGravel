/**
 * Bounded whole-ride undo/redo (03-DOMAIN-MODEL §27, 17-IMPLEMENTATION-PLAN
 * Task 1.3).
 *
 * The behavioral claims under test:
 *
 * - one user action is exactly one history unit, whatever its size;
 * - undo returns the prior *authored ride* (the intent snapshot), not a patch
 *   and not a rebuild;
 * - the index is bounded to `HISTORY_LIMIT`, and pruning keeps undo
 *   well-defined across the pruned boundary via `baseIntent`;
 * - every move is a new revision (the planning-invalidation fence) with a new
 *   `updatedAt`, and it never mutates its input.
 *
 * The engine is pure domain: no framework import, no store, no clock beyond the
 * injected `now`.
 */

import { describe, expect, it } from "vitest";

import type { RideCommand, RideCommandResult } from "@/domain/ride/commands";
import { createRideDocument, defaultRideIntent } from "@/domain/ride/create";
import {
  HISTORY_LIMIT,
  type HistoryMove,
  type HistoryMoveResult,
  appendHistoryEntry,
  canRedo,
  canUndo,
  pruneHistory,
  recordProposalApplied,
  redoRide,
  undoRide,
} from "@/domain/ride/history";
import {
  asGeometryRef,
  newAvoidAreaId,
  newCommandId,
  newHistoryEntryId,
  newPointId,
  newStopId,
} from "@/domain/ride/ids";
import { applyRideCommand } from "@/domain/ride/reducer";
import type {
  AvoidArea,
  CommandSource,
  Coordinate,
  LocationProvenance,
  RideDocument,
  RideHistoryEntry,
  RideHistoryIndex,
  RideIntent,
  RidePoint,
  RoadCharacterIntent,
  StopPoint,
} from "@/domain/ride/types";
import { deepFreeze } from "@/domain/util/freeze";

const NOW = "2026-05-01T12:00:00.000Z";
const LATER = "2026-05-01T13:30:00.000Z";
const EVEN_LATER = "2026-05-01T14:00:00.000Z";
const MAP: LocationProvenance = { type: "map", selectedAt: NOW };
const GPS: LocationProvenance = { type: "gps", accuracyMeters: 8, observedAt: NOW };
const COORD_A: Coordinate = { lon: -76.5, lat: 40.1 };
const COORD_B: Coordinate = { lon: -76.4, lat: 40.2 };

/**
 * Every object/array reachable from `value` that is not frozen, as a path list.
 * An empty list is the deep-frozen assertion: a restored ride is authored truth
 * and is immutable once produced.
 */
function unfrozenNodes(value: unknown, path = "$"): string[] {
  if (typeof value !== "object" || value === null) return [];
  const here = Object.isFrozen(value) ? [] : [path];
  if (Array.isArray(value)) {
    return value.reduce<string[]>(
      (paths, entry, index) => paths.concat(unfrozenNodes(entry, `${path}[${index}]`)),
      here,
    );
  }
  return Object.entries(value).reduce<string[]>(
    (paths, [key, entry]) => paths.concat(unfrozenNodes(entry, `${path}.${key}`)),
    here,
  );
}

function stopPoint(overrides: Partial<StopPoint> = {}): StopPoint {
  return {
    id: newStopId(),
    kind: "stop",
    coordinate: COORD_A,
    label: "Coffee",
    arrivalIntent: "food",
    provenance: MAP,
    ...overrides,
  };
}

function startPoint(overrides: Partial<RidePoint> = {}): RidePoint {
  return {
    id: newPointId(),
    kind: "start",
    coordinate: COORD_A,
    label: "Home",
    provenance: MAP,
    ...overrides,
  };
}

function avoidArea(overrides: Partial<AvoidArea> = {}): AvoidArea {
  return {
    id: newAvoidAreaId(),
    name: "Gravel pit",
    geometryRef: asGeometryRef("geom_avoid_1"),
    enabled: true,
    createdBy: "rider",
    ...overrides,
  };
}

/** A frozen document fixture with the given intent/document overrides. */
function fixture(
  intentOverrides: Partial<RideIntent> = {},
  documentOverrides: Partial<
    Pick<RideDocument, "revision" | "history" | "title" | "provenance">
  > = {},
): RideDocument {
  const document = createRideDocument({ now: NOW });
  const intent = deepFreeze<RideIntent>({ ...defaultRideIntent(), ...intentOverrides });
  // The base snapshot is the initial intent by definition, so a fixture that
  // overrides the intent must override both — otherwise undo would restore the
  // document's product defaults instead of its starting state.
  const history: RideHistoryIndex = {
    entries: [],
    cursor: -1,
    baseIntent: intent,
    appliedProposalIds: [],
    ...documentOverrides.history,
  };
  return deepFreeze<RideDocument>({
    ...document,
    intent,
    ...documentOverrides,
    history,
  });
}

/** The fields every command carries. */
function base(
  document: RideDocument,
  overrides: { source?: CommandSource; label?: string } = {},
) {
  return {
    commandId: newCommandId(),
    rideId: document.rideId,
    baseRevision: document.revision,
    source: "rider" as CommandSource,
    label: "Test command",
    ...overrides,
  };
}

function apply(document: RideDocument, command: RideCommand): RideDocument {
  const result: RideCommandResult = applyRideCommand(document, command, { now: NOW });
  if (result.outcome !== "applied") {
    throw new Error(`expected applied, received ${result.outcome}`);
  }
  return result.document;
}

function expectMove(result: HistoryMoveResult): HistoryMove {
  if (result === null) throw new Error("expected a history move, received null");
  return result;
}

/** A frozen intent whose only difference is the road character. */
function characterIntent(character: RoadCharacterIntent): RideIntent {
  return deepFreeze<RideIntent>({ ...defaultRideIntent(), roadCharacter: character });
}

/** An index built directly from `count` synthetic entries. */
function indexOf(count: number, cursor = count - 1): RideHistoryIndex {
  const entries: RideHistoryEntry[] = Array.from({ length: count }, (_, position) => ({
    entryId: newHistoryEntryId(),
    label: `E${position}`,
    revision: position + 1,
    intent: characterIntent(position % 2 === 0 ? "curvy" : "backroads"),
  }));
  return {
    entries,
    cursor,
    baseIntent: defaultRideIntent(),
    appliedProposalIds: [],
  };
}

describe("history moves — one user action is one undo unit (03-DOMAIN-MODEL §27)", () => {
  it("treats one stop drag as exactly one undo step that restores the prior coordinate", () => {
    const stop = stopPoint();
    const document = fixture({ stops: [stop] });
    const applied = apply(document, {
      ...base(document, { label: "Moved coffee stop" }),
      type: "stop.move",
      stopId: stop.id,
      endpoint: { coordinate: COORD_B, provenance: MAP },
    });

    expect(applied.history.entries).toHaveLength(1);
    expect(applied.intent.stops[0]?.coordinate).toEqual(COORD_B);
    expect(canUndo(applied)).toBe(true);

    const undo = expectMove(undoRide(applied, { now: LATER }));

    expect(undo.label).toBe("Moved coffee stop");
    expect(undo.document.intent.stops).toHaveLength(1);
    expect(undo.document.intent.stops[0]?.coordinate).toEqual(COORD_A);
    expect(undo.document.intent.stops[0]?.id).toBe(stop.id);
    // The undo is not itself a new history unit.
    expect(undo.document.history.entries).toHaveLength(1);
    expect(undo.document.history.cursor).toBe(-1);
    expect(canUndo(undo.document)).toBe(false);
    expect(canRedo(undo.document)).toBe(true);
  });

  it("treats a compound proposal.apply as one undo step that restores every changed field", () => {
    const document = fixture();
    const applied = apply(document, {
      ...base(document, { label: "Applied ride suggestion" }),
      type: "proposal.apply",
      proposalId: "prop_compound",
      operations: [
        { ...base(document), type: "roadCharacter.set", roadCharacter: "curvy" },
        { ...base(document), type: "highwayPolicy.set", avoid: true },
        {
          ...base(document),
          type: "surface.set",
          surface: { preference: "dirt-preferred", unknownSurfacePolicy: "avoid-when-possible" },
        },
      ],
    });

    expect(applied.history.entries).toHaveLength(1);
    expect(applied.intent.roadCharacter).toBe("curvy");
    expect(applied.intent.avoidHighways).toBe(true);

    const undo = expectMove(undoRide(applied));

    expect(undo.document.history.entries).toHaveLength(1);
    expect(undo.document.history.cursor).toBe(-1);
    expect(undo.document.intent.roadCharacter).toBe("balanced");
    expect(undo.document.intent.avoidHighways).toBe(false);
    expect(undo.document.intent.surface).toEqual({
      preference: "mixed",
      unknownSurfacePolicy: "allow-with-warning",
    });
  });

  it("replays the undone entry's intent on redo, cursor included", () => {
    const document = createRideDocument({ now: NOW });
    const applied = apply(document, {
      ...base(document, { label: "Set start" }),
      type: "start.set",
      point: startPoint(),
    });
    const undone = expectMove(undoRide(applied, { now: NOW })).document;
    const redone = expectMove(redoRide(undone, { now: LATER }));

    expect(redone.label).toBe("Set start");
    expect(redone.document.history.cursor).toBe(0);
    expect(redone.document.history.entries).toHaveLength(1);
    expect(redone.document.intent).toBe(applied.intent);
    expect(redone.document.intent.start?.coordinate).toEqual(COORD_A);
    expect(canRedo(redone.document)).toBe(false);
    expect(canUndo(redone.document)).toBe(true);
  });

  it("restores the stored intent snapshot by reference, so geometry stays behind its ref", () => {
    const area = avoidArea();
    const empty = createRideDocument({ now: NOW });
    const document = apply(empty, {
      ...base(empty, { label: "Added avoid area" }),
      type: "avoidArea.create",
      area,
    });
    const applied = apply(document, {
      ...base(document, { label: "Moved avoid area" }),
      type: "avoidArea.update",
      areaId: area.id,
      geometryRef: asGeometryRef("geom_avoid_2"),
    });

    const undo = expectMove(undoRide(applied));
    expect(undo.document.intent).toBe(document.intent);
    expect(undo.document.intent.avoidAreas[0]?.geometryRef).toBe(asGeometryRef("geom_avoid_1"));

    const redo = expectMove(redoRide(undo.document));
    expect(redo.document.intent).toBe(applied.intent);
    expect(redo.document.intent.avoidAreas[0]?.geometryRef).toBe(asGeometryRef("geom_avoid_2"));
  });
});

describe("system-location seeding is not a rider undo step", () => {
  it("leaves a fresh document with nothing to undo and no history entry", () => {
    const document = createRideDocument({ now: NOW });
    const seeded = apply(document, {
      ...base(document, { source: "system-location", label: "Located you" }),
      type: "start.set",
      point: startPoint({ provenance: GPS }),
    });

    expect(seeded.revision).toBe(1);
    expect(seeded.history.entries).toEqual([]);
    expect(seeded.history.cursor).toBe(-1);
    expect(canUndo(seeded)).toBe(false);
    expect(canRedo(seeded)).toBe(false);
    expect(undoRide(seeded)).toBeNull();
  });

  it("does not cut the redo tail when a system-location seed lands after an undo", () => {
    const document = createRideDocument({ now: NOW });
    const authored = apply(document, {
      ...base(document),
      type: "roadCharacter.set",
      roadCharacter: "curvy",
    });
    const undone = expectMove(undoRide(authored)).document;
    const seeded = apply(undone, {
      ...base(undone, { source: "system-location", label: "Located you" }),
      type: "start.set",
      point: startPoint({ provenance: GPS }),
    });

    expect(seeded.revision).toBe(undone.revision + 1);
    expect(seeded.history.entries).toBe(undone.history.entries);
    expect(seeded.history.cursor).toBe(-1);
    expect(canRedo(seeded)).toBe(true);
  });
});

describe("redo-tail cutting and revision policy", () => {
  it("cuts the redo tail when a new edit lands after an undo", () => {
    const document = createRideDocument({ now: NOW });
    const first = apply(document, {
      ...base(document, { label: "First" }),
      type: "roadCharacter.set",
      roadCharacter: "curvy",
    });
    const second = apply(first, {
      ...base(first, { label: "Second" }),
      type: "roadCharacter.set",
      roadCharacter: "backroads",
    });
    const undone = expectMove(undoRide(second)).document;
    expect(canRedo(undone)).toBe(true);

    const third = apply(undone, {
      ...base(undone, { label: "Third" }),
      type: "roadCharacter.set",
      roadCharacter: "efficient",
    });

    expect(canRedo(third)).toBe(false);
    expect(third.history.entries.map((entry) => entry.label)).toEqual(["First", "Third"]);
    expect(third.history.cursor).toBe(1);
    expect(redoRide(third)).toBeNull();
  });

  it("bumps revision and updatedAt on both undo and redo (planning invalidation fence)", () => {
    const document = createRideDocument({ now: NOW });
    const applied = apply(document, {
      ...base(document),
      type: "roadCharacter.set",
      roadCharacter: "curvy",
    });

    const undo = expectMove(undoRide(applied, { now: LATER }));
    expect(undo.document.revision).toBe(applied.revision + 1);
    expect(undo.document.updatedAt).toBe(LATER);
    expect(undo.document.createdAt).toBe(NOW);

    const redo = expectMove(redoRide(undo.document, { now: EVEN_LATER }));
    expect(redo.document.revision).toBe(undo.document.revision + 1);
    expect(redo.document.updatedAt).toBe(EVEN_LATER);
  });

  it("returns null at both boundaries and reports them through canUndo/canRedo", () => {
    const document = createRideDocument({ now: NOW });
    expect(canUndo(document)).toBe(false);
    expect(canRedo(document)).toBe(false);
    expect(undoRide(document)).toBeNull();
    expect(redoRide(document)).toBeNull();

    const applied = apply(document, {
      ...base(document),
      type: "roadCharacter.set",
      roadCharacter: "curvy",
    });
    expect(canUndo(applied)).toBe(true);
    expect(canRedo(applied)).toBe(false);
    expect(redoRide(applied)).toBeNull();

    const undone = expectMove(undoRide(applied)).document;
    expect(canUndo(undone)).toBe(false);
    expect(canRedo(undone)).toBe(true);
    expect(undoRide(undone)).toBeNull();
  });

  it("starts at the base snapshot: cursor -1 with baseIntent as the initial intent", () => {
    const document = createRideDocument({ now: NOW });

    expect(document.history.cursor).toBe(-1);
    expect(document.history.entries).toEqual([]);
    expect(document.history.baseIntent).toEqual(defaultRideIntent());
  });
});

describe("bounded index — HISTORY_LIMIT, pruning and the base snapshot", () => {
  it("caps a long command run at HISTORY_LIMIT entries", () => {
    let document = createRideDocument({ now: NOW });
    const intentsAfterEach: RideIntent[] = [];
    for (let position = 0; position < HISTORY_LIMIT + 5; position += 1) {
      document = apply(document, {
        ...base(document, { label: `Edit ${position + 1}` }),
        type: "roadCharacter.set",
        roadCharacter: position % 2 === 0 ? "curvy" : "backroads",
      });
      intentsAfterEach.push(document.intent);
    }

    expect(HISTORY_LIMIT).toBe(50);
    expect(document.revision).toBe(HISTORY_LIMIT + 5);
    expect(document.history.entries).toHaveLength(HISTORY_LIMIT);
    expect(document.history.cursor).toBe(HISTORY_LIMIT - 1);
    // The oldest five entries were dropped; the base snapshot is the intent of
    // the newest dropped entry (the fifth applied command).
    expect(document.history.entries[0]?.revision).toBe(6);
    expect(document.history.entries.at(-1)?.revision).toBe(HISTORY_LIMIT + 5);
    expect(document.history.baseIntent).toBe(intentsAfterEach[4]);
  });

  it("keeps undo well-defined across the pruned boundary and stops at the base intent", () => {
    let document = createRideDocument({ now: NOW });
    for (let position = 0; position < HISTORY_LIMIT + 5; position += 1) {
      document = apply(document, {
        ...base(document, { label: `Edit ${position + 1}` }),
        type: "roadCharacter.set",
        roadCharacter: position % 2 === 0 ? "curvy" : "backroads",
      });
    }
    const baseIntent = document.history.baseIntent;

    let undone = document;
    for (let remaining = 0; remaining < HISTORY_LIMIT; remaining += 1) {
      const move = undoRide(undone, { now: LATER });
      if (move === null) {
        throw new Error(`undo ${remaining + 1} returned null before the boundary`);
      }
      undone = move.document;
    }

    expect(undone.history.entries).toHaveLength(HISTORY_LIMIT);
    expect(undone.history.cursor).toBe(-1);
    expect(undone.history.entries[0]?.revision).toBe(6);
    expect(canUndo(undone)).toBe(false);
    expect(canRedo(undone)).toBe(true);
    expect(undone.intent).toBe(baseIntent);
    expect(undone.revision).toBe(HISTORY_LIMIT + 5 + HISTORY_LIMIT);
    expect(undoRide(undone)).toBeNull();
  });

  it("prunes in appendHistoryEntry and records the newest dropped intent as baseIntent", () => {
    let index: RideHistoryIndex = {
      entries: [],
      cursor: -1,
      baseIntent: defaultRideIntent(),
      appliedProposalIds: [],
    };
    const intents: RideIntent[] = [];
    for (let position = 0; position < HISTORY_LIMIT + 5; position += 1) {
      const intent = characterIntent(position % 2 === 0 ? "curvy" : "backroads");
      intents.push(intent);
      index = appendHistoryEntry(index, {
        entryId: newHistoryEntryId(),
        label: `E${position}`,
        revision: position + 1,
        intent,
      });
    }

    expect(index.entries).toHaveLength(HISTORY_LIMIT);
    expect(index.entries[0]?.label).toBe("E5");
    expect(index.cursor).toBe(HISTORY_LIMIT - 1);
    expect(index.baseIntent).toBe(intents[4]);
  });

  it("pruneHistory is a no-op within the limit and shifts the cursor when it drops", () => {
    const atLimit = indexOf(HISTORY_LIMIT, 10);
    expect(pruneHistory(atLimit)).toBe(atLimit);

    const over = indexOf(HISTORY_LIMIT + 5);
    const pruned = pruneHistory(over);
    expect(pruned.entries).toHaveLength(HISTORY_LIMIT);
    expect(pruned.entries[0]?.label).toBe("E5");
    expect(pruned.cursor).toBe(over.cursor - 5);
    expect(pruned.baseIntent).toBe(over.entries[4]?.intent);

    // A cursor inside the dropped prefix collapses onto the base snapshot
    // rather than becoming a negative index that is not `-1`.
    const stale = indexOf(HISTORY_LIMIT + 5, 0);
    expect(pruneHistory(stale).cursor).toBe(-1);
  });

  it("recordProposalApplied keeps the last 20 ids FIFO and leaves the rest untouched", () => {
    let index: RideHistoryIndex = {
      entries: [],
      cursor: -1,
      baseIntent: defaultRideIntent(),
      appliedProposalIds: [],
    };
    for (let position = 1; position <= 21; position += 1) {
      index = recordProposalApplied(index, `prop_${position}`);
    }

    expect(index.appliedProposalIds).toHaveLength(20);
    expect(index.appliedProposalIds[0]).toBe("prop_2");
    expect(index.appliedProposalIds.at(-1)).toBe("prop_21");
    expect(index.entries).toEqual([]);
    expect(index.cursor).toBe(-1);
  });
});

describe("purity and immutability", () => {
  it("never mutates the input and returns deep-frozen documents", () => {
    const document = createRideDocument({ now: NOW });
    const applied = apply(document, {
      ...base(document),
      type: "stop.insert",
      stop: stopPoint(),
    });
    const appliedSnapshot = structuredClone(applied);

    const undone = expectMove(undoRide(applied, { now: LATER })).document;
    expect(structuredClone(applied)).toEqual(appliedSnapshot);
    expect(undone).not.toBe(applied);
    expect(unfrozenNodes(undone)).toEqual([]);
    expect(Reflect.set(undone, "revision", 99)).toBe(false);
    expect(Reflect.set(undone.history, "cursor", 0)).toBe(false);

    const undoneSnapshot = structuredClone(undone);
    const redone = expectMove(redoRide(undone, { now: NOW })).document;
    expect(structuredClone(undone)).toEqual(undoneSnapshot);
    expect(unfrozenNodes(redone)).toEqual([]);
    expect(Reflect.set(redone.intent, "roadCharacter", "curvy")).toBe(false);
  });

  it("exposes a readonly index shape at compile time and at runtime", () => {
    /** Compile-time proof: every field rejects assignment. */
    function assertReadonly(index: RideHistoryIndex): void {
      // @ts-expect-error entries is readonly
      index.entries = [];
      // @ts-expect-error cursor is readonly
      index.cursor = 0;
      // @ts-expect-error baseIntent is readonly
      index.baseIntent = defaultRideIntent();
      // @ts-expect-error appliedProposalIds is readonly
      index.appliedProposalIds = [];
    }

    const index = createRideDocument({ now: NOW }).history;
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(index.entries)).toBe(true);
    expect(() => assertReadonly(index)).toThrow(TypeError);
  });
});
