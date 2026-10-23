import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MapScene } from "@/application/map/types";
import type { PlannerItineraryActions } from "@/ui/planner/usePlannerItineraryActions";
import { usePlannerItineraryActions } from "@/ui/planner/usePlannerItineraryActions";
import { createRideDocument } from "@/domain/ride/create";
import { createPlannerUiStore } from "@/ui/stores/planner-ui-store";
import { createRideDocumentStore, insertStopCommand } from "@/ui/stores/ride-document-store";

const NOW = "2026-09-24T12:00:00.000Z";
const COORDINATE = { lon: -75.31, lat: 40.02 };

afterEach(() => cleanup());

describe("usePlannerItineraryActions.addStopAt", () => {
  it("dispatches exactly one appended stop.insert command with the place label", () => {
    const rideDocumentStore = createRideDocumentStore({ document: createRideDocument({ now: NOW }), now: () => NOW });
    const plannerUiStore = createPlannerUiStore();
    const dispatch = vi.spyOn(rideDocumentStore.getState(), "dispatch");
    let actions: PlannerItineraryActions | undefined;

    function Probe() {
      actions = usePlannerItineraryActions({
        document: rideDocumentStore.getState().document,
        scene: { routes: [], selectedRouteId: null } as unknown as MapScene,
        rideDocumentStore,
        plannerUiStore,
      });
      return null;
    }

    render(<Probe />);
    act(() => actions?.addStopAt(COORDINATE, "Chickie's & Pete's"));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "stop.insert",
      stop: {
        kind: "stop",
        coordinate: COORDINATE,
        label: "Chickie's & Pete's",
      },
    });
    expect(dispatch.mock.calls[0]?.[0]).not.toHaveProperty("beforeStopId");
  });

  it("puts a place along the ride in route order, ahead of a stop further on", () => {
    const base = createRideDocument({ now: NOW });
    const rideDocumentStore = createRideDocumentStore({ document: base, now: () => NOW });
    const plannerUiStore = createPlannerUiStore();
    // One stop near the end of an eastbound ride.
    act(() => rideDocumentStore.getState().dispatch(insertStopCommand(rideDocumentStore.getState().document, { lon: -75.05, lat: 40.0 }, undefined)));
    const far = rideDocumentStore.getState().document.intent.stops[0]!;
    const dispatch = vi.spyOn(rideDocumentStore.getState(), "dispatch");
    const line = [
      { lon: -75.5, lat: 40.0 },
      { lon: -75.0, lat: 40.0 },
    ];
    let actions: PlannerItineraryActions | undefined;
    function Probe() {
      actions = usePlannerItineraryActions({
        document: rideDocumentStore.getState().document,
        scene: { routes: [{ id: "r1", geometry: line }], selectedRouteId: "r1" } as unknown as MapScene,
        rideDocumentStore,
        plannerUiStore,
      });
      return null;
    }
    render(<Probe />);
    act(() => actions?.addStopAt({ lon: -75.4, lat: 40.0 }, "Early stop"));
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ type: "stop.insert", beforeStopId: far.id });
  });
});

describe("usePlannerItineraryActions.addRideRoad", () => {
  function probe(rideDocumentStore: ReturnType<typeof createRideDocumentStore>, plannerUiStore: ReturnType<typeof createPlannerUiStore>): () => PlannerItineraryActions | undefined {
    let actions: PlannerItineraryActions | undefined;
    function Probe() {
      actions = usePlannerItineraryActions({
        document: rideDocumentStore.getState().document,
        scene: { routes: [], selectedRouteId: null } as unknown as MapScene,
        rideDocumentStore,
        plannerUiStore,
      });
      return null;
    }
    render(<Probe />);
    return () => actions;
  }

  it("adds the road's two via points as stops, entry then exit", () => {
    const rideDocumentStore = createRideDocumentStore({ document: createRideDocument({ now: NOW }), now: () => NOW });
    const plannerUiStore = createPlannerUiStore();
    const current = probe(rideDocumentStore, plannerUiStore);
    const entry = { lon: -75.4, lat: 40.0 };
    const exit = { lon: -75.1, lat: 40.0 };

    act(() => current()?.addRideRoad(entry, exit, "Pine Creek Road"));

    const stops = rideDocumentStore.getState().document.intent.stops;
    expect(stops).toHaveLength(2);
    expect(stops[0]?.coordinate).toEqual(entry);
    expect(stops[1]?.coordinate).toEqual(exit);
    expect(stops[0]?.label).toBe("Pine Creek Road entry");
    expect(stops[1]?.label).toBe("Pine Creek Road exit");
  });

  it("appends after stops the rider already has", () => {
    const base = createRideDocument({ now: NOW });
    const rideDocumentStore = createRideDocumentStore({ document: base, now: () => NOW });
    const plannerUiStore = createPlannerUiStore();
    act(() =>
      rideDocumentStore
        .getState()
        .dispatch(insertStopCommand(rideDocumentStore.getState().document, { lon: -75.5, lat: 40.0 }, undefined)),
    );
    const existing = rideDocumentStore.getState().document.intent.stops[0]!;
    const current = probe(rideDocumentStore, plannerUiStore);

    act(() => current()?.addRideRoad({ lon: -75.4, lat: 40.0 }, { lon: -75.1, lat: 40.0 }, "Twisty road"));

    const stops = rideDocumentStore.getState().document.intent.stops;
    expect(stops.map((stop) => stop.coordinate)).toEqual([
      existing.coordinate,
      { lon: -75.4, lat: 40.0 },
      { lon: -75.1, lat: 40.0 },
    ]);
  });
});
