import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlannerAlongOpportunities, alongRideCount } from "@/ui/planner/PlannerAlongOpportunities";
import type { RiderOpportunity } from "@/application/discover/rider-opportunities";
import type { RoadOpeningSummary } from "@/application/route-intelligence/opening-calendar-contract";
import { createHttpMapLayersSource } from "@/infrastructure/map-layers/http-map-layers-source";

const route = {
  routeId: "route-1",
  geometry: [
    { lon: -77.4, lat: 40.9 },
    { lon: -77.3, lat: 41 },
  ],
  distanceMeters: 25000,
  durationSeconds: 1800,
};
const place: RiderOpportunity = {
  id: "stop",
  kind: "place",
  name: "Forest overlook",
  category: "viewpoint",
  coordinate: route.geometry[0]!,
  description: null,
  startsAt: null,
  endsAt: null,
  url: null,
  sourceLabel: "OpenStreetMap / Wikimedia",
  motorcycleSpecific: false,
  popular: false,
  rating: null,
  distanceMeters: null,
  distanceFromRouteMeters: 0,
  detourMinutes: 0,
  routeMile: 0,
  estimatedArrivalAt: "2026-10-03T12:00:00Z",
  timingFit: "fits",
  score: 1,
  reason: "On route",
};
const road: RoadOpeningSummary = {
  id: "road",
  sourceId: "dcnr",
  roadName: "Forest road",
  description: "Published opening",
  startsAt: "2026-10-01T00:00:00Z",
  endsAt: "2026-10-05T00:00:00Z",
  certainty: "published-window",
  anchor: [-77.4, 40.9],
  line: route.geometry,
};
const departure = { kind: "future", at: "2026-10-03T12:00:00Z" } as const;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function responses(): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn(async (url: string) =>
    Response.json(
      url.includes("road-openings")
        ? {
            events: [road],
            undated: [],
            sources: [
              { id: "dcnr", label: "PA DCNR", status: "fresh", reason: null },
            ],
            truncated: false,
          }
        : {
            mode: "route",
            opportunities: [place],
            sources: [],
            searchedRadiusMiles: null,
          },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
describe("Along this ride", () => {
  it("is lazy and authors a stop or preferred road only on explicit action", async () => {
    const fetcher = responses();
    const onAddStop = vi.fn();
    const onRouteThrough = vi.fn();
    render(
      <PlannerAlongOpportunities
        route={route}
        departure={departure}
        onAddStop={onAddStop}
        onRouteThrough={onRouteThrough}
      />,
    );
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Along this ride"));
    expect(await screen.findByText("Forest overlook")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onAddStop).not.toHaveBeenCalled();
    expect(onRouteThrough).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Add stop/ }));
    expect(onAddStop).toHaveBeenCalledWith(place.coordinate, place.name);
    fireEvent.click(screen.getByRole("button", { name: /Route through it/ }));
    await waitFor(() => expect(onRouteThrough).toHaveBeenCalledWith(road));
    const body = JSON.parse(
      fetcher.mock.calls.find((call) =>
        String(call[0]).includes("rider-opportunities"),
      )?.[1].body as string,
    );
    expect(body).toMatchObject({
      departAt: departure.at,
      routeDurationSeconds: 1800,
      routeDistanceMeters: 25000,
    });
  });
  it("does not treat failed road sources as clear while retaining available stops", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("road-openings")
          ? Response.json(
              { unavailable: true, reason: "Authority offline" },
              { status: 503 },
            )
          : Response.json({ opportunities: [place], sources: [] }),
      ),
    );
    render(<PlannerAlongOpportunities route={route} departure={departure} />);
    fireEvent.click(screen.getByText("Along this ride"));
    expect(await screen.findByText("Forest overlook")).toBeInTheDocument();
    expect(screen.getByText(/Authority offline/)).toBeInTheDocument();
  });
  it("counts the stops in the row's own line once the list is known", async () => {
    responses();
    render(<PlannerAlongOpportunities route={route} departure={departure} />);
    const row = screen.getByRole("button", { name: /Along this ride/ });
    // Closed, the row says what is behind it rather than leaving a bare title.
    // The "·" between them is the stylesheet's separator, not a DOM text node.
    expect(row).toHaveTextContent(/Along this ride\s*Gas, food, views/);
    fireEvent.click(row);
    await screen.findByText("Forest overlook");
    // One place along the route; the road window is not a stop.
    await waitFor(() => expect(row).toHaveTextContent(/Along this ride\s*1 stop/));
    expect(row).not.toHaveTextContent("road");
  });
  it("counts places, not road windows, and keeps the hint when there are none", () => {
    expect(alongRideCount([{ kind: "road" } as never])).toBe("Gas, food, views");
    expect(alongRideCount([{ kind: "road" } as never, { kind: "stop" } as never])).toBe("1 stop");
    expect(
      alongRideCount([{ kind: "stop" } as never, { kind: "along-stop" } as never, { kind: "road" } as never]),
    ).toBe("2 stops");
  });
  it("refreshes suggestions when reopened", async () => {
    const fetcher = responses();
    render(<PlannerAlongOpportunities route={route} departure={departure} />);
    fireEvent.click(screen.getByText("Along this ride"));
    await screen.findByText("Forest overlook");
    fireEvent.click(screen.getByText("Along this ride"));
    fireEvent.click(screen.getByText("Along this ride"));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  });
  it("caps mixed suggestions at six, caps events at three, and excludes timing misses", async () => {
    const stops = Array.from({ length: 10 }, (_, index) => ({
      ...place,
      id: `stop-${index}`,
      name: `Destination ${index}`,
      kind: index < 5 ? "event" : "place",
      score: 5 - index / 10,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.includes("road-openings")
            ? { events: [road], undated: [], sources: [], truncated: false }
            : {
                opportunities: [
                  {
                    ...place,
                    id: "missed",
                    name: "Ended before arrival",
                    timingFit: "misses",
                    score: 99,
                  },
                  ...stops,
                ],
                sources: [],
              },
        ),
      ),
    );
    render(<PlannerAlongOpportunities route={route} departure={departure} />);
    fireEvent.click(screen.getByText("Along this ride"));
    const list = await screen.findByRole("list", {
      name: "Along this ride suggestions",
    });
    expect(list.children).toHaveLength(6);
    expect(screen.getAllByText("Event")).toHaveLength(3);
    expect(screen.queryByText("Ended before arrival")).not.toBeInTheDocument();
    expect(screen.getByText("Destination 5")).toBeInTheDocument();
  });
  it("aborts a replaced route and ignores its late response", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const fetcher = vi.fn((url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as {
        line: readonly { lon: number }[];
      };
      if (url.includes("road-openings"))
        return Promise.resolve(
          Response.json({ events: [], sources: [], undated: [] }),
        );
      return body.line[0]?.lon === route.geometry[0]?.lon
        ? pending
        : Promise.resolve(
            Response.json({
              opportunities: [{ ...place, name: "Current route stop" }],
              sources: [],
            }),
          );
    });
    vi.stubGlobal("fetch", fetcher);
    const { rerender } = render(
      <PlannerAlongOpportunities route={route} departure={departure} />,
    );
    fireEvent.click(screen.getByText("Along this ride"));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const signal = fetcher.mock.calls[0]?.[1].signal;
    rerender(
      <PlannerAlongOpportunities
        route={{
          ...route,
          routeId: "route-2",
          geometry: [...route.geometry].reverse(),
        }}
        departure={departure}
      />,
    );
    expect(await screen.findByText("Current route stop")).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      resolve(Response.json({ opportunities: [place], sources: [] })),
    );
    expect(screen.queryByText("Forest overlook")).not.toBeInTheDocument();
  });

  it("keeps a refused road action retryable", async () => {
    responses();
    const onRouteThrough = vi.fn(async () => {
      throw new Error("Ride changed while adding the road.");
    });
    render(
      <PlannerAlongOpportunities
        route={route}
        departure={departure}
        onRouteThrough={onRouteThrough}
      />,
    );
    fireEvent.click(screen.getByText("Along this ride"));
    const button = await screen.findByRole("button", {
      name: /Route through it/,
    });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ride changed while adding the road.",
    );
    expect(
      screen.getByRole("button", { name: /Route through it/ }),
    ).toBeEnabled();
  });
  it("prevents duplicate road commands while an action is pending", async () => {
    responses();
    let resolve!: () => void;
    const onRouteThrough = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render(
      <PlannerAlongOpportunities
        route={route}
        departure={departure}
        onRouteThrough={onRouteThrough}
      />,
    );
    fireEvent.click(screen.getByText("Along this ride"));
    const button = await screen.findByRole("button", {
      name: /Route through it/,
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onRouteThrough).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Adding road/ })).toBeDisabled();
    await act(async () => resolve());
    expect(screen.getByRole("button", { name: /Added/ })).toBeDisabled();
  });
});

const MILE = 1609.344;

/** TomTom-shaped along stops, per layer, served through a stubbed fetch. */
function alongSource(unavailableLayers: readonly string[] = []) {
  const along = (layer: string, id: string, name: string, mile: number, offMiles: number, detail: string | null = null) => ({
    feature: {
      id,
      layerId: layer,
      name,
      detail,
      weight: null,
      geometry: { type: "Point", coordinates: [route.geometry[0]!.lon + mile / 100, route.geometry[0]!.lat] },
    },
    alongMeters: mile * MILE,
    offMeters: offMiles * MILE,
  });
  const byLayer: Record<string, readonly unknown[]> = {
    fuel: [along("fuel", "tomtom:sheetz", "Sheetz", 14, 0.3, "Main St, Lehighton")],
    food: [along("food", "tomtom:diner", "Diner", 5, 0.2)],
    coffee: [along("coffee", "tomtom:cafe", "Café", 9, 0.1)],
    viewpoints: [along("viewpoints", "tomtom:hawk", "Hawk Mountain", 26, 1.2)],
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/road-openings"))
      return Response.json({ events: [], undated: [], sources: [], truncated: false });
    if (url.includes("/api/rider-opportunities"))
      return Response.json({ mode: "route", opportunities: [], sources: [], searchedRadiusMiles: null });
    if (url.includes("/api/map-layers/along")) {
      const body = JSON.parse(String(init?.body)) as { layer: string };
      const available = !unavailableLayers.includes(body.layer);
      return Response.json({ stops: available ? byLayer[body.layer] ?? [] : [], available });
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, source: createHttpMapLayersSource({ fetch: fetcher as unknown as typeof fetch }) };
}

describe("Along this ride stops", () => {
  it("lists gas, food, coffee and overlooks by mile with how far off route they are", async () => {
    const { source } = alongSource();
    const onAddStop = vi.fn();
    render(
      <PlannerAlongOpportunities
        route={route}
        departure={departure}
        source={source}
        onAddStop={onAddStop}
      />,
    );
    fireEvent.click(screen.getByText("Along this ride"));
    const list = await screen.findByRole("list", { name: "Along this ride suggestions" });
    expect(
      within(list)
        .getAllByRole("button", { name: /as a stop/ })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Add Diner as a stop",
      "Add Café as a stop",
      "Add Sheetz as a stop",
      "Add Hawk Mountain as a stop",
    ]);
    expect(within(list).getByText("Mile 14")).toBeInTheDocument();
    expect(within(list).getByText("0.3 mi off route · Gas · Main St, Lehighton")).toBeInTheDocument();
    expect(screen.getByText(/Stops from TomTom/)).toBeInTheDocument();
    const sheetz = within(list).getByText("Sheetz").closest("li");
    fireEvent.click(within(sheetz!).getByRole("button", { name: "Add Sheetz as a stop" }));
    expect(onAddStop).toHaveBeenCalledWith(
      { lon: route.geometry[0]!.lon + 0.14, lat: route.geometry[0]!.lat },
      "Sheetz",
    );
    expect(within(sheetz!).getByRole("button", { name: /Added Sheetz/ })).toBeDisabled();
  });

  it("keeps the stops that answered when one provider layer fails", async () => {
    const { source } = alongSource(["coffee"]);
    render(<PlannerAlongOpportunities route={route} departure={departure} source={source} />);
    fireEvent.click(screen.getByText("Along this ride"));
    expect(await screen.findByText("Sheetz")).toBeInTheDocument();
    expect(screen.queryByText("Café")).not.toBeInTheDocument();
    expect(screen.getByText("Coffee stops could not be checked.")).toBeInTheDocument();
  });

  it("says nothing was checked rather than nothing is there when every provider fails", async () => {
    const { source } = alongSource(["fuel", "food", "coffee", "viewpoints"]);
    render(<PlannerAlongOpportunities route={route} departure={departure} source={source} />);
    fireEvent.click(screen.getByText("Along this ride"));
    expect(
      await screen.findByText("No stops could be checked along this ride."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Gas, food and overlooks could not be checked."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Stops from TomTom/)).not.toBeInTheDocument();
  });
});
