/**
 * Point conversion and stop arrival intent (03-DOMAIN-MODEL §4, §26, §27;
 * 04-PLANNER-AND-WORKSPACE-UX §15).
 *
 * 04 §15 makes "convert stop ↔ shaping point where valid" one of the actions a
 * stop supports, and §27 makes one rider action exactly one history unit. The
 * documented command set (03 §26) is a **minimum** set, so the two operations the
 * stop list needs are extensions rather than a compound of existing commands:
 *
 * - `point.convert` converts in one revision, so the pair
 *   `shape.insert` + `stop.remove` can never become two undo steps.
 * - `stop.arrivalIntent.set` edits the one field `stop.move` cannot carry
 *   (its endpoint payload is coordinate/label/provenance, not intent).
 *
 * Both are named, typed operations with their own validator, which is what 03 §26
 * requires of every command; neither is a partial-intent escape hatch.
 */

import { describe, expect, it } from "vitest";

import type { RideCommand, RideCommandResult } from "@/domain/ride/commands";
import { createRideDocument, defaultRideIntent } from "@/domain/ride/create";
import { newCommandId, newRideId, newShapingId, newStopId } from "@/domain/ride/ids";
import { applyRideCommand } from "@/domain/ride/reducer";
import type {
  Coordinate,
  LocationProvenance,
  RideDocument,
  RideIntent,
  ShapingPoint,
  StopArrivalIntent,
  StopPoint,
} from "@/domain/ride/types";
import { deepFreeze } from "@/domain/util/freeze";

const NOW = "2026-05-01T12:00:00.000Z";
const MAP: LocationProvenance = { type: "map", selectedAt: NOW };
const COORD_A: Coordinate = { lon: -76.5, lat: 40.1 };
const COORD_B: Coordinate = { lon: -76.4, lat: 40.2 };

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
    coordinate: COORD_B,
    source: "map-drag",
    ...overrides,
  };
}

function fixture(intentOverrides: Partial<RideIntent> = {}): RideDocument {
  const document = createRideDocument({ now: NOW });
  return deepFreeze<RideDocument>({
    ...document,
    intent: deepFreeze<RideIntent>({ ...defaultRideIntent(), ...intentOverrides }),
  });
}

function base(document: RideDocument) {
  return {
    commandId: newCommandId(),
    rideId: document.rideId,
    baseRevision: document.revision,
    source: "rider" as const,
    label: "Convert point",
  };
}

function expectApplied(result: RideCommandResult): Extract<
  RideCommandResult,
  { outcome: "applied" }
> {
  if (result.outcome !== "applied") {
    throw new Error(`expected applied, received ${result.outcome}`);
  }
  return result;
}

function expectInvalid(result: RideCommandResult): Extract<
  RideCommandResult,
  { outcome: "invalid" }
> {
  if (result.outcome !== "invalid") {
    throw new Error(`expected invalid, received ${result.outcome}`);
  }
  return result;
}

describe("point.convert — stop → shaping anchor", () => {
  it("converts in one revision and one history unit", () => {
    const stop = stopPoint();
    const document = fixture({ stops: [stop] });

    const command: RideCommand = {
      ...base(document),
      type: "point.convert",
      pointId: stop.id,
    };
    const applied = expectApplied(applyRideCommand(document, command, { now: NOW }));

    expect(applied.reroute).toBe(true);
    expect(applied.document.revision).toBe(document.revision + 1);
    // One rider action is one history unit (03 §27): the conversion is not two
    // commands, so it is not two undo steps.
    expect(applied.document.history.entries).toHaveLength(1);
    expect(applied.document.intent.stops).toHaveLength(0);
    const [shape] = applied.document.intent.shaping;
    expect(shape).toBeDefined();
    expect(shape?.coordinate).toEqual(COORD_A);
    expect(shape?.kind).toBe("shape");
  });

  it("carries the identity across the conversion with the shaping prefix", () => {
    const stop = stopPoint();
    const document = fixture({ stops: [stop] });

    const applied = expectApplied(
      applyRideCommand(
        document,
        { ...base(document), type: "point.convert", pointId: stop.id },
        { now: NOW },
      ),
    );

    const [shape] = applied.document.intent.shaping;
    // The converted object is the *same* object with a different brand: the UUID
    // body survives, so a rider (or a test) can trace the conversion, and the
    // branded-id prefix rule (03 §1) stays satisfied.
    expect(shape?.id).toBe(String(stop.id).replace(/^stop_/, "shape_"));
  });

  it("maps the place's provenance onto the anchor's source", () => {
    const searched = stopPoint({
      provenance: { type: "search", provider: "fixture", query: "gas" },
    });
    const imported = stopPoint({ provenance: { type: "import", sourceId: "gpx_1" } });
    const document = fixture({ stops: [searched, imported] });

    const afterSearch = expectApplied(
      applyRideCommand(
        document,
        { ...base(document), type: "point.convert", pointId: searched.id },
        { now: NOW },
      ),
    );
    const searchShape = afterSearch.document.intent.shaping.find((point) =>
      point.id.includes(String(searched.id).replace(/^stop_/, "")),
    );
    expect(searchShape?.source).toBe("search");

    const afterImport = expectApplied(
      applyRideCommand(
        document,
        { ...base(document), type: "point.convert", pointId: imported.id },
        { now: NOW },
      ),
    );
    const importShape = afterImport.document.intent.shaping.find((point) =>
      point.id.includes(String(imported.id).replace(/^stop_/, "")),
    );
    expect(importShape?.source).toBe("import");
  });

  it("rejects a point that is neither a stop nor a shaping anchor", () => {
    const document = fixture();
    const result = expectInvalid(
      applyRideCommand(
        document,
        { ...base(document), type: "point.convert", pointId: newShapingId() },
        { now: NOW },
      ),
    );

    expect(result.code).toBe("unknown-point-id");
    expect(result.message).toContain("no stop or shaping anchor");
  });
});

describe("point.convert — shaping anchor → stop", () => {
  it("converts back, appending the stop and recording a derived provenance", () => {
    const shape = shapePoint();
    const document = fixture({ shaping: [shape] });

    const applied = expectApplied(
      applyRideCommand(
        document,
        { ...base(document), type: "point.convert", pointId: shape.id },
        { now: NOW },
      ),
    );

    expect(applied.document.intent.shaping).toHaveLength(0);
    const [stop] = applied.document.intent.stops;
    expect(stop).toBeDefined();
    expect(stop?.id).toBe(String(shape.id).replace(/^shape_/, "stop_"));
    expect(stop?.coordinate).toEqual(COORD_B);
    expect(stop?.kind).toBe("stop");
    // A shaping anchor has no provenance; the honest answer is that this
    // location was derived from one, not that the rider tapped it on the map.
    expect(stop?.provenance).toEqual({
      type: "derived",
      reason: "converted from shaping anchor",
    });
    expect(applied.document.history.entries).toHaveLength(1);
  });

  it("round-trips a stop through the anchor and back to the same identity", () => {
    const stop = stopPoint();
    const document = fixture({ stops: [stop] });

    const toShape = expectApplied(
      applyRideCommand(
        document,
        { ...base(document), type: "point.convert", pointId: stop.id },
        { now: NOW },
      ),
    );
    const [shape] = toShape.document.intent.shaping;
    if (shape === undefined) throw new Error("expected a converted anchor");

    const back = expectApplied(
      applyRideCommand(
        toShape.document,
        { ...base(toShape.document), type: "point.convert", pointId: shape.id },
        { now: NOW },
      ),
    );

    const [restored] = back.document.intent.stops;
    expect(restored?.id).toBe(stop.id);
    expect(restored?.arrivalIntent).toBeUndefined();
  });

  it("refuses a conversion that would collide with an existing anchor", () => {
    const stop = stopPoint();
    const clash = shapePoint({
      id: String(stop.id).replace(/^stop_/, "shape_") as ShapingPoint["id"],
    });
    const document = fixture({ stops: [stop], shaping: [clash] });

    const result = expectInvalid(
      applyRideCommand(
        document,
        { ...base(document), type: "point.convert", pointId: stop.id },
        { now: NOW },
      ),
    );

    expect(result.code).toBe("duplicate-shape-id");
  });
});

describe("stop.arrivalIntent.set", () => {
  it("sets the intent as one history unit and requests no reroute", () => {
    const stop = stopPoint({ arrivalIntent: undefined });
    const document = fixture({ stops: [stop] });

    const applied = expectApplied(
      applyRideCommand(
        document,
        {
          ...base(document),
          type: "stop.arrivalIntent.set",
          stopId: stop.id,
          arrivalIntent: "food",
        },
        { now: NOW },
      ),
    );

    // No routing consumer reads the arrival intent yet, so this is metadata for
    // today's planner (the same honest `false` as `longTrip.set`): an
    // intent-only edit must not burn a planning round trip.
    expect(applied.reroute).toBe(false);
    expect(applied.document.intent.stops[0]?.arrivalIntent).toBe("food");
    expect(applied.document.history.entries).toHaveLength(1);
  });

  it("clears the intent without leaving an undefined field behind", () => {
    const stop = stopPoint();
    const document = fixture({ stops: [stop] });

    const applied = expectApplied(
      applyRideCommand(
        document,
        {
          ...base(document),
          type: "stop.arrivalIntent.set",
          stopId: stop.id,
          arrivalIntent: null,
        },
        { now: NOW },
      ),
    );

    const updated = applied.document.intent.stops[0];
    expect(updated).toBeDefined();
    expect(updated !== undefined && "arrivalIntent" in updated).toBe(false);
  });

  it("is a no-op when the intent does not change", () => {
    const stop = stopPoint({ arrivalIntent: "scenic" });
    const document = fixture({ stops: [stop] });

    const result = applyRideCommand(
      document,
      {
        ...base(document),
        type: "stop.arrivalIntent.set",
        stopId: stop.id,
        arrivalIntent: "scenic",
      },
      { now: NOW },
    );

    expect(result.outcome).toBe("noop");
    if (result.outcome !== "noop") throw new Error("expected noop");
    expect(result.document).toBe(document);
  });

  it("rejects an unknown stop and an unknown intent", () => {
    const stop = stopPoint();
    const document = fixture({ stops: [stop] });

    const unknownStop = expectInvalid(
      applyRideCommand(
        document,
        {
          ...base(document),
          type: "stop.arrivalIntent.set",
          stopId: newStopId(),
          arrivalIntent: "food",
        },
        { now: NOW },
      ),
    );
    expect(unknownStop.code).toBe("unknown-stop-id");

    const unknownIntent = expectInvalid(
      applyRideCommand(
        document,
        {
          ...base(document),
          type: "stop.arrivalIntent.set",
          stopId: stop.id,
          // A persisted document is untrusted input: an unknown enum value is a
          // validation failure, never a stored value.
          arrivalIntent: "banquet" as unknown as StopArrivalIntent,
        },
        { now: NOW },
      ),
    );
    expect(unknownIntent.code).toBe("invalid-arrival-intent");
  });
});

describe("point commands keep the document immutable", () => {
  it("does not leak the converted anchor into the previous revision", () => {
    const stop = stopPoint();
    const document = fixture({ stops: [stop] });
    const before = JSON.stringify(document);

    applyRideCommand(
      document,
      { ...base(document), type: "point.convert", pointId: stop.id },
      { now: NOW },
    );

    expect(JSON.stringify(document)).toBe(before);
    expect(document.intent.stops).toHaveLength(1);
  });

  it("targets the right ride", () => {
    const stop = stopPoint();
    const document = fixture({ stops: [stop] });

    const result = expectInvalid(
      applyRideCommand(document, {
        ...base(document),
        rideId: newRideId(),
        type: "point.convert",
        pointId: stop.id,
      }),
    );

    expect(result.code).toBe("ride-mismatch");
  });
});
