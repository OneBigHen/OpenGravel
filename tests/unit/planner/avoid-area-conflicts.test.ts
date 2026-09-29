import { describe, expect, it } from "vitest";

import { rectangleRing } from "@/application/planner/avoid-area-geometry";
import { detectAvoidAreaConflicts } from "@/application/planner/avoid-area-conflicts";
import { defaultRideIntent } from "@/domain/ride/create";
import {
  asGeometryRef,
  newAvoidAreaId,
  newPointId,
  newStopId,
  type AvoidAreaId,
} from "@/domain/ride/ids";
import type { AvoidArea, Coordinate, RideIntent, RidePoint, StopPoint } from "@/domain/ride/types";

/**
 * Endpoint-in-avoid-area conflicts (04 §18, 03 §11).
 *
 * The detector is pure and answers one question: which *required* point does an
 * enabled avoid area contain? It never moves anything and never drops anything —
 * the three explicit rider actions (move the endpoint, edit the area, remove the
 * area) are the UI's, and a silently moved point would be exactly the "silent
 * connector" 04 §18 forbids.
 */

const BASE: Coordinate = { lon: -75.44, lat: 40.14 };
const ONE_METER_LAT = 1 / 111_320;
const ONE_METER_LON = 1 / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));

/** A position `lonMeters`/`latMeters` from the fixture's base point. */
function metres(lonMeters: number, latMeters: number): Coordinate {
  return {
    lon: BASE.lon + lonMeters * ONE_METER_LON,
    lat: BASE.lat + latMeters * ONE_METER_LAT,
  };
}

/** A 200 m × 200 m area whose south-west corner is at (0, 0). */
function area(
  id: AvoidAreaId,
  options: { readonly enabled?: boolean } = {},
): AvoidArea {
  return {
    id,
    name: null,
    geometryRef: asGeometryRef(`geo_${id}`),
    enabled: options.enabled ?? true,
    createdBy: "map",
  };
}

function ringsFor(entries: readonly (readonly [AvoidAreaId, number])[]): Map<
  AvoidAreaId,
  readonly (readonly Coordinate[])[]
> {
  const map = new Map<AvoidAreaId, readonly (readonly Coordinate[])[]>();
  for (const [id, offsetMeters] of entries) {
    map.set(id, [rectangleRing(metres(offsetMeters, offsetMeters), metres(offsetMeters + 200, offsetMeters + 200))]);
  }
  return map;
}

function intentWith(
  overrides: Partial<Pick<RideIntent, "start" | "finish" | "stops" | "shaping" | "avoidAreas">>,
): RideIntent {
  return { ...defaultRideIntent(), ...overrides };
}

describe("detectAvoidAreaConflicts", () => {
  it("reports a start point inside an enabled area", () => {
    const start = newStart(metres(100, 100));
    const id = newAvoidAreaId();
    const conflicts = detectAvoidAreaConflicts({
      intent: intentWith({ start, avoidAreas: [area(id)] }),
      ringsByAreaId: ringsFor([[id, 0]]),
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      areaId: id,
      endpoint: { kind: "start", id: start.id },
    });
  });

  it("reports a finish point inside an enabled area", () => {
    const finish = newFinish(metres(50, 150));
    const id = newAvoidAreaId();
    const conflicts = detectAvoidAreaConflicts({
      intent: intentWith({ finish, avoidAreas: [area(id)] }),
      ringsByAreaId: ringsFor([[id, 0]]),
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.endpoint.kind).toBe("finish");
  });

  it("reports a stop inside an enabled area, keeping the stop's identity", () => {
    const stop = newStop(metres(10, 10));
    const id = newAvoidAreaId();
    const conflicts = detectAvoidAreaConflicts({
      intent: intentWith({ stops: [stop], avoidAreas: [area(id)] }),
      ringsByAreaId: ringsFor([[id, 0]]),
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      areaId: id,
      endpoint: { kind: "stop", id: stop.id },
    });
  });

  it("ignores a disabled area: a disabled area is not in force", () => {
    const start = newStart(metres(100, 100));
    const id = newAvoidAreaId();
    const conflicts = detectAvoidAreaConflicts({
      intent: intentWith({ start, avoidAreas: [area(id, { enabled: false })] }),
      ringsByAreaId: ringsFor([[id, 0]]),
    });

    expect(conflicts).toEqual([]);
  });

  it("reports nothing when every required point is outside every area", () => {
    const id = newAvoidAreaId();
    const conflicts = detectAvoidAreaConflicts({
      intent: intentWith({
        start: newStart(metres(-500, -500)),
        finish: newFinish(metres(-500, 300)),
        stops: [newStop(metres(-400, -400))],
        avoidAreas: [area(id)],
      }),
      ringsByAreaId: ringsFor([[id, 0]]),
    });

    expect(conflicts).toEqual([]);
  });

  it("counts a point exactly on the ring as inside (the documented on-edge rule)", () => {
    const start = newStart(metres(100, 0));
    const id = newAvoidAreaId();
    const conflicts = detectAvoidAreaConflicts({
      intent: intentWith({ start, avoidAreas: [area(id)] }),
      ringsByAreaId: ringsFor([[id, 0]]),
    });

    expect(conflicts).toHaveLength(1);
  });

  it("reports one conflict per area when two areas contain the same point", () => {
    const stop = newStop(metres(100, 100));
    const first = newAvoidAreaId();
    const second = newAvoidAreaId();
    const conflicts = detectAvoidAreaConflicts({
      intent: intentWith({ stops: [stop], avoidAreas: [area(first), area(second)] }),
      ringsByAreaId: ringsFor([
        [first, 0],
        [second, 0],
      ]),
    });

    expect(conflicts).toHaveLength(2);
    expect(conflicts.map((conflict) => conflict.areaId)).toEqual([first, second]);
  });

  it("reports one conflict per required point inside one area, in a stable order", () => {
    const start = newStart(metres(10, 10));
    const stopA = newStop(metres(20, 20));
    const stopB = newStop(metres(30, 30));
    const finish = newFinish(metres(40, 40));
    const id = newAvoidAreaId();
    const conflicts = detectAvoidAreaConflicts({
      intent: intentWith({
        start,
        finish,
        stops: [stopA, stopB],
        avoidAreas: [area(id)],
      }),
      ringsByAreaId: ringsFor([[id, 0]]),
    });

    expect(conflicts.map((conflict) => conflict.endpoint.kind)).toEqual([
      "start",
      "stop",
      "stop",
      "finish",
    ]);
    expect(conflicts.map((conflict) => conflict.endpoint.id)).toEqual([
      start.id,
      stopA.id,
      stopB.id,
      finish.id,
    ]);
  });

  it("reports nothing for an enabled area whose rings did not resolve", () => {
    const start = newStart(metres(100, 100));
    const id = newAvoidAreaId();
    const conflicts = detectAvoidAreaConflicts({
      intent: intentWith({ start, avoidAreas: [area(id)] }),
      // The handle resolves to nothing: an unresolvable area cannot be claimed to
      // contain anything, and the request builder reports the unresolved ref.
      ringsByAreaId: new Map(),
    });

    expect(conflicts).toEqual([]);
  });

  it("never treats a shaping anchor as a required point", () => {
    const id = newAvoidAreaId();
    const conflicts = detectAvoidAreaConflicts({
      intent: intentWith({
        shaping: [
          {
            id: "shape_fixture" as never,
            kind: "shape",
            coordinate: metres(100, 100),
            source: "map-drag",
          },
        ],
        avoidAreas: [area(id)],
      }),
      ringsByAreaId: ringsFor([[id, 0]]),
    });

    expect(conflicts).toEqual([]);
  });

  it("is total for a ride with no endpoints at all", () => {
    const id = newAvoidAreaId();
    expect(
      detectAvoidAreaConflicts({
        intent: intentWith({ avoidAreas: [area(id)] }),
        ringsByAreaId: ringsFor([[id, 0]]),
      }),
    ).toEqual([]);
  });
});

function newStart(coordinate: Coordinate): RidePoint {
  return {
    id: newPointId(),
    kind: "start",
    coordinate,
    provenance: { type: "map", selectedAt: "2026-09-17T00:00:00.000Z" },
  };
}

function newFinish(coordinate: Coordinate): RidePoint {
  return {
    id: newPointId(),
    kind: "finish",
    coordinate,
    provenance: { type: "map", selectedAt: "2026-09-17T00:00:00.000Z" },
  };
}

function newStop(coordinate: Coordinate): StopPoint {
  return {
    id: newStopId(),
    kind: "stop",
    coordinate,
    provenance: { type: "map", selectedAt: "2026-09-17T00:00:00.000Z" },
  };
}
