/**
 * Weather along the route, drawn (MAP-EXPERIENCE-NEXT Wave 2, item 7).
 *
 * The strip has four things to get right: a headline with a glyph, one cell per
 * sample at its own hour, a dash — never 0% and never a clear sky — wherever the
 * reading is unknown, and quiet one-liners while it loads or when the provider
 * is down. The planner wrapper is checked too, because the departure it asks
 * about has to be the ride's own.
 */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RouteWeatherReport, RouteWeatherSample } from "@/application/weather/route-weather";
import type { Coordinate } from "@/domain/ride/types";
import { PlannerRouteWeather, nearestQuarterHour } from "@/ui/planner/PlannerRouteWeather";
import { RouteWeatherStrip, routeWeatherGlyph } from "@/ui/weather/RouteWeatherStrip";
import type { RouteWeatherState } from "@/ui/weather/useRouteWeather";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ZONE = "America/New_York";

function sample(overrides: Partial<RouteWeatherSample> = {}): RouteWeatherSample {
  return {
    coordinate: { lon: -75.5, lat: 40.2 },
    alongMeters: 0,
    mile: 0,
    elapsedSeconds: 0,
    eta: "2026-10-27T19:00:00.000Z",
    tempF: 61,
    rainChancePct: 10,
    windMph: 8,
    shortForecast: "Mostly Sunny",
    ...overrides,
  };
}

function report(overrides: Partial<RouteWeatherReport> = {}): RouteWeatherReport {
  return {
    source: "nws",
    samples: [
      sample({ mile: 0, alongMeters: 0, elapsedSeconds: 0, tempF: 61, rainChancePct: 10 }),
      sample({ mile: 12, alongMeters: 19_300, elapsedSeconds: 1800, eta: "2026-10-27T19:30:00.000Z", tempF: 64, rainChancePct: 45 }),
      sample({ mile: 24, alongMeters: 38_600, elapsedSeconds: 3600, eta: "2026-10-27T20:00:00.000Z", tempF: 63, rainChancePct: 80 }),
    ],
    headline: "Rain from mile 24 around 4 PM",
    forecastAvailable: true,
    ...overrides,
  };
}

function ready(value: RouteWeatherReport): RouteWeatherState {
  return { status: "ready", report: value };
}

function cells(): HTMLElement[] {
  return screen.getAllByTestId("route-weather-cell");
}

describe("RouteWeatherStrip", () => {
  it("draws the headline with a rain glyph and one cell per sample", () => {
    render(<RouteWeatherStrip state={ready(report())} timeZone={ZONE} />);

    const headline = screen.getByTestId("route-weather-headline");
    expect(headline).toHaveTextContent("Rain from mile 24 around 4 PM");
    expect(headline.querySelector(".og-route-weather__glyph")).toHaveAttribute("data-kind", "rain");

    const strip = cells();
    expect(strip).toHaveLength(3);
    expect(strip.map((cell) => cell.getAttribute("data-mile"))).toEqual(["0", "12", "24"]);
    // The hour the rider is there, in the zone they ride in (EDT, UTC−4).
    expect(within(strip[0]!).getByText("3 PM")).toBeInTheDocument();
    expect(within(strip[0]!).getByText("61°")).toBeInTheDocument();
    expect(within(strip[0]!).getByText("10%")).toBeInTheDocument();
    // The bar follows the chance: dry, then a maybe, then rain.
    expect(strip.map((cell) => cell.getAttribute("data-rain"))).toEqual(["low", "mid", "high"]);
  });

  it("is sunny only when every sample carries a chance below the rain threshold", () => {
    const dry = report({
      samples: [sample({ mile: 0, rainChancePct: 0 }), sample({ mile: 12, rainChancePct: 15 })],
      headline: "Dry the whole way",
    });
    expect(routeWeatherGlyph(dry)).toBe("dry");

    render(<RouteWeatherStrip state={ready(dry)} timeZone={ZONE} />);
    expect(screen.getByTestId("route-weather-headline").querySelector(".og-route-weather__glyph"))
      .toHaveAttribute("data-kind", "dry");
    expect(cells().map((cell) => cell.getAttribute("data-rain"))).toEqual(["none", "low"]);
  });

  it("shows a dash rather than a dry cell when a sample has no reading", () => {
    const partlyUnknown = report({
      samples: [
        sample({ mile: 0, rainChancePct: 10 }),
        sample({ mile: 12, rainChancePct: null, tempF: null, eta: null }),
      ],
      headline: "Mostly dry, but part of the route has no forecast",
    });

    // One gap is enough to stop the glyph claiming clear weather.
    expect(routeWeatherGlyph(partlyUnknown)).toBe("unknown");
    // Rain a sample does carry is a fact, gap or no gap.
    expect(
      routeWeatherGlyph(report({ samples: [sample({ rainChancePct: 70 }), sample({ rainChancePct: null })] })),
    ).toBe("rain");

    render(<RouteWeatherStrip state={ready(partlyUnknown)} timeZone={ZONE} />);
    expect(screen.getByTestId("route-weather-headline").querySelector(".og-route-weather__glyph"))
      .toHaveAttribute("data-kind", "unknown");

    const unknown = cells()[1]!;
    expect(unknown).toHaveAttribute("data-rain", "unknown");
    expect(within(unknown).getAllByText("—")).toHaveLength(3);
    expect(within(unknown).queryByText("0%")).not.toBeInTheDocument();
    // No fill to mistake for a dry bar: the track itself is hatched.
    expect(unknown.querySelector(".og-route-weather__bar")).toBeNull();
  });

  it("keeps the sample's hour when only the sky is unknown", () => {
    const noSky = report({
      samples: [sample({ mile: 0, rainChancePct: null, tempF: null })],
      headline: "Forecast along the route is unavailable",
      forecastAvailable: false,
    });
    render(<RouteWeatherStrip state={ready(noSky)} timeZone={ZONE} />);

    expect(cells()[0]!).toHaveTextContent("3 PM");
    expect(cells()[0]!).toHaveAttribute("data-rain", "unknown");
  });

  it("counts the trip in hours in a zone it was given, and leaves them blank otherwise", () => {
    const noZone = report({ samples: [sample({ eta: "2026-10-27T19:00:00.000Z" })] });
    render(<RouteWeatherStrip state={ready(noZone)} timeZone="not/a-zone" />);
    expect(within(cells()[0]!).getByText("—")).toBeInTheDocument();
  });

  it("is one quiet line while loading, with no strip and no invented sky", () => {
    render(<RouteWeatherStrip state={{ status: "loading" }} />);

    expect(screen.getByTestId("route-weather-loading")).toHaveTextContent("Checking the weather along the route…");
    expect(screen.queryByTestId("route-weather")).not.toBeInTheDocument();
    expect(screen.queryByTestId("route-weather-cells")).not.toBeInTheDocument();
  });

  it("is one quiet line when the provider is unavailable", () => {
    render(<RouteWeatherStrip state={{ status: "unavailable", reason: "busy" }} />);

    expect(screen.getByTestId("route-weather-unavailable")).toHaveTextContent(
      "Weather along the route is unavailable right now.",
    );
    expect(screen.queryByTestId("route-weather")).not.toBeInTheDocument();
  });

  it("draws nothing before there is a departure to place the ride against", () => {
    const { container } = render(<RouteWeatherStrip state={{ status: "idle" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("nearestQuarterHour", () => {
  it("rounds a clock reading to the quarter hour the forecast can answer", () => {
    expect(nearestQuarterHour("2026-10-27T15:07:00.000Z")).toBe("2026-10-27T15:00:00.000Z");
    expect(nearestQuarterHour("2026-10-27T15:08:00.000Z")).toBe("2026-10-27T15:15:00.000Z");
    expect(nearestQuarterHour("2026-10-27T15:53:00.000Z")).toBe("2026-10-27T16:00:00.000Z");
  });

  it("leaves an instant it cannot read alone", () => {
    expect(nearestQuarterHour("later")).toBe("later");
  });
});

describe("PlannerRouteWeather", () => {
  const LINE: readonly Coordinate[] = [
    { lon: -75.91, lat: 40.61 },
    { lon: -75.8, lat: 40.6 },
    { lon: -75.62, lat: 40.55 },
  ];
  const ROUTE = { geometry: LINE, durationSeconds: 3600 };

  function stubFetch(value: RouteWeatherReport): ReturnType<typeof vi.fn> {
    const mock = vi.fn(async () => Response.json({ report: value }));
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  it("asks about the ride's own departure and duration", async () => {
    const fetchMock = stubFetch(report());
    render(
      <PlannerRouteWeather
        route={ROUTE}
        departure={{ kind: "future", at: "2026-10-27T15:00:00.000Z" }}
        time={{ kind: "none" }}
      />,
    );

    expect(await screen.findByTestId("route-weather")).toBeInTheDocument();
    expect(screen.getByTestId("route-weather-headline")).toHaveTextContent("Rain from mile 24 around 4 PM");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["departureTime"]).toBe("2026-10-27T15:00:00.000Z");
    expect(body["durationSeconds"]).toBe(3600);
    expect(body["line"]).toEqual(LINE.map((point) => ({ lon: point.lon, lat: point.lat })));
  });

  it("asks about a quarter hour, not the exact second, for a ride leaving now", async () => {
    const fetchMock = stubFetch(report({ headline: "Dry the whole way", samples: [sample({ rainChancePct: 5 })] }));
    render(<PlannerRouteWeather route={ROUTE} departure={{ kind: "now" }} time={{ kind: "none" }} />);

    expect(await screen.findByTestId("route-weather")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const departureTime = String((JSON.parse(String(init.body)) as Record<string, unknown>)["departureTime"]);
    const instant = Date.parse(departureTime);
    expect(Number.isFinite(instant)).toBe(true);
    expect(instant % (15 * 60 * 1000)).toBe(0);
  });

  it("keeps the elevation and the ride when the weather is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
    render(
      <PlannerRouteWeather
        route={ROUTE}
        departure={{ kind: "future", at: "2026-10-28T15:00:00.000Z" }}
        time={{ kind: "none" }}
      />,
    );

    expect(await screen.findByTestId("route-weather-unavailable")).toBeVisible();
    expect(screen.queryByTestId("route-weather")).not.toBeInTheDocument();
  });

  it("draws nothing without a route", () => {
    const fetchMock = stubFetch(report());
    const { container } = render(
      <PlannerRouteWeather route={null} departure={{ kind: "now" }} time={{ kind: "none" }} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
