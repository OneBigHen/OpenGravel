import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExplorePanel } from "@/ui/explore/ExplorePanel";

const roads = {
  generatedAt: "2026-10-03T12:00:00Z",
  from: "2026-10-03T12:00:00Z",
  to: "2027-04-01T12:00:00Z",
  truncated: false,
  sources: [{ id: "dcnr", label: "PA DCNR", status: "fresh", reason: null }],
  events: [
    {
      id: "road",
      sourceId: "dcnr",
      roadName: "Bald Eagle forest road",
      description: "Authority opening",
      startsAt: "2026-10-03T00:00:00Z",
      endsAt: "2026-10-05T00:00:00Z",
      certainty: "published-window",
      anchor: [-77.4, 40.9],
    },
  ],
  undated: [
    {
      id: "unknown",
      sourceId: "dcnr",
      roadName: "Seasonal connector",
      description: "Seasonal access",
      anchor: [-77.5, 40.8],
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function location(): void {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({
          coords: { latitude: 40.9, longitude: -77.4 },
        } as GeolocationPosition),
    },
  });
}
describe("Explore Ride and Things", () => {
  it("defaults to Ride with a real date picker and no standalone road/weekend tab", () => {
    render(<ExplorePanel entries={[]} />);
    expect(screen.getByRole("tab", { name: "Ride" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Pick date" }));
    expect(screen.getByLabelText("Ride date")).toHaveAttribute("type", "date");
  });
  it("loads only roads in Ride, shows authority and unknown dates, and filters the chosen day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    location();
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain("/api/road-openings?");
      return Response.json(roads);
    });
    vi.stubGlobal("fetch", fetcher);
    render(<ExplorePanel entries={[]} mapboxToken="public-test" />);
    fireEvent.click(screen.getByRole("button", { name: "Find roads near me" }));
    expect(
      await screen.findByText("Bald Eagle forest road"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("PA DCNR").length).toBeGreaterThan(0);
    expect(screen.getByText("Dates not published")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Bald Eagle forest road location map" }),
    ).toHaveAttribute("src", expect.stringContaining("api.mapbox.com"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/api/road-openings?");
    fireEvent.click(screen.getByRole("button", { name: "Pick date" }));
    fireEvent.change(screen.getByLabelText("Ride date"), {
      target: { value: "2026-10-10" },
    });
    await waitFor(() =>
      expect(screen.queryByText("Bald Eagle forest road")).toBeNull(),
    );
    expect(screen.getByText("Dates not published")).toBeInTheDocument();
  });
  it("opens Things without requesting permission or fetching until the rider asks", () => {
    location();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<ExplorePanel entries={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Things" }));
    expect(
      screen.getByRole("button", { name: "Find things worth riding to" }),
    ).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves rider ranking in Things and caps events without dropping destinations", async () => {
    location();
    const opportunities = Array.from({ length: 10 }, (_, index) => ({
      id: `item-${index}`,
      name: `Rider destination ${index}`,
      kind: index < 5 ? "event" : "place",
      reason: "Worth the ride",
      sourceLabel: "Places / OpenStreetMap",
      startsAt: null,
      url: null,
      description: null,
      distanceMeters: index === 0 ? 80000 : 3000,
      detourMinutes: null,
      routeMile: null,
      estimatedArrivalAt: null,
      timingFit: "unknown",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ opportunities, sources: [], searchedRadiusMiles: 100 }),
      ),
    );
    render(<ExplorePanel entries={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Things" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Find things worth riding to" }),
    );
    await screen.findByText("Rider destination 0");
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveTextContent("Rider destination 0");
    expect(screen.getAllByText("Event")).toHaveLength(3);
    expect(screen.queryByText("Rider destination 3")).not.toBeInTheDocument();
    expect(screen.getByText("Rider destination 5")).toBeInTheDocument();
  });
  it("moves between the two tabs with arrow keys and preserves visible focus", () => {
    render(<ExplorePanel entries={[]} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Ride" }), {
      key: "ArrowRight",
    });
    expect(screen.getByRole("tab", { name: "Things" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Things" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "Things" }), {
      key: "Home",
    });
    expect(screen.getByRole("tab", { name: "Ride" })).toHaveFocus();
  });
  it("hides an empty calendar result and exposes Things time controls", async () => {
    location();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ...roads, events: [], undated: [] })),
    );
    render(<ExplorePanel entries={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Find roads near me" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Road access windows" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Things" }));
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next weekend" }));
    expect(
      screen.getByRole("button", { name: "Next weekend" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
