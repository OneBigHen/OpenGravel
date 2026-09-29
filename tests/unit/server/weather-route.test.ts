import { afterEach, describe, expect, it } from "vitest";

import {
  clearWeatherCache,
  handleWeatherRequest,
  type WeatherRouteDependencies,
} from "@/app/api/weather/route";
import type { WeatherSnapshot } from "@/application/preparation/providers";

const snapshot: WeatherSnapshot = {
  fetchedAt: "2026-09-17T14:32:00.000Z",
  source: "nws",
  alerts: [],
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

function request(lat = "40.14", lon = "-75.44"): Request {
  return new Request(`http://localhost/api/weather?lat=${lat}&lon=${lon}`);
}

function dependencies(
  fetchSnapshot: WeatherRouteDependencies["fetchSnapshot"],
  now: () => number,
): WeatherRouteDependencies {
  return { fetchSnapshot, now };
}

afterEach(() => clearWeatherCache());

describe("weather proxy route", () => {
  it("returns a bounded snapshot and reuses a rounded coordinate cache key", async () => {
    let calls = 0;
    const response = await handleWeatherRequest(
      request("40.123", "-75.443"),
      dependencies(async () => { calls += 1; return snapshot; }, () => 0),
    );
    const second = await handleWeatherRequest(
      request("40.124", "-75.441"),
      dependencies(async () => { calls += 1; return snapshot; }, () => 1),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ snapshot });
    expect(second.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("expires successful entries at the alert freshness boundary", async () => {
    let now = 1_000_000;
    let calls = 0;
    const deps = dependencies(async () => { calls += 1; return snapshot; }, () => now);

    await handleWeatherRequest(request(), deps);
    now += 5 * 60 * 1000 - 1;
    await handleWeatherRequest(request(), deps);
    now += 2;
    await handleWeatherRequest(request(), deps);

    expect(calls).toBe(2);
  });

  it.each([
    ["91", "-75.44", "Latitude must be between -90 and 90."],
    ["40.14", "181", "Longitude must be between -180 and 180."],
    ["north", "-75.44", "Latitude must be a finite number."],
  ])("rejects bounded invalid coordinates (%s, %s)", async (lat, lon, reason) => {
    const response = await handleWeatherRequest(request(lat, lon), {
      fetchSnapshot: async () => snapshot,
      now: () => 0,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ unavailable: true, reason, retryable: false });
  });

  it("returns an honest retryable 503 when the upstream is unavailable", async () => {
    const response = await handleWeatherRequest(request(), {
      fetchSnapshot: async () => {
        throw new Error("upstream details must not escape");
      },
      now: () => 0,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      unavailable: true,
      reason: "Weather is unavailable right now.",
      retryable: true,
    });
  });

  it("returns the planning-server reason for a static deployment route absence", async () => {
    const response = await handleWeatherRequest(request(), {
      fetchSnapshot: async () => {
        const error = new Error("route missing") as Error & { code?: string };
        error.code = "route-unavailable";
        throw error;
      },
      now: () => 0,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ unavailable: true, retryable: true });
  });
});
