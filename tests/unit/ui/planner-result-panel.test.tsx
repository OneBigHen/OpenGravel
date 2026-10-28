/**
 * The ride result panel's deferred chart (plan first-load split, elevation
 * chart rework).
 *
 * The elevation chart, the waypoint projection and the ride briefing load with
 * `next/dynamic` once a route exists, so the first map interaction does not
 * carry them. Deferring the chart must not drop what the ride gives it: the
 * authored points become numbered notches, the sheet's expanded detent opens the
 * chart expanded, the selected card's colour tints the slot, and the surface
 * evidence drawn from the card reaches the strip under the profile.
 *
 * The panel is rendered as the rail composition (`inspector: null`), which is
 * the same subtree the wide tier portals into its inspector column.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ElevationResult, ElevationSource } from "@/application/elevation/profile";
import type { RouteCardVm } from "@/application/planner/planner-view-model";
import type { SurfaceRun } from "@/application/roads/engine-road-evidence";
import { createRideDocument, defaultRideIntent } from "@/domain/ride/create";
import { newPointId, newStopId } from "@/domain/ride/ids";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import { asRouteCandidateId } from "@/domain/route/ids";
import { PlannerResultPanel } from "@/ui/planner/PlannerResultPanel";

afterEach(() => cleanup());

const NOW = "2026-06-21T14:00:00.000Z";
const STRAIGHT = { type: "map", selectedAt: NOW } as const;

/** A straight west→east ride, so every authored point projects onto it. */
const LINE: readonly Coordinate[] = Array.from({ length: 21 }, (_, index) => ({
  lon: -75.7 + index * 0.02,
  lat: 40.8,
}));

function card(routeId: string, overrides: Partial<RouteCardVm> = {}): RouteCardVm {
  return {
    routeId: asRouteCandidateId(routeId),
    roleKey: "best-ride",
    roleLabel: "Best Ride",
    durationLabel: "1 h 30 min",
    distanceLabel: "30 mi",
    addedTimeLabel: null,
    badges: [],
    unknownSurfaceMi: null,
    whyKey: `why-${routeId}`,
    isSelected: true,
    ...overrides,
  };
}

/** The ride whose authored points the chart notches: start, one stop, finish. */
function rideWithWaypoints(): RideDocument {
  const base = createRideDocument({ now: NOW });
  const intent = {
    ...defaultRideIntent(),
    start: { id: newPointId(), kind: "start" as const, coordinate: LINE[0]!, provenance: STRAIGHT },
    stops: [
      { id: newStopId(), kind: "stop" as const, coordinate: LINE[10]!, provenance: STRAIGHT },
    ],
    finish: { id: newPointId(), kind: "finish" as const, coordinate: LINE[20]!, provenance: STRAIGHT },
  };
  return { ...base, intent };
}

/** A source that answers every sample with the same height. */
const ELEVATION_SOURCE: ElevationSource = {
  elevations: async (points): Promise<ElevationResult> => ({
    availability: "available",
    elevationsMeters: points.map(() => 240),
  }),
};

const SURFACE: readonly SurfaceRun[] = [{ kind: "gravel", from: 0, to: 0.6 }];

function renderPanel(
  { routeId, sheetExpanded }: { readonly routeId: string; readonly sheetExpanded: boolean },
): void {
  const ride = rideWithWaypoints();
  render(
    <PlannerResultPanel
      inspector={null}
      choices={{ cards: [card(routeId, { tint: 2, surfaceRuns: SURFACE })], explanation: null, onSelect: vi.fn() }}
      actions={{ document: ride, libraryService: undefined, shareService: undefined, route: null, start: null }}
      briefing={{
        route: { routeId: asRouteCandidateId(routeId), geometry: LINE, distanceMeters: 48_000, durationSeconds: 5_400 },
        ride,
        bikes: [],
        providers: { elevationProfile: ELEVATION_SOURCE },
        offlineRoute: null,
        actions: { setBike: vi.fn(), setDeparture: vi.fn(), setArriveBy: vi.fn() },
        onRouteTraffic: vi.fn(),
      }}
      sheetExpanded={sheetExpanded}
    />,
  );
}

describe("PlannerResultPanel's deferred elevation chart", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("draws the authored points, the expanded density and the card's surface once the chart loads", async () => {
    renderPanel({ routeId: "route_firstload_expanded", sheetExpanded: true });

    // The chart is behind the lazy boundary: it arrives after the first paint.
    await screen.findByTestId("elevation-profile");
    // The loading skeleton carries the same test id, so read the drawn chart
    // only once the measured climb is on screen.
    expect(await screen.findByTestId("elevation-climb")).toHaveTextContent("ft");
    const chart = screen.getByTestId("elevation-profile");

    // The sheet's expanded detent opens the chart expanded.
    expect(chart).toHaveAttribute("data-density", "expanded");
    // The selected card's colour slot tints the chart's container.
    expect(chart.closest(".og-elevation-slot")).toHaveAttribute("data-tint", "2");
    // The authored points are notched in order: start, the stop, the finish.
    const notches = within(screen.getByTestId("elevation-waypoints")).getAllByTestId("elevation-waypoint");
    expect(notches.map((notch) => notch.getAttribute("data-position"))).toEqual(["1", "2", "3"]);
    expect(notches.map((notch) => notch.getAttribute("title"))).toEqual(["Start", "Stop 1", "Finish"]);
    // The card's surface runs still reach the strip under the profile.
    expect(screen.getByTestId("elevation-surface")).toBeInTheDocument();
  });

  it("keeps the compact density while the sheet rests, with no notches to draw", async () => {
    renderPanel({ routeId: "route_firstload_compact", sheetExpanded: false });

    await screen.findByTestId("elevation-profile");
    await screen.findByTestId("elevation-climb");
    expect(screen.getByTestId("elevation-profile")).toHaveAttribute("data-density", "compact");
    expect(screen.queryByTestId("elevation-waypoints")).not.toBeInTheDocument();
  });

  it("draws the weather along the route under the profile, from the ride's own departure", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        report: {
          source: "nws",
          samples: [
            {
              coordinate: { lon: -75.7, lat: 40.8 },
              alongMeters: 0,
              mile: 0,
              elapsedSeconds: 0,
              eta: "2026-06-21T14:00:00.000Z",
              tempF: 71,
              rainChancePct: 10,
              windMph: 6,
              shortForecast: "Sunny",
            },
          ],
          headline: "Dry the whole way",
          forecastAvailable: true,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPanel({ routeId: "route_weather_wiring", sheetExpanded: false });

    // The strip is behind its own lazy boundary, beside the chart.
    expect(await screen.findByTestId("planner-route-weather")).toBeInTheDocument();
    expect(await screen.findByTestId("route-weather-headline")).toHaveTextContent("Dry the whole way");
    expect(screen.getAllByTestId("route-weather-cell")).toHaveLength(1);

    // The route is what the request is about: its line and its measured time.
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as {
      readonly durationSeconds: number;
      readonly line: readonly { readonly lon: number; readonly lat: number }[];
    };
    expect(body.durationSeconds).toBe(5_400);
    expect(body.line[0]).toEqual({ lon: LINE[0]!.lon, lat: LINE[0]!.lat });
    expect(body.line).toHaveLength(21);
  });
});

/**
 * The phone block's options and the one-tap ride style need more room than the
 * peek detent has, so opening Compare rides there asks the sheet for its next
 * step up instead of showing a list the rider cannot shape.
 */
describe("PlannerResultPanel on a phone", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the sheet for room when Compare rides opens from the peek block", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const onExpandSheet = vi.fn();
    const ride = rideWithWaypoints();
    render(
      <PlannerResultPanel
        inspector={null}
        onExpandSheet={onExpandSheet}
        choices={{
          cards: [card("route_peek_a"), card("route_peek_b", { isSelected: false })],
          explanation: null,
          onSelect: vi.fn(),
        }}
        actions={{ document: ride, libraryService: undefined, shareService: undefined, route: null, start: null }}
        briefing={{
          route: null,
          ride,
          bikes: [],
          providers: {},
          offlineRoute: null,
          actions: { setBike: vi.fn(), setDeparture: vi.fn(), setArriveBy: vi.fn() },
          onRouteTraffic: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("compare-rides"));
    expect(onExpandSheet).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("phone-alternatives")).toBeInTheDocument();
    // Going back to the summary is not a move up.
    fireEvent.click(screen.getByRole("button", { name: "Back to ride" }));
    expect(onExpandSheet).toHaveBeenCalledTimes(1);
  });
});
