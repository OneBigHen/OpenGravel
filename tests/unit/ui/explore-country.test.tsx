import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogEntry } from "@/application/explore/catalog";
import type { RouteLibrary } from "@/application/route-library/client";
import { FLAG, type IndexRow } from "@/application/route-library/types";
import { ExplorePanel } from "@/ui/explore/ExplorePanel";
import { createStubMapHostFactory } from "../support/stub-map-host";

const curated: CatalogEntry = {
  id: "route-1",
  source: "catalog",
  name: "Lehigh sample route",
  region: "Lehigh Valley",
  summary: "A route.",
  distanceKm: 27.5,
  bounds: { west: -75.5, south: 40.5, east: -75.2, north: 40.7 },
  geometry: [{ lon: -75.5, lat: 40.5 }, { lon: -75.2, lat: 40.7 }],
  provenance: "Sample route.",
};

function row(id: string, patch: Partial<IndexRow> = {}): IndexRow {
  return { id, n: `Ride ${id}`, k: "road", t: "twisty", q: 3, mi: 40, st: ["NC"], p: [35.5, -83.5], pp: "start", bb: null, f: FLAG.line, s: 0, c: "ACDWX4c7f_0AAC", sf: "p", ...patch };
}

function library(rows: readonly IndexRow[]): RouteLibrary {
  return { version: "v1", rows, sources: ["BestBikingRoads"], stateCounts: {}, linesFor: async () => null };
}

function stubPhone(matches: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches && query.includes("max-width: 760px"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/explore");
});

describe("Explore across the country", () => {
  const rows = [
    row("a", { q: 5, n: "Cherohala Skyway", t: "scenic" }),
    row("b", { q: 4, t: "dirt" }),
    row("c", { q: 3, t: "twisty", p: null, pp: null, f: 0, c: null }),
  ];

  it("lists library rides after the curated ones, with the quality word, the type and the credit", () => {
    render(<ExplorePanel entries={[curated]} library={library(rows)} />);
    const section = screen.getByTestId("routes-section");
    expect(within(section).getByRole("heading", { name: "Across the country" })).toBeInTheDocument();
    const first = within(section).getAllByTestId("library-row")[0]!;
    expect(first).toHaveTextContent("Cherohala Skyway");
    expect(first).toHaveTextContent("Standout · Scenic");
    expect(first).toHaveTextContent("Route from BestBikingRoads");
    expect(first).toHaveTextContent("about");
    // A ride with no place says so, and no row draws stars.
    expect(screen.getByText("Not on the map yet")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/★|stars/i);
    const all = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(all.indexOf("/explore/route-1")).toBeLessThan(all.indexOf("/explore/a"));
  });

  it("filters the list with the chips and keeps them in the address bar", async () => {
    render(<ExplorePanel entries={[curated]} library={library(rows)} />);
    fireEvent.click(screen.getByTestId("chip-dirt"));
    await waitFor(() => expect(window.location.search).toBe("?type=dirt"));
    const list = screen.getByTestId("library-list");
    expect(within(list).getAllByTestId("library-row")).toHaveLength(1);
    expect(screen.getByTestId("chip-dirt")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("chip-dirt"));
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(within(screen.getByTestId("library-list")).getAllByTestId("library-row")).toHaveLength(3);
  });

  it("shows thirty at a time", () => {
    const many = Array.from({ length: 70 }, (_, index) => row(`r${String(index).padStart(2, "0")}`));
    render(<ExplorePanel entries={[]} library={library(many)} />);
    expect(screen.getAllByTestId("library-row")).toHaveLength(30);
    fireEvent.click(screen.getByRole("button", { name: /Show more/ }));
    expect(screen.getAllByTestId("library-row")).toHaveLength(60);
    fireEvent.click(screen.getByRole("button", { name: /Show more/ }));
    expect(screen.getAllByTestId("library-row")).toHaveLength(70);
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
  });

  it("renders exactly today's Explore when there is no library", () => {
    render(<ExplorePanel entries={[curated]} library={null} />);
    expect(screen.queryByTestId("routes-section")).toBeNull();
    expect(screen.queryByTestId("chip-dirt")).toBeNull();
    expect(screen.queryByTestId("routes-pill")).toBeNull();
    expect(screen.getByRole("button", { name: "Twisty" })).toBeInTheDocument();
  });

  it("offers the Map pill on a phone and switches to the map view", async () => {
    stubPhone(true);
    const hosts = createStubMapHostFactory();
    render(<ExplorePanel entries={[curated]} library={library(rows)} map={{ hostFactory: hosts.factory, basemap: "empty", onOpen: vi.fn() }} />);
    fireEvent.click(screen.getByTestId("routes-pill"));
    await waitFor(() => expect(window.location.search).toContain("view=map"));
    await waitFor(() => expect(screen.getByTestId("routes-map")).toBeInTheDocument());
    expect(screen.getByTestId("routes-pill")).toHaveTextContent("2 rides here · List");
    expect(screen.getByTestId("chip-twisty")).toBeInTheDocument();
  });

  it("lists only what was in view when the pill says List", async () => {
    stubPhone(true);
    window.history.replaceState({}, "", "/explore?view=list&here=-84.5,35,-83,36");
    render(<ExplorePanel entries={[curated]} library={library([...rows, row("far", { p: [44, -100], st: ["SD"] })])} map={{ hostFactory: createStubMapHostFactory().factory, basemap: "empty", onOpen: vi.fn() }} />);
    await waitFor(() => expect(screen.getByTestId("routes-here-title")).toHaveTextContent("2 rides here"));
    expect(screen.getAllByTestId("library-row")).toHaveLength(2);
    expect(screen.queryByText("Lehigh sample route")).toBeNull();
    expect(screen.getByTestId("routes-pill")).toHaveTextContent("Map");
  });
});
