/**
 * Authoring a road span (04 §17, 03 §12; 02 §4, 03 §27).
 *
 * The same two-step discipline as an avoid area: the span line goes into the
 * GeometryStore, and **one** `roadSpan.create` command carries the handle the
 * store returned along with the two anchors and the direction. A command that
 * does not apply reclaims the ref this call minted, so a refused commit cannot
 * leave unreferenced bytes behind.
 */

import { describe, expect, it } from "vitest";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type { GeometryStore } from "@/application/geometry/geometry-store";
import {
  authorRoadSpan,
  flipRoadSpanModeCommand,
  removeRoadSpanCommand,
  setRoadSpanModeCommand,
} from "@/application/planner/road-span-authoring";
import { applyRideCommand } from "@/domain/ride/reducer";
import { createRideDocument } from "@/domain/ride/create";
import type { RideCommand } from "@/domain/ride/commands";
import type { Coordinate, RideDocument } from "@/domain/ride/types";

const BASE: Coordinate = { lon: -75.44, lat: 40.14 };
const ONE_METER_LAT = 1 / 111_320;
const ONE_METER_LON = 1 / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));

function metres(east: number, north: number): Coordinate {
  return {
    lon: BASE.lon + east * ONE_METER_LON,
    lat: BASE.lat + north * ONE_METER_LAT,
  };
}

const GEOMETRY: readonly Coordinate[] = [metres(0, 0), metres(200, 0), metres(400, 0)];
const ANCHORS: readonly Coordinate[] = [GEOMETRY[0]!, GEOMETRY[2]!];

function store(): GeometryStore {
  return createMemoryGeometryStore();
}

async function documentWithSpan(
  geometryStore: GeometryStore,
  mode: "must" | "prefer" | "avoid" = "must",
): Promise<{ readonly document: RideDocument; readonly spanId: string }> {
  const document = createRideDocument();
  const created = await authorRoadSpan({
    document,
    geometry: GEOMETRY,
    anchors: ANCHORS,
    direction: "forward",
    mode,
    geometryStore,
    dispatch: (command) => applyRideCommand(document, command),
  });
  if (created.outcome !== "applied") throw new Error(created.outcome);
  return { document: created.document, spanId: created.spanId };
}

describe("authorRoadSpan", () => {
  it("stores the line first and applies one roadSpan.create carrying the handle", async () => {
    const geometryStore = store();
    const document = createRideDocument();
    const commands: RideCommand[] = [];

    const result = await authorRoadSpan({
      document,
      geometry: GEOMETRY,
      anchors: ANCHORS,
      direction: "forward",
      mode: "must",
      geometryStore,
      dispatch: (command) => {
        commands.push(command);
        return applyRideCommand(document, command);
      },
    });

    expect(result.outcome).toBe("applied");
    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe("roadSpan.create");
    if (result.outcome !== "applied") return;
    const span = result.document.intent.roadSpans[0];
    expect(span?.mode).toBe("must");
    expect(span?.direction).toBe("forward");
    expect(span?.anchorRefs).toEqual(ANCHORS);
    expect(span?.geometryRef).toBe(result.geometryRef);
    const record = await geometryStore.get(result.geometryRef);
    expect(record?.payload).toEqual({ kind: "line", coordinates: GEOMETRY });
    expect(record?.kind).toBe("road-span");
  });

  it("refuses an unusable geometry before writing anything", async () => {
    const geometryStore = store();
    const document = createRideDocument();
    const result = await authorRoadSpan({
      document,
      geometry: [{ lon: BASE.lon, lat: BASE.lat }],
      anchors: ANCHORS,
      direction: "forward",
      mode: "must",
      geometryStore,
      dispatch: (command) => applyRideCommand(document, command),
    });
    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected") return;
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("refuses anchors that are not usable coordinates", async () => {
    const geometryStore = store();
    const document = createRideDocument();
    const result = await authorRoadSpan({
      document,
      geometry: GEOMETRY,
      anchors: [ANCHORS[0]!, { lon: Number.NaN, lat: 40 }],
      direction: "forward",
      mode: "must",
      geometryStore,
      dispatch: (command) => applyRideCommand(document, command),
    });
    expect(result.outcome).toBe("rejected");
  });

  it("reclaims the ref it minted when the command does not apply", async () => {
    const geometryStore = store();
    const document = createRideDocument();
    let minted: string | null = null;
    const result = await authorRoadSpan({
      document,
      geometry: GEOMETRY,
      anchors: ANCHORS,
      direction: "forward",
      mode: "must",
      geometryStore,
      dispatch: (command) => {
        if (command.type === "roadSpan.create") minted = command.span.geometryRef;
        // A stale document is the realistic refusal: the revision moved on.
        return { outcome: "stale", currentRevision: document.revision + 1 };
      },
    });
    expect(result.outcome).toBe("stale");
    expect(minted).not.toBeNull();
    expect(await geometryStore.has(minted as never)).toBe(false);
  });

  it("labels the history entry by mode so undo reads as what it removes", async () => {
    const geometryStore = store();
    const document = createRideDocument();
    const labels: string[] = [];
    await authorRoadSpan({
      document,
      geometry: GEOMETRY,
      anchors: ANCHORS,
      direction: "reverse",
      mode: "avoid",
      geometryStore,
      dispatch: (command) => {
        labels.push(command.label);
        return applyRideCommand(document, command);
      },
    });
    expect(labels).toEqual(["Avoided this road"]);
  });
});

describe("flipRoadSpanModeCommand", () => {
  it("flips Keep to Prefer and Prefer back to Keep", async () => {
    const geometryStore = store();
    const { document, spanId } = await documentWithSpan(geometryStore, "must");
    const toPrefer = flipRoadSpanModeCommand(document, spanId as never);
    expect(toPrefer?.mode).toBe("prefer");
    const applied = applyRideCommand(document, toPrefer!);
    if (applied.outcome !== "applied") throw new Error(applied.outcome);
    expect(flipRoadSpanModeCommand(applied.document, spanId as never)?.mode).toBe("must");
  });

  it("has no flip for an avoid span: Avoid is not a softer Keep", async () => {
    const geometryStore = store();
    const { document, spanId } = await documentWithSpan(geometryStore, "avoid");
    expect(flipRoadSpanModeCommand(document, spanId as never)).toBeNull();
  });

  it("has no flip for a span the document does not hold", async () => {
    const geometryStore = store();
    const { document } = await documentWithSpan(geometryStore, "must");
    expect(flipRoadSpanModeCommand(document, "span_missing" as never)).toBeNull();
  });

  it("sets an explicit mode for the three action-bar actions", async () => {
    const geometryStore = store();
    const { document, spanId } = await documentWithSpan(geometryStore, "prefer");
    const command = setRoadSpanModeCommand(document, spanId as never, "must");
    expect(command.type).toBe("roadSpan.update");
    expect(command.mode).toBe("must");
  });

  it("removes a span by identity", async () => {
    const geometryStore = store();
    const { document, spanId } = await documentWithSpan(geometryStore, "must");
    const command = removeRoadSpanCommand(document, spanId as never);
    expect(command.type).toBe("roadSpan.remove");
    expect(command.spanId).toBe(spanId);
  });
});
