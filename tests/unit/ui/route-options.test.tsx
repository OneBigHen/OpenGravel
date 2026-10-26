import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RouteOptions } from "@/ui/planner/RouteOptions";
import { usePlannerRideStyle } from "@/ui/planner/usePlannerRideStyle";
import { createRideDocumentStore, placeStartCommand, placeFinishCommand } from "@/ui/stores/ride-document-store";
import type { RouteCardVm } from "@/application/planner/planner-view-model";
import { asRouteCandidateId } from "@/domain/route/ids";

afterEach(cleanup);
const card: RouteCardVm = { routeId: asRouteCandidateId("a"), roleKey: "fastest", roleLabel: "Fastest", durationLabel: "25 min", distanceLabel: "20 mi", addedTimeLabel: null, badges: [], unknownSurfaceMi: null, whyKey: "a", isSelected: true };
it("shows the trip, reverses through the existing ride.reverse command and exposes Edit and Options", () => {
  const store = createRideDocumentStore();
  store.getState().dispatch(placeStartCommand(store.getState().document, { lat: 40, lon: -75 }));
  store.getState().dispatch(placeFinishCommand(store.getState().document, { lat: 41, lon: -74 }));
  const original = store.getState().document.intent;
  const style = renderHook(() => usePlannerRideStyle({ document: store.getState().document, rideDocumentStore: store }));
  const onEdit = vi.fn(), onOptions = vi.fn(), onStart = vi.fn();
  render(<RouteOptions cards={[card]} onSelect={vi.fn()} startLabel="My location" finishLabel="Wawa Gas, PA"
    onReverse={style.result.current.actions.reverse} onEdit={onEdit} onOptions={onOptions}
    start={{ starting: false, refusal: null, error: null, onStart }}/>);
  expect(screen.getByTestId("route-options-header")).toHaveTextContent("My location → Wawa Gas");
  fireEvent.click(screen.getByRole("button", { name: "Swap start and destination" }));
  expect(store.getState().document.intent.start?.coordinate).toEqual(original.finish?.coordinate);
  expect(store.getState().document.intent.finish?.coordinate).toEqual(original.start?.coordinate);
  fireEvent.click(screen.getByRole("button", { name: "Edit" })); expect(onEdit).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: /Options/ })); expect(onOptions).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Start ride" })); expect(onStart).toHaveBeenCalledOnce();
  expect(screen.getAllByTestId("start-ride")).toHaveLength(1);
  expect(screen.getByTestId("route-option-fastest")).toHaveAttribute("aria-pressed", "true");
});
