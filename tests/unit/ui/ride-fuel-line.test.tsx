import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MapLayersResult, MapLayersSource } from "@/application/map-layers";
import type { GasAhead } from "@/application/ride-session/fuel-ahead";
import { RideFuelLine } from "@/ui/ride/RideFuelLine";

/**
 * "Next gas" on the ride: one line, one button. The maths is pinned in
 * `tests/unit/ride-session/fuel-ahead.test.ts`; this pins what a rider reads and
 * presses, and that a press changes the ride only through the ride's own
 * commands.
 */

const STATION: GasAhead = {
  id: "osm:node/1",
  name: "Sheetz",
  coordinate: { lon: -75.4, lat: 40.2 },
  aheadMiles: 14,
};

afterEach(cleanup);

function guided(overrides: Partial<Parameters<typeof RideFuelLine>[0]> = {}) {
  return (
    <RideFuelLine
      stations={[STATION]}
      stationsFound={1}
      routeKey="route_1"
      alongMiles={0}
      position={{ lon: -75.5, lat: 40.0 }}
      headingDegrees={0}
      usableMiles={120}
      onAddStop={vi.fn()}
      {...overrides}
    />
  );
}

describe("RideFuelLine — a guided ride", () => {
  it("names the next station in plain words, with no button when the range reaches it", () => {
    render(guided());
    expect(screen.getByTestId("ride-fuel-line").textContent).toBe("Next gas 14 mi · Sheetz");
    expect(screen.getByTestId("ride-fuel")).toHaveAttribute("data-tone", "next");
    expect(screen.queryByTestId("ride-fuel-add-stop")).toBeNull();
  });

  it("says the range is short, and offers the one action that changes the ride", () => {
    const onAddStop = vi.fn();
    render(
      guided({
        stations: [{ ...STATION, aheadMiles: 38 }],
        usableMiles: 30,
        onAddStop,
      }),
    );
    expect(screen.getByTestId("ride-fuel-line").textContent).toBe(
      "Gas: 38 mi to next station — range left ~30 mi",
    );
    expect(screen.getByTestId("ride-fuel")).toHaveAttribute("data-tone", "warn");
    fireEvent.click(screen.getByTestId("ride-fuel-add-stop"));
    expect(onAddStop).toHaveBeenCalledWith({ lon: -75.4, lat: 40.2 }, "Sheetz");
  });

  it("answers an unknown search with one compact Filled up row, never an empty box", () => {
    render(guided({ stations: [], stationsFound: 0 }));
    // The block exists, but it is one row: the button a rider presses when they
    // stop for fuel, and the one line that says what it counts.
    const block = screen.getByTestId("ride-fuel");
    expect(block).toHaveAttribute("data-tone", "unknown");
    expect(block).toHaveClass("og-ride-fuel--compact");
    expect(screen.getByTestId("ride-fuel-filled-up")).toHaveTextContent("Filled up?");
    expect(screen.getByText("Tank range counts from here.")).toBeInTheDocument();
    // Unknown is never printed as a value, and no station is invented.
    expect(screen.queryByTestId("ride-fuel-line")).toBeNull();
    expect(screen.queryByTestId("ride-fuel-add-stop")).toBeNull();

    fireEvent.click(screen.getByTestId("ride-fuel-filled-up"));
    expect(screen.getByTestId("ride-fuel-filled-note")).toHaveTextContent("Range counted from here.");
  });

  it("draws nothing when the gas search is unknown and there is no bike range to count", () => {
    render(guided({ stations: [], stationsFound: 0, usableMiles: null }));
    expect(screen.queryByTestId("ride-fuel")).toBeNull();
    expect(screen.queryByTestId("ride-fuel-filled-up")).toBeNull();
  });

  it("says no gas is ahead when the ride found stations, all of them behind", () => {
    render(guided({ stations: [], stationsFound: 4 }));
    expect(screen.getByTestId("ride-fuel-line").textContent).toBe("No gas along the next 120 mi");
    expect(screen.getByTestId("ride-fuel")).toHaveAttribute("data-tone", "warn");
    expect(screen.queryByTestId("ride-fuel-add-stop")).toBeNull();
  });

  it("never turns an unknown range into a reassurance", () => {
    render(guided({ usableMiles: null }));
    expect(screen.getByTestId("ride-fuel-line").textContent).toBe("Next gas 14 mi · Sheetz");
    expect(screen.queryByTestId("ride-fuel-add-stop")).toBeNull();
  });

  it("counts the miles ridden into the range left", () => {
    const { rerender } = render(guided({ stations: [{ ...STATION, aheadMiles: 100 }] }));
    expect(screen.getByTestId("ride-fuel-line").textContent).toBe("Next gas 100 mi · Sheetz");

    rerender(guided({ stations: [{ ...STATION, aheadMiles: 100 }], alongMiles: 30 }));
    expect(screen.getByTestId("ride-fuel-line").textContent).toBe(
      "Gas: 100 mi to next station — range left ~90 mi",
    );
  });

  it("starts the count again after the rider fills up", () => {
    const short = { stations: [{ ...STATION, aheadMiles: 100 }], alongMiles: 30 };
    const { rerender } = render(guided(short));
    expect(screen.getByTestId("ride-fuel")).toHaveAttribute("data-tone", "warn");

    fireEvent.click(screen.getByTestId("ride-fuel-filled-up"));
    expect(screen.getByTestId("ride-fuel-filled-note").textContent).toContain("Range counted from here.");

    rerender(guided({ ...short, alongMiles: 35 }));
    expect(screen.getByTestId("ride-fuel-line").textContent).toBe("Next gas 100 mi · Sheetz");
  });

  it("says nothing about the map's Scenic / Food filter, and nothing about a route it cannot measure", () => {
    render(guided({ alongMiles: null }));
    // The distance is still a measurement; only the range sentence is withheld.
    expect(screen.getByTestId("ride-fuel-line").textContent).toBe("Next gas 14 mi · Sheetz");
  });
});

describe("RideFuelLine — Free Ride", () => {
  function layers(features: MapLayersResult["features"]): MapLayersSource {
    return {
      load: vi.fn(async () => ({ features, unavailable: [] })),
      trafficTileUrl: null,
    };
  }

  const north = {
    id: "osm:node/9",
    layerId: "fuel" as const,
    name: "North Gas",
    detail: null,
    weight: null,
    geometry: { type: "Point" as const, coordinates: [-75, 40.072] as const },
  };

  it("shows the nearest station ahead inside 25 miles", async () => {
    render(
      <RideFuelLine
        stations={[]}
        stationsFound={0}
        routeKey={null}
        alongMiles={null}
        position={{ lon: -75, lat: 40 }}
        headingDegrees={0}
        usableMiles={120}
        source={layers([north])}
      />,
    );
    const line = await screen.findByTestId("ride-fuel-line");
    expect(line.textContent).toBe("Next gas 5 mi · North Gas");
    expect(screen.queryByTestId("ride-fuel-add-stop")).toBeNull();
  });

  it("says nothing without a direction to call ahead", async () => {
    render(
      <RideFuelLine
        stations={[]}
        stationsFound={0}
        routeKey={null}
        alongMiles={null}
        position={{ lon: -75, lat: 40 }}
        headingDegrees={null}
        usableMiles={120}
        source={layers([north])}
      />,
    );
    await waitFor(() => expect(screen.queryByTestId("ride-fuel")).toBeNull());
  });

  it("says nothing at all when the layers port is not wired in", () => {
    render(
      <RideFuelLine
        stations={[]}
        stationsFound={0}
        routeKey={null}
        alongMiles={null}
        position={{ lon: -75, lat: 40 }}
        headingDegrees={0}
        usableMiles={120}
      />,
    );
    expect(screen.queryByTestId("ride-fuel")).toBeNull();
  });

  it("fails on its own: a search that rejects shows no fuel line and no error", async () => {
    const load = vi.fn(async () => {
      throw new Error("layers offline");
    });
    render(
      <RideFuelLine
        stations={[]}
        stationsFound={0}
        routeKey={null}
        alongMiles={null}
        position={{ lon: -75, lat: 40 }}
        headingDegrees={0}
        usableMiles={120}
        source={{ load, trafficTileUrl: null }}
      />,
    );
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.queryByTestId("ride-fuel")).toBeNull();
  });
});
