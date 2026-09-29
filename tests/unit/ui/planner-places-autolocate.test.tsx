import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PositionSource } from "@/application/ride-session/position-pipeline";
import { createGarage, snapshotOf } from "@/application/garage/garage-model";
import { createRideDocument } from "@/domain/ride/create";
import { usePlannerPlaces } from "@/ui/planner/usePlannerPlaces";
import { createPlannerUiStore } from "@/ui/stores/planner-ui-store";
import { createRideDocumentStore, roadCharacterCommand } from "@/ui/stores/ride-document-store";

const HERE = { lon: -75.3851, lat: 40.0948 };

function source(permission: "granted" | "prompt" | "denied", fixDelayMs = 0): PositionSource & { watch: ReturnType<typeof vi.fn> } {
  return {
    permission: vi.fn(async () => permission),
    watch: vi.fn((observer) => {
      setTimeout(() => observer.position({
        coordinate: HERE, observedAt: new Date().toISOString(), accuracyMeters: 8, headingDegrees: null, speedMps: null,
      }), fixDelayMs);
      return { stop: () => undefined };
    }),
  };
}

function mount(permission: "granted" | "prompt" | "denied", document = createRideDocument(), fixDelayMs = 0, autoLocate?: "ask") {
  const rideDocumentStore = createRideDocumentStore({ document });
  const plannerUiStore = createPlannerUiStore();
  const position = source(permission, fixDelayMs);
  const places = { search: { search: vi.fn(), reverse: vi.fn() }, names: { request: vi.fn(), nameFor: vi.fn(() => null), subscribe: () => () => undefined, version: () => 0 }, position, ...(autoLocate === undefined ? {} : { autoLocate }) } as never;
  const hook = renderHook(() => usePlannerPlaces({ document: rideDocumentStore.getState().document, rideDocumentStore, plannerUiStore, places }));
  return { rideDocumentStore, position, unmount: hook.unmount };
}

describe("a fresh ride opens on the rider", () => {
  it("sets Start to the current location when location is already granted", async () => {
    const { rideDocumentStore } = mount("granted");
    await waitFor(() => expect(rideDocumentStore.getState().document.intent.start?.coordinate).toEqual(HERE));
  });

  it("never prompts for location on load", async () => {
    const { rideDocumentStore, position } = mount("prompt");
    await waitFor(() => expect(position.permission).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(position.watch).not.toHaveBeenCalled();
    expect(rideDocumentStore.getState().document.intent.start).toBeNull();
  });

  it("drops a fix that arrives after the rider left the planner (Record, Just ride)", async () => {
    const { rideDocumentStore, position, unmount } = mount("granted", createRideDocument(), 250);
    await waitFor(() => expect(position.watch).toHaveBeenCalled());
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(rideDocumentStore.getState().document.intent.start).toBeNull();
    expect(rideDocumentStore.getState().document.revision).toBe(0);
  });

  it("in the installed app, asks on first open: the Permissions API cannot see the app's grant", async () => {
    const { rideDocumentStore } = mount("prompt", createRideDocument(), 0, "ask");
    await waitFor(() => expect(rideDocumentStore.getState().document.intent.start?.coordinate).toEqual(HERE));
  });

  it("never asks after the rider said no", async () => {
    const { rideDocumentStore, position } = mount("denied", createRideDocument(), 0, "ask");
    await waitFor(() => expect(position.permission).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(position.watch).not.toHaveBeenCalled();
    expect(rideDocumentStore.getState().document.intent.start).toBeNull();
  });

  it("still fills Start when startup edits the ride before the fix lands (the garage's bike)", async () => {
    const { rideDocumentStore } = mount("granted", createRideDocument(), 60);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const state = rideDocumentStore.getState();
    expect(state.dispatch(roadCharacterCommand(state.document, "curvy")).outcome).toBe("applied");
    await waitFor(() => expect(rideDocumentStore.getState().document.intent.start?.coordinate).toEqual(HERE));
  });

  it("waits for startup to seed the garage's bike before setting Start (a fast fix kept the default bike)", async () => {
    let finishRestore: (pointer: null) => void = () => undefined;
    const repository = {
      loadDraftPointer: () => new Promise<null>((resolve) => { finishRestore = resolve; }),
    } as never;
    const trail = { ...snapshotOf(createGarage().bikes[0]!), bikeId: "bike_trail", fuelRangeMiles: 60 };
    const rideDocumentStore = createRideDocumentStore({ repository, newRideBike: () => trail });
    expect(rideDocumentStore.getState().restoreStatus.state).toBe("loading");
    const plannerUiStore = createPlannerUiStore();
    const position = source("granted");
    const places = { search: { search: vi.fn(), reverse: vi.fn() }, names: { request: vi.fn(), nameFor: vi.fn(() => null), subscribe: () => () => undefined, version: () => 0 }, position } as never;
    renderHook(() => usePlannerPlaces({ document: rideDocumentStore.getState().document, rideDocumentStore, plannerUiStore, places }));
    await waitFor(() => expect(position.watch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rideDocumentStore.getState().document.intent.start).toBeNull();
    finishRestore(null);
    await waitFor(() => expect(rideDocumentStore.getState().document.intent.start?.coordinate).toEqual(HERE));
    expect(rideDocumentStore.getState().document.intent.bike.bikeId).toBe("bike_trail");
  });
});
