/**
 * The chip after Gas, wired to the row: one contextual suggestion from the
 * hour, the sun and the open route's fuel gaps. Tapping it runs the search its
 * matching chip already runs, and the row never grows past its five chips.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { METERS_PER_MILE, type MapLayersSource } from "@/application/map-layers";
import { chipRow, SEARCH_CHIPS, TopSearch } from "@/ui/place/TopSearch";

const BIAS = { lat: 40.5, lon: -75 };
const PORT = { search: vi.fn(async () => ({ status: "ok" as const, places: [] })), reverse: vi.fn(async () => null) };

/** A straight 69-mile leg north along -75°, so miles and along-route metres agree. */
const ROUTE = {
  routeId: "route_a",
  geometry: [
    { lon: -75, lat: 40 },
    { lon: -75, lat: 41 },
  ],
};

function station(id: string, alongMiles: number) {
  return {
    feature: {
      id,
      layerId: "fuel" as const,
      name: id,
      detail: null,
      weight: null,
      geometry: { type: "Point" as const, coordinates: [-75, 40 + alongMiles / 69] as [number, number] },
    },
    alongMeters: alongMiles * METERS_PER_MILE,
    offMeters: 30,
  };
}

function source(stops: ReturnType<typeof station>[], available = true): MapLayersSource {
  return { load: vi.fn(), trafficTileUrl: null, along: vi.fn(async () => ({ available, stops })) };
}

function chips() {
  return screen.getByLabelText("Nearby places");
}

function renderTopSearch(route: typeof ROUTE | null, mapLayers: MapLayersSource | undefined) {
  const onChip = vi.fn();
  render(
    <TopSearch
      search={{ port: PORT, onPick: vi.fn() }}
      bias={BIAS}
      selected={false}
      activeChip={null}
      layerOn={() => false}
      onClear={vi.fn()}
      onChip={onChip}
      onLayer={vi.fn()}
      route={route}
      mapLayers={mapLayers}
    />,
  );
  return onChip;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("chipRow", () => {
  const ORDER = ["gas", "food", "coffee", "moto", "lodging"] as const;

  it("keeps the row at five chips with the suggestion right after Gas", () => {
    const row = chipRow([...ORDER], { id: "coffee", label: "Coffee nearby", reason: "morning" });
    expect(row.map((item) => item.label)).toEqual(["Gas", "Coffee nearby", "Food", "Moto shop", "Lodging"]);
    expect(row.map((item) => item.smart)).toEqual([false, true, false, false, false]);
    // Tapping it runs the coffee search the row already knew.
    expect(row[1]?.chip.id).toBe("coffee");
  });

  it("moves a later matched chip up instead of showing it twice", () => {
    const row = chipRow([...ORDER], { id: "lodging", label: "Lodging", reason: "late" });
    expect(row.map((item) => item.chip.id)).toEqual(["gas", "lodging", "food", "coffee", "moto"]);
  });

  it("makes room for the fuel suggestion, because Gas keeps its own chip", () => {
    const row = chipRow([...ORDER], { id: "gas", label: "Fuel before the gap", reason: "fuel-gap" });
    expect(row.map((item) => item.label)).toEqual(["Gas", "Fuel before the gap", "Coffee", "Moto shop", "Lodging"]);
    expect(row[1]?.chip.id).toBe("gas");
  });

  it("is the plain hour order when nothing is suggested", () => {
    const row = chipRow([...ORDER], null);
    expect(row.map((item) => item.label)).toEqual(["Gas", "Food", "Coffee", "Moto shop", "Lodging"]);
    expect(row.some((item) => item.smart)).toBe(false);
  });
});

describe("the chip after Gas in the top bar", () => {
  it("suggests fuel before a dry stretch longer than 60 mi, and searches gas", async () => {
    const onChip = renderTopSearch(ROUTE, source([station("early", 1), station("late", 2)]));
    const smart = await screen.findByTestId("smart-chip-gas");
    expect(smart).toHaveTextContent("Fuel before the gap");
    expect(smart).toHaveAttribute("data-smart", "true");
    // One chip after Gas, and the row stays the five chips it always had.
    const labels = Array.from(chips().querySelectorAll("button")).map((button) => button.textContent);
    expect(labels[0]).toBe("Gas");
    expect(labels[1]).toBe("Fuel before the gap");
    expect(screen.getAllByTestId(/^(search|smart)-chip-/u)).toHaveLength(5);
    fireEvent.click(smart);
    expect(onChip).toHaveBeenCalledWith(SEARCH_CHIPS[0]);
  });

  it("does not raise the fuel chip while the stations are only a few miles apart", async () => {
    const mapLayers = source([station("a", 10), station("b", 20), station("c", 30), station("d", 40), station("e", 55)]);
    renderTopSearch(ROUTE, mapLayers);
    await waitFor(() => expect(mapLayers.along).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("smart-chip-gas")).toBeNull());
    expect(screen.queryByText("Fuel before the gap")).toBeNull();
  });

  it("says nothing about fuel when the stations could not be checked", async () => {
    const failed = source([], false);
    renderTopSearch(ROUTE, failed);
    await waitFor(() => expect(failed.along).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("smart-chip-gas")).toBeNull());
  });

  it("asks for no fuel search without an open route", async () => {
    const mapLayers = source([]);
    renderTopSearch(null, mapLayers);
    await waitFor(() => expect(screen.queryByTestId("smart-chip-gas")).toBeNull());
    expect(mapLayers.along).not.toHaveBeenCalled();
  });
});
