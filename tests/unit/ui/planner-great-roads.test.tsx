import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AlongRouteRide } from "@/application/route-library/along-route";
import { FLAG, type IndexRow } from "@/application/route-library/types";
import { PlannerGreatRoads, offRouteLabel } from "@/ui/planner/PlannerGreatRoads";

function row(patch: Partial<IndexRow> = {}): IndexRow {
  return { id: "pa-231", n: "PA 231: Prosperity to Avella", k: "road", t: "twisty", q: 4, mi: 26, st: ["PA"], p: [39.9979, -80.3553], pp: "start", bb: null, f: FLAG.line, s: 0, c: null, sf: "p", ...patch };
}

function hit(patch: Partial<IndexRow> = {}, offRouteMeters = 8000): AlongRouteRide {
  return { row: row(patch), offRouteMeters, alongRouteMeters: 12_000, routeMile: 7.5 };
}

afterEach(cleanup);

describe("Great roads near your route", () => {
  it("names each ride with its quality, type, length, distance off the route and credit", () => {
    render(<PlannerGreatRoads rides={[hit()]} sources={["BestBikingRoads"]} />);
    const section = screen.getByTestId("great-roads-along");
    expect(screen.getByRole("heading", { name: "Great roads near your route" })).toBeInTheDocument();
    const item = screen.getByTestId("great-road-row");
    expect(item).toHaveTextContent("PA 231: Prosperity to Avella");
    expect(item).toHaveTextContent("Great ride · Twisty");
    expect(item).toHaveTextContent("26 mi");
    expect(item).toHaveTextContent("5 mi off");
    expect(item).toHaveTextContent("Route from BestBikingRoads");
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/explore/pa-231");
    expect(item.closest("section")).toBe(section);
  });

  it("says on your route only when the start really is on the line", () => {
    expect(offRouteLabel(120)).toBe("On route");
    expect(offRouteLabel(350)).toBe("On route");
    expect(offRouteLabel(5000)).toBe("3.1 mi off");
  });

  it("draws nothing when the national library is off or no ride is near", () => {
    const { container } = render(<PlannerGreatRoads rides={[]} sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
