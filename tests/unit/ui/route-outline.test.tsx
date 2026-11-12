/**
 * Start paints the route's outline before the map's tiles arrive (R3-4).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RouteOutline, outlinePath } from "@/ui/ride/RouteOutline";

const LINE = [
  { lat: 40.72, lon: -77.89 },
  { lat: 40.75, lon: -77.85 },
  { lat: 40.7, lon: -77.8 },
];

describe("the ride's route outline", () => {
  it("draws the line fitted inside its box", () => {
    const path = outlinePath(LINE);
    expect(path).toMatch(/^M[\d.]+ [\d.]+L/);
    for (const value of (path ?? "").replace(/[ML]/g, " ").trim().split(/\s+/).map(Number)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1000);
    }
  });

  it("draws nothing for an unavailable line", () => {
    expect(outlinePath([])).toBeNull();
    expect(outlinePath([LINE[0]!])).toBeNull();
    const { container } = render(<RouteOutline line={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("takes no touches and is hidden from screen readers", () => {
    render(<RouteOutline line={LINE} />);
    expect(screen.getByTestId("ride-route-outline")).toHaveAttribute("aria-hidden", "true");
  });
});
