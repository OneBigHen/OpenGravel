import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocateOutcome } from "@/application/geocoding/locate-once";
import type { PlaceMatch } from "@/application/geocoding/place-search";
import { PlaceSheet } from "@/ui/place/PlaceSheet";
import { RiderToast } from "@/ui/place/RiderToast";
import { TopSearch } from "@/ui/place/TopSearch";
import { usePlaceFlow } from "@/ui/place/usePlaceFlow";
import { createRideDocumentStore, placeStartCommand } from "@/ui/stores/ride-document-store";
import { createPlannerUiStore } from "@/ui/stores/planner-ui-store";
import type { PlannerPlaceServices } from "@/ui/planner/usePlannerPlaces";

const place: PlaceMatch = { id: "coffee", name: "Mountain Coffee", label: "Mountain Coffee, PA", context: "Jim Thorpe", coordinate: { lat: 40.87, lon: -75.73 }, provider: "test", openNow: true };
const rider = { lat: 40.8757, lon: -75.7324 };
const port = { search: vi.fn(async () => ({ status: "ok" as const, places: [place] })), reverse: vi.fn(async () => null) };
const services: PlannerPlaceServices = { search: port, names: { nameFor: () => undefined, request: () => undefined, subscribe: () => () => undefined, version: () => 0 } };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

function card(extra: Partial<Parameters<typeof PlaceSheet>[0]> = {}) {
  const handlers = { onDirections: vi.fn(), onSave: vi.fn(), onShare: vi.fn(), onClose: vi.fn() };
  render(<PlaceSheet place={place} rider={rider} {...handlers} {...extra}/>);
  return handlers;
}

describe("universal place sheet", () => {
  it("leads with Directions, names the place and labels straight-line distance away", () => {
    card({ driveTime: "5 min drive" });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(place.name);
    expect(screen.getByTestId("place-sheet")).toHaveTextContent(/mi away.*5 min drive/);
    expect(screen.getByTestId("place-directions")).toHaveTextContent("Directions");
    expect(screen.queryByRole("button", { name: "Add stop" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start here" })).toBeNull();
  });
  it("offers route and dropped-pin actions only when supplied", () => {
    const add = vi.fn(), start = vi.fn();
    card({ onAddStop: add, onStart: start });
    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Start here" }));
    expect(add).toHaveBeenCalledOnce(); expect(start).toHaveBeenCalledOnce();
  });
  it("has reachable save, share and close controls", () => {
    const actions = card({ saved: true });
    fireEvent.click(screen.getByRole("button", { name: "Saved" }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: "Close place details" }));
    expect(actions.onSave).toHaveBeenCalledOnce(); expect(actions.onShare).toHaveBeenCalledOnce(); expect(actions.onClose).toHaveBeenCalledOnce();
  });
  it("focuses its heading, closes with Escape and restores the invoker", () => {
    const button = document.createElement("button"); document.body.append(button); button.focus();
    const actions = card();
    expect(screen.getByRole("heading")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(actions.onClose).toHaveBeenCalledOnce();
    cleanup(); expect(button).toHaveFocus(); button.remove();
  });
  it("keeps unknown distance and drive time honest", () => {
    card({ rider: null });
    expect(screen.getByTestId("place-sheet")).toHaveTextContent("Distance needs your location");
    expect(screen.getByTestId("place-sheet")).toHaveTextContent("Drive time after Directions");
  });
});

describe("top search and toast", () => {
  it("renders one search and seven chips; selecting a chip is explicit", () => {
    const onChip = vi.fn(), onClear = vi.fn();
    render(<TopSearch search={{ port, onPick: vi.fn() }} bias={rider} selected activeChip={null} onClear={onClear} onChip={onChip}/>);
    expect(screen.getByPlaceholderText("Search here")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(8);
    fireEvent.click(screen.getByTestId("search-chip-gas"));
    expect(onChip).toHaveBeenCalledWith({ id: "gas", label: "Gas", query: "gas" });
    fireEvent.click(screen.getByLabelText("Clear place")); expect(onClear).toHaveBeenCalledOnce();
  });
  it("expires after four seconds", () => {
    vi.useFakeTimers(); const dismiss = vi.fn();
    render(<RiderToast notice={{ id: 1, message: "Stop added" }} onDismiss={dismiss}/>);
    act(() => vi.advanceTimersByTime(3999)); expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1)); expect(dismiss).toHaveBeenCalledOnce();
  });
  it("undoes with one tap and starts a fresh timeout for a new edit", () => {
    vi.useFakeTimers(); const undo = vi.fn(), dismiss = vi.fn();
    const view = render(<RiderToast notice={{ id: 1, message: "Start set", undo }} onDismiss={dismiss}/>);
    act(() => vi.advanceTimersByTime(3000));
    view.rerender(<RiderToast notice={{ id: 2, message: "Stop added", undo }} onDismiss={dismiss}/>);
    act(() => vi.advanceTimersByTime(1001)); expect(dismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce(); expect(dismiss).toHaveBeenCalledOnce();
  });
});

function flow(locateStart: () => Promise<LocateOutcome> = vi.fn(async () => ({ status: "located" as const, coordinate: rider, accuracyMeters: 10, observedAt: "2026-10-25T12:00:00Z" }))) {
  const rideStore = createRideDocumentStore(), uiStore = createPlannerUiStore(), onDirectionsReady = vi.fn();
  const view = renderHook(() => usePlaceFlow({ services, search: { port, onPick: vi.fn() }, rider, locateStart, rideStore, uiStore, hasRoute: false, onMapPointAction: vi.fn(), onDirectionsReady }));
  return { ...view, rideStore, uiStore, onDirectionsReady };
}

describe("place flow", () => {
  it("a search pick never authors the ride; Directions plans once and Undo restores it", async () => {
    const view = flow(); const before = view.rideStore.getState().document;
    act(() => view.result.current.composerSearch?.onPick("finish", place, "coffee"));
    expect(view.rideStore.getState().document).toBe(before);
    render(<>{view.result.current.sheet}</>);
    await act(async () => fireEvent.click(screen.getByTestId("place-directions")));
    expect(view.onDirectionsReady).toHaveBeenCalledOnce();
    expect(view.rideStore.getState().document.intent.start?.coordinate).toEqual(rider);
    expect(view.rideStore.getState().document.intent.finish?.coordinate).toEqual(place.coordinate);
    render(<>{view.result.current.toast}</>);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(view.rideStore.getState().document.intent).toEqual(before.intent);
  });
  it("What's here opens a pin without editing or planning", () => {
    const view = flow(); const before = view.rideStore.getState().document;
    act(() => view.result.current.pointAction("info", place.coordinate));
    render(<>{view.result.current.sheet}</>);
    expect(screen.getByRole("heading")).toHaveTextContent("Dropped pin");
    expect(view.rideStore.getState().document).toBe(before);
    expect(view.onDirectionsReady).not.toHaveBeenCalled();
  });
  it("Directions to here uses current location, never an old authored start", async () => {
    const view = flow();
    act(() => view.rideStore.getState().dispatch(placeStartCommand(view.rideStore.getState().document, { lat: 30, lon: -70 })));
    await act(async () => view.result.current.pointAction("finish", place.coordinate));
    expect(view.rideStore.getState().document.intent.start?.coordinate).toEqual(rider);
    expect(view.onDirectionsReady).toHaveBeenCalledOnce();
  });
  it("leaves start empty and does not plan when location is denied", async () => {
    const view = flow(async () => ({ status: "failed", code: "permission-denied" }));
    act(() => view.rideStore.getState().dispatch(placeStartCommand(view.rideStore.getState().document, rider)));
    await act(async () => view.result.current.pointAction("finish", place.coordinate));
    expect(view.rideStore.getState().document.intent.start).toBeNull();
    expect(view.rideStore.getState().document.intent.finish?.coordinate).toEqual(place.coordinate);
    expect(view.onDirectionsReady).not.toHaveBeenCalled();
  });
  it("does not overwrite a newer ride edit while location is arriving", async () => {
    let resolve: (value: LocateOutcome) => void = () => undefined;
    const view = flow(() => new Promise<LocateOutcome>((done) => { resolve = done; }));
    act(() => view.result.current.pointAction("finish", place.coordinate));
    act(() => view.rideStore.getState().dispatch(placeStartCommand(view.rideStore.getState().document, { lat: 30, lon: -70 })));
    const edited = view.rideStore.getState().document;
    await act(async () => resolve({ status: "located", coordinate: rider, accuracyMeters: 10, observedAt: "2026-10-25T12:00:00Z" }));
    expect(view.rideStore.getState().document).toBe(edited);
    expect(view.onDirectionsReady).not.toHaveBeenCalled();
  });

});
