import path from "node:path";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { libraryRideAsCatalogEntry } from "@/server/route-library/as-catalog-entry";
import { resetPackForTests } from "@/server/route-library/pack";
import { LibraryTripStops } from "@/ui/explore/LibraryRideSections";
import { RouteDetail } from "@/ui/explore/RouteDetail";

const FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/route-library/pack.sqlite");

beforeEach(() => {
  process.env["OGV_ROUTE_LIBRARY_PACK"] = FIXTURE;
  resetPackForTests();
});

afterEach(() => {
  cleanup();
  delete process.env["OGV_ROUTE_LIBRARY_PACK"];
  resetPackForTests();
});

describe("a big trip reads as days and sections (L7)", () => {
  it("reads the Arizona BDR's six sections, its day count, its permit and its season", () => {
    const entry = libraryRideAsCatalogEntry("az-arizona-bdr")!;
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: /Arizona Backcountry/ })).toBeInTheDocument();
    expect(screen.getByTestId("worth-eyebrow").textContent).toContain("Big trip");

    const days = screen.getByTestId("trip-days");
    expect(within(days).getByRole("heading", { name: "Days and sections" })).toBeInTheDocument();
    expect(within(days).getByText("The source says 4 to 6 days. 6 sections, one a day.")).toBeInTheDocument();
    const rows = days.querySelectorAll(".og-library-ride__section");
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent("Day 1");
    expect(rows[0]).toHaveTextContent("Mexico border to Benson");
    expect(rows[0]).toHaveTextContent("128 mi");
    expect(rows[5]).toHaveTextContent("Day 6");
    expect(rows[5]).toHaveTextContent("Cameron to Utah border");
    expect(rows[5]).toHaveTextContent("151 mi");
    expect(within(days).getByText("750 mi of sections, from the source. Check each day before you ride it.")).toBeInTheDocument();

    // Fuel and camps are said even when the source lists none: a silence is not a stop.
    const stops = screen.getByTestId("trip-stops");
    expect(within(stops).getByText("The source lists no fuel stops.")).toBeInTheDocument();
    expect(within(stops).getByText("The source lists no camps.")).toBeInTheDocument();

    const facts = screen.getByTestId("library-facts");
    expect(within(facts).getByRole("heading", { name: "Good to know" })).toBeInTheDocument();
    expect(within(facts).getByText(/Navajo Nation permit/)).toBeInTheDocument();
    expect(within(facts).getByText("Season: May, June, September, October (the source says)")).toBeInTheDocument();

    // Link-only BDR: the source is the way on, never a followed line of ours.
    expect(screen.getByTestId("ride-source-link").getAttribute("href")).toContain("ridebdr.com");
    expect(screen.queryByTestId("ride-this")).toBeNull();
  });

  it("lists the fuel and camps the source does give, with its link", () => {
    const stops = libraryRideAsCatalogEntry("nc-cherohala-skyway")!.libraryDetail!.stops;
    render(<LibraryTripStops stops={stops} />);
    expect(screen.getByText("Fuel in Tellico Plains, TN")).toBeInTheDocument();
    expect(screen.getByText("Fuel in Robbinsville, NC")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Where this came from/ })).toHaveLength(2);
    expect(screen.getByText("The source lists no camps.")).toBeInTheDocument();
  });
});

describe("a trail area is a place to ride to, with its permit and season (L8)", () => {
  it("reads the Michigan ORV route as a place with access, permit and season", () => {
    const entry = libraryRideAsCatalogEntry("mi-orv-route-slc")!;
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "ORV Route SLC" })).toBeInTheDocument();
    expect(screen.getByText("Trail area")).toBeInTheDocument();
    const facts = screen.getByTestId("library-facts");
    expect(within(facts).getByRole("heading", { name: "Ride here" })).toBeInTheDocument();
    expect(within(facts).getByText("Open to motorcycles, the source says")).toBeInTheDocument();
    expect(within(facts).getByText(/Permit: Michigan DNR ORV license/)).toBeInTheDocument();
    expect(within(facts).getByText("Season not stated")).toBeInTheDocument();
    expect(within(facts).getByText("Unpaved, the source says")).toBeInTheDocument();

    const directions = screen.getByTestId("ride-to-trailhead");
    expect(directions).toHaveTextContent("Directions to the area");
    expect(directions.getAttribute("href")).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=46\./);
    expect(within(screen.getByTestId("ride-credit")).getByRole("link").getAttribute("href")).toContain("michigan.gov");
    // An area has no line to follow and no tank to plan around.
    expect(screen.queryByTestId("ride-this")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("does not invent a place when the source supplied no coordinates", () => {
    const entry = libraryRideAsCatalogEntry("ok-white-water-orv-area")!;
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);
    expect(screen.getByText("Trail area")).toBeInTheDocument();
    expect(screen.queryByTestId("ride-to-trailhead")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Ride here" })).toBeInTheDocument();
    // No pin: the honest source link is the only way on, and a place is not saved as an empty ride.
    expect(screen.getByTestId("ride-source-link").getAttribute("href")).toContain("riderplanet-usa.com");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
