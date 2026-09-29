import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlacesSource } from "@/application/places/places-source";
import type { NearbyPlace, PlacesResult } from "@/application/places/types";
import type { Coordinate } from "@/domain/ride/types";
import { PlannerAlongStops } from "@/ui/planner/PlannerAlongStops";

const LINE: readonly Coordinate[] = [
  { lon: -75.2, lat: 40.1 },
  { lon: -75.1, lat: 40.2 },
];

function place(overrides: Partial<NearbyPlace> = {}): NearbyPlace {
  return {
    id: "hh:chickies" as NearbyPlace["id"],
    kind: "happy_hour",
    name: "Chickie's & Pete's",
    coordinate: { lon: -75.15, lat: 40.15 },
    category: "Sports Bar",
    label: "Til 10 PM",
    status: "now",
    city: "Bridgeport",
    address: "",
    specials: ["$3 drafts"],
    schedule: null,
    rating: null,
    popular: false,
    dogFriendly: null,
    patio: null,
    url: "https://example.test/chickies",
    mapsUrl: null,
    offRouteMiles: 0.3,
    routeMile: 42,
    ...overrides,
  };
}

function available(places: readonly NearbyPlace[] = []): PlacesResult {
  return { availability: "available", places, fetchedAt: "2026-09-24T12:00:00.000Z", attribution: "Test" };
}

function sourceFor(alongRoute: PlacesSource["alongRoute"]): PlacesSource {
  return {
    id: "places-test",
    inExtent: vi.fn(async () => available()),
    alongRoute: vi.fn(alongRoute),
  };
}

afterEach(() => cleanup());

describe("PlannerAlongStops", () => {
  it("shows a loading list, then fetches and renders the route rows", async () => {
    let resolve!: (result: PlacesResult) => void;
    const pending = new Promise<PlacesResult>((done) => { resolve = done; });
    const source = sourceFor(() => pending);
    const venue = place();
    render(<PlannerAlongStops route={{ routeId: "route-a", geometry: LINE }} source={source} />);
    fireEvent.click(screen.getByText("Stops along your ride"));

    expect(screen.getByRole("status")).toHaveTextContent("Checking happy hours and events along your route");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    await waitFor(() => expect(source.alongRoute).toHaveBeenCalledTimes(1));
    expect(source.alongRoute).toHaveBeenCalledWith(
      { line: LINE, bufferMiles: 1 },
      { kinds: ["happy_hour", "event"], window: "today" },
      expect.any(AbortSignal),
    );

    await act(async () => resolve(available([venue])));
    expect(screen.getByRole("list", { name: "Stops along your ride" })).toHaveTextContent("Mile 42");
    expect(screen.getByText(/On now · until 10 PM/)).toBeInTheDocument();
    expect(screen.getByText(/0.3 mi off/)).toBeInTheDocument();
  });

  it("uses unavailable copy without exposing provider reasons", async () => {
    const source = sourceFor(async () => ({
      availability: "unavailable",
      places: [],
      reason: "provider token is absent",
      retryable: true,
    }));
    render(<PlannerAlongStops route={{ routeId: "route-a", geometry: LINE }} source={source} />);
    fireEvent.click(screen.getByText("Stops along your ride"));

    expect(await screen.findByText("Places unavailable right now")).toBeInTheDocument();
    expect(screen.queryByText("provider token is absent")).not.toBeInTheDocument();
  });

  it("explains an available empty result", async () => {
    render(
      <PlannerAlongStops
        route={{ routeId: "route-a", geometry: LINE }}
        source={sourceFor(async () => available())}
      />,
    );
    fireEvent.click(screen.getByText("Stops along your ride"));

    expect(await screen.findByText("No happy hours or events within a mile of this route today.")).toBeInTheDocument();
  });

  it("passes the place to Add as stop and marks that row Added", async () => {
    const venue = place();
    const onAddStop = vi.fn();
    render(
      <PlannerAlongStops
        route={{ routeId: "route-a", geometry: LINE }}
        source={sourceFor(async () => available([venue]))}
        onAddStop={onAddStop}
      />,
    );
    fireEvent.click(screen.getByText("Stops along your ride"));

    const button = await screen.findByRole("button", { name: "Add Chickie's & Pete's as a stop" });
    fireEvent.click(button);

    expect(onAddStop).toHaveBeenCalledTimes(1);
    expect(onAddStop).toHaveBeenCalledWith(venue);
    expect(screen.getByRole("button", { name: "Added Chickie's & Pete's as a stop" })).toBeDisabled();
  });

  it("aborts and refetches when the route id changes", async () => {
    const source = sourceFor(async () => available());
    const { rerender } = render(
      <PlannerAlongStops route={{ routeId: "route-a", geometry: LINE }} source={source} />,
    );
    await waitFor(() => expect(source.alongRoute).toHaveBeenCalledTimes(1));
    const firstSignal = vi.mocked(source.alongRoute).mock.calls[0]?.[2];

    rerender(<PlannerAlongStops route={{ routeId: "route-b", geometry: LINE.slice().reverse() }} source={source} />);

    await waitFor(() => expect(source.alongRoute).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);
    expect(source.alongRoute).toHaveBeenLastCalledWith(
      { line: [...LINE].reverse(), bufferMiles: 1 },
      { kinds: ["happy_hour", "event"], window: "today" },
      expect.any(AbortSignal),
    );
  });

  it("renders nothing without a source or route", () => {
    const withoutSource = render(<PlannerAlongStops route={{ routeId: "route-a", geometry: LINE }} />);
    expect(withoutSource.container.firstChild).toBeNull();

    withoutSource.rerender(<PlannerAlongStops route={null} source={sourceFor(async () => available())} />);
    expect(withoutSource.container.firstChild).toBeNull();
  });
});
