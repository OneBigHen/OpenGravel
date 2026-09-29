/**
 * Drawing through the workspace's real seams (04-PLANNER-AND-WORKSPACE-UX §19/§20,
 * 05-MAP-INTERACTION-AND-CARTOGRAPHY §4/§18, 03-DOMAIN-MODEL §27; Task 4.4).
 *
 * The claims that need the workspace rather than a unit:
 *
 * - **A stroke is local.** A press, N moves and a release produce one stroke and
 *   dispatch **nothing**: no command reaches the document and no payload reaches
 *   the geometry store, which is what 05 §18 means by "pointer move: local visual
 *   update only".
 * - **Escape cancels the current stroke and keeps the ones already drawn** (04 §19),
 *   while the pen stays armed.
 * - **Done is exactly one command and one undo unit**, and after it the map draws a
 *   faint committed sketch instead of the draft.
 * - **A refused commit keeps the drawing editable** (04 §19).
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { MapIntent } from "@/application/map/types";
import type { ClientPlanningBeginInput } from "@/application/planner/client-planning-service";
import { EMPTY_SKETCH_DRAFT } from "@/application/planner/sketch-draft";
import { SKETCH_PREVIEW_SETTLE_MS } from "@/application/planner/sketch-preview";
import { emptyRouteRoles, type PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { RideCommand, RideCommandResult } from "@/domain/ride/commands";
import { newRideId } from "@/domain/ride/ids";
import type { Coordinate } from "@/domain/ride/types";
import { PlannerWorkspace } from "@/ui/planner/PlannerWorkspace";
import { createPlannerUiStore } from "@/ui/stores/planner-ui-store";
import { createRideDocumentStore } from "@/ui/stores/ride-document-store";
import type { PlanningSessionState, PlanningSessionStore } from "@/ui/stores/planning-session-store";

import { createStubMapHostFactory, type StubMapHost, type StubMapHostFactory } from "../support/stub-map-host";

const FIXED = "2026-09-17T00:00:00.000Z";
const now = (): string => FIXED;
const MAP_SIZE = 1000;

const BASE: Coordinate = { lon: -75.44, lat: 40.14 };
const ONE_METER_LAT = 1 / 111_320;
const ONE_METER_LON = 1 / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));

function metres(east: number, north: number): Coordinate {
  return {
    lon: BASE.lon + east * ONE_METER_LON,
    lat: BASE.lat + north * ONE_METER_LAT,
  };
}

/** An idle session: nothing planned yet, nothing drawn. */
function idleSession(): {
  readonly store: PlanningSessionStore;
  readonly begins: number[];
  readonly inputs: ClientPlanningBeginInput[];
} {
  const begins: number[] = [];
  const inputs: ClientPlanningBeginInput[] = [];
  const state: PlanningSessionState = {
    snapshot: null as unknown as PlanningSessionSnapshot,
    geometry: {},
    begin: async (input): Promise<void> => {
      begins.push(input.rideRevision);
      inputs.push(input);
    },
    cancel: (): void => undefined,
    selectRoute: (): void => undefined,
  };
  const rideId = newRideId();
  const snapshot: PlanningSessionSnapshot = {
    identity: { rideId, rideRevision: 0, planningGeneration: 0 },
    phase: "idle",
    lastGoodBundle: null,
    committedBundle: null,
    selectionSource: "automatic",
    selectedRouteId: null,
    error: null,
    diagnostics: [],
    startedAt: FIXED,
    settledAt: null,
  };
  const live: PlanningSessionState = { ...state, snapshot };
  return {
    begins,
    inputs,
    store: {
      getState: (): PlanningSessionState => live,
      getInitialState: (): PlanningSessionState => live,
      subscribe: (): (() => void) => (): void => undefined,
    },
  };
}

function mockMapViewport(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element): DOMRect {
      void this;
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: MAP_SIZE,
        bottom: MAP_SIZE,
        width: MAP_SIZE,
        height: MAP_SIZE,
        toJSON: (): Record<string, never> => ({}),
      } as DOMRect;
    },
  );
}

interface RenderedWorkspace {
  readonly rideDocumentStore: ReturnType<typeof createRideDocumentStore>;
  readonly plannerUiStore: ReturnType<typeof createPlannerUiStore>;
  readonly geometryStore: GeometryStore;
  readonly mapFactory: StubMapHostFactory;
  readonly session: ReturnType<typeof idleSession>;
  /** Every command the workspace dispatched, in order. */
  readonly commands: readonly RideCommand[];
  /** Makes the next dispatch answer with `result` instead of applying it. */
  readonly refuseNext: (result: RideCommandResult) => void;
  readonly host: () => StubMapHost;
  readonly emit: (intent: MapIntent) => void;
}

function watchedDocumentStore(): {
  readonly store: ReturnType<typeof createRideDocumentStore>;
  readonly commands: RideCommand[];
  /** Makes the next dispatch answer with `result` instead of applying it. */
  readonly refuseNext: (result: RideCommandResult) => void;
} {
  const store = createRideDocumentStore({ now });
  const commands: RideCommand[] = [];
  let forced: RideCommandResult | null = null;
  const realGetState = store.getState;
  const wrapped: typeof store = {
    ...store,
    getState: (): ReturnType<typeof realGetState> => {
      const state = realGetState();
      return {
        ...state,
        dispatch: (command: RideCommand): RideCommandResult => {
          commands.push(command);
          if (forced !== null) {
            const answer = forced;
            forced = null;
            return answer;
          }
          return state.dispatch(command);
        },
      };
    },
  };
  return {
    store: wrapped,
    commands,
    refuseNext: (result: RideCommandResult): void => {
      forced = result;
    },
  };
}

async function renderWorkspace(): Promise<RenderedWorkspace> {
  mockMapViewport();
  const geometryStore = createMemoryGeometryStore();
  const watched = watchedDocumentStore();
  const session = idleSession();
  const plannerUiStore = createPlannerUiStore();
  const mapFactory = createStubMapHostFactory();

  render(
    <PlannerWorkspace
      rideDocumentStore={watched.store}
      planningSessionStore={session.store}
      plannerUiStore={plannerUiStore}
      geometryStore={geometryStore}
      mapHostFactory={mapFactory.factory}
    />,
  );
  // The shaping tools live behind the "Refine route" disclosure.
  fireEvent.click(screen.getByTestId("refine-toggle"));
  await Promise.resolve();
  await Promise.resolve();
  await waitFor(() => expect(mapFactory.hosts).toHaveLength(1));

  return {
    rideDocumentStore: watched.store,
    plannerUiStore,
    geometryStore,
    mapFactory,
    session,
    commands: watched.commands,
    refuseNext: watched.refuseNext,
    host: (): StubMapHost => {
      const first = mapFactory.hosts[0];
      if (first === undefined) throw new Error("the workspace has no map host");
      return first;
    },
    emit: (intent: MapIntent): void => {
      act(() => {
        mapFactory.hosts[0]?.emit(intent);
      });
    },
  };
}

/** Arms the pen and draws one stroke from a list of positions. */
function drawStroke(
  workspace: RenderedWorkspace,
  points: readonly Coordinate[],
  pointerId = 1,
): void {
  const first = points[0];
  if (first === undefined) throw new Error("a stroke needs at least one point");
  workspace.emit({ type: "pointer-down", pointerId, coordinate: first, ref: null });
  for (const point of points.slice(1)) {
    workspace.emit({ type: "pointer-move", pointerId, coordinate: point });
  }
  const last = points[points.length - 1] as Coordinate;
  workspace.emit({ type: "pointer-up", pointerId, coordinate: last });
}

function revisionOf(workspace: RenderedWorkspace): number {
  return workspace.rideDocumentStore.getState().document.revision;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the drawing tool", () => {
  it("turns a press, moves and a release into exactly one stroke, dispatching nothing", async () => {
    const workspace = await renderWorkspace();
    const puts = vi.spyOn(workspace.geometryStore, "put");

    fireEvent.click(screen.getByTestId("start-drawing"));
    expect(workspace.plannerUiStore.getState().activeTool).toBe("sketch");

    const before = revisionOf(workspace);
    const commandsBefore = workspace.commands.length;
    drawStroke(workspace, [metres(0, 0), metres(100, 40), metres(200, 0), metres(300, 80)]);

    const draft = workspace.plannerUiStore.getState().sketchDraft;
    expect(draft.strokes).toHaveLength(1);
    expect(draft.strokes[0]).toHaveLength(4);
    expect(draft.active).toBeNull();

    // 05 §18: a pointer move updates the canvas, never the store and never the
    // network. The document did not move, no command was dispatched, and no
    // geometry payload was written.
    expect(revisionOf(workspace)).toBe(before);
    expect(workspace.commands).toHaveLength(commandsBefore);
    expect(puts).not.toHaveBeenCalled();

    // What the rider drew is what the map is handed.
    const scene = workspace.host().lastScene();
    expect(scene?.sketchDraft?.strokes).toHaveLength(1);
    expect(scene?.sketchDraft?.active).toBeNull();
    expect(scene?.sketch).toBeNull();
  });

  it("drops a tap and keeps the strokes already drawn", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("start-drawing"));

    drawStroke(workspace, [metres(0, 0), metres(200, 0)]);
    // A press and release in the same place: not a stroke.
    drawStroke(workspace, [metres(400, 0)], 2);

    expect(workspace.plannerUiStore.getState().sketchDraft.strokes).toHaveLength(1);
  });

  it("Escape cancels the current stroke and keeps the pen armed", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("start-drawing"));
    drawStroke(workspace, [metres(0, 0), metres(200, 0)]);

    // A second stroke in flight.
    workspace.emit({
      type: "pointer-down",
      pointerId: 2,
      coordinate: metres(0, 200),
      ref: null,
    });
    workspace.emit({ type: "pointer-move", pointerId: 2, coordinate: metres(200, 200) });
    expect(workspace.plannerUiStore.getState().sketchDraft.active).toHaveLength(2);

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    const draft = workspace.plannerUiStore.getState().sketchDraft;
    expect(draft.strokes).toHaveLength(1);
    expect(draft.active).toBeNull();
    expect(workspace.plannerUiStore.getState().activeTool).toBe("sketch");
  });

  it("Undo removes the last stroke, Redo restores it, Clear empties the surface", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("start-drawing"));
    drawStroke(workspace, [metres(0, 0), metres(200, 0)]);
    drawStroke(workspace, [metres(0, 200), metres(200, 200)], 2);

    fireEvent.click(screen.getByTestId("sketch-undo"));
    expect(workspace.plannerUiStore.getState().sketchDraft.strokes).toHaveLength(1);
    fireEvent.click(screen.getByTestId("sketch-redo"));
    expect(workspace.plannerUiStore.getState().sketchDraft.strokes).toHaveLength(2);

    fireEvent.click(screen.getByTestId("sketch-clear"));
    expect(workspace.plannerUiStore.getState().sketchDraft).toEqual(EMPTY_SKETCH_DRAFT);
  });

  it("Done commits one sketch and plans once", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("start-drawing"));
    drawStroke(workspace, [metres(0, 0), metres(300, 100)]);
    drawStroke(workspace, [metres(150, -100), metres(150, 200)], 2);

    const commandsBefore = workspace.commands.length;
    await act(async () => {
      fireEvent.click(screen.getByTestId("sketch-done"));
      await Promise.resolve();
      await Promise.resolve();
    });

    const sketchCommands = workspace.commands
      .slice(commandsBefore)
      .filter((command) => command.type === "sketch.commit");
    expect(sketchCommands).toHaveLength(1);
    const document = workspace.rideDocumentStore.getState().document;
    expect(document.intent.sketch).not.toBeNull();
    expect(document.history.entries).toHaveLength(1);
    expect(document.history.entries[0]?.label).toBe("Drew route");
    expect(document.intent.sketch?.rawStrokeRefs).toHaveLength(2);
    // The pen retires and the draft is gone: the authored sketch is what is drawn
    // now, faintly, and the corridor resolves from the store the commit wrote to.
    expect(workspace.plannerUiStore.getState().activeTool).toBe("pan");
    expect(workspace.plannerUiStore.getState().sketchDraft).toEqual(EMPTY_SKETCH_DRAFT);
    const corridorRef = document.intent.sketch?.corridorRef;
    expect(corridorRef).toBeDefined();
    await expect(workspace.geometryStore.get(corridorRef as never)).resolves.not.toBeNull();
    expect(workspace.host().lastScene()?.sketchDraft).toBeNull();

    // Done asked for exactly one plan, against the revision the commit produced.
    expect(workspace.session.begins).toEqual([document.revision]);
  });

  it("is one undo unit: undoing the sketch removes the whole drawing", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("start-drawing"));
    drawStroke(workspace, [metres(0, 0), metres(300, 100)]);
    drawStroke(workspace, [metres(150, -100), metres(150, 200)], 2);

    await act(async () => {
      fireEvent.click(screen.getByTestId("sketch-done"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(workspace.rideDocumentStore.getState().document.intent.sketch).not.toBeNull();

    fireEvent.click(screen.getByTestId("undo"));
    const document = workspace.rideDocumentStore.getState().document;
    expect(document.intent.sketch).toBeNull();
    expect(document.history.cursor).toBe(-1);
  });

  it("keeps the drawing editable when the commit is refused", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("start-drawing"));
    drawStroke(workspace, [metres(0, 0), metres(300, 100)]);

    // A stale document: the commit cannot apply, and the draft must survive it.
    workspace.refuseNext({ outcome: "stale", currentRevision: 99 });

    await act(async () => {
      fireEvent.click(screen.getByTestId("sketch-done"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("sketch-error").textContent).toContain("revision 99");
    expect(workspace.plannerUiStore.getState().sketchDraft.strokes).toHaveLength(1);
  });

  it("offers the endpoint toggle only when the ride has an endpoint to keep", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("start-drawing"));

    // A fresh ride has nothing to keep: the toggle is absent, and the policy is
    // the derive the drawing needs.
    expect(screen.queryByTestId("sketch-keep-endpoints")).toBeNull();
    expect(workspace.plannerUiStore.getState().sketchEndpointPolicy).toBe("derive");
  });
});

describe("snap-as-you-go and extending a drawing (OGV-D-285)", () => {
  const settle = { timeout: SKETCH_PREVIEW_SETTLE_MS + 1_500 };

  it("plans the drawing so far when the finger lifts and rests, authoring nothing", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("start-drawing"));
    const commandsBefore = workspace.commands.length;
    drawStroke(workspace, [metres(0, 0), metres(300, 100), metres(600, 0)]);

    await waitFor(() => expect(workspace.session.inputs).toHaveLength(1), settle);
    const planned = workspace.session.inputs[0]!;
    expect(planned.intent.sketch?.rawStrokeRefs).toHaveLength(1);
    expect(planned.rideRevision).toBe(revisionOf(workspace));
    // Nothing was authored: the ride holds no sketch and no command was sent.
    expect(workspace.rideDocumentStore.getState().document.intent.sketch).toBeNull();
    expect(workspace.commands).toHaveLength(commandsBefore);
    expect(workspace.plannerUiStore.getState().sketchPreviewGenerations).toHaveLength(1);
    expect(workspace.plannerUiStore.getState().activeTool).toBe("sketch");
  });

  it("does not plan while a stroke is still under the finger", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("start-drawing"));
    workspace.emit({ type: "pointer-down", pointerId: 1, coordinate: metres(0, 0), ref: null });
    workspace.emit({ type: "pointer-move", pointerId: 1, coordinate: metres(300, 0) });
    await new Promise((resolve) => setTimeout(resolve, SKETCH_PREVIEW_SETTLE_MS + 300));
    expect(workspace.session.inputs).toHaveLength(0);
  });

  it("Cancel removes the preview's payloads and asks for nothing on an empty ride", async () => {
    const workspace = await renderWorkspace();
    const removed = vi.spyOn(workspace.geometryStore, "remove");
    fireEvent.click(screen.getByTestId("start-drawing"));
    drawStroke(workspace, [metres(0, 0), metres(300, 100)]);
    await waitFor(() => expect(workspace.session.inputs).toHaveLength(1), settle);

    fireEvent.click(screen.getByTestId("sketch-cancel"));
    const preview = workspace.session.inputs[0]!.intent.sketch!;
    expect(removed.mock.calls.map(([ref]) => ref).sort()).toEqual(
      [...preview.rawStrokeRefs, preview.corridorRef].sort(),
    );
    // A fresh ride has nothing of its own to plan, so no second begin.
    expect(workspace.session.inputs).toHaveLength(1);
  });

  it("Extend re-opens the committed drawing so the next stroke carries on from its end", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("start-drawing"));
    drawStroke(workspace, [metres(0, 0), metres(300, 100)]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("sketch-done"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(workspace.plannerUiStore.getState().activeTool).toBe("pan");

    await act(async () => {
      fireEvent.click(screen.getByTestId("sketch-extend"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(workspace.plannerUiStore.getState().activeTool).toBe("sketch"));
    const reopened = workspace.plannerUiStore.getState().sketchDraft;
    expect(reopened.strokes).toHaveLength(1);
    expect(reopened.strokes[0]?.[0]).toEqual(metres(0, 0));

    // A stroke from the old end joins the drawing; Done commits both as one.
    drawStroke(workspace, [metres(300, 100), metres(600, 0)], 3);
    await act(async () => {
      fireEvent.click(screen.getByTestId("sketch-done"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(workspace.rideDocumentStore.getState().document.intent.sketch?.rawStrokeRefs).toHaveLength(2);
  });
});

describe("drawing a ride that already has endpoints", () => {
  it("defaults to keeping them", async () => {
    const workspace = await renderWorkspace();
    const document = workspace.rideDocumentStore.getState().document;
    act(() => {
      workspace.rideDocumentStore.getState().dispatch({
        commandId: "cmd_start" as never,
        rideId: document.rideId,
        baseRevision: document.revision,
        source: "map",
        label: "Moved start",
        type: "start.set",
        point: {
          id: "pt_start" as never,
          kind: "start",
          coordinate: metres(0, 0),
          provenance: { type: "map", selectedAt: FIXED },
        },
      });
    });
    expect(workspace.rideDocumentStore.getState().document.intent.start).not.toBeNull();

    fireEvent.click(screen.getByTestId("start-drawing"));
    expect(screen.getByTestId("sketch-keep-endpoints")).toBeInTheDocument();
    expect(workspace.plannerUiStore.getState().sketchEndpointPolicy).toBe(
      "preserve-existing",
    );

    fireEvent.click(screen.getByTestId("sketch-keep-endpoints"));
    expect(workspace.plannerUiStore.getState().sketchEndpointPolicy).toBe("derive");
  });
});

describe("the empty ride", () => {
  it("does not claim a sketch it does not have", async () => {
    const workspace = await renderWorkspace();
    expect(workspace.rideDocumentStore.getState().document.intent.sketch).toBeNull();
    expect(workspace.host().lastScene()?.sketch).toBeNull();
    expect(workspace.host().lastScene()?.sketchDraft).toBeNull();
    expect(emptyRouteRoles()).toBeDefined();
  });
});
