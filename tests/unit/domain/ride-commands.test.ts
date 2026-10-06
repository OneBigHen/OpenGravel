import { describe, expect, it } from "vitest";

import {
  RIDE_COMMAND_TYPES,
  type RideCommand,
  type RideCommandResult,
} from "@/domain/ride/commands";
import { createRideDocument, defaultRideIntent } from "@/domain/ride/create";
import {
  asGeometryRef,
  asRoadEntityId,
  newAvoidAreaId,
  newCommandId,
  newHistoryEntryId,
  newPointId,
  newRideId,
  newRoadSpanId,
  newShapingId,
  newSketchId,
  newStopId,
  type RideId,
} from "@/domain/ride/ids";
import { applyRideCommand } from "@/domain/ride/reducer";
import type {
  AvoidArea,
  CommandSource,
  Coordinate,
  LocationProvenance,
  RideDocument,
  RideHistoryEntry,
  RideIntent,
  RidePoint,
  RoadSpanConstraint,
  ShapingPoint,
  SketchIntent,
  StopPoint,
  SurfaceIntent,
  TerrainIntent,
} from "@/domain/ride/types";
import { deepFreeze } from "@/domain/util/freeze";

const NOW = "2026-05-01T12:00:00.000Z";
const LATER = "2026-05-01T13:30:00.000Z";
const MAP: LocationProvenance = { type: "map", selectedAt: NOW };
const COORD_A: Coordinate = { lon: -76.5, lat: 40.1 };
const COORD_B: Coordinate = { lon: -76.4, lat: 40.2 };

/** Every command type the union must expose (03-DOMAIN-MODEL §26). */
const DOCUMENTED_COMMAND_TYPES: readonly string[] = [
  "ride.create",
  "ride.clear",
  "ride.reverse",
  "ride.shape.set",
  "start.set",
  "start.clear",
  "finish.set",
  "finish.clear",
  "stop.insert",
  "stop.move",
  "stop.reorder",
  "stop.remove",
  "stop.arrivalIntent.set",
  "point.convert",
  "shape.insert",
  "shape.move",
  "shape.remove",
  "time.set",
  "departure.set",
  "roadCharacter.set",
  "noveltyPreference.set",
  "surface.set",
  "terrain.set",
  "trafficPreference.set",
  "highwayPolicy.set",
  "tollPolicy.set",
  "bike.set",
  "avoidArea.create",
  "avoidArea.update",
  "avoidArea.remove",
  "roadSpan.create",
  "roadSpan.update",
  "roadSpan.remove",
  "sketch.commit",
  "sketch.clear",
  "longTrip.set",
  "proposal.apply",
];

/**
 * Every object/array reachable from `value` that is not frozen, as a path list.
 * An empty list is the deep-frozen assertion (03-DOMAIN-MODEL §2 authored truth
 * is immutable once created).
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

function finishPoint(overrides: Partial<RidePoint> = {}): RidePoint {
  return {
    id: newPointId(),
    kind: "finish",
    coordinate: COORD_B,
    provenance: MAP,
    ...overrides,
  };
}

function stopPoint(overrides: Partial<StopPoint> = {}): StopPoint {
  return {
    id: newStopId(),
    kind: "stop",
    coordinate: COORD_A,
    label: "Fuel",
    arrivalIntent: "fuel",
    provenance: MAP,
    ...overrides,
  };
}

function shapePoint(overrides: Partial<ShapingPoint> = {}): ShapingPoint {
  return {
    id: newShapingId(),
    kind: "shape",
    coordinate: COORD_A,
    source: "map-drag",
    ...overrides,
  };
}

function avoidArea(overrides: Partial<AvoidArea> = {}): AvoidArea {
  return {
    id: newAvoidAreaId(),
    name: "Mud season",
    geometryRef: asGeometryRef("geom_avoid_1"),
    enabled: true,
    createdBy: "drawing",
    ...overrides,
  };
}

function roadSpan(overrides: Partial<RoadSpanConstraint> = {}): RoadSpanConstraint {
  return {
    id: newRoadSpanId(),
    mode: "prefer",
    direction: "forward",
    roadEntityId: asRoadEntityId("road_1"),
    geometryRef: asGeometryRef("geom_span_1"),
    anchorRefs: [COORD_A],
    ...overrides,
  };
}

function sketch(overrides: Partial<SketchIntent> = {}): SketchIntent {
  return {
    id: newSketchId(),
    rawStrokeRefs: [asGeometryRef("geom_stroke_1")],
    corridorRef: asGeometryRef("geom_corridor_1"),
    topologyHints: [{ kind: "near-loop", at: { lon: -75.44, lat: 40.14 }, strokeIndices: [0] }],
    endpointPolicy: "derive",
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
  return deepFreeze<RideDocument>({
    ...document,
    intent: deepFreeze<RideIntent>({ ...defaultRideIntent(), ...intentOverrides }),
    ...documentOverrides,
  });
}

interface BaseOverrides {
  readonly source?: CommandSource;
  readonly label?: string;
  readonly baseRevision?: number;
  readonly rideId?: RideId;
}

/** The fields every command carries (02-ARCHITECTURE-CONTRACT §5). */
function base(document: RideDocument, overrides: BaseOverrides = {}) {
  return {
    commandId: newCommandId(),
    rideId: document.rideId,
    baseRevision: document.revision,
    source: "rider" as CommandSource,
    label: "Test command",
    ...overrides,
  };
}

type Applied = Extract<RideCommandResult, { outcome: "applied" }>;
type Invalid = Extract<RideCommandResult, { outcome: "invalid" }>;
type Noop = Extract<RideCommandResult, { outcome: "noop" }>;

function expectApplied(result: RideCommandResult): Applied {
  if (result.outcome !== "applied") {
    throw new Error(`expected applied, received ${result.outcome}`);
  }
  return result;
}

function expectInvalid(result: RideCommandResult): Invalid {
  if (result.outcome !== "invalid") {
    throw new Error(`expected invalid, received ${result.outcome}`);
  }
  return result;
}

function expectNoop(result: RideCommandResult): Noop {
  if (result.outcome !== "noop") {
    throw new Error(`expected noop, received ${result.outcome}`);
  }
  return result;
}

describe("RideCommand union (03-DOMAIN-MODEL §26, 02-ARCHITECTURE-CONTRACT §5)", () => {
  it("registers exactly the documented command set", () => {
    expect(Object.keys(RIDE_COMMAND_TYPES).sort()).toEqual(
      [...DOCUMENTED_COMMAND_TYPES].sort(),
    );
    expect(Object.keys(RIDE_COMMAND_TYPES)).toHaveLength(37);
  });

  it("exposes no generic patch or setState mutation member", () => {
    const document = fixture();
    const common = base(document);
    // @ts-expect-error — RideCommand has no generic "patch" variant (VNX-003).
    const patch: RideCommand = { ...common, type: "patch", fields: { surface: {} } };
    // @ts-expect-error — RideCommand has no "setState" variant (02 §5).
    const setState: RideCommand = { ...common, type: "setState", intent: {} };

    expect([patch, setState]).toHaveLength(2);
    expect(Object.keys(RIDE_COMMAND_TYPES)).not.toContain("patch");
    expect(Object.keys(RIDE_COMMAND_TYPES)).not.toContain("setState");
  });
});

describe("applyRideCommand guard order", () => {
  it("rejects a command aimed at another ride", () => {
    const document = fixture();
    const command: RideCommand = {
      ...base(document, { rideId: newRideId() }),
      type: "start.set",
      point: startPoint(),
    };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe("ride-mismatch");
  });

  it("rejects a lagging base revision as stale and reports the current revision", () => {
    const document = fixture({}, { revision: 3 });
    const command: RideCommand = {
      ...base(document, { baseRevision: 2 }),
      type: "start.set",
      point: startPoint(),
    };
    const result = applyRideCommand(document, command);

    expect(result.outcome).toBe("stale");
    expect(result.outcome === "stale" ? result.currentRevision : null).toBe(3);
  });

  it("reports ride mismatch before staleness", () => {
    const document = fixture({}, { revision: 3 });
    const command: RideCommand = {
      ...base(document, { rideId: newRideId(), baseRevision: 0 }),
      type: "start.set",
      point: startPoint(),
    };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe("ride-mismatch");
  });

  it("reports staleness before operation validation", () => {
    const document = fixture({}, { revision: 3 });
    const command: RideCommand = {
      ...base(document, { baseRevision: 1 }),
      type: "stop.move",
      stopId: newStopId(),
      endpoint: { coordinate: COORD_B, provenance: MAP },
    };

    expect(applyRideCommand(document, command).outcome).toBe("stale");
  });
});

describe("start and finish endpoints", () => {
  it("applies a rider-authored start with one history entry", () => {
    const document = fixture();
    const point = startPoint();
    const command: RideCommand = {
      ...base(document, { label: "Set start" }),
      type: "start.set",
      point,
    };
    const result = expectApplied(applyRideCommand(document, command, { now: LATER }));

    expect(result.reroute).toBe(true);
    expect(result.document.revision).toBe(1);
    expect(result.document.updatedAt).toBe(LATER);
    expect(result.document.createdAt).toBe(document.createdAt);
    expect(result.document.intent.start).toEqual({ ...point, kind: "start" });
    expect(result.document.history.cursor).toBe(0);
    expect(result.document.history.entries).toHaveLength(1);
    expect(result.document.history.entries[0]?.label).toBe("Set start");
    expect(result.document.history.entries[0]?.revision).toBe(1);
    expect(result.document.history.entries[0]?.intent.start).toEqual({
      ...point,
      kind: "start",
    });
  });

  it("lets a rider replace an already authored start", () => {
    const document = fixture({ start: startPoint({ label: "Old" }) });
    const command: RideCommand = {
      ...base(document),
      type: "start.set",
      point: startPoint({ label: "New" }),
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.document.intent.start?.label).toBe("New");
    expect(result.document.history.entries).toHaveLength(1);
  });

  it("seeds an empty start from system location without a history entry", () => {
    const document = fixture();
    const command: RideCommand = {
      ...base(document, { source: "system-location", label: "Seeded start" }),
      type: "start.set",
      point: startPoint(),
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.document.revision).toBe(1);
    expect(result.document.intent.start).not.toBeNull();
    expect(result.document.history.entries).toEqual([]);
    expect(result.document.history.cursor).toBe(-1);
  });

  it("refuses to let system location overwrite an authored start (OGV-DOM-005)", () => {
    const document = fixture({ start: startPoint({ label: "Chosen" }) });
    const command: RideCommand = {
      ...base(document, { source: "system-location" }),
      type: "start.set",
      point: startPoint({ label: "Seeded" }),
    };
    const result = expectInvalid(applyRideCommand(document, command));

    expect(result.code).toBe("start-already-authored");
  });

  it("treats a system-location finish as an ordinary authored edit", () => {
    const document = fixture();
    const command: RideCommand = {
      ...base(document, { source: "system-location" }),
      type: "finish.set",
      point: finishPoint(),
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.document.intent.finish?.kind).toBe("finish");
    expect(result.document.history.entries).toHaveLength(1);
  });

  it("clears an authored start", () => {
    const document = fixture({ start: startPoint() });
    const command: RideCommand = {
      ...base(document, { label: "Clear start" }),
      type: "start.clear",
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.reroute).toBe(true);
    expect(result.document.intent.start).toBeNull();
    expect(result.document.history.entries.at(-1)?.label).toBe("Clear start");
  });

  it("treats clearing an absent start as a no-op", () => {
    const document = fixture();
    const command: RideCommand = { ...base(document), type: "start.clear" };

    expect(expectNoop(applyRideCommand(document, command)).document).toBe(document);
  });

  it("sets and clears the finish", () => {
    const document = fixture();
    const setFinish: RideCommand = {
      ...base(document),
      type: "finish.set",
      point: finishPoint(),
    };
    const withFinish = expectApplied(applyRideCommand(document, setFinish)).document;
    const clearFinish: RideCommand = { ...base(withFinish), type: "finish.clear" };
    const result = expectApplied(applyRideCommand(withFinish, clearFinish));

    expect(withFinish.intent.finish?.coordinate).toEqual(COORD_B);
    expect(result.document.intent.finish).toBeNull();
    expect(result.document.history.entries).toHaveLength(2);
  });

  it("rejects an out-of-range endpoint coordinate", () => {
    const document = fixture();
    const command: RideCommand = {
      ...base(document),
      type: "finish.set",
      point: finishPoint({ coordinate: { lon: 0, lat: 91 } }),
    };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe("invalid-coordinate");
  });
});

describe("stop commands", () => {
  it("inserts a stop at the end", () => {
    const document = fixture({ stops: [stopPoint({ label: "First" })] });
    const stop = stopPoint({ label: "Second" });
    const command: RideCommand = { ...base(document), type: "stop.insert", stop };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.reroute).toBe(true);
    expect(result.document.intent.stops.map((entry) => entry.label)).toEqual([
      "First",
      "Second",
    ]);
    expect(result.document.intent.stops[1]?.id).toBe(stop.id);
  });

  it("inserts a stop before an existing stop", () => {
    const second = stopPoint({ label: "Second" });
    const document = fixture({ stops: [stopPoint({ label: "First" }), second] });
    const inserted = stopPoint({ label: "Inserted" });
    const command: RideCommand = {
      ...base(document),
      type: "stop.insert",
      stop: inserted,
      beforeStopId: second.id,
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.document.intent.stops.map((entry) => entry.label)).toEqual([
      "First",
      "Inserted",
      "Second",
    ]);
  });

  it("rejects an insert with an unknown anchor stop", () => {
    const document = fixture({ stops: [stopPoint()] });
    const command: RideCommand = {
      ...base(document),
      type: "stop.insert",
      stop: stopPoint(),
      beforeStopId: newStopId(),
    };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe("unknown-stop-id");
  });

  it("rejects a duplicate stop id on insert", () => {
    const existing = stopPoint();
    const document = fixture({ stops: [existing] });
    const command: RideCommand = {
      ...base(document),
      type: "stop.insert",
      stop: stopPoint({ id: existing.id }),
    };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe("duplicate-stop-id");
  });

  it("rejects an out-of-range stop coordinate", () => {
    const document = fixture();
    const command: RideCommand = {
      ...base(document),
      type: "stop.insert",
      stop: stopPoint({ coordinate: { lon: 181, lat: 0 } }),
    };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe("invalid-coordinate");
  });

  it("moves a stop, replacing coordinate and provenance but keeping identity", () => {
    const existing = stopPoint({ label: "Coffee", arrivalIntent: "food" });
    const document = fixture({ stops: [existing] });
    const provenance: LocationProvenance = { type: "search", provider: "nominatim", query: "cafe" };
    const command: RideCommand = {
      ...base(document),
      type: "stop.move",
      stopId: existing.id,
      endpoint: { coordinate: COORD_B, provenance },
    };
    const result = expectApplied(applyRideCommand(document, command));
    const moved = result.document.intent.stops[0];

    expect(moved?.id).toBe(existing.id);
    expect(moved?.coordinate).toEqual(COORD_B);
    expect(moved?.provenance).toEqual(provenance);
    expect(moved?.label).toBe("Coffee");
    expect(moved?.arrivalIntent).toBe("food");
    expect(result.reroute).toBe(true);
  });

  it("replaces the label when the move supplies one", () => {
    const existing = stopPoint({ label: "Coffee" });
    const document = fixture({ stops: [existing] });
    const command: RideCommand = {
      ...base(document),
      type: "stop.move",
      stopId: existing.id,
      endpoint: { coordinate: COORD_B, provenance: MAP, label: "Lunch" },
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.document.intent.stops[0]?.label).toBe("Lunch");
  });

  it("rejects a move of an unknown stop", () => {
    const document = fixture({ stops: [stopPoint()] });
    const command: RideCommand = {
      ...base(document),
      type: "stop.move",
      stopId: newStopId(),
      endpoint: { coordinate: COORD_B, provenance: MAP },
    };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe("unknown-stop-id");
  });

  it("treats a move to the same coordinate and provenance as a no-op", () => {
    const existing = stopPoint({ coordinate: COORD_A });
    const document = fixture({ stops: [existing] });
    const command: RideCommand = {
      ...base(document),
      type: "stop.move",
      stopId: existing.id,
      endpoint: { coordinate: COORD_A, provenance: MAP },
    };

    expect(expectNoop(applyRideCommand(document, command)).document).toBe(document);
  });

  it("reorders a stop before another stop", () => {
    const first = stopPoint({ label: "First" });
    const second = stopPoint({ label: "Second" });
    const third = stopPoint({ label: "Third" });
    const document = fixture({ stops: [first, second, third] });
    const command: RideCommand = {
      ...base(document),
      type: "stop.reorder",
      stopId: third.id,
      beforeStopId: first.id,
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.document.intent.stops.map((entry) => entry.label)).toEqual([
      "Third",
      "First",
      "Second",
    ]);
  });

  it("reorders a stop to the end when no anchor is given", () => {
    const first = stopPoint({ label: "First" });
    const second = stopPoint({ label: "Second" });
    const third = stopPoint({ label: "Third" });
    const document = fixture({ stops: [first, second, third] });
    const command: RideCommand = {
      ...base(document),
      type: "stop.reorder",
      stopId: first.id,
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.document.intent.stops.map((entry) => entry.label)).toEqual([
      "Second",
      "Third",
      "First",
    ]);
  });

  it("rejects a reorder of an unknown stop", () => {
    const document = fixture({ stops: [stopPoint()] });
    const command: RideCommand = {
      ...base(document),
      type: "stop.reorder",
      stopId: newStopId(),
    };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe("unknown-stop-id");
  });

  it("rejects a reorder against an unknown anchor", () => {
    const existing = stopPoint();
    const document = fixture({ stops: [existing] });
    const command: RideCommand = {
      ...base(document),
      type: "stop.reorder",
      stopId: existing.id,
      beforeStopId: newStopId(),
    };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe("unknown-stop-id");
  });

  it("treats reordering a stop before itself as a no-op", () => {
    const existing = stopPoint();
    const document = fixture({ stops: [existing, stopPoint()] });
    const command: RideCommand = {
      ...base(document),
      type: "stop.reorder",
      stopId: existing.id,
      beforeStopId: existing.id,
    };

    expect(expectNoop(applyRideCommand(document, command)).document).toBe(document);
  });

  it("removes a stop by id", () => {
    const first = stopPoint({ label: "First" });
    const second = stopPoint({ label: "Second" });
    const document = fixture({ stops: [first, second] });
    const command: RideCommand = { ...base(document), type: "stop.remove", stopId: first.id };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.document.intent.stops.map((entry) => entry.label)).toEqual(["Second"]);
  });

  it("rejects removing an unknown stop", () => {
    const document = fixture({ stops: [stopPoint()] });
    const command: RideCommand = { ...base(document), type: "stop.remove", stopId: newStopId() };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe("unknown-stop-id");
  });
});

describe("shaping commands", () => {
  it("inserts, moves and removes shaping anchors", () => {
    const document = fixture();
    const point = shapePoint();
    const inserted = expectApplied(
      applyRideCommand(document, { ...base(document), type: "shape.insert", point }),
    ).document;
    const movedResult = expectApplied(
      applyRideCommand(inserted, {
        ...base(inserted),
        type: "shape.move",
        shapeId: point.id,
        coordinate: COORD_B,
      }),
    );
    const moved = movedResult.document;
    const removed = expectApplied(
      applyRideCommand(moved, { ...base(moved), type: "shape.remove", shapeId: point.id }),
    ).document;

    expect(inserted.intent.shaping.map((entry) => entry.id)).toEqual([point.id]);
    expect(moved.intent.shaping[0]?.coordinate).toEqual(COORD_B);
    expect(movedResult.reroute).toBe(true);
    expect(removed.intent.shaping).toEqual([]);
  });

  it("rejects a duplicate shaping id on insert", () => {
    const existing = shapePoint();
    const document = fixture({ shaping: [existing] });
    const command: RideCommand = {
      ...base(document),
      type: "shape.insert",
      point: shapePoint({ id: existing.id }),
    };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe("duplicate-shape-id");
  });

  it("rejects moving or removing an unknown shaping anchor", () => {
    const document = fixture({ shaping: [shapePoint()] });
    const move: RideCommand = {
      ...base(document),
      type: "shape.move",
      shapeId: newShapingId(),
      coordinate: COORD_B,
    };
    const remove: RideCommand = {
      ...base(document),
      type: "shape.remove",
      shapeId: newShapingId(),
    };

    expect(expectInvalid(applyRideCommand(document, move)).code).toBe("unknown-shape-id");
    expect(expectInvalid(applyRideCommand(document, remove)).code).toBe("unknown-shape-id");
  });

  it("treats moving a shaping anchor to its own coordinate as a no-op", () => {
    const existing = shapePoint({ coordinate: COORD_A });
    const document = fixture({ shaping: [existing] });
    const command: RideCommand = {
      ...base(document),
      type: "shape.move",
      shapeId: existing.id,
      coordinate: COORD_A,
    };

    expect(expectNoop(applyRideCommand(document, command)).document).toBe(document);
  });
});

describe(".set commands", () => {
  it("sets the trip shape as one undoable, rerouting command", () => {
    const document = fixture();
    const command: RideCommand = {
      ...base(document),
      type: "ride.shape.set",
      shape: "loop",
    };
    const result = expectApplied(applyRideCommand(document, command, { now: LATER }));

    expect(result.reroute).toBe(true);
    expect(result.document.intent.shape).toBe("loop");
    expect(result.document.revision).toBe(document.revision + 1);
    expect(result.document.history.entries.at(-1)?.label).toBe(command.label);
  });

  it("sets the time intent and rejects an invalid one", () => {
    const document = fixture();
    const command: RideCommand = {
      ...base(document),
      type: "time.set",
      time: { kind: "budget", targetMinutes: 240, toleranceMinutes: 30 },
    };
    const applied = expectApplied(applyRideCommand(document, command));
    const invalid: RideCommand = {
      ...base(document),
      type: "time.set",
      time: { kind: "budget", targetMinutes: 0, toleranceMinutes: 10 },
    };

    expect(applied.reroute).toBe(true);
    expect(applied.document.intent.time).toEqual({
      kind: "budget",
      targetMinutes: 240,
      toleranceMinutes: 30,
    });
    expect(expectInvalid(applyRideCommand(document, invalid)).code).toBe("invalid-time");
  });

  it.each([Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects a non-finite budget (%s) as invalid-time",
    (value) => {
      const document = fixture();
      const command: RideCommand = {
        ...base(document),
        type: "time.set",
        time: { kind: "budget", targetMinutes: value, toleranceMinutes: 0 },
      };

      expect(expectInvalid(applyRideCommand(document, command)).code).toBe(
        "invalid-time",
      );
    },
  );

  it("sets the surface intent and rejects an invalid envelope", () => {
    const document = fixture();
    const command: RideCommand = {
      ...base(document),
      type: "surface.set",
      surface: {
        preference: "dirt-preferred",
        targetUnpavedShare: { min: 0.2, target: 0.5, max: 0.8 },
        unknownSurfacePolicy: "avoid-when-possible",
      },
    };
    const applied = expectApplied(applyRideCommand(document, command));
    const invalid: RideCommand = {
      ...base(document),
      type: "surface.set",
      surface: {
        preference: "moon-dust",
        unknownSurfacePolicy: "allow-with-warning",
      } as unknown as SurfaceIntent,
    };

    expect(applied.document.intent.surface.preference).toBe("dirt-preferred");
    expect(expectInvalid(applyRideCommand(document, invalid)).code).toBe("invalid-surface");
  });

  it("treats a structurally identical surface as a no-op", () => {
    const surface: SurfaceIntent = {
      preference: "mixed",
      unknownSurfacePolicy: "allow-with-warning",
    };
    const document = fixture({ surface });
    const command: RideCommand = {
      ...base(document),
      type: "surface.set",
      surface: { ...surface },
    };

    expect(expectNoop(applyRideCommand(document, command)).document).toBe(document);
  });

  it("sets terrain, road character, traffic and toll policies", () => {
    const document = fixture();
    const withTerrain = expectApplied(
      applyRideCommand(document, {
        ...base(document),
        type: "terrain.set",
        terrain: { level: "known-easy-only" },
      }),
    ).document;
    const withCharacter = expectApplied(
      applyRideCommand(withTerrain, {
        ...base(withTerrain),
        type: "roadCharacter.set",
        roadCharacter: "curvy",
      }),
    ).document;
    const withTraffic = expectApplied(
      applyRideCommand(withCharacter, {
        ...base(withCharacter),
        type: "trafficPreference.set",
        traffic: "minimize-delay",
      }),
    ).document;
    const applied = expectApplied(
      applyRideCommand(withTraffic, {
        ...base(withTraffic),
        type: "tollPolicy.set",
        tollPolicy: "allow-with-warning",
      }),
    ).document;

    expect(applied.intent.terrain).toEqual({ level: "known-easy-only" });
    expect(applied.intent.roadCharacter).toBe("curvy");
    expect(applied.intent.traffic).toBe("minimize-delay");
    expect(applied.intent.tollPolicy).toBe("allow-with-warning");
    expect(applied.revision).toBe(4);
  });

  it("rejects unknown enum values reaching the reducer as untrusted input", () => {
    const document = fixture();
    const terrain: RideCommand = {
      ...base(document),
      type: "terrain.set",
      terrain: { level: "impossible" } as unknown as TerrainIntent,
    };
    const character: RideCommand = {
      ...base(document),
      type: "roadCharacter.set",
      roadCharacter: "scenic" as RideIntent["roadCharacter"],
    };

    expect(expectInvalid(applyRideCommand(document, terrain)).code).toBe("invalid-terrain");
    expect(expectInvalid(applyRideCommand(document, character)).code).toBe(
      "invalid-road-character",
    );
  });

  it("sets the highway policy", () => {
    const document = fixture();
    const command: RideCommand = { ...base(document), type: "highwayPolicy.set", avoid: true };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.reroute).toBe(true);
    expect(result.document.intent.avoidHighways).toBe(true);
  });

  it("treats an unchanged highway policy as a no-op", () => {
    const document = fixture({ avoidHighways: false });
    const command: RideCommand = { ...base(document), type: "highwayPolicy.set", avoid: false };

    expect(expectNoop(applyRideCommand(document, command)).document).toBe(document);
  });

  it("sets the bike snapshot", () => {
    const document = fixture();
    const bike = { ...document.intent.bike, fuelRangeMiles: 220, category: "adventure" as const };
    const command: RideCommand = { ...base(document), type: "bike.set", bike };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.reroute).toBe(true);
    expect(result.document.intent.bike.fuelRangeMiles).toBe(220);
  });

  it("sets the departure intent and rejects an unreadable future instant", () => {
    const document = fixture();
    const command: RideCommand = {
      ...base(document),
      type: "departure.set",
      departure: { kind: "future", at: LATER },
    };
    const applied = expectApplied(applyRideCommand(document, command));
    const invalid: RideCommand = {
      ...base(document),
      type: "departure.set",
      departure: { kind: "future", at: "tomorrow-ish" },
    };

    expect(applied.document.intent.departure).toEqual({ kind: "future", at: LATER });
    expect(expectInvalid(applyRideCommand(document, invalid)).code).toBe("invalid-departure");
  });

  it("sets and clears longTrip without requesting a reroute", () => {
    const document = fixture();
    const setTrip: RideCommand = {
      ...base(document),
      type: "longTrip.set",
      value: { staged: true, notes: "Two days" },
    };
    const withTrip = expectApplied(applyRideCommand(document, setTrip));
    const clearTrip: RideCommand = { ...base(withTrip.document), type: "longTrip.set", value: null };
    const cleared = expectApplied(applyRideCommand(withTrip.document, clearTrip));

    expect(withTrip.reroute).toBe(false);
    expect(withTrip.document.intent.longTrip).toEqual({ staged: true, notes: "Two days" });
    expect(cleared.document.intent.longTrip).toBeNull();
  });

  it("treats setting the same longTrip value as a no-op", () => {
    const document = fixture({ longTrip: { staged: true } });
    const command: RideCommand = {
      ...base(document),
      type: "longTrip.set",
      value: { staged: true },
    };

    expect(expectNoop(applyRideCommand(document, command)).document).toBe(document);
  });
});

describe("avoid areas", () => {
  it("creates, updates and removes an avoid area", () => {
    const document = fixture();
    const area = avoidArea();
    const created = expectApplied(
      applyRideCommand(document, { ...base(document), type: "avoidArea.create", area }),
    ).document;
    const updated = expectApplied(
      applyRideCommand(created, {
        ...base(created),
        type: "avoidArea.update",
        areaId: area.id,
        enabled: false,
      }),
    ).document;
    const removed = expectApplied(
      applyRideCommand(updated, {
        ...base(updated),
        type: "avoidArea.remove",
        areaId: area.id,
      }),
    ).document;

    expect(created.intent.avoidAreas).toHaveLength(1);
    expect(updated.intent.avoidAreas[0]?.enabled).toBe(false);
    expect(removed.intent.avoidAreas).toEqual([]);
  });

  it("rejects a duplicate avoid area id", () => {
    const existing = avoidArea();
    const document = fixture({ avoidAreas: [existing] });
    const command: RideCommand = {
      ...base(document),
      type: "avoidArea.create",
      area: avoidArea({ id: existing.id }),
    };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe(
      "duplicate-avoid-area-id",
    );
  });

  it("rejects updates and removals of unknown avoid areas", () => {
    const document = fixture({ avoidAreas: [avoidArea()] });
    const update: RideCommand = {
      ...base(document),
      type: "avoidArea.update",
      areaId: newAvoidAreaId(),
      enabled: false,
    };
    const remove: RideCommand = {
      ...base(document),
      type: "avoidArea.remove",
      areaId: newAvoidAreaId(),
    };

    expect(expectInvalid(applyRideCommand(document, update)).code).toBe("unknown-avoid-area-id");
    expect(expectInvalid(applyRideCommand(document, remove)).code).toBe("unknown-avoid-area-id");
  });

  it("renames an avoid area without requesting a reroute", () => {
    const area = avoidArea({ name: "Old name" });
    const document = fixture({ avoidAreas: [area] });
    const command: RideCommand = {
      ...base(document),
      type: "avoidArea.update",
      areaId: area.id,
      name: "New name",
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.reroute).toBe(false);
    expect(result.document.intent.avoidAreas[0]?.name).toBe("New name");
  });

  it("clears an avoid area name with an explicit null", () => {
    const area = avoidArea({ name: "Old name" });
    const document = fixture({ avoidAreas: [area] });
    const command: RideCommand = {
      ...base(document),
      type: "avoidArea.update",
      areaId: area.id,
      name: null,
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.document.intent.avoidAreas[0]?.name).toBeNull();
  });

  it("requests a reroute when geometry or enablement changes", () => {
    const area = avoidArea();
    const document = fixture({ avoidAreas: [area] });
    const geometry: RideCommand = {
      ...base(document),
      type: "avoidArea.update",
      areaId: area.id,
      geometryRef: asGeometryRef("geom_avoid_2"),
    };
    const enabled: RideCommand = {
      ...base(document),
      type: "avoidArea.update",
      areaId: area.id,
      enabled: false,
    };

    expect(expectApplied(applyRideCommand(document, geometry)).reroute).toBe(true);
    expect(expectApplied(applyRideCommand(document, enabled)).reroute).toBe(true);
  });

  it("treats an update that changes nothing as a no-op", () => {
    const area = avoidArea({ name: "Same", enabled: true });
    const document = fixture({ avoidAreas: [area] });
    const command: RideCommand = {
      ...base(document),
      type: "avoidArea.update",
      areaId: area.id,
      name: "Same",
      enabled: true,
      geometryRef: area.geometryRef,
    };

    expect(expectNoop(applyRideCommand(document, command)).document).toBe(document);
  });
});

describe("road spans", () => {
  it("creates, updates and removes a road span", () => {
    const document = fixture();
    const span = roadSpan();
    const createdResult = expectApplied(
      applyRideCommand(document, { ...base(document), type: "roadSpan.create", span }),
    );
    const created = createdResult.document;
    const updated = expectApplied(
      applyRideCommand(created, {
        ...base(created),
        type: "roadSpan.update",
        spanId: span.id,
        mode: "must",
        direction: "reverse",
      }),
    ).document;
    const removed = expectApplied(
      applyRideCommand(updated, { ...base(updated), type: "roadSpan.remove", spanId: span.id }),
    ).document;

    expect(created.intent.roadSpans).toHaveLength(1);
    expect(createdResult.reroute).toBe(true);
    expect(updated.intent.roadSpans[0]?.mode).toBe("must");
    expect(updated.intent.roadSpans[0]?.direction).toBe("reverse");
    expect(removed.intent.roadSpans).toEqual([]);
  });

  it("rejects a duplicate road span id", () => {
    const existing = roadSpan();
    const document = fixture({ roadSpans: [existing] });
    const command: RideCommand = {
      ...base(document),
      type: "roadSpan.create",
      span: roadSpan({ id: existing.id }),
    };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe(
      "duplicate-road-span-id",
    );
  });

  it("rejects an out-of-range anchor coordinate on create", () => {
    const document = fixture();
    const command: RideCommand = {
      ...base(document),
      type: "roadSpan.create",
      span: roadSpan({ anchorRefs: [{ lon: -181, lat: 0 }] }),
    };

    expect(expectInvalid(applyRideCommand(document, command)).code).toBe("invalid-coordinate");
  });

  it("rejects updates and removals of unknown road spans", () => {
    const document = fixture({ roadSpans: [roadSpan()] });
    const update: RideCommand = {
      ...base(document),
      type: "roadSpan.update",
      spanId: newRoadSpanId(),
      mode: "avoid",
    };
    const remove: RideCommand = {
      ...base(document),
      type: "roadSpan.remove",
      spanId: newRoadSpanId(),
    };

    expect(expectInvalid(applyRideCommand(document, update)).code).toBe("unknown-road-span-id");
    expect(expectInvalid(applyRideCommand(document, remove)).code).toBe("unknown-road-span-id");
  });
});

describe("sketch commands", () => {
  it("commits and clears a sketch", () => {
    const document = fixture();
    const committed = expectApplied(
      applyRideCommand(document, { ...base(document), type: "sketch.commit", sketch: sketch() }),
    );
    const cleared = expectApplied(
      applyRideCommand(committed.document, { ...base(committed.document), type: "sketch.clear" }),
    );

    expect(committed.reroute).toBe(true);
    expect(committed.document.intent.sketch).not.toBeNull();
    expect(cleared.document.intent.sketch).toBeNull();
  });

  it("treats committing an identical sketch as a no-op", () => {
    const existing = sketch();
    const document = fixture({ sketch: existing });
    const command: RideCommand = {
      ...base(document),
      type: "sketch.commit",
      sketch: { ...existing, rawStrokeRefs: [...existing.rawStrokeRefs], topologyHints: [{ kind: "near-loop", at: { lon: -75.44, lat: 40.14 }, strokeIndices: [0] }] },
    };

    expect(expectNoop(applyRideCommand(document, command)).document).toBe(document);
  });

  it("treats clearing an absent sketch as a no-op", () => {
    const document = fixture();
    const command: RideCommand = { ...base(document), type: "sketch.clear" };

    expect(expectNoop(applyRideCommand(document, command)).document).toBe(document);
  });
});

describe("ride.reverse", () => {
  it("swaps endpoints and reverses stops, shaping and span directions", () => {
    const firstStop = stopPoint({ label: "First" });
    const secondStop = stopPoint({ label: "Second" });
    const firstShape = shapePoint({ coordinate: COORD_A });
    const secondShape = shapePoint({ coordinate: COORD_B });
    const document = fixture({
      start: startPoint({ label: "Start" }),
      finish: finishPoint({ label: "Finish" }),
      stops: [firstStop, secondStop],
      shaping: [firstShape, secondShape],
      roadSpans: [
        roadSpan({ direction: "forward" }),
        roadSpan({ direction: "reverse" }),
        roadSpan({ direction: "either" }),
      ],
    });
    const command: RideCommand = {
      ...base(document, { label: "Reversed ride" }),
      type: "ride.reverse",
    };
    const result = expectApplied(applyRideCommand(document, command));
    const reversed = result.document.intent;

    expect(result.reroute).toBe(true);
    expect(reversed.start?.kind).toBe("start");
    expect(reversed.start?.id).toBe(document.intent.finish?.id);
    expect(reversed.start?.label).toBe("Finish");
    expect(reversed.finish?.kind).toBe("finish");
    expect(reversed.finish?.id).toBe(document.intent.start?.id);
    expect(reversed.stops.map((entry) => entry.id)).toEqual([secondStop.id, firstStop.id]);
    expect(reversed.shaping.map((entry) => entry.id)).toEqual([secondShape.id, firstShape.id]);
    expect(reversed.roadSpans.map((span) => span.direction)).toEqual([
      "reverse",
      "forward",
      "either",
    ]);
    expect(result.document.history.entries.map((entry) => entry.label)).toEqual([
      "Reversed ride",
    ]);
  });

  it("treats reversing an empty ride as a no-op", () => {
    const document = fixture();
    const command: RideCommand = { ...base(document), type: "ride.reverse" };

    expect(expectNoop(applyRideCommand(document, command)).document).toBe(document);
  });
});

describe("ride.clear and ride.create", () => {
  it("clears authored points but keeps preferences, constraints and sketch", () => {
    const document = fixture({
      start: startPoint(),
      finish: finishPoint(),
      stops: [stopPoint()],
      shaping: [shapePoint()],
      avoidAreas: [avoidArea()],
      roadSpans: [roadSpan()],
      sketch: sketch(),
      roadCharacter: "curvy",
    });
    const command: RideCommand = { ...base(document, { label: "Cleared points" }), type: "ride.clear" };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.reroute).toBe(true);
    expect(result.document.intent.start).toBeNull();
    expect(result.document.intent.finish).toBeNull();
    expect(result.document.intent.stops).toEqual([]);
    expect(result.document.intent.shaping).toEqual([]);
    expect(result.document.intent.avoidAreas).toEqual(document.intent.avoidAreas);
    expect(result.document.intent.roadSpans).toEqual(document.intent.roadSpans);
    expect(result.document.intent.sketch).toEqual(document.intent.sketch);
    expect(result.document.intent.roadCharacter).toBe("curvy");
    expect(result.document.history.entries.at(-1)?.label).toBe("Cleared points");
  });

  it("treats clearing an already-empty point set as a no-op", () => {
    const document = fixture();
    const command: RideCommand = { ...base(document), type: "ride.clear" };

    expect(expectNoop(applyRideCommand(document, command)).document).toBe(document);
  });

  it("keeps a start that is the rider's own location or a saved place", () => {
    for (const provenance of [
      { type: "gps" as const, accuracyMeters: 8, observedAt: "2026-10-04T12:00:00.000Z" },
      { type: "saved" as const, savedPlaceId: "home" },
    ]) {
      const start = startPoint({ provenance });
      const document = fixture({ start, finish: finishPoint(), stops: [stopPoint()] });
      const result = expectApplied(applyRideCommand(document, { ...base(document), type: "ride.clear" }));
      expect(result.document.intent.start).toEqual(start);
      expect(result.document.intent.finish).toBeNull();
      expect(result.document.intent.stops).toEqual([]);
    }
  });

  it("clears a lone GPS or saved start once nothing else is left to clear", () => {
    for (const provenance of [
      { type: "gps" as const, accuracyMeters: 8, observedAt: "2026-10-04T12:00:00.000Z" },
      { type: "saved" as const, savedPlaceId: "home" },
    ]) {
      const document = fixture({ start: startPoint({ provenance }) });
      const result = expectApplied(applyRideCommand(document, { ...base(document), type: "ride.clear" }));
      expect(result.document.intent.start).toBeNull();
    }
  });

  it("resets the intent to defaults while keeping document identity metadata", () => {
    const document = fixture(
      { start: startPoint(), roadCharacter: "curvy", stops: [stopPoint()] },
      { title: "Alpine loop", provenance: { type: "import", sourceId: "gpx-1" } },
    );
    const command: RideCommand = { ...base(document, { label: "New ride" }), type: "ride.create" };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.reroute).toBe(true);
    expect(result.document.intent).toEqual(defaultRideIntent());
    expect(result.document.rideId).toBe(document.rideId);
    expect(result.document.title).toBe("Alpine loop");
    expect(result.document.provenance).toEqual({ type: "import", sourceId: "gpx-1" });
    expect(result.document.history.entries.at(-1)?.label).toBe("New ride");
  });

  it("uses the chosen bike snapshot when a new ride command resets the intent", () => {
    const document = fixture({ roadCharacter: "curvy" });
    const bike = { ...document.intent.bike, bikeId: "bike_short", fuelRangeMiles: 60, reserveMiles: 10 };
    const command: RideCommand = { ...base(document, { label: "New ride" }), type: "ride.create", bike };
    const result = expectApplied(applyRideCommand(document, command));
    expect(result.document.intent.bike).toEqual(bike);
    expect(result.document.history.baseIntent.bike).toEqual(document.history.baseIntent.bike);
    expect(document.intent.bike).toEqual(defaultRideIntent().bike);
  });

  it("rejects an invalid bike snapshot on ride.create", () => {
    const document = fixture();
    const bike = { ...document.intent.bike, fuelRangeMiles: 10 };
    const command: RideCommand = { ...base(document), type: "ride.create", bike };
    const result = applyRideCommand(document, command);
    expect(result).toMatchObject({ outcome: "invalid", code: "invalid-bike" });
  });

  it.each([
    ["fuel range", { fuelRangeMiles: 601 }],
    ["reserve lower bound", { reserveMiles: -1 }],
    ["reserve upper bound", { reserveMiles: 101 }],
    ["reserve below range", { fuelRangeMiles: 60, reserveMiles: 60 }],
    ["category enum", { category: "custom" }],
    ["gravel enum", { maintainedGravel: "sometimes" }],
    ["rough track enum", { roughTracks: "sometimes" }],
    ["unknown surface enum", { unknownSurface: "guess" }],
  ] as const)("rejects an invalid %s in both ride.create and bike.set", (_field, overrides) => {
    const document = fixture();
    const bike = { ...document.intent.bike, ...overrides } as unknown as typeof document.intent.bike;
    const create = { ...base(document), type: "ride.create" as const, bike } as RideCommand;
    const set = { ...base(document), type: "bike.set" as const, bike } as RideCommand;

    expect(applyRideCommand(document, create)).toMatchObject({ outcome: "invalid", code: "invalid-bike" });
    expect(applyRideCommand(document, set)).toMatchObject({ outcome: "invalid", code: "invalid-bike" });
  });

  it("rejects malformed bike payloads instead of throwing", () => {
    const document = fixture();
    const command = { ...base(document), type: "ride.create", bike: null } as unknown as RideCommand;
    expect(applyRideCommand(document, command)).toMatchObject({ outcome: "invalid", code: "invalid-bike" });
  });
});

describe("proposal.apply", () => {
  it("applies a compound proposal as exactly one revision and one history entry", () => {
    const document = fixture();
    const command: RideCommand = {
      ...base(document, { source: "advisor", label: "Applied ride suggestion" }),
      type: "proposal.apply",
      proposalId: "prop_compound",
      operations: [
        { ...base(document), type: "roadCharacter.set", roadCharacter: "curvy" },
        { ...base(document), type: "terrain.set", terrain: { level: "known-easy-only" } },
        { ...base(document), type: "highwayPolicy.set", avoid: true },
      ],
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.reroute).toBe(true);
    expect(result.document.revision).toBe(document.revision + 1);
    expect(result.document.history.entries).toHaveLength(1);
    expect(result.document.history.cursor).toBe(0);
    expect(result.document.history.entries[0]?.label).toBe("Applied ride suggestion");
    expect(result.document.history.entries[0]?.revision).toBe(1);
    expect(result.document.history.appliedProposalIds).toEqual(["prop_compound"]);
    expect(result.document.intent.roadCharacter).toBe("curvy");
    expect(result.document.intent.terrain).toEqual({ level: "known-easy-only" });
    expect(result.document.intent.avoidHighways).toBe(true);
  });

  it("runs inner operations sequentially so a later operation sees earlier work", () => {
    const document = fixture();
    const stop = stopPoint({ label: "Chained" });
    const command: RideCommand = {
      ...base(document),
      type: "proposal.apply",
      proposalId: "prop_chain",
      operations: [
        { ...base(document), type: "stop.insert", stop },
        {
          ...base(document),
          type: "stop.move",
          stopId: stop.id,
          endpoint: { coordinate: COORD_B, provenance: MAP },
        },
      ],
    };
    const result = expectApplied(applyRideCommand(document, command));
    const moved = result.document.intent.stops[0];

    expect(result.document.revision).toBe(1);
    expect(moved?.id).toBe(stop.id);
    expect(moved?.coordinate).toEqual(COORD_B);
    expect(moved?.arrivalIntent).toBe("fuel");
  });

  it("treats re-applying the same proposal id as a no-op", () => {
    const document = fixture();
    const build = (current: RideDocument): RideCommand => ({
      ...base(current),
      type: "proposal.apply",
      proposalId: "prop_once",
      operations: [{ ...base(current), type: "roadCharacter.set", roadCharacter: "curvy" }],
    });
    const first = expectApplied(applyRideCommand(document, build(document)));
    const second = expectNoop(applyRideCommand(first.document, build(first.document)));

    expect(second.document).toBe(first.document);
  });

  it("fails the whole proposal with the inner code when an inner operation is invalid", () => {
    const document = fixture({ stops: [stopPoint()] });
    const command: RideCommand = {
      ...base(document),
      type: "proposal.apply",
      proposalId: "prop_bad",
      operations: [
        { ...base(document), type: "roadCharacter.set", roadCharacter: "curvy" },
        {
          ...base(document),
          type: "stop.move",
          stopId: newStopId(),
          endpoint: { coordinate: COORD_B, provenance: MAP },
        },
      ],
    };
    const result = expectInvalid(applyRideCommand(document, command));

    expect(result.code).toBe("unknown-stop-id");
    expect(document.intent.roadCharacter).toBe("balanced");
    expect(document.history.appliedProposalIds).toEqual([]);
  });

  it("skips inner no-ops without failing the proposal", () => {
    const surface: SurfaceIntent = {
      preference: "mixed",
      unknownSurfacePolicy: "allow-with-warning",
    };
    const document = fixture({ surface });
    const command: RideCommand = {
      ...base(document),
      type: "proposal.apply",
      proposalId: "prop_mixed",
      operations: [
        { ...base(document), type: "surface.set", surface: { ...surface } },
        { ...base(document), type: "stop.insert", stop: stopPoint() },
      ],
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.document.revision).toBe(1);
    expect(result.document.history.entries).toHaveLength(1);
    expect(result.document.intent.stops).toHaveLength(1);
  });

  it("treats a proposal with no effective change as a no-op and records no id", () => {
    const surface: SurfaceIntent = {
      preference: "mixed",
      unknownSurfacePolicy: "allow-with-warning",
    };
    const document = fixture({ surface });
    const command: RideCommand = {
      ...base(document),
      type: "proposal.apply",
      proposalId: "prop_empty",
      operations: [{ ...base(document), type: "surface.set", surface: { ...surface } }],
    };
    const result = expectNoop(applyRideCommand(document, command));

    expect(result.document).toBe(document);
    expect(result.document.history.appliedProposalIds).toEqual([]);
  });

  it("derives reroute from the inner operations", () => {
    const area = avoidArea({ name: "Old" });
    const document = fixture({ avoidAreas: [area] });
    const renameOnly: RideCommand = {
      ...base(document),
      type: "proposal.apply",
      proposalId: "prop_rename",
      operations: [
        { ...base(document), type: "avoidArea.update", areaId: area.id, name: "New" },
      ],
    };
    const withGeometry: RideCommand = {
      ...base(document),
      type: "proposal.apply",
      proposalId: "prop_geometry",
      operations: [
        { ...base(document), type: "avoidArea.update", areaId: area.id, name: "New" },
        {
          ...base(document),
          type: "avoidArea.update",
          areaId: area.id,
          geometryRef: asGeometryRef("geom_avoid_9"),
        },
      ],
    };

    expect(expectApplied(applyRideCommand(document, renameOnly)).reroute).toBe(false);
    expect(expectApplied(applyRideCommand(document, withGeometry)).reroute).toBe(true);
  });

  it("keeps only the last 20 applied proposal ids (FIFO)", () => {
    let document = fixture();
    for (let index = 1; index <= 21; index += 1) {
      const command: RideCommand = {
        ...base(document),
        type: "proposal.apply",
        proposalId: `prop_${index}`,
        operations: [
          { ...base(document), type: "stop.insert", stop: stopPoint({ label: `Stop ${index}` }) },
        ],
      };
      document = expectApplied(applyRideCommand(document, command)).document;
    }

    expect(document.revision).toBe(21);
    expect(document.intent.stops).toHaveLength(21);
    expect(document.history.appliedProposalIds).toHaveLength(20);
    expect(document.history.appliedProposalIds[0]).toBe("prop_2");
    expect(document.history.appliedProposalIds.at(-1)).toBe("prop_21");
  });
});

describe("history mechanics", () => {
  it("cuts redo history when a new edit lands after an undo", () => {
    const entryA: RideHistoryEntry = {
      entryId: newHistoryEntryId(),
      label: "A",
      revision: 1,
      intent: defaultRideIntent(),
    };
    const entryB: RideHistoryEntry = {
      entryId: newHistoryEntryId(),
      label: "B",
      revision: 2,
      intent: defaultRideIntent(),
    };
    const document = fixture(
      {},
      {
        revision: 2,
        history: {
          entries: [entryA, entryB],
          cursor: 0,
          baseIntent: defaultRideIntent(),
          appliedProposalIds: [],
        },
      },
    );
    const command: RideCommand = {
      ...base(document, { label: "C" }),
      type: "start.set",
      point: startPoint(),
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.document.history.entries.map((entry) => entry.label)).toEqual(["A", "C"]);
    expect(result.document.history.cursor).toBe(1);
    expect(result.document.history.entries.at(-1)?.revision).toBe(3);
  });

  it("does not cut redo history for a non-undoable system-location seed", () => {
    const entryA: RideHistoryEntry = {
      entryId: newHistoryEntryId(),
      label: "A",
      revision: 1,
      intent: defaultRideIntent(),
    };
    const document = fixture(
      {},
      {
        revision: 1,
        history: {
          entries: [entryA],
          cursor: 0,
          baseIntent: defaultRideIntent(),
          appliedProposalIds: [],
        },
      },
    );
    const command: RideCommand = {
      ...base(document, { source: "system-location" }),
      type: "start.set",
      point: startPoint(),
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(result.document.revision).toBe(2);
    expect(result.document.history.entries).toEqual([entryA]);
    expect(result.document.history.cursor).toBe(0);
  });
});

describe("purity and immutability", () => {
  it("never mutates the input document and freezes the result tree", () => {
    const document = fixture();
    const snapshot = structuredClone(document);
    const command: RideCommand = {
      ...base(document),
      type: "stop.insert",
      stop: stopPoint(),
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(structuredClone(document)).toEqual(snapshot);
    expect(document.revision).toBe(0);
    expect(result.document).not.toBe(document);
    expect(unfrozenNodes(result.document)).toEqual([]);
    expect(Reflect.set(result.document, "revision", 99)).toBe(false);
    expect(Reflect.set(result.document.intent.stops, "length", 0)).toBe(false);
  });

  it("deeply freezes nested collections produced by a proposal", () => {
    const document = fixture();
    const command: RideCommand = {
      ...base(document),
      type: "proposal.apply",
      proposalId: "prop_frozen",
      operations: [
        { ...base(document), type: "avoidArea.create", area: avoidArea() },
        { ...base(document), type: "roadSpan.create", span: roadSpan() },
        { ...base(document), type: "sketch.commit", sketch: sketch() },
        { ...base(document), type: "shape.insert", point: shapePoint() },
      ],
    };
    const result = expectApplied(applyRideCommand(document, command));

    expect(unfrozenNodes(result.document)).toEqual([]);
    expect(result.document.intent.avoidAreas[0]?.geometryRef).toBe("geom_avoid_1");
    expect(result.document.intent.sketch?.rawStrokeRefs).toEqual(["geom_stroke_1"]);
  });
});
