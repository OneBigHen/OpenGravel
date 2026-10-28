import { afterEach, describe, expect, it } from "vitest";

import type { WeatherForecastPeriod } from "@/application/preparation/providers";
import { clearWeatherCache } from "@/server/weather/cache";
import { createCachedHourlyForecastSource } from "@/server/weather/forecast-source";
import {
  handleRouteWeatherRequest,
  MAX_ROUTE_WEATHER_BODY_BYTES,
  MAX_ROUTE_WEATHER_LINE_POINTS,
  MAX_ROUTE_WEATHER_SAMPLES,
} from "@/server/weather/route-weather";

/**
 * A recorded hour-by-hour forecast around the departure: dry at first, rain
 * from 2 PM. Values are the fixture-shaped NWS periods the client parses.
 */
const FORECAST: readonly WeatherForecastPeriod[] = [
  { name: "12 PM", startTime: "2026-10-27T12:00:00.000Z", endTime: "2026-10-27T13:00:00.000Z", temperatureF: 59, windMph: 6, precipChance: 10, shortForecast: "Sunny" },
  { name: "1 PM", startTime: "2026-10-27T13:00:00.000Z", endTime: "2026-10-27T14:00:00.000Z", temperatureF: 61, windMph: 8, precipChance: 10, shortForecast: "Mostly Sunny" },
  { name: "2 PM", startTime: "2026-10-27T14:00:00.000Z", endTime: "2026-10-27T15:00:00.000Z", temperatureF: 64, windMph: 12, precipChance: 80, shortForecast: "Rain" },
  { name: "3 PM", startTime: "2026-10-27T15:00:00.000Z", endTime: "2026-10-27T16:00:00.000Z", temperatureF: 62, windMph: 14, precipChance: 70, shortForecast: "Showers" },
];

const DEPARTURE = "2026-10-27T13:30:00.000Z";

/** A ten-mile route at 40.2°N; each point is 0.04° of longitude apart. */
function line(spanDegrees = 0.2): readonly { lon: number; lat: number }[] {
  return Array.from({ length: 6 }, (_, index) => ({
    lon: -75.5 + (spanDegrees * index) / 5,
    lat: 40.2,
  }));
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    line: line(),
    departureTime: DEPARTURE,
    durationSeconds: 3600,
    timeZone: "UTC",
    ...overrides,
  };
}

function post(payload: unknown): Request {
  return new Request("http://local/api/weather/route", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

interface FakeSource {
  readonly forecast: (
    lat: number,
    lon: number,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<readonly WeatherForecastPeriod[]>;
  readonly calls: readonly { readonly lat: number; readonly lon: number }[];
}

function fakeSource(
  answer: (cell: { readonly lat: number; readonly lon: number }) => readonly WeatherForecastPeriod[] = () => FORECAST,
): FakeSource {
  const calls: { lat: number; lon: number }[] = [];
  return {
    calls,
    forecast: async (lat, lon) => {
      calls.push({ lat, lon });
      return answer({ lat, lon });
    },
  };
}

interface ParsedReport {
  readonly source: string;
  readonly headline: string;
  readonly forecastAvailable: boolean;
  readonly samples: readonly Record<string, unknown>[];
}

/** The report out of a response, typed loosely enough to probe one field. */
async function reportOf(response: Response): Promise<ParsedReport> {
  const parsed = await response.json() as { report: ParsedReport };
  return parsed.report;
}

afterEach(() => clearWeatherCache());

describe("handleRouteWeatherRequest", () => {
  it("answers one reading per sample, each at its own ETA", async () => {
    const fake = fakeSource();
    const response = await handleRouteWeatherRequest(post(body()), { source: fake });

    expect(response.status).toBe(200);
    const report = await reportOf(response);
    const samples = report.samples;
    expect(samples).toHaveLength(6);
    expect(samples.map((sample) => sample["eta"])).toEqual([
      "2026-10-27T13:30:00.000Z",
      "2026-10-27T13:42:00.000Z",
      "2026-10-27T13:54:00.000Z",
      "2026-10-27T14:06:00.000Z",
      "2026-10-27T14:18:00.000Z",
      "2026-10-27T14:30:00.000Z",
    ]);
    // The first two samples are still in the dry 1 PM hour; the rest are in rain.
    expect(samples[0]).toMatchObject({ tempF: 61, rainChancePct: 10, windMph: 8, shortForecast: "Mostly Sunny" });
    expect(samples[5]).toMatchObject({ tempF: 64, rainChancePct: 80, windMph: 12, shortForecast: "Rain" });
    expect(typeof samples[0]?.["mile"]).toBe("number");
    expect(report.headline).toBe("Rain from mile 6 around 2 PM");
    expect(report.forecastAvailable).toBe(true);
    expect(report.source).toBe("nws");
  });

  it("asks the provider once per forecast cell rather than once per sample", async () => {
    const wide = fakeSource();
    await handleRouteWeatherRequest(post(body()), { source: wide });
    expect(wide.calls.length).toBeGreaterThan(1);
    expect(wide.calls.length).toBeLessThan(6);

    const narrow = fakeSource();
    await handleRouteWeatherRequest(post(body({ line: line(0.005) })), { source: narrow });
    expect(narrow.calls).toHaveLength(1);
  });

  it("keeps a sample whose cell failed unknown, never dry", async () => {
    const fake = fakeSource((cell) => {
      if (cell.lon <= -75.5) throw new Error("NWS is down");
      return FORECAST;
    });
    const response = await handleRouteWeatherRequest(post(body()), { source: fake });

    expect(response.status).toBe(200);
    const report = await reportOf(response);
    expect(report.samples[0]).toMatchObject({
      tempF: null,
      rainChancePct: null,
      windMph: null,
      shortForecast: null,
    });
    expect(report.samples[0]?.["eta"]).toBe("2026-10-27T13:30:00.000Z");
    expect(report.samples[5]?.["rainChancePct"]).toBe(80);
    expect(report.forecastAvailable).toBe(true);
    expect(report.headline).toBe("Rain from mile 6 around 2 PM");
  });

  it("does not call a partly unknown route dry", async () => {
    const dry = FORECAST.map((period) => ({ ...period, precipChance: 5 }));
    const fake = fakeSource((cell) => {
      if (cell.lon <= -75.5) throw new Error("NWS is down");
      return dry;
    });
    const report = await reportOf(await handleRouteWeatherRequest(post(body()), { source: fake }));

    expect(report.samples[0]?.["rainChancePct"]).toBeNull();
    expect(report.samples[5]?.["rainChancePct"]).toBe(5);
    expect(report.headline).toBe("Mostly dry, but part of the route has no forecast");
  });

  it("answers unavailable weather when no cell answered, keeping the ETAs", async () => {
    const fake = fakeSource(() => {
      throw new Error("NWS is down");
    });
    const report = await reportOf(await handleRouteWeatherRequest(post(body()), { source: fake }));

    expect(report.forecastAvailable).toBe(false);
    expect(report.headline).toBe("Forecast along the route is unavailable");
    expect(report.samples).toHaveLength(6);
    expect(report.samples[0]?.["eta"]).toBe("2026-10-27T13:30:00.000Z");
    expect(report.samples.every((sample) => sample["rainChancePct"] === null)).toBe(true);
  });

  it("keeps an ETA the forecast does not reach unknown", async () => {
    const fake = fakeSource();
    const report = await reportOf(await handleRouteWeatherRequest(
      post(body({ departureTime: "2027-10-27T13:30:00.000Z" })),
      { source: fake },
    ));

    expect(report.forecastAvailable).toBe(false);
    expect(report.samples[0]?.["eta"]).toBe("2027-10-27T13:30:00.000Z");
    expect(report.samples[0]?.["tempF"]).toBeNull();
  });

  it("accepts [lon, lat] pairs as well as objects", async () => {
    const fake = fakeSource();
    const pairs = line().map((point) => [point.lon, point.lat]);
    const response = await handleRouteWeatherRequest(post(body({ line: pairs })), { source: fake });
    const report = await reportOf(response);
    expect(response.status).toBe(200);
    expect(report.samples).toHaveLength(6);
    expect(report.samples[0]?.["coordinate"]).toEqual({ lon: -75.5, lat: 40.2 });
  });

  it("says no clock time when the rider's time zone was not sent", async () => {
    const fake = fakeSource();
    const payload = body();
    delete payload["timeZone"];
    const report = await reportOf(await handleRouteWeatherRequest(post(payload), { source: fake }));
    expect(report.headline).toBe("Rain from mile 6");
  });

  it("honours a requested sample count within its cap", async () => {
    const fake = fakeSource();
    const report = await reportOf(await handleRouteWeatherRequest(
      post(body({ samples: 3 })),
      { source: fake },
    ));
    expect(report.samples).toHaveLength(3);
  });

  it.each([
    ["a one-point line", { line: [{ lon: -75.5, lat: 40.2 }] }],
    ["an over-long line", { line: Array.from({ length: MAX_ROUTE_WEATHER_LINE_POINTS + 1 }, () => ({ lon: -75.5, lat: 40.2 })) }],
    ["a malformed coordinate", { line: [{ lon: -75.5, lat: 40.2 }, { lon: "west", lat: 40.2 }] }],
    ["an out-of-range coordinate", { line: [{ lon: -75.5, lat: 40.2 }, { lon: -175.5, lat: 91 }] }],
    ["a missing departure", { departureTime: undefined }],
    ["an unreadable departure", { departureTime: "this afternoon" }],
    ["a missing duration", { durationSeconds: undefined }],
    ["a negative duration", { durationSeconds: -60 }],
    ["an unknown time zone", { timeZone: "Not/AZone" }],
    ["too few samples", { samples: 1 }],
    ["too many samples", { samples: MAX_ROUTE_WEATHER_SAMPLES + 1 }],
  ])("rejects %s before any provider call", async (_label, overrides) => {
    const fake = fakeSource();
    const response = await handleRouteWeatherRequest(post(body(overrides)), { source: fake });
    expect(response.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
    const parsed = await response.json() as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe("validation");
  });

  it("rejects a body that is not JSON", async () => {
    const response = await handleRouteWeatherRequest(post("{not json"), { source: fakeSource() });
    expect(response.status).toBe(400);
  });

  it("rejects an oversized body without reading it into the sampler", async () => {
    const fake = fakeSource();
    const response = await handleRouteWeatherRequest(
      post(body({ note: "x".repeat(MAX_ROUTE_WEATHER_BODY_BYTES) })),
      { source: fake },
    );
    expect(response.status).toBe(413);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("the cached hourly forecast source", () => {
  it("serves one cell from memory for the forecast TTL, then asks again", async () => {
    let now = 1_000_000;
    let calls = 0;
    const source = createCachedHourlyForecastSource({
      fetchForecast: async () => {
        calls += 1;
        return FORECAST;
      },
      now: () => now,
    });

    expect(await source.forecast(40.123, -75.443)).toBe(FORECAST);
    // A point in the same rounded cell is the same forecast.
    expect(await source.forecast(40.124, -75.441)).toBe(FORECAST);
    expect(calls).toBe(1);

    now += 30 * 60 * 1000 + 1;
    await source.forecast(40.123, -75.443);
    expect(calls).toBe(2);
  });

  it("does not cache a provider failure", async () => {
    let calls = 0;
    const source = createCachedHourlyForecastSource({
      fetchForecast: async () => {
        calls += 1;
        if (calls === 1) throw new Error("NWS is down");
        return FORECAST;
      },
      now: () => 0,
    });

    await expect(source.forecast(40.12, -75.44)).rejects.toThrow("NWS is down");
    expect(await source.forecast(40.123, -75.443)).toBe(FORECAST);
    expect(calls).toBe(2);
  });
});
