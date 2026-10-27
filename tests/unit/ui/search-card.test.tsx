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
    expect(screen.getByTestId("place-card")).toHaveTextContent(place.name);
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
    expect(screen.getByTestId("place-sheet")).not.toHaveTextContent("Drive time");
  });
  it("shows the drive time only when it is known", () => {
    card({ driveTime: null });
    expect(screen.getByTestId("place-sheet")).toHaveTextContent(/mi away/);
    expect(screen.getByTestId("place-sheet")).not.toHaveTextContent("Drive time");
    card({ driveTime: "5 min drive" });
    expect(screen.getAllByTestId("place-sheet").at(-1)).toHaveTextContent("5 min drive");
  });
});

describe("top search and toast", () => {
  it("renders one search, five place chips and two layer switches", () => {
    const onChip = vi.fn(), onClear = vi.fn(), onLayer = vi.fn();
    render(<TopSearch search={{ port, onPick: vi.fn() }} bias={rider} selected activeChip={null} layerOn={() => false} onClear={onClear} onChip={onChip} onLayer={onLayer}/>);
    expect(screen.getByPlaceholderText("Search here")).toBeInTheDocument();
    expect(screen.queryByTestId("search-chip-twisty")).toBeNull();
    // Clear, five place chips, two layer switches, and the named Menu beside the search.
    expect(screen.getAllByRole("button")).toHaveLength(9);
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
    const gas = screen.getByTestId("search-chip-gas");
    expect(gas.querySelector("svg")).not.toBeNull();
    expect(gas).toHaveTextContent("Gas");
    expect(gas.textContent).not.toMatch(/⛽/u);
    fireEvent.click(gas);
    expect(onChip).toHaveBeenCalledWith({ id: "gas", label: "Gas", query: "gas", empty: "No gas in this area" });
    fireEvent.click(screen.getByTestId("layer-chip-twisty"));
    expect(onLayer).toHaveBeenCalledWith({ id: "twisty", layer: "great-roads", label: "Twisty roads layer" });
    expect(onChip).toHaveBeenCalledOnce();
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
  it("a category supplies map pins, frames them above the sheet, and opens a card without editing", async () => {
    const view = flow(); const before = view.rideStore.getState().document;
    render(<>{view.result.current.top}</>);
    await act(async () => fireEvent.click(screen.getByTestId("search-chip-gas")));
    expect(view.result.current.pins).toHaveLength(1);
    expect(view.result.current.pins[0]?.glyph).toBe("gas");
    expect(view.result.current.pins[0]?.coordinate).toEqual(place.coordinate);
    expect(view.uiStore.getState().fitRequest?.extent).toMatchObject({ minLat: place.coordinate.lat - .004, maxLat: place.coordinate.lat + .004 });
    render(<>{view.result.current.sheet}</>);
    fireEvent.click(screen.getByTestId("category-result"));
    expect(view.rideStore.getState().document).toBe(before);
    expect(view.result.current.pins[0]?.selected).toBe(true);
  });
  it("an empty category names what is missing and searches the map view on request", async () => {
    const view = flow();
    vi.mocked(port.search).mockResolvedValueOnce({ status: "ok", places: [] });
    render(<>{view.result.current.top}</>);
    await act(async () => fireEvent.click(screen.getByTestId("search-chip-gas")));
    act(() => view.result.current.onViewport({ minLat: 40, maxLat: 41, minLon: -76, maxLon: -75 }));
    render(<>{view.result.current.sheet}</>);
    expect(screen.getByTestId("category-results")).toHaveTextContent("No gas in this area");
    expect(screen.queryByText(/No places found here/)).toBeNull();
    await act(async () => fireEvent.click(screen.getByTestId("search-this-area")));
    expect(port.search).toHaveBeenLastCalledWith("gas", expect.objectContaining({ bias: { lat: 40.5, lon: -75.5 } }));
    expect(view.result.current.pins).toHaveLength(1);
  });
  it("a layer chip switches the road overlay instead of searching places", async () => {
    const view = flow();
    render(<>{view.result.current.top}</>);
    await act(async () => fireEvent.click(screen.getByTestId("layer-chip-twisty")));
    expect(port.search).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem("ogv.map-layers.v1") ?? "[]")).toContain("great-roads");
    render(<>{view.result.current.toast}</>);
    expect(screen.getByTestId("rider-toast")).toHaveTextContent("Twisty roads layer on");
    await act(async () => fireEvent.click(screen.getByTestId("layer-chip-twisty")));
    expect(JSON.parse(window.localStorage.getItem("ogv.map-layers.v1") ?? "[]")).not.toContain("great-roads");
  });
  it("shares its own coordinate and the app, never a Google Maps link, and says so", async () => {
    const share = vi.fn(async (data: ShareData) => { void data; });
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    const view = flow();
    act(() => view.result.current.composerSearch?.onPick("finish", place, "coffee"));
    render(<>{view.result.current.sheet}</>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share" })));
    expect(share).toHaveBeenCalledOnce();
    const payload = share.mock.calls[0]?.[0] as { readonly text: string; readonly url?: string };
    expect(payload.text).toBe("Mountain Coffee — 40.87000, -75.73000");
    expect(payload.url).toBe(window.location.origin);
    expect(JSON.stringify(payload)).not.toContain("google");
    render(<>{view.result.current.toast}</>);
    expect(screen.getByTestId("rider-toast")).toHaveTextContent("Place shared");
    Reflect.deleteProperty(navigator, "share");
  });
  it("copies the place when the share sheet refuses", async () => {
    const share = vi.fn(async (data: ShareData) => { void data; throw new Error("not allowed"); });
    const writeText = vi.fn(async (text: string) => { void text; });
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const view = flow();
    act(() => view.result.current.composerSearch?.onPick("finish", place, "coffee"));
    render(<>{view.result.current.sheet}</>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share" })));
    expect(share).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledOnce();
    render(<>{view.result.current.toast}</>);
    expect(screen.getByTestId("rider-toast")).toHaveTextContent("Place copied");
    Reflect.deleteProperty(navigator, "share");
    Reflect.deleteProperty(navigator, "clipboard");
  });
  it("copies the same place when the phone has no share sheet", async () => {
    const writeText = vi.fn(async (text: string) => { void text; });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    const view = flow();
    act(() => view.result.current.composerSearch?.onPick("finish", place, "coffee"));
    render(<>{view.result.current.sheet}</>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share" })));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Mountain Coffee — 40.87000, -75.73000"));
    expect(writeText.mock.calls[0]?.[0]).not.toContain("google");
    render(<>{view.result.current.toast}</>);
    expect(screen.getByTestId("rider-toast")).toHaveTextContent("Place copied");
    Reflect.deleteProperty(navigator, "clipboard");
  });
  it("calls the start action the same thing for a searched place as for a pin", () => {
    const view = flow();
    act(() => view.result.current.composerSearch?.onPick("start", place, "coffee"));
    render(<>{view.result.current.sheet}</>);
    expect(screen.getByRole("button", { name: "Start here" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use as start" })).toBeNull();
  });
  it("a search pick never authors the ride; Directions plans once and Undo restores it", async () => {
    const view = flow(); const before = view.rideStore.getState().document;
    act(() => view.result.current.composerSearch?.onPick("finish", place, "coffee"));
    expect(view.rideStore.getState().document).toBe(before);
    render(<>{view.result.current.sheet}</>);
    await act(async () => fireEvent.click(screen.getByTestId("place-directions")));
    expect(view.onDirectionsReady).toHaveBeenCalledOnce();
    expect(view.uiStore.getState().fitRequest?.extent).toBeNull();
    expect(view.uiStore.getState().cameraUserOwned).toBe(false);
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
