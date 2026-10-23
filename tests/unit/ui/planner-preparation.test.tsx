/**
 * The planner's route briefing (MVP parity M4, OGV-D-266).
 *
 * Pins the contract: the context reads the departure, the bike and the route;
 * live traffic is asked only for a ride leaving now; the departure chips author
 * one command each; and the selected route's traffic is handed back once.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  departureIsLive,
  plannerPreparationContext,
  thinLine,
  TRAFFIC_CORRIDOR_POINTS,
} from "@/application/preparation/planner-context";
import type {
  PreparationProviderRegistry,
  ProviderResult,
  TrafficData,
  WeatherData,
} from "@/application/preparation/providers";
import { DEFAULT_BIKE } from "@/domain/ride/create";
import { createGarage } from "@/application/garage/garage-model";
import type { Coordinate } from "@/domain/ride/types";
import { departureFor, departureSummary, PlannerPreparation } from "@/ui/planner/PlannerPreparation";
import { InstalledOfflineAreasProvider } from "@/ui/planner/installed-offline-areas";

afterEach(() => cleanup());

const NOW = "2026-06-21T14:00:00.000Z";
const LINE: Coordinate[] = Array.from({ length: 400 }, (_, index) => ({ lon: -75.7 + index * 0.001, lat: 40.86 }));
const ROUTE = { geometry: LINE, distanceMeters: 48_000, durationSeconds: 5_400 };

describe("plannerPreparationContext", () => {
  it("builds the ride window, fuel range and daylight from the route and the departure", () => {
    const context = plannerPreparationContext({ route: ROUTE, departure: { kind: "now" }, bike: DEFAULT_BIKE, now: NOW });
    expect(context.distanceKm).toBe(48);
    expect(context.rideDurationMinutes).toBe(90);
    expect(context.tripWindow).toEqual({ start: NOW, end: "2026-06-21T15:30:00.000Z" });
    // 150 mi range less the 30 mi reserve.
    expect(context.fuelRangeKm).toBeCloseTo(120 * 1.609344, 5);
    // Jim Thorpe on the solstice: sunset ≈ 8:40 PM EDT (00:40Z), ~10.6 h after a 10 AM start.
    expect(context.sunset?.startsWith("2026-06-22T00:")).toBe(true);
    expect(context.remainingDaylightMinutes).toBeGreaterThan(600);
    expect(context.remainingDaylightMinutes).toBeLessThan(660);
    expect(context.trafficCorridor).toHaveLength(TRAFFIC_CORRIDOR_POINTS);
    expect(context.weatherLocation).toEqual({ lat: 40.86, lon: -75.7 });
  });

  it("asks for live traffic only when the ride leaves soon", () => {
    const later = plannerPreparationContext({
      route: ROUTE,
      departure: { kind: "future", at: "2026-06-22T12:00:00.000Z" },
      bike: DEFAULT_BIKE,
      now: NOW,
    });
    expect(later.trafficCorridor).toBeUndefined();
    expect(later.routeTouchesMappedCorridor).toBe(false);
    expect(later.tripWindow?.start).toBe("2026-06-22T12:00:00.000Z");
    expect(departureIsLive({ kind: "future", at: "2026-06-21T14:20:00.000Z" }, NOW)).toBe(true);
  });

  it("thins a line evenly and keeps both ends", () => {
    const thinned = thinLine(LINE, 5);
    expect(thinned).toHaveLength(5);
    expect(thinned[0]).toBe(LINE[0]);
    expect(thinned.at(-1)).toBe(LINE.at(-1));
  });
});

describe("departure choices", () => {
  it("resolves quick choices from the moment they are picked", () => {
    const from = new Date("2026-06-21T14:00:00.000Z");
    expect(departureFor("now", from)).toEqual({ kind: "now" });
    expect(departureFor("in-1h", from)).toEqual({ kind: "future", at: "2026-06-21T15:00:00.000Z" });
    const tomorrow = departureFor("tomorrow-8", from);
    expect(tomorrow.kind === "future" && new Date(tomorrow.at).getHours()).toBe(8);
    expect(departureSummary({ kind: "now" })).toBe("Leaving now");
    expect(departureSummary({ kind: "future", at: "2026-06-21T15:00:00.000Z" }, "America/New_York")).toBe(
      "Leaving Sun 11:00 AM",
    );
  });
});

describe("PlannerPreparation", () => {
  it("routes a selected garage bike through the bike-change action", () => {
    const base = createGarage().bikes[0]!;
    const trailBike = { ...base, id: "bike_trail", name: "Trail bike", fuelRangeMiles: 60, reserveMiles: 10 };
    const onBikeChange = vi.fn();
    render(
      <PlannerPreparation
        route={{ routeId: "route_a", ...ROUTE }}
        departure={{ kind: "now" }}
        bike={DEFAULT_BIKE}
        bikes={[base, trailBike]}
        offlineRoute={null}
        onDepartureChange={vi.fn()}
        onBikeChange={onBikeChange}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Change bike for this ride" }), {
      target: { value: "bike_trail" },
    });

    expect(onBikeChange).toHaveBeenCalledWith(expect.objectContaining({
      bikeId: "bike_trail",
      fuelRangeMiles: 60,
      reserveMiles: 10,
    }));
  });

  function providers(): PreparationProviderRegistry & {
    readonly weatherRefresh: ReturnType<typeof vi.fn>;
    readonly trafficRefresh: ReturnType<typeof vi.fn>;
  } {
    const weatherResult: ProviderResult<WeatherData> = {
      state: "ready",
      reason: "Weather for the ride window.",
      provenance: "National Weather Service",
      data: { display: "72°F, dry" } as WeatherData,
    };
    const trafficResult: ProviderResult<TrafficData> = {
      state: "ready",
      reason: "Traffic matched to this route.",
      provenance: "Live traffic feed",
      data: { display: "Light traffic" } as TrafficData,
    };
    const weatherRefresh = vi.fn(async () => weatherResult);
    const trafficRefresh = vi.fn(async () => trafficResult);
    return {
      weatherRefresh,
      trafficRefresh,
      weather: {
        id: "weather-test",
        kind: "weather",
        capabilities: () => ({ kind: "weather", availability: "available", freshness: "time-bound", reason: null, provenance: "test" }),
        getWeather: () => weatherResult,
        refresh: weatherRefresh,
      },
      traffic: {
        id: "traffic-test",
        kind: "traffic",
        capabilities: () => ({ kind: "traffic", availability: "available", freshness: "time-bound", reason: null, provenance: "test" }),
        getTraffic: () => trafficResult,
        refresh: trafficRefresh,
      },
    } as never;
  }

  it("checks the selected route once, briefs it, and hands its traffic back", async () => {
    const registry = providers();
    const onRouteTraffic = vi.fn();
    const onDepartureChange = vi.fn();
    render(
      <PlannerPreparation
        route={{ routeId: "route_a", ...ROUTE }}
        departure={{ kind: "now" }}
        bike={DEFAULT_BIKE}
        providers={registry}
        offlineRoute={null}
        onDepartureChange={onDepartureChange}
        onBikeChange={vi.fn()}
        onRouteTraffic={onRouteTraffic}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(registry.weatherRefresh).toHaveBeenCalledTimes(1);
    expect(registry.trafficRefresh).toHaveBeenCalledTimes(1);
    expect(onRouteTraffic).toHaveBeenLastCalledWith({ routeId: "route_a", label: "Light traffic" });
    expect(screen.getByTestId("preparation-section")).toBeInTheDocument();
    expect(screen.getByTestId("departure-summary")).toHaveTextContent("Leaving now");

    fireEvent.click(screen.getByTestId("departure-in-1h"));
    expect(onDepartureChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "future" }));
    fireEvent.click(screen.getByTestId("departure-custom"));
    expect(screen.getByTestId("departure-time")).toBeInTheDocument();
  });

  it("arrives by a time: the briefing leaves early enough, and a quick choice clears it (NV-09)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 21, 10, 0));
    try {
      const registry = providers();
      const onArrivalChange = vi.fn();
      const onDepartureChange = vi.fn();
      const view = (arrival: { date: string; localTime: string } | null) => (
        <PlannerPreparation
          route={{ routeId: "route_a", ...ROUTE }}
          departure={{ kind: "now" }}
          bike={DEFAULT_BIKE}
          providers={registry}
          offlineRoute={null}
          onDepartureChange={onDepartureChange}
          arrival={arrival}
          onArrivalChange={onArrivalChange}
          onBikeChange={vi.fn()}
        />
      );
      const { rerender } = render(view(null));
      fireEvent.click(screen.getByTestId("departure-arrive"));
      fireEvent.change(screen.getByTestId("arrival-time"), { target: { value: "2026-06-21T18:00" } });
      expect(onArrivalChange).toHaveBeenLastCalledWith({ date: "2026-06-21", localTime: "18:00" });

      rerender(view({ date: "2026-06-21", localTime: "18:00" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      // 90 min ride → leave 4:30 PM; the weather window is that ride, not now.
      const context = registry.weatherRefresh.mock.lastCall?.[0] as { tripWindow?: { start: string } };
      expect(context.tripWindow?.start).toBe(new Date(2026, 5, 21, 16, 30).toISOString());
      expect(screen.getByTestId("departure-summary").textContent).toMatch(/^Leave Sun 4:30 PM to arrive by 6:00 PM$/);
      expect(screen.getByTestId("departure-arrive")).toBeChecked();

      fireEvent.click(screen.getByTestId("departure-in-1h"));
      expect(onArrivalChange).toHaveBeenLastCalledWith(null);
      expect(onDepartureChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "future" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so when leaving now already misses the arrival (NV-09)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 21, 17, 30));
    try {
      const registry = providers();
      render(
        <PlannerPreparation
          route={{ routeId: "route_a", ...ROUTE }}
          departure={{ kind: "now" }}
          bike={DEFAULT_BIKE}
          providers={registry}
          offlineRoute={null}
          onDepartureChange={vi.fn()}
          arrival={{ date: "2026-06-21", localTime: "18:00" }}
          onArrivalChange={vi.fn()}
          onBikeChange={vi.fn()}
        />,
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(registry.trafficRefresh).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("departure-summary").textContent).toBe(
        "Leave now · arrive Sun 7:00 PM, after 6:00 PM",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers no arrive-by where the ride has none (loops)", () => {
    render(
      <PlannerPreparation
        route={{ routeId: "route_a", ...ROUTE }}
        departure={{ kind: "now" }}
        bike={DEFAULT_BIKE}
        offlineRoute={null}
        onDepartureChange={vi.fn()}
        onBikeChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("departure-arrive")).toBeNull();
  });

  it("says the downloaded area plans rides offline instead of 'online only for now'", async () => {
    const offlineRegions = {
      installed: vi.fn(async () => [{ regionId: "pennsylvania" }, { regionId: "maryland" }]),
    };
    render(
      <PlannerPreparation
        route={{ routeId: "route_a", ...ROUTE }}
        departure={{ kind: "now" }}
        bike={DEFAULT_BIKE}
        offlineRoute={null}
        offlineRegions={offlineRegions as never}
        onDepartureChange={vi.fn()}
        onBikeChange={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const note = screen.getByTestId("offline-summary-note");
    expect(note).toHaveTextContent("2 areas ready · plan offline");
    expect(note).not.toHaveTextContent("online only for now");
    // The disclosure underneath agrees with the line above it.
    expect(screen.getByTestId("offline-state-plan.route")).not.toHaveTextContent("Needs network");
  });

  it("reads the areas the composition root provided when no prop is given", async () => {
    render(
      <InstalledOfflineAreasProvider regions={{ installed: async () => [{ regionId: "pennsylvania" }] as never }}>
        <PlannerPreparation
          route={{ routeId: "route_a", ...ROUTE }}
          departure={{ kind: "now" }}
          bike={DEFAULT_BIKE}
          offlineRoute={null}
          onDepartureChange={vi.fn()}
          onBikeChange={vi.fn()}
        />
      </InstalledOfflineAreasProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("offline-summary-note")).toHaveTextContent("1 area ready · plan offline");
  });

  it("says so plainly when this device holds no downloaded area", async () => {
    const offlineRegions = { installed: vi.fn(async () => []) };
    render(
      <PlannerPreparation
        route={{ routeId: "route_a", ...ROUTE }}
        departure={{ kind: "now" }}
        bike={DEFAULT_BIKE}
        offlineRoute={null}
        offlineRegions={offlineRegions as never}
        onDepartureChange={vi.fn()}
        onBikeChange={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const note = screen.getByTestId("offline-summary-note");
    expect(note).toHaveTextContent("no downloaded area · online only");
    expect(note).not.toHaveTextContent("online only for now");
  });

  it("shows nothing before there is a route", () => {
    render(
      <PlannerPreparation
        route={null}
        departure={{ kind: "now" }}
        bike={DEFAULT_BIKE}
        offlineRoute={null}
        onDepartureChange={vi.fn()}
        onBikeChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("prepare")).toBeNull();
    expect(screen.queryByTestId("offline-toggle")).toBeNull();
  });
});
