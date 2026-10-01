import { readFileSync } from "node:fs";
import path from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type { GeometryStore } from "@/application/geometry/geometry-store";
import { VERTEX_HANDLE_HIT_RADIUS_METERS } from "@/application/planner/avoid-area-geometry";
import { createClientPlanningService } from "@/application/planner/client-planning-service";
import type { MapIntent } from "@/application/map/types";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { GeometryRef } from "@/domain/ride/ids";
import { PlannerWorkspace } from "@/ui/planner/PlannerWorkspace";
import { createPlannerUiStore } from "@/ui/stores/planner-ui-store";
import { createPlanningSessionStore } from "@/ui/stores/planning-session-store";
import { createRideDocumentStore } from "@/ui/stores/ride-document-store";

import { createStubMapHostFactory, type StubMapHost, type StubMapHostFactory } from "../support/stub-map-host";

/**
 * Authoring, editing and conflict handling for avoid areas, driven through the
 * workspace's real seams (04-PLANNER-AND-WORKSPACE-UX §18, §20, §31;
 * 05-MAP-INTERACTION-AND-CARTOGRAPHY §4, §21; 03-DOMAIN-MODEL §11, §27).
 *
 * Three claims need the workspace rather than a unit:
 *
 * - **One gesture, one command, one undo unit.** The rectangle drag's preview is
 *   presentation until the machine commits the gesture, and the commit is exactly
 *   one `avoidArea.create` — which is only observable where the pointer stream, the
 *   UI store and the document store meet.
 * - **The geometry store is written before the command, and never orphaned.** The
 *   handle the document keeps must resolve in the store the workspace wrote to.
 * - **A conflict is surfaced, never resolved by the app.** The panel's three
 *   actions are intents the workspace arms or dispatches; nothing here moves a
 *   point on its own.
 */

const FIXED = "2026-09-17T00:00:00.000Z";
const now = (): string => FIXED;
const MAP_SIZE = 1000;

/** The area the tests draw, and the start they place inside it. */
const START = { lon: -75.2022, lat: 39.9478 };
const RECT_SW = { lon: -75.204, lat: 39.946 };
const RECT_NE = { lon: -75.2004, lat: 39.9496 };
const POLYGON_CORNERS = [
  { lon: -75.204, lat: 39.946 },
  { lon: -75.2, lat: 39.946 },
  { lon: -75.202, lat: 39.9496 },
];

function neverFetch(): typeof fetch {
  return (async (): Promise<Response> => {
    throw new Error("these tests do not plan");
  }) as typeof fetch;
}

interface RenderedAvoidAreaWorkspace {
  readonly rideDocumentStore: ReturnType<typeof createRideDocumentStore>;
  readonly plannerUiStore: ReturnType<typeof createPlannerUiStore>;
  readonly geometryStore: GeometryStore;
  readonly mapFactory: StubMapHostFactory;
  readonly host: () => StubMapHost;
  readonly emit: (intent: MapIntent) => void;
}

async function flushHostSubscription(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** JSdom has no layout, so every rect is a real viewport-sized box. */
function mockMapViewport(headHeight = MAP_SIZE): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element): DOMRect {
      const height = this.getAttribute("data-testid") === "sheet-head" ? headHeight : MAP_SIZE;
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: MAP_SIZE,
        bottom: height,
        width: MAP_SIZE,
        height,
        toJSON: (): Record<string, never> => ({}),
      } as DOMRect;
    },
  );
}

async function renderWorkspace(): Promise<RenderedAvoidAreaWorkspace> {
  mockMapViewport();
  const geometryStore = createMemoryGeometryStore();
  const rideDocumentStore = createRideDocumentStore({ now });
  const planningSessionStore = createPlanningSessionStore({
    service: createClientPlanningService({ fetcher: neverFetch(), now, geometryStore }),
  });
  const plannerUiStore = createPlannerUiStore();
  const mapFactory = createStubMapHostFactory();

  render(
    <PlannerWorkspace
      rideDocumentStore={rideDocumentStore}
      planningSessionStore={planningSessionStore}
      plannerUiStore={plannerUiStore}
      geometryStore={geometryStore}
      mapHostFactory={mapFactory.factory}
    />,
  );
  // The shaping tools live behind the "Refine route" disclosure.
  fireEvent.click(screen.getByTestId("refine-toggle"));
  await flushHostSubscription();

  const host = (): StubMapHost => {
    const first = mapFactory.hosts[0];
    if (first === undefined) throw new Error("the workspace has no map host");
    return first;
  };

  return {
    rideDocumentStore,
    plannerUiStore,
    geometryStore,
    mapFactory,
    host,
    emit: (intent: MapIntent): void => {
      act(() => {
        host().emit(intent);
      });
    },
  };
}

function avoidAreas(store: ReturnType<typeof createRideDocumentStore>) {
  return store.getState().document.intent.avoidAreas;
}

function revisionOf(store: ReturnType<typeof createRideDocumentStore>): number {
  return store.getState().document.revision;
}

function historyLength(store: ReturnType<typeof createRideDocumentStore>): number {
  return store.getState().document.history.entries.length;
}

/** Draws one rectangle through the real tool, and resolves when it is stored. */
async function drawRectangle(
  workspace: RenderedAvoidAreaWorkspace,
  from = RECT_SW,
  to = RECT_NE,
): Promise<void> {
  fireEvent.click(screen.getByTestId("draw-rectangle"));
  workspace.emit({ type: "pointer-down", pointerId: 1, coordinate: from, ref: null });
  workspace.emit({ type: "pointer-move", pointerId: 1, coordinate: to });
  workspace.emit({ type: "gesture-commit", tool: "avoid-area", geometry: [from, to] });
  await waitFor(() => expect(avoidAreas(workspace.rideDocumentStore)).toHaveLength(1));
}

/** Places the start with the unarmed first tap the composer asks for (OGV-D-213). */
async function placeStart(workspace: RenderedAvoidAreaWorkspace, coordinate = START): Promise<void> {
  workspace.emit({ type: "map-click", coordinate });
  await waitFor(() =>
    expect(workspace.rideDocumentStore.getState().document.intent.start?.coordinate).toEqual(
      coordinate,
    ),
  );
}

async function polygonPayload(
  store: GeometryStore,
  ref: GeometryRef,
): Promise<GeometryPayload> {
  const record = await store.get(ref);
  if (record === null) throw new Error(`no geometry for ${ref}`);
  return record.payload;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the rectangle tool", () => {
  it("arms the drawing pointer tool, and previews without authoring", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("draw-rectangle"));

    expect(workspace.plannerUiStore.getState().avoidAreaTool).toBe("rectangle");
    // 05 §4: the pointer tool is what disables the renderer's own camera drags, so
    // arming the tool and changing the pointer tool must be one transition.
    expect(workspace.plannerUiStore.getState().activeTool).toBe("avoid-area");

    const before = revisionOf(workspace.rideDocumentStore);
    workspace.emit({ type: "pointer-down", pointerId: 1, coordinate: RECT_SW, ref: null });
    workspace.emit({ type: "pointer-move", pointerId: 1, coordinate: RECT_NE });

    // The shape is public (it is what the rider is dragging) and it is *nothing*
    // in the ride: no revision, no history entry, no area.
    expect(workspace.host().lastScene()?.previewArea?.valid).toBe(true);
    expect(avoidAreas(workspace.rideDocumentStore)).toEqual([]);
    expect(revisionOf(workspace.rideDocumentStore)).toBe(before);
  });

  it("commits one command on the release and is one undo unit", async () => {
    const workspace = await renderWorkspace();
    const revisions = revisionOf(workspace.rideDocumentStore);
    const entries = historyLength(workspace.rideDocumentStore);

    await drawRectangle(workspace);

    expect(revisionOf(workspace.rideDocumentStore) - revisions).toBe(1);
    expect(historyLength(workspace.rideDocumentStore) - entries).toBe(1);
    expect(workspace.rideDocumentStore.getState().document.history.entries[0]?.label).toBe(
      "Drew avoid area",
    );
    // The preview is retired and the tool is one shot (04 §18 "clear tool mode").
    expect(workspace.host().lastScene()?.previewArea).toBeNull();
    expect(workspace.plannerUiStore.getState().avoidAreaTool).toBe("idle");
    expect(workspace.plannerUiStore.getState().activeTool).toBe("pan");
  });

  it("stores the polygon before the command, so the document's handle resolves", async () => {
    const workspace = await renderWorkspace();
    await drawRectangle(workspace);

    const area = avoidAreas(workspace.rideDocumentStore)[0];
    expect(area).toBeDefined();
    if (area === undefined) return;
    const payload = await polygonPayload(workspace.geometryStore, area.geometryRef);
    expect(payload.kind).toBe("polygon");
    if (payload.kind !== "polygon") return;
    // Four corners, closed on the first.
    expect(payload.rings[0]).toHaveLength(5);
    expect(payload.rings[0]?.[4]).toEqual(payload.rings[0]?.[0]);
    // …and the map is drawing it, from the same handle.
    await waitFor(() =>
      expect(workspace.host().lastScene()?.avoidAreas[0]?.rings).toHaveLength(1),
    );
  });

  it("authors nothing when the gesture is cancelled", async () => {
    const workspace = await renderWorkspace();
    const before = revisionOf(workspace.rideDocumentStore);
    fireEvent.click(screen.getByTestId("draw-rectangle"));

    workspace.emit({ type: "pointer-down", pointerId: 1, coordinate: RECT_SW, ref: null });
    workspace.emit({ type: "pointer-move", pointerId: 1, coordinate: RECT_NE });
    workspace.emit({ type: "gesture-cancel" });

    expect(avoidAreas(workspace.rideDocumentStore)).toEqual([]);
    expect(revisionOf(workspace.rideDocumentStore)).toBe(before);
    expect(workspace.host().lastScene()?.previewArea).toBeNull();
    expect(workspace.plannerUiStore.getState().avoidAreaError).toBeNull();
  });

  it("refuses a straight-line drag, and keeps the tool armed so the rider can retry", async () => {
    const workspace = await renderWorkspace();
    const before = revisionOf(workspace.rideDocumentStore);
    fireEvent.click(screen.getByTestId("draw-rectangle"));
    // The same latitude twice: a straight-line drag is not a rectangle, and the
    // refusal is the honest one (two corners in the same place).
    workspace.emit({ type: "pointer-down", pointerId: 1, coordinate: RECT_SW, ref: null });
    workspace.emit({
      type: "gesture-commit",
      tool: "avoid-area",
      geometry: [RECT_SW, { lon: RECT_NE.lon, lat: RECT_SW.lat }],
    });

    await waitFor(() =>
      expect(workspace.plannerUiStore.getState().avoidAreaError).toMatch(/same place/i),
    );
    expect(avoidAreas(workspace.rideDocumentStore)).toEqual([]);
    expect(revisionOf(workspace.rideDocumentStore)).toBe(before);
    // The rider can simply drag again.
    expect(workspace.plannerUiStore.getState().avoidAreaTool).toBe("rectangle");
  });

  it("refuses a drag thinner than the tool's own minimum span on one axis", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("draw-rectangle"));
    // 20 m wide by ~180 m tall: over the area minimum, under the span minimum.
    const thin = { lon: RECT_SW.lon + 0.000234, lat: RECT_NE.lat };
    workspace.emit({ type: "pointer-down", pointerId: 1, coordinate: RECT_SW, ref: null });
    workspace.emit({
      type: "gesture-commit",
      tool: "avoid-area",
      geometry: [RECT_SW, thin],
    });

    await waitFor(() =>
      expect(workspace.plannerUiStore.getState().avoidAreaError).toMatch(/too small/i),
    );
    expect(avoidAreas(workspace.rideDocumentStore)).toEqual([]);
  });
});

describe("the polygon tool", () => {
  it("adds a corner per tap and authors nothing until it closes", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("draw-polygon"));
    const before = revisionOf(workspace.rideDocumentStore);

    for (const corner of POLYGON_CORNERS) {
      workspace.emit({ type: "pointer-up", pointerId: 1, coordinate: corner });
    }

    expect(workspace.plannerUiStore.getState().avoidAreaDraft).toEqual(POLYGON_CORNERS);
    expect(screen.getByTestId("avoid-polygon-draft")).toHaveTextContent("3 placed");
    expect(avoidAreas(workspace.rideDocumentStore)).toEqual([]);
    expect(revisionOf(workspace.rideDocumentStore)).toBe(before);
  });

  it("closes on Enter and commits one command", async () => {
    const workspace = await renderWorkspace();
    const entries = historyLength(workspace.rideDocumentStore);
    fireEvent.click(screen.getByTestId("draw-polygon"));
    for (const corner of POLYGON_CORNERS) {
      workspace.emit({ type: "pointer-up", pointerId: 1, coordinate: corner });
    }

    act(() => {
      fireEvent.keyDown(window, { key: "Enter" });
    });

    await waitFor(() => expect(avoidAreas(workspace.rideDocumentStore)).toHaveLength(1));
    expect(historyLength(workspace.rideDocumentStore) - entries).toBe(1);
    expect(workspace.plannerUiStore.getState().avoidAreaDraft).toEqual([]);
    expect(workspace.plannerUiStore.getState().avoidAreaTool).toBe("idle");

    const area = avoidAreas(workspace.rideDocumentStore)[0];
    if (area === undefined) return;
    const payload = await polygonPayload(workspace.geometryStore, area.geometryRef);
    if (payload.kind !== "polygon") throw new Error("not a polygon");
    // Three corners plus the closing repeat — a polygon ring, never a partial one.
    expect(payload.rings[0]).toHaveLength(4);
  });

  it("removes the last corner with Backspace", async () => {
    const workspace = await renderWorkspace();
    fireEvent.click(screen.getByTestId("draw-polygon"));
    for (const corner of POLYGON_CORNERS) {
      workspace.emit({ type: "pointer-up", pointerId: 1, coordinate: corner });
    }

    act(() => {
      fireEvent.keyDown(window, { key: "Backspace" });
    });

    expect(workspace.plannerUiStore.getState().avoidAreaDraft).toEqual(
      POLYGON_CORNERS.slice(0, 2),
    );
  });

  it("cancels entirely on Escape: no draft, no command", async () => {
    const workspace = await renderWorkspace();
    const before = revisionOf(workspace.rideDocumentStore);
    fireEvent.click(screen.getByTestId("draw-polygon"));
    for (const corner of POLYGON_CORNERS.slice(0, 2)) {
      workspace.emit({ type: "pointer-up", pointerId: 1, coordinate: corner });
    }

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(workspace.plannerUiStore.getState().avoidAreaDraft).toEqual([]);
    expect(workspace.plannerUiStore.getState().avoidAreaTool).toBe("idle");
    expect(workspace.plannerUiStore.getState().activeTool).toBe("pan");
    expect(avoidAreas(workspace.rideDocumentStore)).toEqual([]);
    expect(revisionOf(workspace.rideDocumentStore)).toBe(before);
  });
});

describe("editing an area", () => {
  async function withSelectedArea(): Promise<RenderedAvoidAreaWorkspace> {
    const workspace = await renderWorkspace();
    await drawRectangle(workspace);
    fireEvent.click(screen.getByTestId("select-avoid-area-1"));
    return workspace;
  }

  it("draws vertex handles for the selected area, and none for a disabled one", async () => {
    const workspace = await withSelectedArea();
    await waitFor(() =>
      expect(workspace.host().lastScene()?.avoidHandles).toHaveLength(4),
    );

    fireEvent.click(screen.getByTestId("toggle-avoid-area-1"));
    await waitFor(() =>
      expect(workspace.host().lastScene()?.avoidHandles).toEqual([]),
    );
    expect(avoidAreas(workspace.rideDocumentStore)[0]?.enabled).toBe(false);
  });

  it("translates the whole shape in one update, previewing before the release", async () => {
    const workspace = await withSelectedArea();
    const area = avoidAreas(workspace.rideDocumentStore)[0];
    if (area === undefined) return;
    const originalRef = area.geometryRef;
    const entries = historyLength(workspace.rideDocumentStore);
    const delta = { lon: 0.001, lat: 0.001 };

    fireEvent.click(screen.getByTestId("move-avoid-area-1"));
    expect(workspace.plannerUiStore.getState().activeTool).toBe("polygon-edit");
    workspace.emit({
      type: "pointer-down",
      pointerId: 1,
      coordinate: RECT_SW,
      ref: { kind: "avoid-area", avoidAreaId: area.id },
    });
    workspace.emit({
      type: "pointer-move",
      pointerId: 1,
      coordinate: { lon: RECT_SW.lon + delta.lon, lat: RECT_SW.lat + delta.lat },
    });

    // Preview only: the document still names the old handle.
    expect(workspace.host().lastScene()?.previewArea?.valid).toBe(true);
    expect(avoidAreas(workspace.rideDocumentStore)[0]?.geometryRef).toBe(originalRef);

    workspace.emit({
      type: "gesture-commit",
      tool: "polygon-edit",
      geometry: [
        RECT_SW,
        { lon: RECT_SW.lon + delta.lon, lat: RECT_SW.lat + delta.lat },
      ],
    });

    await waitFor(() =>
      expect(avoidAreas(workspace.rideDocumentStore)[0]?.geometryRef).not.toBe(originalRef),
    );
    const moved = avoidAreas(workspace.rideDocumentStore)[0];
    if (moved === undefined) return;
    const payload = await polygonPayload(workspace.geometryStore, moved.geometryRef);
    if (payload.kind !== "polygon") throw new Error("not a polygon");
    const ring = payload.rings[0] ?? [];
    expect(ring[0]).toEqual({ lon: RECT_SW.lon + delta.lon, lat: RECT_SW.lat + delta.lat });
    expect(ring).toHaveLength(5);
    // One command, one undo unit — and the area is still the same object.
    expect(historyLength(workspace.rideDocumentStore) - entries).toBe(1);
    expect(moved.id).toBe(area.id);
    // The previous handle still resolves: undo restores the document that names it.
    expect(await workspace.geometryStore.has(originalRef)).toBe(true);
    expect(workspace.host().lastScene()?.previewArea).toBeNull();
  });

  it("moves exactly one corner in a vertex drag", async () => {
    const workspace = await withSelectedArea();
    const area = avoidAreas(workspace.rideDocumentStore)[0];
    if (area === undefined) return;
    const delta = { lon: 0.0005, lat: 0.0006 };

    fireEvent.click(screen.getByTestId("vertices-avoid-area-1"));
    workspace.emit({
      type: "pointer-down",
      pointerId: 1,
      coordinate: RECT_SW,
      ref: { kind: "avoid-area", avoidAreaId: area.id },
    });
    workspace.emit({
      type: "gesture-commit",
      tool: "polygon-edit",
      geometry: [
        RECT_SW,
        { lon: RECT_SW.lon + delta.lon, lat: RECT_SW.lat + delta.lat },
      ],
    });

    await waitFor(() =>
      expect(avoidAreas(workspace.rideDocumentStore)[0]?.geometryRef).not.toBe(area.geometryRef),
    );
    const next = avoidAreas(workspace.rideDocumentStore)[0];
    if (next === undefined) return;
    const payload = await polygonPayload(workspace.geometryStore, next.geometryRef);
    if (payload.kind !== "polygon") throw new Error("not a polygon");
    const ring = payload.rings[0] ?? [];
    expect(ring[0]).toEqual({ lon: RECT_SW.lon + delta.lon, lat: RECT_SW.lat + delta.lat });
    // Every other corner is untouched, and the ring still closes.
    expect(ring[1]).toEqual({ lon: RECT_NE.lon, lat: RECT_SW.lat });
    expect(ring[4]).toEqual(ring[0]);
  });

  it("does not guess a corner when the grab is beyond the handle radius", async () => {
    const workspace = await withSelectedArea();
    const area = avoidAreas(workspace.rideDocumentStore)[0];
    if (area === undefined) return;
    const before = revisionOf(workspace.rideDocumentStore);
    // The centre of the rectangle is ~250 m from every corner.
    const centre = {
      lon: (RECT_SW.lon + RECT_NE.lon) / 2,
      lat: (RECT_SW.lat + RECT_NE.lat) / 2,
    };
    expect(VERTEX_HANDLE_HIT_RADIUS_METERS).toBeLessThan(230);

    fireEvent.click(screen.getByTestId("vertices-avoid-area-1"));
    workspace.emit({
      type: "pointer-down",
      pointerId: 1,
      coordinate: centre,
      ref: { kind: "avoid-area", avoidAreaId: area.id },
    });
    workspace.emit({
      type: "gesture-commit",
      tool: "polygon-edit",
      geometry: [centre, { lon: centre.lon + 0.001, lat: centre.lat }],
    });

    expect(revisionOf(workspace.rideDocumentStore)).toBe(before);
    expect(workspace.plannerUiStore.getState().avoidAreaError).toBeNull();
  });

  it("renames in one command and does not reroute", async () => {
    const workspace = await withSelectedArea();
    const entries = historyLength(workspace.rideDocumentStore);

    fireEvent.change(screen.getByTestId("rename-avoid-area-1"), {
      target: { value: "Route 206" },
    });
    fireEvent.click(screen.getByTestId("apply-rename-avoid-area-1"));

    await waitFor(() => expect(avoidAreas(workspace.rideDocumentStore)[0]?.name).toBe("Route 206"));
    expect(historyLength(workspace.rideDocumentStore) - entries).toBe(1);
    const entriesAfter = workspace.rideDocumentStore.getState().document.history.entries;
    expect(entriesAfter[entriesAfter.length - 1]?.label).toBe("Renamed avoid area");
    // The list row now shows the rider's own name, and undo names it too.
    expect(screen.getByTestId("select-avoid-area-1")).toHaveTextContent("Route 206");
  });

  it("removes the area and disarms the tool that was editing it", async () => {
    const workspace = await withSelectedArea();
    fireEvent.click(screen.getByTestId("vertices-avoid-area-1"));
    expect(workspace.plannerUiStore.getState().avoidAreaTool).toBe("vertices");

    fireEvent.click(screen.getByTestId("remove-avoid-area-1"));

    await waitFor(() => expect(avoidAreas(workspace.rideDocumentStore)).toEqual([]));
    expect(workspace.plannerUiStore.getState().avoidAreaTool).toBe("idle");
    expect(workspace.plannerUiStore.getState().activeTool).toBe("pan");
    expect(screen.getByTestId("avoid-areas-empty")).toBeInTheDocument();
  });

  it("zooms to the area as one explicit fit request", async () => {
    const workspace = await withSelectedArea();
    const before = workspace.plannerUiStore.getState().fitRequest;
    fireEvent.click(screen.getByTestId("zoom-avoid-area-1"));
    const after = workspace.plannerUiStore.getState().fitRequest;
    expect(after).not.toBeNull();
    expect(after?.token).toBeGreaterThan(before?.token ?? 0);
    expect(after?.extent).not.toBeNull();
  });
});

describe("endpoint-in-area conflicts", () => {
  it("surfaces the conflict with its three explicit actions, and never resolves it", async () => {
    const workspace = await renderWorkspace();
    await placeStart(workspace);
    await drawRectangle(workspace);

    const panel = await screen.findByTestId("avoid-conflict-panel");
    expect(panel).toHaveTextContent("Route cannot pass through this area");
    expect(screen.getByTestId("avoid-conflict-0")).toHaveTextContent("contains your start");
    // Nothing was moved or dropped on the rider's behalf.
    expect(workspace.rideDocumentStore.getState().document.intent.start?.coordinate).toEqual(
      START,
    );
    expect(avoidAreas(workspace.rideDocumentStore)).toHaveLength(1);
    expect(screen.getByTestId("conflict-badge-avoid-area-1")).toHaveTextContent("1 inside");
  });

  it("arms the endpoint's own placement from Move endpoint", async () => {
    const workspace = await renderWorkspace();
    await placeStart(workspace);
    await drawRectangle(workspace);

    fireEvent.click(await screen.findByTestId("conflict-move-0"));

    expect(workspace.plannerUiStore.getState().placementTool).toBe("place-start");
    expect(workspace.plannerUiStore.getState().avoidAreaTool).toBe("idle");
    // The conflict is still authored state: the rider has not placed the new point yet.
    expect(screen.getByTestId("avoid-conflict-panel")).toBeInTheDocument();
  });

  it("arms the corner editor from Edit area", async () => {
    const workspace = await renderWorkspace();
    await placeStart(workspace);
    await drawRectangle(workspace);

    fireEvent.click(await screen.findByTestId("conflict-edit-0"));

    expect(workspace.plannerUiStore.getState().avoidAreaTool).toBe("vertices");
    expect(workspace.plannerUiStore.getState().activeTool).toBe("polygon-edit");
  });

  it("removes the area from Remove area, and the conflict goes with it", async () => {
    const workspace = await renderWorkspace();
    await placeStart(workspace);
    await drawRectangle(workspace);

    fireEvent.click(await screen.findByTestId("conflict-remove-0"));

    await waitFor(() => expect(avoidAreas(workspace.rideDocumentStore)).toEqual([]));
    expect(screen.queryByTestId("avoid-conflict-panel")).not.toBeInTheDocument();
    expect(workspace.rideDocumentStore.getState().document.intent.start?.coordinate).toEqual(
      START,
    );
  });

  it("clears the conflict when the area is moved off the point", async () => {
    const workspace = await renderWorkspace();
    await placeStart(workspace);
    await drawRectangle(workspace);
    const area = avoidAreas(workspace.rideDocumentStore)[0];
    if (area === undefined) return;

    fireEvent.click(screen.getByTestId("move-avoid-area-1"));
    const delta = { lon: 0.01, lat: 0.01 };
    workspace.emit({
      type: "pointer-down",
      pointerId: 1,
      coordinate: RECT_SW,
      ref: { kind: "avoid-area", avoidAreaId: area.id },
    });
    workspace.emit({
      type: "gesture-commit",
      tool: "polygon-edit",
      geometry: [RECT_SW, { lon: RECT_SW.lon + delta.lon, lat: RECT_SW.lat + delta.lat }],
    });

    await waitFor(() =>
      expect(screen.queryByTestId("avoid-conflict-panel")).not.toBeInTheDocument(),
    );
  });
});

describe("the expanded sheet's scroll affordance", () => {
  it("publishes the measured head height for the stylesheet to consume", async () => {
    mockMapViewport(96);
    const geometryStore = createMemoryGeometryStore();
    const rideDocumentStore = createRideDocumentStore({ now });
    const planningSessionStore = createPlanningSessionStore({
      service: createClientPlanningService({ fetcher: neverFetch(), now, geometryStore }),
    });
    const plannerUiStore = createPlannerUiStore({ sheetDetent: "expanded" });
    const mapFactory = createStubMapHostFactory();

    render(
      <PlannerWorkspace
        rideDocumentStore={rideDocumentStore}
        planningSessionStore={planningSessionStore}
        plannerUiStore={plannerUiStore}
        geometryStore={geometryStore}
        mapHostFactory={mapFactory.factory}
      />,
    );

    const sheet = screen.getByTestId("planner-sheet");
    const scroll = screen.getByTestId("sheet-scroll");
    expect(scroll.className).toContain("og-sheet__body");
    await waitFor(() =>
      expect(sheet.style.getPropertyValue("--og-sheet-head-height")).toBe("96px"),
    );
  });

  it("insets the scroll origin by that height in the stylesheet", () => {
    const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
    // The inset the *scroll* respects: a keyboard scrollIntoView never parks a
    // row under the block above the list.
    expect(css).toMatch(
      /\.og-planner__sheet\[data-detent="expanded"\]\s+\.og-sheet__body\s*\{[^}]*scroll-padding-top:\s*var\(--og-sheet-head-height/,
    );
    // …and the fade that makes a clipped row read as scrolled: it hangs exactly
    // where the scroller begins.
    expect(css).toMatch(
      /\.og-planner__sheet\[data-detent="expanded"\]\s+\.og-sheet__head::after\s*\{[^}]*top:\s*calc\(100% \+ 8px\)/,
    );
    expect(css).toMatch(/\.og-planner__sheet\[data-detent="expanded"\]\s+\.og-sheet__head::after\s*\{[^}]*linear-gradient/);
  });

  it("never pads the scroll container by the header height, which would leave a permanent band", () => {
    const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const rule =
      /\.og-planner__sheet\[data-detent="expanded"\]\s+\.og-sheet__body\s*\{([^}]*)\}/.exec(
        css,
      )?.[1] ?? "";
    expect(rule).not.toBe("");
    expect(rule).not.toMatch(/^\s*padding-top:/m);
  });
});
