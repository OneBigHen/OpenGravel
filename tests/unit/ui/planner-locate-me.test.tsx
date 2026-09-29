import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildMapScene, sceneCoordinates } from "@/application/map/build-map-scene";
import { emptyPlanningSession } from "@/application/planner/planning-session";
import type { PositionSource } from "@/application/ride-session/position-pipeline";
import { createRideDocument } from "@/domain/ride/create";
import { LOCATE_ME_FAILURE_COPY, locateExtent, usePlannerPlaces } from "@/ui/planner/usePlannerPlaces";
import { createPlannerUiStore } from "@/ui/stores/planner-ui-store";
import { createRideDocumentStore } from "@/ui/stores/ride-document-store";

const HERE = { lon: -75.3851, lat: 40.0948 };

function source(result: { accuracyMeters: number } | "permission-denied"): PositionSource & { watch: ReturnType<typeof vi.fn> } {
  return {
    // "prompt": the planner's own auto-locate stays out of these tests.
    permission: vi.fn(async () => "prompt" as const),
    watch: vi.fn((observer) => {
      setTimeout(() => {
        if (result === "permission-denied") observer.error({ code: "permission-denied" });
        else observer.position({
          coordinate: HERE, observedAt: new Date().toISOString(), accuracyMeters: result.accuracyMeters, headingDegrees: null, speedMps: null,
        });
      }, 0);
      return { stop: () => undefined };
    }),
  };
}

function mount(position: PositionSource | undefined) {
  const rideDocumentStore = createRideDocumentStore({ document: createRideDocument() });
  const plannerUiStore = createPlannerUiStore();
  const places = { search: { search: vi.fn(), reverse: vi.fn() }, names: { request: vi.fn(), nameFor: vi.fn(() => null), subscribe: () => () => undefined, version: () => 0 }, ...(position === undefined ? {} : { position }) } as never;
  const hook = renderHook(() => usePlannerPlaces({ document: rideDocumentStore.getState().document, rideDocumentStore, plannerUiStore, places }));
  return { hook, rideDocumentStore, plannerUiStore };
}

describe("center on me (the planner map's locate button)", () => {
  it("draws the dot and frames the streets around the rider, leaving the ride alone", async () => {
    const { hook, rideDocumentStore, plannerUiStore } = mount(source({ accuracyMeters: 8 }));
    act(() => hook.result.current.locateMe?.onLocate());
    expect(hook.result.current.locateMe?.locating).toBe(true);
    await waitFor(() => expect(hook.result.current.riderPosition).toEqual({ coordinate: HERE, confidence: "good" }));
    expect(hook.result.current.locateMe?.locating).toBe(false);
    expect(plannerUiStore.getState().fitRequest?.extent).toEqual(locateExtent(HERE));
    expect(rideDocumentStore.getState().document.intent.start).toBeNull();
    expect(rideDocumentStore.getState().document.revision).toBe(0);
  });

  it("draws a loose fix as uncertain", async () => {
    const { hook } = mount(source({ accuracyMeters: 900 }));
    act(() => hook.result.current.locateMe?.onLocate());
    await waitFor(() => expect(hook.result.current.riderPosition?.confidence).toBe("degraded"));
  });

  it("says why when location is off, and moves nothing", async () => {
    const { hook, plannerUiStore } = mount(source("permission-denied"));
    act(() => hook.result.current.locateMe?.onLocate());
    await waitFor(() => expect(hook.result.current.locateMe?.failure).toBe(LOCATE_ME_FAILURE_COPY["permission-denied"]));
    expect(hook.result.current.riderPosition).toBeNull();
    expect(plannerUiStore.getState().fitRequest).toBeNull();
  });

  it("is absent when the surface cannot locate", () => {
    const { hook } = mount(undefined);
    expect(hook.result.current.locateMe).toBeUndefined();
  });

  it("the dot is drawn, but never pulls the ride's own framing", () => {
    const scene = buildMapScene({
      document: createRideDocument(),
      session: emptyPlanningSession(),
      uiState: { selectedObject: null },
      readGeometry: () => null,
      riderPosition: { coordinate: HERE, confidence: "good" },
    });
    expect(scene.riderPosition?.coordinate).toEqual(HERE);
    expect(sceneCoordinates(scene)).not.toContainEqual(HERE);
  });
});
