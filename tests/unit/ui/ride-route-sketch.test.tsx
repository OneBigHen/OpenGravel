/**
 * The finish card's route sketch (08 §13).
 *
 * The sketch is drawn from the route's own coordinates through the same pure
 * extent projection My rides uses for a recorded track, so what is asserted here
 * is the picture a rider sees: the ridden part in Ember, the rest in Topo Sage
 * at 45%, and no travelled split at all when the engine never said how far along
 * the rider got.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Coordinate } from "@/domain/ride/types";
import {
  RIDE_SKETCH_BOX,
  RideRouteSketch,
  rideRouteSketchLabel,
  splitRiddenLine,
} from "@/ui/ride/RideRouteSketch";

const LINE: readonly Coordinate[] = [
  { lon: -75.44, lat: 40.13 },
  { lon: -75.43, lat: 40.12 },
  { lon: -75.42, lat: 40.11 },
];

afterEach(cleanup);

describe("splitting the ridden line", () => {
  it("splits a straight line where the engine's fraction lands", () => {
    const half = splitRiddenLine([{ lon: 0, lat: 0 }, { lon: 2, lat: 0 }], 0.5);
    expect(half?.travelled).toEqual([{ lon: 0, lat: 0 }, { lon: 1, lat: 0 }]);
    expect(half?.remaining).toEqual([{ lon: 1, lat: 0 }, { lon: 2, lat: 0 }]);

    // An odd fraction splits on the right segment, not halfway through the list.
    const quarter = splitRiddenLine([{ lon: 0, lat: 0 }, { lon: 2, lat: 0 }, { lon: 2, lat: 2 }], 0.25);
    expect(quarter?.travelled.at(-1)?.lon).toBeCloseTo(1, 6);
    expect(quarter?.travelled.at(-1)?.lat).toBeCloseTo(0, 6);
    expect(quarter?.remaining[0]).toEqual(quarter?.travelled.at(-1));
  });

  it("refuses a split it cannot justify", () => {
    // Unknown progress, a line with nothing to draw, and a line of no length.
    expect(splitRiddenLine(LINE, null)).toBeNull();
    expect(splitRiddenLine([], 0.5)).toBeNull();
    expect(splitRiddenLine([{ lon: 1, lat: 1 }], 0.5)).toBeNull();
    expect(splitRiddenLine([{ lon: 1, lat: 1 }, { lon: 1, lat: 1 }], 0.5)).toBeNull();
    expect(splitRiddenLine(LINE, Number.NaN)).toBeNull();
  });

  it("puts nothing behind the rider at the start and everything at the finish", () => {
    expect(splitRiddenLine(LINE, 0)).toEqual({ travelled: [LINE[0]], remaining: [...LINE] });
    expect(splitRiddenLine(LINE, 1)).toEqual({ travelled: [...LINE], remaining: [] });
    // A fraction outside 0..1 is clamped, never extrapolated off the line.
    expect(splitRiddenLine(LINE, 4)).toEqual({ travelled: [...LINE], remaining: [] });
  });
});

describe("the sketch's label", () => {
  it("names what is known and never invents the route's total", () => {
    expect(rideRouteSketchLabel("42 mi", 0.72)).toBe("Route sketch: 42 mi ridden, 72% along the route.");
    expect(rideRouteSketchLabel("42 mi", null)).toBe("Route sketch: 42 mi ridden.");
    expect(rideRouteSketchLabel(null, 0.5)).toBe("Route sketch: 50% along the route.");
    expect(rideRouteSketchLabel(null, null)).toBe("Route sketch of this ride's route.");
    expect(rideRouteSketchLabel("42 mi", 0.004)).toBe("Route sketch: 42 mi ridden, 0% along the route.");
  });
});

describe("rendering the sketch", () => {
  it("draws the ridden part in Ember and the rest muted once progress is known", () => {
    const { container } = render(<RideRouteSketch routeLine={LINE} fraction={0.5} distanceText="42 mi" />);

    const svg = screen.getByTestId("ride-route-sketch");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "Route sketch: 42 mi ridden, 50% along the route.");
    expect(svg).toHaveAttribute("viewBox", `0 0 ${RIDE_SKETCH_BOX.width} ${RIDE_SKETCH_BOX.height}`);
    expect(svg).toHaveAttribute("data-split", "known");

    expect(container.querySelectorAll(".og-ride__sketch-line--travelled")).toHaveLength(1);
    expect(container.querySelectorAll(".og-ride__sketch-line--remaining")).toHaveLength(1);
    // Start and finish are 6 px dots: three units of radius in a 320-unit box.
    const dots = container.querySelectorAll(".og-ride__sketch-dot");
    expect(dots).toHaveLength(2);
    for (const dot of dots) expect(dot).toHaveAttribute("r", "3");
  });

  it("shows the route alone when the fraction is unknown, with no travelled split", () => {
    const { container } = render(<RideRouteSketch routeLine={LINE} fraction={null} distanceText={null} />);

    expect(screen.getByTestId("ride-route-sketch")).toHaveAttribute("data-split", "unknown");
    expect(container.querySelectorAll(".og-ride__sketch-line--travelled")).toHaveLength(0);
    expect(container.querySelectorAll(".og-ride__sketch-line--remaining")).toHaveLength(1);
  });

  it("stays inside the padded box, so a line never touches the card's edge", () => {
    const { container } = render(<RideRouteSketch routeLine={LINE} fraction={0.5} distanceText={null} />);
    const points = Array.from(container.querySelectorAll("polyline")).flatMap((polyline) =>
      (polyline.getAttribute("points") ?? "").split(" ").filter(Boolean),
    );
    expect(points.length).toBeGreaterThan(2);
    for (const point of points) {
      const [x, y] = point.split(",").map(Number);
      expect(x).toBeGreaterThanOrEqual(RIDE_SKETCH_BOX.padding);
      expect(x).toBeLessThanOrEqual(RIDE_SKETCH_BOX.width - RIDE_SKETCH_BOX.padding);
      expect(y).toBeGreaterThanOrEqual(RIDE_SKETCH_BOX.padding);
      expect(y).toBeLessThanOrEqual(RIDE_SKETCH_BOX.height - RIDE_SKETCH_BOX.padding);
    }
  });

  it("draws nothing at all for an empty or single-point line", () => {
    const { container } = render(<RideRouteSketch routeLine={[]} fraction={0.5} distanceText={null} />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const single = render(
      <RideRouteSketch routeLine={[{ lon: -75.44, lat: 40.13 }]} fraction={null} distanceText={null} />,
    );
    expect(single.container).toBeEmptyDOMElement();
  });
});
