import { describe, expect, it } from "vitest";

import {
  evenDurationProfile,
  forecastForInstant,
  isKnownTimeZone,
  isRouteWeatherReport,
  routeLineMeters,
  routeWeatherHeadline,
  routeWeatherHourLabel,
  routeWeatherReading,
  sampleRouteWeatherPoints,
  type RouteWeatherSample,
} from "@/application/weather/route-weather";
import type { WeatherForecastPeriod } from "@/application/preparation/providers";
import type { Coordinate } from "@/domain/ride/types";

const MILE_METERS = 1609.344;
const DEPARTURE = Date.parse("2026-10-27T13:00:00.000Z");

function line(points: number, spanDegrees = 0.02): readonly Coordinate[] {
  return Array.from({ length: points }, (_, index) => ({
    lon: -75.5 + (spanDegrees * index) / (points - 1),
    lat: 40.2,
  }));
}

function period(startTime: string, endTime: string, overrides: Partial<WeatherForecastPeriod> = {}): WeatherForecastPeriod {
  return { name: startTime, startTime, endTime, shortForecast: "Sunny", ...overrides };
}

describe("sampling a route for weather", () => {
  it("places the default six points at even distance, both ends included", () => {
    const route = line(4);
    const total = routeLineMeters(route);
    const samples = sampleRouteWeatherPoints({
      line: route,
      durationProfile: evenDurationProfile(total, 3600),
      departureMs: DEPARTURE,
    });

    expect(samples).toHaveLength(6);
    expect(samples[0]?.alongMeters).toBe(0);
    expect(samples[5]?.alongMeters).toBeCloseTo(total, 6);
    expect(samples[0]?.coordinate.lon).toBeCloseTo(-75.5, 9);
    expect(samples[0]?.coordinate.lat).toBeCloseTo(40.2, 9);
    expect(samples[5]?.coordinate.lon).toBeCloseTo(route[3]?.lon ?? 0, 9);
    expect(samples[5]?.coordinate.lat).toBeCloseTo(route[3]?.lat ?? 0, 9);
    for (let index = 1; index < samples.length; index += 1) {
      const step = (samples[index]?.alongMeters ?? 0) - (samples[index - 1]?.alongMeters ?? 0);
      expect(step).toBeCloseTo(total / 5, 6);
      expect(samples[index]?.mile ?? 0).toBeGreaterThan(samples[index - 1]?.mile ?? -1);
    }
  });

  it("assigns each point its ETA from the duration profile, not from a guessed speed", () => {
    const route = line(6);
    const total = routeLineMeters(route);
    const samples = sampleRouteWeatherPoints({
      line: route,
      // A climb early, a fast finish: half the distance in the first quarter hour.
      durationProfile: {
        stops: [
          { distanceMeters: 0, elapsedSeconds: 0 },
          { distanceMeters: total / 2, elapsedSeconds: 900 },
          { distanceMeters: total, elapsedSeconds: 3600 },
        ],
      },
      departureMs: DEPARTURE,
      count: 3,
    });

    expect(samples.map((sample) => sample.elapsedSeconds)).toEqual([0, 900, 3600]);
    expect(samples.map((sample) => sample.eta)).toEqual([
      "2026-10-27T13:00:00.000Z",
      "2026-10-27T13:15:00.000Z",
      "2026-10-27T14:00:00.000Z",
    ]);
  });

  it("shares an even profile's duration out over the distance, in miles", () => {
    const route: readonly Coordinate[] = [
      { lon: -75.5, lat: 40.2 },
      { lon: -75.5 + 2 * MILE_METERS / 111_000, lat: 40.2 },
    ];
    const total = routeLineMeters(route);
    const profile = evenDurationProfile(total, 1200);
    if (profile === null) throw new Error("profile");
    const samples = sampleRouteWeatherPoints({ line: route, durationProfile: profile, departureMs: DEPARTURE, count: 3 });

    expect(samples.map((sample) => sample.elapsedSeconds)).toEqual([0, 600, 1200]);
    expect(samples[2]?.mile).toBeCloseTo(total / MILE_METERS, 1);
    expect(samples[2]?.eta).toBe("2026-10-27T13:20:00.000Z");
  });

  it("refuses to invent a duration or a departure", () => {
    const route = line(3);
    const withoutDuration = sampleRouteWeatherPoints({
      line: route,
      durationProfile: null,
      departureMs: DEPARTURE,
      count: 3,
    });
    expect(withoutDuration.map((sample) => sample.elapsedSeconds)).toEqual([null, null, null]);
    expect(withoutDuration.map((sample) => sample.eta)).toEqual([null, null, null]);

    const withoutDeparture = sampleRouteWeatherPoints({
      line: route,
      durationProfile: evenDurationProfile(routeLineMeters(route), 600),
      departureMs: null,
      count: 3,
    });
    expect(withoutDeparture.map((sample) => sample.elapsedSeconds)).toEqual([0, 300, 600]);
    expect(withoutDeparture.map((sample) => sample.eta)).toEqual([null, null, null]);
  });

  it("returns nothing for a line with no measurable length", () => {
    expect(sampleRouteWeatherPoints({
      line: [{ lon: -75.5, lat: 40.2 }],
      durationProfile: null,
      departureMs: DEPARTURE,
    })).toEqual([]);
    expect(sampleRouteWeatherPoints({
      line: [{ lon: -75.5, lat: 40.2 }, { lon: -75.5, lat: 40.2 }],
      durationProfile: null,
      departureMs: DEPARTURE,
    })).toEqual([]);
  });
});

describe("matching a sample to an hourly forecast", () => {
  const periods = [
    period("2026-10-27T13:00:00.000Z", "2026-10-27T14:00:00.000Z", { temperatureF: 61 }),
    period("2026-10-27T14:00:00.000Z", "2026-10-27T15:00:00.000Z", { temperatureF: 63 }),
  ];

  it("reads the period that covers the ETA", () => {
    expect(forecastForInstant(periods, Date.parse("2026-10-27T14:30:00.000Z"))?.temperatureF).toBe(63);
  });

  it("borrows a period that starts within half an hour, because the hourly grid starts on the hour", () => {
    expect(forecastForInstant(periods, Date.parse("2026-10-27T12:40:00.000Z"))?.temperatureF).toBe(61);
    expect(forecastForInstant(periods, Date.parse("2026-10-27T15:25:00.000Z"))?.temperatureF).toBe(63);
  });

  it("stays unknown outside the forecast's reach", () => {
    expect(forecastForInstant(periods, Date.parse("2026-10-27T12:00:00.000Z"))).toBeNull();
    expect(forecastForInstant(periods, Date.parse("2026-10-27T16:00:00.000Z"))).toBeNull();
    expect(forecastForInstant([], Date.parse("2026-10-27T14:30:00.000Z"))).toBeNull();
    expect(forecastForInstant(periods, Number.NaN)).toBeNull();
  });

  it("keeps a period's missing fields missing instead of zero", () => {
    expect(routeWeatherReading(null)).toEqual({
      tempF: null,
      rainChancePct: null,
      windMph: null,
      shortForecast: null,
    });
    expect(routeWeatherReading(period("2026-10-27T13:00:00.000Z", "2026-10-27T14:00:00.000Z"))).toEqual({
      tempF: null,
      rainChancePct: null,
      windMph: null,
      shortForecast: "Sunny",
    });
  });
});

function sample(mile: number, eta: string | null, rainChancePct: number | null) {
  return { mile, eta, rainChancePct };
}

const AT_3_PM = "2026-10-27T15:00:00.000Z";

describe("the headline over the sampled weather", () => {
  it("says dry only when every sample has a rain chance below the threshold", () => {
    expect(routeWeatherHeadline({
      samples: [
        sample(0, AT_3_PM, 5),
        sample(10, "2026-10-27T16:00:00.000Z", 12),
        sample(20, "2026-10-27T17:00:00.000Z", 19),
      ],
      timeZone: "UTC",
    })).toBe("Dry the whole way");
  });

  it("treats the 20% chance the point forecast already calls rain as rain", () => {
    expect(routeWeatherHeadline({
      samples: [sample(0, AT_3_PM, 5), sample(10, "2026-10-27T16:00:00.000Z", 20)],
      timeZone: "UTC",
    })).toBe("Rain from mile 10 around 4 PM");
  });

  it("never calls an unknown sample dry", () => {
    expect(routeWeatherHeadline({
      samples: [sample(0, AT_3_PM, 5), sample(10, "2026-10-27T16:00:00.000Z", null)],
      timeZone: "UTC",
    })).toBe("Mostly dry, but part of the route has no forecast");
    expect(routeWeatherHeadline({
      samples: [sample(0, AT_3_PM, null), sample(10, "2026-10-27T16:00:00.000Z", null)],
      timeZone: "UTC",
    })).toBe("Forecast along the route is unavailable");
  });

  it.each([
    [[80, 5, 5, 5], "Rain at the start around 9 AM, easing after mile 10"],
    [[5, 60, 60, 5], "Rain from mile 10 around 10 AM, easing by mile 30"],
    [[5, 5, 60, 60], "Rain from mile 20 around 11 AM"],
    [[5, 5, 5, 80], "Rain from mile 30 around 12 PM"],
  ])("says where the rain starts when the chances are %j", (chances, expected) => {
    const samples = chances.map((rainChancePct, index) =>
      sample(index * 10, new Date(Date.parse(AT_3_PM) - 6 * 3600_000 + index * 3600_000).toISOString(), rainChancePct),
    );
    expect(routeWeatherHeadline({ samples, timeZone: "UTC" })).toBe(expected);
  });

  it("says rain the whole way only when every sample is rainy", () => {
    expect(routeWeatherHeadline({
      samples: [sample(0, AT_3_PM, 90), sample(10, "2026-10-27T16:00:00.000Z", 70)],
      timeZone: "UTC",
    })).toBe("Rain the whole way");
  });

  it("calls two separate wet stretches showers on and off", () => {
    expect(routeWeatherHeadline({
      samples: [
        sample(0, AT_3_PM, 80),
        sample(10, "2026-10-27T16:00:00.000Z", 5),
        sample(20, "2026-10-27T17:00:00.000Z", 60),
      ],
      timeZone: "UTC",
    })).toBe("Showers on and off along the route");
  });

  it("keeps the clock out of the headline when the rider's time zone is unknown", () => {
    expect(routeWeatherHeadline({
      samples: [sample(0, AT_3_PM, 5), sample(38, "2026-10-27T19:00:00.000Z", 80)],
      timeZone: null,
    })).toBe("Rain from mile 38");
  });

  it("has nothing to check the weather against without a route", () => {
    expect(routeWeatherHeadline({ samples: [], timeZone: "UTC" })).toBe("No route to check the weather along");
  });
});

describe("the local hour a headline names", () => {
  it("rounds the ETA to the nearest hour in the rider's zone", () => {
    expect(routeWeatherHourLabel("2026-10-27T15:29:00.000Z", "UTC")).toBe("3 PM");
    expect(routeWeatherHourLabel("2026-10-27T15:30:00.000Z", "UTC")).toBe("4 PM");
    expect(routeWeatherHourLabel("2026-10-27T04:10:00.000Z", "UTC")).toBe("4 AM");
    expect(routeWeatherHourLabel("2026-10-27T19:40:00.000Z", "America/New_York")).toBe("4 PM");
    expect(routeWeatherHourLabel("2026-10-27T23:50:00.000Z", "UTC")).toBe("12 AM");
  });

  it("says nothing when the instant or the zone is unknown", () => {
    expect(routeWeatherHourLabel(null, "UTC")).toBeNull();
    expect(routeWeatherHourLabel("not-a-time", "UTC")).toBeNull();
    expect(routeWeatherHourLabel(AT_3_PM, null)).toBeNull();
    expect(routeWeatherHourLabel(AT_3_PM, "Not/AZone")).toBeNull();
  });

  it("recognises real IANA zones only", () => {
    expect(isKnownTimeZone("America/New_York")).toBe(true);
    expect(isKnownTimeZone("UTC")).toBe(true);
    expect(isKnownTimeZone("Not/AZone")).toBe(false);
    expect(isKnownTimeZone("")).toBe(false);
  });
});

describe("validating a report at the client boundary", () => {
  const report = {
    source: "nws" as const,
    samples: [{
      coordinate: { lon: -75.5, lat: 40.2 },
      alongMeters: 0,
      mile: 0,
      elapsedSeconds: 0,
      eta: AT_3_PM,
      tempF: 61,
      rainChancePct: 40,
      windMph: 8,
      shortForecast: "Light Rain",
    } satisfies RouteWeatherSample],
    headline: "Rain from mile 0 around 3 PM",
    forecastAvailable: true,
  };

  it("accepts a report the API produced", () => {
    expect(isRouteWeatherReport(report)).toBe(true);
    expect(isRouteWeatherReport({ ...report, samples: [{ ...report.samples[0], rainChancePct: null }] })).toBe(true);
  });

  it("rejects an answer that would read as weather it does not have", () => {
    expect(isRouteWeatherReport(null)).toBe(false);
    expect(isRouteWeatherReport({ ...report, source: "other" })).toBe(false);
    expect(isRouteWeatherReport({ ...report, headline: "" })).toBe(false);
    expect(isRouteWeatherReport({ ...report, samples: [{ ...report.samples[0], rainChancePct: "40%" }] })).toBe(false);
    expect(isRouteWeatherReport({ ...report, samples: [{ ...report.samples[0], eta: "later" }] })).toBe(false);
    expect(isRouteWeatherReport({ ...report, forecastAvailable: undefined })).toBe(false);
  });
});
