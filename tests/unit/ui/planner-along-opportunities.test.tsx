import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlannerAlongOpportunities } from "@/ui/planner/PlannerAlongOpportunities";
import type { RiderOpportunity } from "@/application/discover/rider-opportunities";
import type { RoadOpeningSummary } from "@/application/route-intelligence/opening-calendar-contract";

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
  it("refreshes suggestions when reopened", async () => {
    const fetcher = responses();
    render(<PlannerAlongOpportunities route={route} departure={departure} />);
    fireEvent.click(screen.getByText("Along this ride"));
    await screen.findByText("Forest overlook");
    fireEvent.click(screen.getByText("Along this ride"));
    fireEvent.click(screen.getByText("Along this ride"));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  });
  it("caps mixed suggestions at five, caps events at three, and excludes timing misses", async () => {
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
    expect(list.children).toHaveLength(5);
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
