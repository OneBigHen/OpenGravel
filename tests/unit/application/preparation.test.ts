import { describe, expect, it } from "vitest";

import {
  daylightIsRelevant,
  fuelIsRelevant,
  lodgingIsRelevant,
  serviceIsRelevant,
  trafficIsRelevant,
  weatherIsRelevant,
} from "@/application/preparation/relevance";
import {
  prepareRoute,
  type RoutePreparationContext,
} from "@/application/preparation/prepare-route";
import {
  nullOfflineRouteProvider,
  nullWeatherProvider,
  probeCapabilities,
  type ProviderCapability,
  type TrafficProvider,
  type WeatherProvider,
} from "@/application/preparation/providers";

const departure = "2026-09-17T08:00:00.000Z";
const baseContext: RoutePreparationContext = {
  distanceKm: 120,
  rideDurationMinutes: 120,
  departure,
  tripWindow: { start: departure, end: "2026-09-17T10:00:00.000Z" },
  congestedWindows: [],
  routeTouchesMappedCorridor: false,
  fuelRangeKm: 200,
  sunset: "2026-09-17T19:00:00.000Z",
  remainingDaylightMinutes: 180,
  multiDay: false,
  providers: {},
};

function capability(
  kind: ProviderCapability["kind"],
  availability: ProviderCapability["availability"] = "available",
): ProviderCapability {
  return {
    kind,
    availability,
    freshness: "time-bound",
    reason: availability === "available" ? null : "Provider is degraded.",
    provenance: "Test capability declaration",
  };
}

const readyWeatherProvider: WeatherProvider = {
  id: "test-weather",
  kind: "weather",
  capabilities: () => capability("weather"),
  getWeather: () => ({
    state: "ready",
    reason: "Forecast received for the trip window.",
    provenance: "Test weather provider",
    data: { display: "Dry · 18°C" },
  }),
};

const staleTrafficProvider: TrafficProvider = {
  id: "test-traffic",
  kind: "traffic",
  capabilities: () => capability("traffic", "degraded"),
  getTraffic: () => ({
    state: "stale",
    reason: "Traffic data is older than its freshness window.",
    provenance: "Test traffic cache",
    data: { display: "Slowdown reported" },
  }),
};

describe("preparation relevance rules", () => {
  it.each([
    ["weather needs a trip window", "weather", { tripWindow: undefined }, false],
    ["weather is shown with a trip window", "weather", { tripWindow: baseContext.tripWindow }, true],
    ["traffic includes the start boundary", "traffic", { departure, congestedWindows: [{ start: departure, end: "2026-09-17T09:00:00.000Z" }] }, true],
    ["traffic includes the end boundary", "traffic", { departure: "2026-09-17T09:00:00.000Z", congestedWindows: [{ start: departure, end: "2026-09-17T09:00:00.000Z" }] }, true],
    ["traffic is shown for a mapped corridor", "traffic", { routeTouchesMappedCorridor: true }, true],
    ["traffic is hidden outside both conditions", "traffic", { departure, congestedWindows: [], routeTouchesMappedCorridor: false }, false],
    ["fuel starts above 120 km", "fuel", { distanceKm: 120 }, false],
    ["fuel is shown at 120.1 km", "fuel", { distanceKm: 120.1 }, true],
    ["fuel is shown for a short usable range", "fuel", { distanceKm: 46, fuelRangeKm: 80 }, true],
    ["fuel is shown when range is unknown", "fuel", { distanceKm: 20, fuelRangeKm: null }, true],
    ["daylight needs sunset and duration", "daylight", { sunset: undefined }, false],
    ["daylight is shown when sunset is known", "daylight", { sunset: baseContext.sunset }, true],
    ["lodging is hidden at 150 km", "lodging", { distanceKm: 150, multiDay: false }, false],
    ["lodging is shown above 150 km", "lodging", { distanceKm: 150.1, multiDay: false }, true],
    ["lodging is shown for a multi-day ride", "lodging", { distanceKm: 20, multiDay: true }, true],
    ["service follows the long-trip rule", "service", { distanceKm: 150.1, multiDay: false }, true],
  ] as const)("%s", (_name, rule, patch, expected) => {
    const context = { ...baseContext, ...patch };
    const result = {
      weather: weatherIsRelevant(context),
      traffic: trafficIsRelevant(context),
      fuel: fuelIsRelevant(context),
      daylight: daylightIsRelevant(context),
      lodging: lodgingIsRelevant(context),
      service: serviceIsRelevant(context),
    }[rule];
    expect(result).toBe(expected);
  });
});

describe("prepareRoute", () => {
  it("orders relevant checks and preserves ready, stale, and unavailable states", () => {
    const preparation = prepareRoute({
      ...baseContext,
      distanceKm: 151,
      congestedWindows: [{ start: departure, end: "2026-09-17T09:00:00.000Z" }],
      providers: {
        weather: readyWeatherProvider,
        traffic: staleTrafficProvider,
        offlineRoute: nullOfflineRouteProvider,
      },
    });

    expect(preparation.items.map((item) => item.kind)).toEqual([
      "weather",
      "traffic",
      "fuel",
      "daylight",
      "offline-route",
    ]);
    expect(preparation.items[0]).toMatchObject({ kind: "weather", state: "ready", relevance: "conditional" });
    expect(preparation.items[1]).toMatchObject({ kind: "traffic", state: "stale", relevance: "conditional" });
    expect(preparation.items.find((item) => item.kind === "lodging")).toBeUndefined();
  });

  it("never turns an absent provider into a ready or all-clear item", () => {
    const preparation = prepareRoute({
      ...baseContext,
      providers: {},
    });

    const optionalItems = preparation.items.filter((item) =>
      ["weather", "traffic", "offline-route"].includes(item.kind),
    );
    expect(optionalItems.length).toBeGreaterThan(0);
    expect(optionalItems.every((item) => item.state !== "ready")).toBe(true);
    expect(optionalItems.every((item) => item.reason.length > 0)).toBe(true);
    expect(optionalItems.some((item) => item.reason.toLowerCase().includes("not available"))).toBe(true);
  });

  it("exposes all declared capability slots while preserving provider absence", () => {
    const none = probeCapabilities([]);
    const one = probeCapabilities([readyWeatherProvider]);
    const two = probeCapabilities([readyWeatherProvider, staleTrafficProvider]);

    expect(none.map((entry) => entry.kind)).toEqual(["offline-route", "weather", "traffic", "elevation"]);
    expect(none.every((entry) => entry.availability === "unavailable")).toBe(true);
    expect(one.find((entry) => entry.kind === "weather")).toMatchObject({ availability: "available", freshness: "time-bound" });
    expect(one.find((entry) => entry.kind === "traffic")).toMatchObject({ availability: "unavailable" });
    expect(two.find((entry) => entry.kind === "traffic")).toMatchObject({ availability: "degraded" });
  });

  it("uses the null weather provider as an honest unavailable result", () => {
    const preparation = prepareRoute({
      ...baseContext,
      providers: { weather: nullWeatherProvider },
    });

    expect(preparation.items.find((item) => item.kind === "weather")).toMatchObject({
      state: "unavailable",
    });
    expect(preparation.items.find((item) => item.kind === "weather")).not.toHaveProperty("data");
  });
});
