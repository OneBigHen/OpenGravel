import { describe, expect, it, vi } from "vitest";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type { GeometryStore } from "@/application/geometry/geometry-store";
import {
  authorSketch,
  clearSketchCommand,
  SKETCH_CLEAR_LABEL,
  SKETCH_COMMIT_LABEL,
} from "@/application/planner/sketch-authoring";
import { buildSketchCorridor } from "@/application/planner/sketch-corridor";
import { applyRideCommand } from "@/domain/ride/reducer";
import { createRideDocument } from "@/domain/ride/create";
import { newCommandId, type GeometryRef } from "@/domain/ride/ids";
import type { RideCommand, RideCommandResult } from "@/domain/ride/commands";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import { MAX_SKETCH_STROKES } from "@/domain/sketch/types";

/**
 * Committing a sketch (03 §27, 04 §19/§20, 06 §18; Task 4.4).
 *
 * The command is the domain's only mutation entry, and the geometry store mints
 * the handles, so the two things every test here checks are: exactly one command
 * per commit, and no payload left behind when the command does not apply.
 */

const ORIGIN: Coordinate = { lon: -75.44, lat: 40.14 };
const METERS_PER_DEGREE_LAT = 111_320;
const METERS_PER_DEGREE_LON = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

function at(east: number, north: number): Coordinate {
  return {
    lon: ORIGIN.lon + east / METERS_PER_DEGREE_LON,
    lat: ORIGIN.lat + north / METERS_PER_DEGREE_LAT,
  };
}

function line(
  fromEast: number,
  fromNorth: number,
  toEast: number,
  toNorth: number,
): Coordinate[] {
  const steps = 8;
  const points: Coordinate[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    points.push(
      at(
        fromEast + (toEast - fromEast) * ratio,
        fromNorth + (toNorth - fromNorth) * ratio,
      ),
    );
  }
  return points;
}

/** A records-and-forwards dispatch, so a test can see the one command. */
function recorder(document: RideDocument): {
  readonly dispatch: (command: RideCommand) => RideCommandResult;
  readonly commands: RideCommand[];
} {
  const commands: RideCommand[] = [];
  return {
    commands,
    dispatch: (command: RideCommand): RideCommandResult => {
      commands.push(command);
      return applyRideCommand(document, command);
    },
  };
}

/** A store that remembers every write and removal. */
function watchedStore(): {
  readonly store: GeometryStore;
  readonly puts: GeometryRef[];
  readonly removes: GeometryRef[];
} {
  const inner = createMemoryGeometryStore();
  const puts: GeometryRef[] = [];
  const removes: GeometryRef[] = [];
  return {
    puts,
    removes,
    store: {
      put: async (payload, options) => {
        const record = await inner.put(payload, options);
        puts.push(record.geometryRef);
        return record;
      },
      get: (ref) => inner.get(ref),
      has: (ref) => inner.has(ref),
      remove: async (ref) => {
        removes.push(ref);
        await inner.remove(ref);
      },
    },
  };
}

describe("authorSketch", () => {
  it("commits one sketch command carrying the trace, corridor and hints", async () => {
    const document = createRideDocument();
    const { dispatch, commands } = recorder(document);
    const { store } = watchedStore();
    const strokes = [line(0, 0, 300, 0), line(150, -100, 150, 100)];

    const result = await authorSketch({
      document,
      strokes,
      endpointPolicy: "derive",
      geometryStore: store,
      dispatch,
    });

    expect(result.outcome).toBe("applied");
    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command?.type).toBe("sketch.commit");
    expect(command?.label).toBe(SKETCH_COMMIT_LABEL);
    expect(command?.type === "sketch.commit" && command.sketch.rawStrokeRefs).toHaveLength(2);
    if (command?.type !== "sketch.commit") throw new Error("expected a sketch commit");
    expect(command.sketch.endpointPolicy).toBe("derive");
    expect(
      command.sketch.topologyHints.some((hint) => hint.kind === "crossing"),
    ).toBe(true);

    // The committed references resolve to what was drawn.
    const corridor = await store.get(command.sketch.corridorRef);
    expect(corridor?.kind).toBe("sketch-corridor");
    const expected = buildSketchCorridor(strokes);
    expect(corridor?.kind === "sketch-corridor" && corridor.payload.kind === "line"
      ? corridor.payload.coordinates
      : null).toEqual(expected.corridor);
    for (const [index, ref] of command.sketch.rawStrokeRefs.entries()) {
      const record = await store.get(ref);
      expect(record?.kind).toBe("sketch-stroke");
      expect(
        record?.payload.kind === "line" ? record.payload.coordinates : null,
      ).toEqual(strokes[index]);
    }
  });

  it("carries the endpoint policy unchanged", async () => {
    const document = createRideDocument();
    const { dispatch, commands } = recorder(document);
    const { store } = watchedStore();

    await authorSketch({
      document,
      strokes: [line(0, 0, 200, 0)],
      endpointPolicy: "preserve-existing",
      geometryStore: store,
      dispatch,
    });

    const command = commands[0];
    if (command?.type !== "sketch.commit") throw new Error("expected a sketch commit");
    expect(command.sketch.endpointPolicy).toBe("preserve-existing");
  });

  it("refuses a trace that is not a corridor, and writes nothing", async () => {
    const document = createRideDocument();
    const { dispatch, commands } = recorder(document);
    const { store, puts } = watchedStore();

    const result = await authorSketch({
      document,
      strokes: [[at(0, 0)]],
      endpointPolicy: "derive",
      geometryStore: store,
      dispatch,
    });

    expect(result.outcome).toBe("rejected");
    expect(commands).toHaveLength(0);
    expect(puts).toHaveLength(0);
  });

  it("refuses an unbounded number of strokes", async () => {
    const document = createRideDocument();
    const { dispatch, commands } = recorder(document);
    const { store } = watchedStore();
    const strokes = Array.from({ length: MAX_SKETCH_STROKES + 1 }, (_value, index) =>
      line(index * 200, 0, index * 200 + 100, 0),
    );

    const result = await authorSketch({
      document,
      strokes,
      endpointPolicy: "derive",
      geometryStore: store,
      dispatch,
    });

    expect(result.outcome).toBe("rejected");
    expect(commands).toHaveLength(0);
  });

  it("reclaims every payload it wrote when the command does not apply", async () => {
    const document = createRideDocument();
    const { store, puts, removes } = watchedStore();
    const dispatch = vi.fn(
      (): RideCommandResult => ({ outcome: "stale", currentRevision: 7 }),
    );

    const result = await authorSketch({
      document,
      strokes: [line(0, 0, 300, 0), line(320, 0, 620, 0)],
      endpointPolicy: "derive",
      geometryStore: store,
      dispatch,
    });

    expect(result.outcome).toBe("stale");
    expect(dispatch).toHaveBeenCalledTimes(1);
    // Three payloads (two strokes and the corridor), all reclaimed.
    expect(puts).toHaveLength(3);
    expect(removes.sort()).toEqual([...puts].sort());
  });

  it("reports an invalid command without leaving bytes behind", async () => {
    const document = createRideDocument();
    const { store, puts, removes } = watchedStore();
    const dispatch = vi.fn(
      (): RideCommandResult => ({
        outcome: "invalid",
        code: "ride-mismatch",
        message: "nope",
      }),
    );

    const result = await authorSketch({
      document,
      strokes: [line(0, 0, 300, 0)],
      endpointPolicy: "derive",
      geometryStore: store,
      dispatch,
    });

    expect(result.outcome).toBe("invalid");
    expect(removes.sort()).toEqual([...puts].sort());
  });
});

describe("clearSketchCommand", () => {
  it("is one command, and the reducer clears the sketch", () => {
    const document = createRideDocument();
    const command = clearSketchCommand(document);

    expect(command.type).toBe("sketch.clear");
    expect(command.label).toBe(SKETCH_CLEAR_LABEL);
    expect(command.baseRevision).toBe(document.revision);

    const sketch = {
      id: "sketch_1" as never,
      rawStrokeRefs: ["geo_stroke_1" as never],
      corridorRef: "geo_corridor_1" as never,
      topologyHints: [],
      endpointPolicy: "derive" as const,
    };
    const committed = applyRideCommand(document, {
      commandId: newCommandId(),
      rideId: document.rideId,
      baseRevision: document.revision,
      source: "drawing",
      label: SKETCH_COMMIT_LABEL,
      type: "sketch.commit",
      sketch,
    });
    if (committed.outcome !== "applied") throw new Error("fixture sketch did not apply");

    const cleared = applyRideCommand(committed.document, clearSketchCommand(committed.document));
    expect(cleared.outcome).toBe("applied");
    expect(cleared.outcome === "applied" && cleared.document.intent.sketch).toBeNull();
  });
});
