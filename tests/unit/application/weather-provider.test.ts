import { describe, expect, it } from "vitest";

import {
  alertOverlapsTripWindow,
  createNwsWeatherProvider,
} from "@/application/preparation/weather-provider";
import { prepareRoute } from "@/application/preparation/prepare-route";
import type { RoutePreparationContext } from "@/application/preparation/prepare-route";
import type {
  WeatherAlert,
  WeatherSnapshot,
} from "@/application/preparation/providers";

const snapshot: WeatherSnapshot = {
  fetchedAt: "2026-09-17T14:32:00.000Z",
  source: "nws",
  alerts: [{
    event: "Severe Thunderstorm Watch",
    severity: "Severe",
    onset: "2026-09-17T17:00:00.000Z",
    ends: "2026-09-18T00:00:00.000Z",
    area: "Lehigh Valley",
  }],
  forecast: [{
    name: "This Afternoon",
    startTime: "2026-09-17T16:00:00.000Z",
    endTime: "2026-09-17T18:00:00.000Z",
    temperatureF: 72,
    windMph: 10,
    precipChance: 10,
    shortForecast: "Sunny",
  }],
};

const location = { lat: 40.14, lon: -75.44 };

function context(
  tripWindow: RoutePreparationContext["tripWindow"],
  riderTimeZone = "America/New_York",
): RoutePreparationContext {
  return { weatherLocation: location, tripWindow, riderTimeZone };
}

function alert(overrides: Partial<WeatherAlert> = {}): WeatherAlert {
  return {
    event: "Flood Advisory",
    severity: "Moderate",
    onset: "2026-09-17T17:00:00.000Z",
    ends: "2026-09-18T00:00:00.000Z",
    area: "Valley",
    ...overrides,
  };
}

describe("NWS preparation provider", () => {
  it("calls the local proxy and makes an overlapping alert the primary factual item", async () => {
    const provider = createNwsWeatherProvider({
      fetcher: async () => Response.json({ snapshot }),
      now: () => Date.parse("2026-09-17T14:44:00.000Z"),
    });

    await provider.refresh(context({
      start: "2026-09-17T18:00:00.000Z",
      end: "2026-09-17T19:00:00.000Z",
    }));
    const result = provider.getWeather(context({
      start: "2026-09-17T18:00:00.000Z",
      end: "2026-09-17T19:00:00.000Z",
    }));

    expect(result.state).toBe("ready");
    expect(result.data).toMatchObject({
      display: "Severe Thunderstorm Watch — through 8:00 PM EDT (updated 12 min ago)",
      freshnessLabel: "Fresh",
      primaryAlert: { severity: "Severe" },
    });
    // The provenance names the kind of source, never the agency that published
    // it: provider identity is diagnostics-only (OGV-D-151), and a rider reading
    // the briefing needs "is this a real forecast and how old is it", not a
    // vendor (VNX-007 / Rule E, defect: provider names in rider copy).
    expect(result.provenance).toMatch(/^Source: National Weather Service · updated \d{2}:\d{2} EDT$/);
    expect(result.provenance).not.toMatch(/nws|noaa/i);
    // The alert sentence is about the rider's trip, not about the publisher.
    expect(result.reason).toBe(
      "A weather alert covers your trip window; check before you ride.",
    );

    const preparation = prepareRoute({
      ...context({ start: "2026-09-17T18:00:00.000Z", end: "2026-09-17T19:00:00.000Z" }),
      routeCharacter: {
        state: "ready",
        reason: "Route character known.",
        provenance: "Route evidence",
        data: { display: "Twisty" },
      },
      providers: { weather: provider },
    });
    expect(preparation.items[0]?.kind).toBe("weather");
  });

  it("formats alert and update times in the rider timezone, including date changes", async () => {
    const provider = createNwsWeatherProvider({
      fetcher: async () => Response.json({ snapshot }),
      now: () => Date.parse("2026-09-17T14:44:00.000Z"),
    });
    const tokyoContext = context({
      start: "2026-09-17T18:00:00.000Z",
      end: "2026-09-17T19:00:00.000Z",
    }, "Asia/Tokyo");
    await provider.refresh(tokyoContext);

    const result = provider.getWeather(tokyoContext);

    expect(result.data?.display).toBe(
      "Severe Thunderstorm Watch — through 9:00 AM GMT+9 (updated 12 min ago)",
    );
    expect(result.provenance).toContain("updated 23:32 GMT+9");
  });

  it("shows forecast only without a trip window, even when alerts exist", async () => {
    const provider = createNwsWeatherProvider({
      fetcher: async () => Response.json({ snapshot }),
      now: () => Date.parse("2026-09-17T14:44:00.000Z"),
    });
    await provider.refresh(context(null));

    const result = provider.getWeather(context(null));
    expect(result.data?.display).toContain("Sunny");
    expect(result.data).not.toHaveProperty("primaryAlert");
    expect(result.data?.display).not.toContain("Thunderstorm");
  });

  it("scopes long-trip weather metrics and alerts to the trip window", async () => {
    const scopedSnapshot: WeatherSnapshot = {
      ...snapshot,
      alerts: [
        alert({ severity: "Severe", event: "Outside warning", onset: "2026-09-17T22:00:00.000Z", ends: "2026-09-17T23:00:00.000Z" }),
        alert({ severity: "Minor", event: "Trip advisory", onset: "2026-09-17T18:30:00.000Z", ends: "2026-09-17T19:30:00.000Z" }),
      ],
      forecast: [
        { ...snapshot.forecast[0]!, startTime: "2026-09-17T18:00:00.000Z", endTime: "2026-09-17T20:00:00.000Z", precipChance: 55, windMph: 35 },
        { ...snapshot.forecast[0]!, name: "Later", startTime: "2026-09-17T22:00:00.000Z", endTime: "2026-09-17T23:00:00.000Z", precipChance: 95, windMph: 60 },
      ],
    };
    const provider = createNwsWeatherProvider({
      fetcher: async () => Response.json({ snapshot: scopedSnapshot }),
      now: () => Date.parse("2026-09-17T14:44:00.000Z"),
    });
    const tripWindow = { start: "2026-09-17T18:00:00.000Z", end: "2026-09-17T20:00:00.000Z" };
    await provider.refresh(context(tripWindow));

    expect(provider.getWeather(context(tripWindow)).data).toMatchObject({
      tripWindowScoped: true,
      maxPrecipChance: 55,
      maxWindMph: 35,
      tripAlerts: [{ event: "Trip advisory" }],
    });
  });

  it.each([
    ["before", { start: "2026-09-17T16:00:00.000Z", end: "2026-09-17T16:59:00.000Z" }, false],
    ["during", { start: "2026-09-17T18:00:00.000Z", end: "2026-09-17T19:00:00.000Z" }, true],
    ["after", { start: "2026-09-18T00:01:00.000Z", end: "2026-09-18T01:00:00.000Z" }, false],
  ] as const)("recognizes an alert %s the trip window", (_name, window, expected) => {
    expect(alertOverlapsTripWindow(alert(), window)).toBe(expected);
  });

  it("does not project an alert when the trip window is unknown", () => {
    expect(alertOverlapsTripWindow(alert(), undefined)).toBe(false);
    expect(alertOverlapsTripWindow(alert({ onset: null, ends: null }), {
      start: "2026-09-17T18:00:00.000Z",
      end: "2026-09-17T19:00:00.000Z",
    })).toBe(false);
  });

  it("marks data stale strictly after 45 minutes", async () => {
    const provider = createNwsWeatherProvider({
      fetcher: async () => Response.json({ snapshot }),
      now: () => Date.parse("2026-09-17T15:17:00.000Z"),
    });
    await provider.refresh(context(null));
    expect(provider.getWeather(context(null))).toMatchObject({ state: "ready" });

    const stale = createNwsWeatherProvider({
      fetcher: async () => Response.json({ snapshot }),
      now: () => Date.parse("2026-09-17T15:17:00.001Z"),
    });
    await stale.refresh(context(null));
    expect(stale.getWeather(context(null))).toMatchObject({ state: "stale" });
  });

  it("keeps a missing proxy honest instead of manufacturing clear weather", async () => {
    const provider = createNwsWeatherProvider({
      fetcher: async () => new Response("Not Found", { status: 404 }),
    });
    const result = await provider.refresh(context(null));
    expect(result).toMatchObject({
      state: "unavailable",
      reason: "Weather needs the planning server.",
    });
    expect(result.data).toBeUndefined();
  });
});
