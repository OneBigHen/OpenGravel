import { describe, expect, it } from "vitest";
import { createRideDocumentStore, directionsCommand, loopFromCommand, placeStartCommand } from "@/ui/stores/ride-document-store";

const place = { label: "Coffee", provider: "test", coordinate: { lat: 40.6, lon: -75.4 } };
const fix = { coordinate: { lat: 40.8, lon: -75.7 }, accuracyMeters: 10, observedAt: "2026-10-25T12:00:00Z" };

describe("Directions and loop commands", () => {
  it("sets both endpoints as one history entry and one undo restores the prior ride", () => {
    const store = createRideDocumentStore();
    store.getState().dispatch(placeStartCommand(store.getState().document, place.coordinate));
    const before = store.getState().document;
    const result = store.getState().dispatch(directionsCommand(before, place, fix));
    expect(result.outcome).toBe("applied");
    const after = store.getState().document;
    expect(after.intent.start?.coordinate).toEqual(fix.coordinate);
    expect(after.intent.finish?.label).toBe("Coffee");
    expect(after.intent.shape).toBe("destination");
    expect(after.history.entries.length).toBe(before.history.entries.length + 1);
    store.getState().undo();
    expect(store.getState().document.intent).toEqual(before.intent);
  });
  it("clears an old start when no current location is available", () => {
    const store = createRideDocumentStore();
    store.getState().dispatch(placeStartCommand(store.getState().document, fix.coordinate));
    store.getState().dispatch(directionsCommand(store.getState().document, place, null));
    expect(store.getState().document.intent.start).toBeNull();
    expect(store.getState().document.intent.finish?.coordinate).toEqual(place.coordinate);
  });
  it("rejects invalid coordinates atomically", () => {
    const store = createRideDocumentStore();
    const before = store.getState().document;
    const result = store.getState().dispatch(directionsCommand(before, { ...place, coordinate: { lat: 91, lon: 0 } }, fix));
    expect(result.outcome).toBe("invalid");
    expect(store.getState().document).toBe(before);
  });
  it("makes a one hour loop in a single undo step", () => {
    const store = createRideDocumentStore();
    const before = store.getState().document;
    store.getState().dispatch(loopFromCommand(before, fix.coordinate));
    expect(store.getState().document.intent.shape).toBe("loop");
    expect(store.getState().document.intent.time).toEqual({ kind: "budget", targetMinutes: 60, toleranceMinutes: 15 });
    store.getState().undo();
    expect(store.getState().document.intent).toEqual(before.intent);
  });
});
