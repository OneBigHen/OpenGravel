import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MapLayersSource } from "@/application/map-layers";
import { RideDetour } from "@/ui/ride/RideDetour";

/** Route changes mid-ride: the reroute control and the fuel-ahead list (UX rework phase 9). */

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
    fireEvent.click(screen.getByTestId("ride-fuel-ahead"));
    const list = await screen.findByTestId("ride-fuel-list");
    expect(list.textContent).not.toContain("Behind Gas");
    const rows = list.querySelectorAll("li");
    expect(rows[0]?.textContent).toContain("Near Fuel");
    expect(rows[1]?.textContent).toContain("Far Fuel");

    fireEvent.click(screen.getByRole("button", { name: "Route via Near Fuel" }));
    expect(onReroute).toHaveBeenCalledWith({ coordinate: { lon: -75.0, lat: 40.1 }, label: "Near Fuel" });
  });

  it("offers a reroute now when off the line, and holds it without a good fix", () => {
    const onReroute = vi.fn();
    const { rerender } = render(
      <RideDetour offRoute busy={false} message={null} error={null} routeLine={LINE} position={null} fixGood={false} onReroute={onReroute} onEasierWayBack={vi.fn()} onTurnAround={vi.fn()} />,
    );
    const button = screen.getByTestId("ride-reroute");
    expect(button.textContent).toBe("Reroute now");
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
});
