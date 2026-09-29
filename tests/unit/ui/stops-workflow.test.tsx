/**
 * The stops workflow end to end (03-DOMAIN-MODEL §27, 04-PLANNER-AND-WORKSPACE-UX
 * §15, §20, §31; 05-MAP-INTERACTION-AND-CARTOGRAPHY §4).
 *
 * The object list is the accessible form of the map operations, and a drag is the
 * direct one; both must produce **exactly one command and one undo unit**. This
 * suite drives the real stores through the real workspace, because that is the
 * only layer where "one gesture = one `dispatch`" can be observed: the component
 * tests pin what the buttons ask for, and these tests pin what the workspace does
 * with it.
 *
 * Nothing here reaches a network: the ride is authored by taps and by the list, and
 * no test plans a route (the fetcher refuses).
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClientPlanningService } from "@/application/planner/client-planning-service";
import type { MapIntent } from "@/application/map/types";
import type { StopId } from "@/domain/ride/ids";
import type { StopPoint } from "@/domain/ride/types";
import { createPlannerUiStore } from "@/ui/stores/planner-ui-store";
import { createRideDocumentStore } from "@/ui/stores/ride-document-store";
import { createPlanningSessionStore } from "@/ui/stores/planning-session-store";
import { PlannerWorkspace } from "@/ui/planner/PlannerWorkspace";

import { createStubMapHostFactory, type StubMapHostFactory } from "../support/stub-map-host";

const FIXED = "2026-09-17T00:00:00.000Z";
const now = (): string => FIXED;
const MAP_SIZE = 1000;
const ORIGIN = { lon: -75.2, lat: 39.95 };

interface Rendered {
  readonly rideDocumentStore: ReturnType<typeof createRideDocumentStore>;
  readonly plannerUiStore: ReturnType<typeof createPlannerUiStore>;
  readonly mapFactory: StubMapHostFactory;
}

let current: Rendered | null = null;

/** JSdom has no layout, so the dock's own rect is mocked as a real viewport. */
function mockMapViewport(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: MAP_SIZE,
    bottom: MAP_SIZE,
    width: MAP_SIZE,
    height: MAP_SIZE,
    toJSON: (): Record<string, never> => ({}),
  } as DOMRect);
}

/** A tap position as the geography the stub host would have unprojected. */
function coordinateAt(x: number, y: number): { lon: number; lat: number } {
  return {
    lon: ORIGIN.lon + (x / MAP_SIZE) * 0.4,
    lat: ORIGIN.lat + (y / MAP_SIZE) * 0.25,
  };
}

function emitIntent(intent: MapIntent): void {
  const host = current?.mapFactory.hosts[0];
  if (host === undefined) throw new Error("the workspace has no map host");
  act(() => {
    host.emit(intent);
  });
}

function tapMap(x: number, y: number): { lon: number; lat: number } {
  const coordinate = coordinateAt(x, y);
  emitIntent({ type: "map-click", coordinate });
  return coordinate;
}

/** The fetcher for tests that author points but never plan. */
function unfetched(): typeof fetch {
  return (async (): Promise<Response> => {
    throw new Error("this test never plans a ride");
  }) as typeof fetch;
}

async function renderWorkspace(): Promise<Rendered> {
  const rideDocumentStore = createRideDocumentStore({ now });
  const planningSessionStore = createPlanningSessionStore({
    service: createClientPlanningService({ fetcher: unfetched(), now }),
  });
  const plannerUiStore = createPlannerUiStore();
  const mapFactory = createStubMapHostFactory();

  render(
    <PlannerWorkspace
      rideDocumentStore={rideDocumentStore}
      planningSessionStore={planningSessionStore}
      plannerUiStore={plannerUiStore}
      mapHostFactory={mapFactory.factory}
    />,
  );
  // The shaping tools live behind the "Refine route" disclosure.
  fireEvent.click(screen.getByTestId("refine-toggle"));
  // The host subscribes to intents once the async factory resolves.
  await Promise.resolve();
  await Promise.resolve();
  const rendered: Rendered = { rideDocumentStore, plannerUiStore, mapFactory };
  current = rendered;
  return rendered;
}

/** Authors a start and a destination with two unarmed taps (OGV-D-213). */
async function placeBothEndpoints(): Promise<void> {
  tapMap(100, 100);
  await waitFor(() => {
    expect(screen.getByTestId("start-value")).not.toHaveTextContent("No start yet");
  });
  tapMap(900, 900);
  await waitFor(() => {
    expect(screen.getByTestId("finish-value")).not.toHaveTextContent("No destination yet");
  });
}

/** Adds a stop through the panel's own place mode and one map tap. */
async function addStop(x: number, y: number): Promise<StopId> {
  const before = new Set(stopsOf().map((stop) => stop.id));
  fireEvent.click(screen.getByTestId("add-stop"));
  tapMap(x, y);
  await waitFor(() => {
    expect(stopsOf()).toHaveLength(before.size + 1);
  });
  // The new stop is the one that was not there before: it is not necessarily the
  // last one, because a new stop lands after the selected stop (04 §15).
  const added = stopsOf().find((stop) => !before.has(stop.id));
  if (added === undefined) throw new Error("the stop was not authored");
  return added.id;
}

function stopsOf(): readonly StopPoint[] {
  return current?.rideDocumentStore.getState().document.intent.stops ?? [];
}

function historyLength(): number {
  return current?.rideDocumentStore.getState().document.history.entries.length ?? 0;
}

beforeEach(() => {
  mockMapViewport();
});

afterEach(() => {
  current = null;
  cleanup();
  vi.restoreAllMocks();
});

describe("the object list drives one command per press", () => {
  it("reorders with the neighbour the ordering rule chose", async () => {
    const { rideDocumentStore } = await renderWorkspace();
    await placeBothEndpoints();
    const first = await addStop(300, 300);
    const second = await addStop(600, 600);
    expect(stopsOf().map((stop) => stop.id)).toEqual([first, second]);

    const before = rideDocumentStore.getState().document.revision;
    const beforeHistory = historyLength();
    fireEvent.click(screen.getByTestId("move-up-stop-2"));

    const document = rideDocumentStore.getState().document;
    expect(document.intent.stops.map((stop) => stop.id)).toEqual([second, first]);
    // One press is one revision and one history unit (03 §27), labelled for the
    // undo control (04 §20).
    expect(document.revision).toBe(before + 1);
    expect(document.history.entries).toHaveLength(beforeHistory + 1);
    expect(document.history.entries[document.history.entries.length - 1]?.label).toBe(
      "Reorder stops",
    );
  });

  it("converts a stop to a shaping anchor in one command", async () => {
    const { rideDocumentStore } = await renderWorkspace();
    await placeBothEndpoints();
    await addStop(300, 300);

    const before = rideDocumentStore.getState().document.revision;
    const beforeHistory = historyLength();
    const authored = stopsOf()[0]?.coordinate;
    fireEvent.click(screen.getByTestId("convert-stop-1"));

    const document = rideDocumentStore.getState().document;
    expect(document.intent.stops).toHaveLength(0);
    expect(document.intent.shaping).toHaveLength(1);
    // Two commands would have been two undo units; the conversion is one.
    expect(document.revision).toBe(before + 1);
    expect(document.history.entries).toHaveLength(beforeHistory + 1);
    expect(document.intent.shaping[0]?.coordinate).toEqual(authored);

    // The anchor is now a list row of its own, and converting it back restores a
    // stop — one more revision, one more history unit.
    fireEvent.click(screen.getByTestId("convert-shape-1"));
    const restored = rideDocumentStore.getState().document;
    expect(restored.intent.stops).toHaveLength(1);
    expect(restored.intent.shaping).toHaveLength(0);
    expect(restored.history.entries).toHaveLength(beforeHistory + 2);
  });

  it("removes a stop and restores it with undo", async () => {
    const { rideDocumentStore } = await renderWorkspace();
    await placeBothEndpoints();
    const stopId = await addStop(300, 300);

    fireEvent.click(screen.getByTestId("remove-stop-1"));
    expect(stopsOf()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("undo"));

    expect(stopsOf().map((stop) => stop.id)).toEqual([stopId]);
    expect(rideDocumentStore.getState().document.intent.stops[0]?.id).toBe(stopId);
  });

  it("edits a position numerically, and refuses an out-of-range value first", async () => {
    const { rideDocumentStore } = await renderWorkspace();
    await placeBothEndpoints();
    await addStop(300, 300);

    fireEvent.click(screen.getByTestId("select-stop-1"));
    const before = rideDocumentStore.getState().document.revision;

    fireEvent.change(screen.getByTestId("point-lat"), { target: { value: "91" } });
    fireEvent.click(screen.getByTestId("apply-coordinate"));
    expect(screen.getByTestId("inspector-error")).toBeInTheDocument();
    expect(rideDocumentStore.getState().document.revision).toBe(before);

    fireEvent.change(screen.getByTestId("point-lat"), { target: { value: "40.25" } });
    fireEvent.change(screen.getByTestId("point-lon"), { target: { value: "-75.35" } });
    fireEvent.click(screen.getByTestId("apply-coordinate"));

    const stop = rideDocumentStore.getState().document.intent.stops[0];
    expect(stop?.coordinate).toEqual({ lat: 40.25, lon: -75.35 });
    expect(rideDocumentStore.getState().document.revision).toBe(before + 1);
  });

  it("sets an arrival intent as its own labelled unit", async () => {
    const { rideDocumentStore } = await renderWorkspace();
    await placeBothEndpoints();
    await addStop(300, 300);

    fireEvent.click(screen.getByTestId("select-stop-1"));
    fireEvent.change(screen.getByTestId("arrival-intent"), { target: { value: "fuel" } });

    const document = rideDocumentStore.getState().document;
    expect(document.intent.stops[0]?.arrivalIntent).toBe("fuel");
    expect(document.history.entries[document.history.entries.length - 1]?.label).toBe(
      "Change arrival intent",
    );
  });
});

describe("a point drag is one gesture and one command (05 §4)", () => {
  it("previews locally and commits exactly once on release", async () => {
    const { rideDocumentStore, plannerUiStore, mapFactory } = await renderWorkspace();
    await placeBothEndpoints();
    const stopId = await addStop(300, 300);
    const stopRef = { kind: "stop", stopId } as const;

    const before = rideDocumentStore.getState().document.revision;
    const beforeHistory = historyLength();
    const pressed = coordinateAt(300, 300);
    const released = coordinateAt(320, 340);

    emitIntent({ type: "pointer-down", pointerId: 1, coordinate: pressed, ref: stopRef });
    // The ghost is public from the press, and nothing is authored yet.
    expect(plannerUiStore.getState().dragPreview).not.toBeNull();
    expect(mapFactory.hosts[0]?.lastScene()?.preview).not.toBeNull();
    expect(rideDocumentStore.getState().document.revision).toBe(before);

    emitIntent({ type: "pointer-move", pointerId: 1, coordinate: released });
    // The preview follows the pointer, and the document still has not moved.
    expect(plannerUiStore.getState().dragPreview?.coordinate).toEqual(released);
    expect(rideDocumentStore.getState().document.revision).toBe(before);

    // A release on its own is not a commit: the machine decides what the gesture
    // meant, and only `gesture-commit` carries a committed geometry.
    emitIntent({ type: "pointer-up", pointerId: 1, coordinate: released });
    expect(rideDocumentStore.getState().document.revision).toBe(before);

    emitIntent({ type: "gesture-commit", tool: "point-drag", geometry: [pressed, released] });

    const document = rideDocumentStore.getState().document;
    expect(document.intent.stops[0]?.coordinate).toEqual(released);
    // One drag, one revision, one history unit — and the identity survives.
    expect(document.revision).toBe(before + 1);
    expect(document.history.entries).toHaveLength(beforeHistory + 1);
    expect(document.intent.stops[0]?.id).toBe(stopId);
    // The ghost is gone once the command exists.
    expect(plannerUiStore.getState().dragPreview).toBeNull();
  });

  it("commits nothing when the gesture is cancelled", async () => {
    const { rideDocumentStore, plannerUiStore } = await renderWorkspace();
    await placeBothEndpoints();
    const stopId = await addStop(300, 300);

    const before = rideDocumentStore.getState().document.revision;
    const beforeHistory = historyLength();

    emitIntent({
      type: "pointer-down",
      pointerId: 1,
      coordinate: coordinateAt(300, 300),
      ref: { kind: "stop", stopId },
    });
    emitIntent({ type: "pointer-move", pointerId: 1, coordinate: coordinateAt(340, 350) });
    emitIntent({ type: "gesture-cancel" });

    expect(plannerUiStore.getState().dragPreview).toBeNull();
    expect(rideDocumentStore.getState().document.revision).toBe(before);
    expect(rideDocumentStore.getState().document.history.entries).toHaveLength(beforeHistory);
    expect(rideDocumentStore.getState().document.intent.stops[0]?.coordinate).toEqual(
      coordinateAt(300, 300),
    );
  });

  it("moves the start without minting a second identity", async () => {
    const { rideDocumentStore } = await renderWorkspace();
    await placeBothEndpoints();
    const startId = rideDocumentStore.getState().document.intent.start?.id;
    if (startId === undefined) throw new Error("expected a start");

    const pressed = coordinateAt(100, 100);
    const released = coordinateAt(140, 160);
    emitIntent({
      type: "pointer-down",
      pointerId: 1,
      coordinate: pressed,
      ref: { kind: "point", pointId: startId },
    });
    emitIntent({ type: "gesture-commit", tool: "point-drag", geometry: [pressed, released] });

    const start = rideDocumentStore.getState().document.intent.start;
    expect(start?.coordinate).toEqual(released);
    expect(start?.id).toBe(startId);
  });

  it("does not drag an object the tool cannot grab", async () => {
    const { rideDocumentStore, plannerUiStore } = await renderWorkspace();
    await placeBothEndpoints();
    await addStop(300, 300);

    const before = rideDocumentStore.getState().document.revision;
    emitIntent({
      type: "pointer-down",
      pointerId: 1,
      coordinate: coordinateAt(500, 500),
      ref: { kind: "route", routeId: "route_x" as never },
    });

    // A route press is not a point drag: no ghost, and the commit phase authors
    // nothing either.
    expect(plannerUiStore.getState().dragPreview).toBeNull();
    emitIntent({
      type: "gesture-commit",
      tool: "point-drag",
      geometry: [coordinateAt(500, 500), coordinateAt(560, 560)],
    });
    expect(rideDocumentStore.getState().document.revision).toBe(before);
  });
});

describe("placing a stop and replacing a place", () => {
  it("inserts after the selected stop", async () => {
    await renderWorkspace();
    await placeBothEndpoints();
    const first = await addStop(300, 300);
    const second = await addStop(600, 600);

    // Select the first stop, then add another: it lands directly after the stop
    // the rider was looking at (04 §15, `stop-insertion.ts`).
    fireEvent.click(screen.getByTestId("select-stop-1"));
    const third = await addStop(450, 450);

    expect(stopsOf().map((stop) => stop.id)).toEqual([first, third, second]);
  });

  it("replaces a stop's place with the next tap", async () => {
    const { rideDocumentStore } = await renderWorkspace();
    await placeBothEndpoints();
    const stopId = await addStop(300, 300);
    const before = rideDocumentStore.getState().document.revision;

    fireEvent.click(screen.getByTestId("replace-stop-1"));
    const coordinate = tapMap(700, 700);

    const document = rideDocumentStore.getState().document;
    expect(document.intent.stops[0]?.id).toBe(stopId);
    expect(document.intent.stops[0]?.coordinate).toEqual(coordinate);
    expect(document.revision).toBe(before + 1);
    // Placement stays one shot: the mode is not left armed behind the rider.
    expect(screen.queryByTestId("map-hint")).not.toBeInTheDocument();
  });

  it("keeps the stop list out of the itinerary when shaping anchors exist", async () => {
    await renderWorkspace();
    await placeBothEndpoints();
    await addStop(300, 300);

    fireEvent.click(screen.getByTestId("convert-stop-1"));

    const itinerary = screen.getByTestId("stops-list");
    expect(within(itinerary).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByTestId("shaping-list")).toBeInTheDocument();
  });
});

describe("zoom to (04 §15)", () => {
  it("frames the object with an explicit fit, even while the rider owns the camera", async () => {
    const { rideDocumentStore, plannerUiStore, mapFactory } = await renderWorkspace();
    await placeBothEndpoints();
    const host = mapFactory.hosts[0];
    if (host === undefined) throw new Error("expected a map host");

    // The rider takes the camera, which suspends automatic fit (05 §8)...
    emitIntent({ type: "camera-changed" });
    expect(plannerUiStore.getState().cameraUserOwned).toBe(true);
    host.reset();

    // ...and asks for one object explicitly, which is the one gesture that still
    // moves the camera.
    fireEvent.click(screen.getByTestId("zoom-start"));

    expect(host.fits).toHaveLength(1);
    const start = rideDocumentStore.getState().document.intent.start;
    if (start === undefined || start === null) throw new Error("expected a start");
    const extent = host.fits[0]?.extent;
    if (extent === undefined) throw new Error("expected a fit extent");
    expect(extent.minLon).toBeLessThanOrEqual(start.coordinate.lon);
    expect(extent.maxLon).toBeGreaterThanOrEqual(start.coordinate.lon);
    expect(extent.minLat).toBeLessThanOrEqual(start.coordinate.lat);
    expect(extent.maxLat).toBeGreaterThanOrEqual(start.coordinate.lat);
    // The rider still owns the camera: an explicit zoom moves the camera, it does
    // not hand it back to automatic fit.
    expect(plannerUiStore.getState().cameraUserOwned).toBe(true);
  });

  it("asks again when the same object is asked for twice", async () => {
    const { plannerUiStore, mapFactory } = await renderWorkspace();
    await placeBothEndpoints();
    const host = mapFactory.hosts[0];
    if (host === undefined) throw new Error("expected a map host");

    fireEvent.click(screen.getByTestId("zoom-start"));
    const firstToken = plannerUiStore.getState().fitRequest?.token ?? 0;
    const firstFits = host.fits.length;

    // A request is one gesture, not a camera mode: asking for the same object a
    // second time must move the camera a second time, which is what the token is
    // for (a key equal to the previous one would be reconciled away).
    fireEvent.click(screen.getByTestId("zoom-start"));

    expect(plannerUiStore.getState().fitRequest?.token).toBe(firstToken + 1);
    expect(host.fits.length).toBeGreaterThan(firstFits);
  });
});
