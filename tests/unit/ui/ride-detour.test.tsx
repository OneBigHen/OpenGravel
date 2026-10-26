import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlaceMatch, PlaceSearchPort } from "@/application/geocoding/place-search";
import type { MapLayersSource } from "@/application/map-layers";
import { RideDetour } from "@/ui/ride/RideDetour";
import { ALONG_RIDE_SEARCH_DEBOUNCE_MS, RIDE_PLACE_SEARCH_UNAVAILABLE } from "@/ui/ride/RideStopSearch";

/** Route changes mid-ride: the reroute control, the fuel-ahead list and the
 *  "search along this ride" row (UX rework phase 9). */

const LINE = [
  { lon: -75.0, lat: 40.0 },
  { lon: -75.0, lat: 40.5 },
];

function station(id: string, name: string, lat: number, alongMeters: number) {
  return {
    feature: { id, layerId: "fuel" as const, name, detail: null, weight: null, geometry: { type: "Point" as const, coordinates: [-75.0, lat] as const } },
    alongMeters,
    offMeters: 40,
  };
}

function source(): MapLayersSource {
  return {
    load: vi.fn(),
    trafficTileUrl: null,
    along: vi.fn(async () => ({
      available: true,
      stops: [
        station("behind", "Behind Gas", 40.01, 1_000),
        station("far", "Far Fuel", 40.3, 33_000),
        station("near", "Near Fuel", 40.1, 11_000),
      ],
    })),
  };
}

afterEach(cleanup);

function searchedPlace(id: string, name: string, lat: number): PlaceMatch {
  return {
    id,
    label: `${name}, PA`,
    name,
    context: "Carbon County, PA",
    coordinate: { lon: -75.0, lat },
    provider: "fixture",
  };
}

function placeSearch(
  answer: Awaited<ReturnType<PlaceSearchPort["search"]>>,
): PlaceSearchPort {
  return { search: vi.fn(async () => answer), reverse: vi.fn(async () => null) };
}

describe("RideDetour", () => {
  it("lists stations ahead of the rider, nearest first, and routes via the chosen one", async () => {
    const onReroute = vi.fn();
    render(
      <RideDetour
        offRoute={false}
        busy={false}
        message={null}
        error={null}
        routeLine={LINE}
        position={{ lon: -75.0, lat: 40.05 }}
        fixGood
        source={source()}
        onReroute={onReroute}
        onEasierWayBack={vi.fn()}
        onTurnAround={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("ride-add-stop"));
    fireEvent.click(screen.getByTestId("ride-fuel-ahead"));
    const list = await screen.findByTestId("ride-fuel-list");
    expect(list.textContent).not.toContain("Behind Gas");
    const rows = list.querySelectorAll("li");
    expect(rows[0]?.textContent).toContain("Near Fuel");
    expect(rows[1]?.textContent).toContain("Far Fuel");

    fireEvent.click(screen.getByRole("button", { name: "Route via Near Fuel" }));
    expect(onReroute).toHaveBeenCalledWith({ coordinate: { lon: -75.0, lat: 40.1 }, label: "Near Fuel" });
  });

  it("asks the same along-route source for food when the rider picks Food", async () => {
    const src = source();
    render(
      <RideDetour offRoute={false} busy={false} message={null} error={null} routeLine={LINE} position={{ lon: -75.0, lat: 40.05 }} fixGood source={src} onReroute={vi.fn()} onEasierWayBack={vi.fn()} onTurnAround={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("ride-add-stop"));
    fireEvent.click(screen.getByTestId("ride-food-ahead"));
    await screen.findByTestId("ride-fuel-list");
    expect(src.along).toHaveBeenCalledWith(expect.anything(), "food");
  });

  it("offers a new route from here when off the line, and holds it without a good fix", () => {
    const onReroute = vi.fn();
    const { rerender } = render(
      <RideDetour offRoute busy={false} message={null} error={null} routeLine={LINE} position={null} fixGood={false} onReroute={onReroute} onEasierWayBack={vi.fn()} onTurnAround={vi.fn()} />,
    );
    const button = screen.getByTestId("ride-reroute");
    expect(button.textContent).toBe("New route from here");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("ride-reroute-status")).toBeNull();

    rerender(
      <RideDetour offRoute busy message="Finding a new route from here…" error={null} routeLine={LINE} position={null} fixGood onReroute={onReroute} onEasierWayBack={vi.fn()} onTurnAround={vi.fn()} />,
    );
    expect(screen.getByTestId("ride-reroute-status").textContent).toBe("Finding a new route from here…");
    expect(screen.getByTestId("ride-reroute").textContent).toBe("Routing…");
  });

  it("offers easier-return and turn-around controls through the same GPS/busy gate", () => {
    const onEasierWayBack = vi.fn();
    const onTurnAround = vi.fn();
    const { rerender } = render(
      <RideDetour
        offRoute={false}
        busy={false}
        message={null}
        error={null}
        routeLine={LINE}
        position={{ lon: -75.0, lat: 40.05 }}
        fixGood
        onReroute={vi.fn()}
        onEasierWayBack={onEasierWayBack}
        onTurnAround={onTurnAround}
      />,
    );

    fireEvent.click(screen.getByTestId("ride-easier-way-back"));
    fireEvent.click(screen.getByTestId("ride-turn-around"));
    expect(onEasierWayBack).toHaveBeenCalledOnce();
    expect(onTurnAround).toHaveBeenCalledOnce();

    rerender(
      <RideDetour
        offRoute={false}
        busy={false}
        message={null}
        error={null}
        routeLine={LINE}
        position={{ lon: -75.0, lat: 40.05 }}
        fixGood={false}
        onReroute={vi.fn()}
        onEasierWayBack={onEasierWayBack}
        onTurnAround={onTurnAround}
      />,
    );
    expect(screen.getByTestId("ride-easier-way-back")).toBeDisabled();
    expect(screen.getByTestId("ride-turn-around")).toBeDisabled();
  });

  it("keeps Gas and Food and adds Coffee, Lodging and a search box to the same stop picker", async () => {
    const search = placeSearch({ status: "ok", places: [] });
    render(
      <RideDetour offRoute={false} busy={false} message={null} error={null} routeLine={LINE} position={{ lon: -75.0, lat: 40.05 }} fixGood source={source()} search={search} onReroute={vi.fn()} onEasierWayBack={vi.fn()} onTurnAround={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("ride-add-stop"));
    expect(screen.getByTestId("ride-fuel-ahead")).toBeInTheDocument();
    expect(screen.getByTestId("ride-food-ahead")).toBeInTheDocument();
    expect(screen.getByTestId("ride-stop-search-field")).toBeInTheDocument();
    expect(screen.getByTestId("ride-stop-coffee")).toHaveTextContent("Coffee");
    expect(screen.getByTestId("ride-stop-lodging")).toHaveTextContent("Lodging");

    // The chip asks the shared category table's own lookup, biased to the rider.
    fireEvent.click(screen.getByTestId("ride-stop-coffee"));
    await screen.findByText(/No places found for/);
    expect(search.search).toHaveBeenCalledWith("coffee shop", expect.objectContaining({ bias: { lon: -75.0, lat: 40.05 } }));
  });

  it("orders searched places along the part of the ride ahead and adds one as the next stop", async () => {
    const onReroute = vi.fn();
    const search = placeSearch({
      status: "ok",
      places: [
        searchedPlace("far", "Far Diner", 40.4),
        searchedPlace("behind", "Passed Cafe", 40.01),
        searchedPlace("near", "Near Coffee", 40.1),
      ],
    });
    render(
      <RideDetour offRoute={false} busy={false} message={null} error={null} routeLine={LINE} position={{ lon: -75.0, lat: 40.05 }} fixGood search={search} remainingMeters={40_000} remainingSeconds={2_400} onReroute={onReroute} onEasierWayBack={vi.fn()} onTurnAround={vi.fn()} />,
    );
    // No POI layer port at all: the search still works on its own.
    fireEvent.click(screen.getByTestId("ride-add-stop"));
    expect(screen.queryByTestId("ride-fuel-ahead")).toBeNull();
    fireEvent.change(screen.getByTestId("ride-stop-search-field"), { target: { value: "coffee" } });
    fireEvent.keyDown(screen.getByTestId("ride-stop-search-field"), { key: "Enter" });

    const list = await screen.findByTestId("ride-stop-results");
    const rows = list.querySelectorAll("li");
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain("Near Coffee");
    expect(rows[1]?.textContent).toContain("Far Diner");
    expect(rows[2]?.textContent).toContain("Passed Cafe");
    expect(rows[2]?.textContent).toContain("Behind you");

    // A tap only selects; the stop is added by the confirm button.
    fireEvent.click(rows[0]!.querySelector("button")!);
    expect(onReroute).not.toHaveBeenCalled();
    const confirm = await screen.findByTestId("ride-stop-confirm");
    expect(confirm.textContent).toContain("Near Coffee");
    fireEvent.click(screen.getByTestId("ride-stop-confirm-go"));
    expect(onReroute).toHaveBeenCalledWith({ coordinate: { lon: -75.0, lat: 40.1 }, label: "Near Coffee" });
    // The picker closes with the stop, as the Gas and Food rows do.
    expect(screen.queryByTestId("ride-stop-search-field")).toBeNull();
  });

  it("says when place search is unavailable", async () => {
    const search = placeSearch({ status: "unavailable", reason: "fixture" });
    render(
      <RideDetour offRoute={false} busy={false} message={null} error={null} routeLine={LINE} position={{ lon: -75.0, lat: 40.05 }} fixGood search={search} onReroute={vi.fn()} onEasierWayBack={vi.fn()} onTurnAround={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("ride-add-stop"));
    fireEvent.click(screen.getByTestId("ride-stop-lodging"));
    expect(await screen.findByText(RIDE_PLACE_SEARCH_UNAVAILABLE)).toBeInTheDocument();
  });

  it("holds the confirm until there is a fresh fix, and says why", async () => {
    const search = placeSearch({ status: "ok", places: [searchedPlace("near", "Near Coffee", 40.1)] });
    render(
      <RideDetour offRoute={false} busy={false} message={null} error={null} routeLine={LINE} position={{ lon: -75.0, lat: 40.05 }} fixGood={false} search={search} onReroute={vi.fn()} onEasierWayBack={vi.fn()} onTurnAround={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("ride-add-stop"));
    fireEvent.click(screen.getByTestId("ride-stop-coffee"));
    fireEvent.click(await screen.findByTestId("ride-stop-option"));
    const go = await screen.findByTestId("ride-stop-confirm-go");
    expect(go).toBeDisabled();
    expect(go).toHaveAttribute("title", "Routing to a stop needs a fresh, accurate GPS fix.");
  });

  it("asks once after the rider stops typing", async () => {
    vi.useFakeTimers();
    try {
      const search = placeSearch({ status: "ok", places: [] });
      render(
        <RideDetour offRoute={false} busy={false} message={null} error={null} routeLine={LINE} position={{ lon: -75.0, lat: 40.05 }} fixGood search={search} onReroute={vi.fn()} onEasierWayBack={vi.fn()} onTurnAround={vi.fn()} />,
      );
      fireEvent.click(screen.getByTestId("ride-add-stop"));
      const field = screen.getByTestId("ride-stop-search-field");
      fireEvent.change(field, { target: { value: "ha" } });
      fireEvent.change(field, { target: { value: "hawk" } });
      expect(search.search).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(ALONG_RIDE_SEARCH_DEBOUNCE_MS);
      expect(search.search).toHaveBeenCalledOnce();
      expect(search.search).toHaveBeenCalledWith("hawk", expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not offer to search along a ride with no line to measure", () => {
    render(
      <RideDetour offRoute={false} busy={false} message={null} error={null} routeLine={[]} position={{ lon: -75.0, lat: 40.05 }} fixGood search={placeSearch({ status: "ok", places: [] })} onReroute={vi.fn()} onEasierWayBack={vi.fn()} onTurnAround={vi.fn()} />,
    );
    expect(screen.queryByTestId("ride-add-stop")).toBeNull();
  });
});
