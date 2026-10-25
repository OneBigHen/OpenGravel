/**
 * The fuel line under the briefing. A rider gets one line while the bike's
 * range covers every dry stretch, and only a gap longer than that range opens
 * into a warning with the stations at either end of it. The stations
 * themselves belong to "Along this ride", so they are not listed twice.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { METERS_PER_MILE } from "@/application/map-layers";
import type { MapLayersSource } from "@/application/map-layers";
import { PlannerFuelAlong } from "@/ui/planner/PlannerFuelAlong";

/** A straight 69-mile leg north along -75°, so miles and along-route metres agree. */
const LINE = [
  { lon: -75.0, lat: 40.0 },
  { lon: -75.0, lat: 41.0 },
];
const ROUTE = { routeId: "route_a", geometry: LINE };

function station(id: string, name: string, alongMiles: number) {
  return {
    feature: {
      id,
      layerId: "fuel" as const,
      name,
      detail: null,
      weight: null,
      geometry: { type: "Point" as const, coordinates: [-75.0, 40 + alongMiles / 69] as const },
    },
    alongMeters: alongMiles * METERS_PER_MILE,
    offMeters: 40,
  };
}

function source(stops: ReturnType<typeof station>[], available = true): MapLayersSource {
  return {
    load: vi.fn(),
    trafficTileUrl: null,
    along: vi.fn(async () => ({ available, stops })),
  };
}

afterEach(cleanup);

describe("PlannerFuelAlong", () => {
  it("is one line in range, with no station list and no provider footer", async () => {
    render(
      <PlannerFuelAlong
        route={ROUTE}
        source={source([
          station("a", "First Gas", 11),
          station("b", "Second Gas", 22),
          station("c", "Third Gas", 33),
          station("d", "Fourth Gas", 44),
          station("e", "Fifth Gas", 55),
        ])}
        usableRangeMiles={60}
        onAddStop={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("fuel-line")).toHaveTextContent("Gas every ~14 mi — you're fine");
    expect(screen.queryByTestId("fuel-along")).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.queryByText(/TomTom/)).not.toBeInTheDocument();
  });

  it("warns about a dry stretch longer than the range, with only the stations around it", async () => {
    const onAddStop = vi.fn();
    render(
      <PlannerFuelAlong
        route={ROUTE}
        source={source([
          station("early", "Early Gas", 5),
          station("late", "Last Gas", 65),
        ])}
        usableRangeMiles={40}
        onAddStop={onAddStop}
      />,
    );

    expect(await screen.findByTestId("fuel-line")).toHaveTextContent("No gas for 60 mi — your range is 40 mi");
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Early Gas"),
      expect.stringContaining("Last Gas"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Add Early Gas as a stop" }));
    expect(onAddStop).toHaveBeenCalledWith({ lon: -75.0, lat: 40 + 5 / 69 }, "Early Gas");
  });

  it("does not judge the spacing when the bike's usable range is unknown", async () => {
    render(<PlannerFuelAlong route={ROUTE} source={source([station("only", "Only Gas", 20)])} usableRangeMiles={null} />);

    expect(await screen.findByTestId("fuel-line")).toHaveTextContent("Gas every ~49 mi");
    expect(screen.queryByText(/you're fine/)).not.toBeInTheDocument();
  });

  it("says a route has no gas near it instead of claiming a fine spacing", async () => {
    render(<PlannerFuelAlong route={ROUTE} source={source([])} usableRangeMiles={120} />);

    expect(await screen.findByTestId("fuel-line")).toHaveTextContent(
      "No gas within a mile of this 69 mi ride",
    );
  });

  it("shows nothing when the stations could not be checked", async () => {
    const failed = source([], false);
    render(<PlannerFuelAlong route={ROUTE} source={failed} usableRangeMiles={120} />);

    await waitFor(() => expect(failed.along).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId("fuel-line")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fuel-along")).not.toBeInTheDocument();
  });
});
