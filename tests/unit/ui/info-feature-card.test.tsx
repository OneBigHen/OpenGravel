import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InfoFeature } from "@/application/map-layers";
import { InfoFeatureCard } from "@/ui/layers/InfoFeatureCard";

afterEach(cleanup);

const TWISTY_ROAD: InfoFeature = {
  id: "curvy:1",
  layerId: "great-roads",
  name: "Pine Creek Road",
  detail: "Very twisty · 8.2 mi",
  weight: 0.9,
  geometry: {
    type: "LineString",
    coordinates: [
      [0, 0],
      [0.05, 0],
      [0.1, 0],
    ],
  },
};

const GRAVEL_ROAD: InfoFeature = {
  id: "gravel:1",
  layerId: "gravel",
  name: "Old Mine Track",
  detail: "Surveyed gravel · confidence 70%",
  weight: 0.7,
  geometry: {
    type: "LineString",
    coordinates: [
      [0, 0],
      [0.1, 0],
    ],
  },
};

const FUEL_STOP: InfoFeature = {
  id: "tomtom:1",
  layerId: "fuel",
  name: "Valley Gas",
  detail: null,
  weight: null,
  geometry: { type: "Point", coordinates: [-75.31, 40.02] },
};

describe("InfoFeatureCard ride this road", () => {
  it("offers a tapped twisty road as a ride, entered at the near end", () => {
    const onRideRoad = vi.fn();
    render(
      <InfoFeatureCard
        feature={TWISTY_ROAD}
        onClose={vi.fn()}
        onRideRoad={onRideRoad}
        rideRoadReference={{ lon: -0.05, lat: 0 }}
      />,
    );
    fireEvent.click(screen.getByTestId("info-feature-ride-road"));
    expect(onRideRoad).toHaveBeenCalledTimes(1);
    const [entry, exit, name] = onRideRoad.mock.calls[0]!;
    expect(name).toBe("Pine Creek Road");
    expect(entry.lon).toBeCloseTo(0.005, 6);
    expect(exit.lon).toBeCloseTo(0.095, 6);
  });

  it("offers a tapped gravel road too, and enters it from the other end", () => {
    const onRideRoad = vi.fn();
    render(
      <InfoFeatureCard
        feature={GRAVEL_ROAD}
        onClose={vi.fn()}
        onRideRoad={onRideRoad}
        rideRoadReference={{ lon: 0.15, lat: 0 }}
      />,
    );
    fireEvent.click(screen.getByTestId("info-feature-ride-road"));
    const [entry, exit] = onRideRoad.mock.calls[0]!;
    expect(entry.lon).toBeCloseTo(0.095, 6);
    expect(exit.lon).toBeCloseTo(0.005, 6);
  });

  it("keeps the drawn order when the planner has neither a stop nor a start", () => {
    const onRideRoad = vi.fn();
    render(
      <InfoFeatureCard
        feature={TWISTY_ROAD}
        onClose={vi.fn()}
        onRideRoad={onRideRoad}
        rideRoadReference={null}
      />,
    );
    fireEvent.click(screen.getByTestId("info-feature-ride-road"));
    const [entry, exit] = onRideRoad.mock.calls[0]!;
    expect(entry.lon).toBeCloseTo(0.005, 6);
    expect(exit.lon).toBeCloseTo(0.095, 6);
  });

  it("shows no road action when the host cannot add one", () => {
    render(<InfoFeatureCard feature={TWISTY_ROAD} onClose={vi.fn()} />);
    expect(screen.queryByTestId("info-feature-ride-road")).not.toBeInTheDocument();
    expect(screen.queryByTestId("info-feature-add-stop")).not.toBeInTheDocument();
  });

  it("leaves 'Add as stop' alone for a point stop, with no road action", () => {
    const onAddStop = vi.fn();
    const onRideRoad = vi.fn();
    render(
      <InfoFeatureCard
        feature={FUEL_STOP}
        onClose={vi.fn()}
        onAddStop={onAddStop}
        onRideRoad={onRideRoad}
      />,
    );
    expect(screen.queryByTestId("info-feature-ride-road")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("info-feature-add-stop"));
    expect(onAddStop).toHaveBeenCalledWith({ lon: -75.31, lat: 40.02 }, "Valley Gas");
    expect(onRideRoad).not.toHaveBeenCalled();
  });
});
