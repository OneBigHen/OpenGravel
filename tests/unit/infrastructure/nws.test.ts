import points from "../../fixtures/weather/points.json";
import gridpoints from "../../fixtures/weather/gridpoints.json";
import gridpointsCelsius from "../../fixtures/weather/gridpoints-celsius.json";
import alerts from "../../fixtures/weather/alerts.json";
import alertsUnknownWindow from "../../fixtures/weather/alerts-unknown-window.json";
import malformedGridpoints from "../../fixtures/weather/malformed-gridpoints.json";
import { describe, expect, it, vi } from "vitest";

import {
  WeatherProviderError,
  fetchSnapshot,
} from "@/infrastructure/weather/nws";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/geo+json" },
  });
}

function fetcherFor(
  grid: unknown = gridpoints,
  alert: unknown = alerts,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(new Headers(init?.headers).get("user-agent")).toBe(
      "OpenGravel/0.1 (https://github.com/OneBigHen/OpenGravel)",
    );
    if (url.includes("/points/")) return response(points);
    if (url.includes("/gridpoints/")) return response(grid);
    if (url.includes("/alerts/active")) return response(alert);
    return response({}, 404);
  });
}

describe("NWS weather adapter", () => {
  it("asks for the hourly forecast, whose unnamed periods are named by their start (M4)", async () => {
    const urls: string[] = [];
    const base = fetcherFor({
      properties: {
        periods: (gridpoints as { properties: { periods: Record<string, unknown>[] } }).properties.periods.map(
          (period) => ({ ...period, name: "" }),
        ),
      },
    });
    const snapshot = await fetchSnapshot(40.14, -75.44, {
      fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(String(input));
        return base(input, init);
      }) as typeof fetch,
      sleep: async () => undefined,
      random: () => 0,
    });
    expect(urls.some((url) => /\/gridpoints\/[^/]+\/\d+,\d+\/forecast\/hourly$/.test(url))).toBe(true);
    expect(snapshot.forecast[0]?.name).toBe(snapshot.forecast[0]?.startTime);
  });

  it("maps recorded points, forecast periods, and active alerts", async () => {
    const snapshot = await fetchSnapshot(40.14, -75.44, {
      fetcher: fetcherFor(),
      sleep: async () => undefined,
      random: () => 0,
    });

    expect(snapshot.source).toBe("nws");
    expect(snapshot.fetchedAt).toEqual(expect.any(String));
    expect(snapshot.alerts).toEqual([
      {
        event: "Severe Thunderstorm Watch",
        severity: "Severe",
        onset: "2026-09-17T17:00:00+00:00",
        ends: "2026-09-17T20:00:00+00:00",
        area: "Lehigh Valley",
      },
    ]);
    expect(snapshot.forecast[0]).toEqual({
      name: "This Afternoon",
      startTime: "2026-09-17T16:00:00+00:00",
      endTime: "2026-09-17T18:00:00+00:00",
      temperatureF: 72,
      windMph: 10,
      precipChance: 10,
      shortForecast: "Sunny",
    });
  });

  it("converts a metric recorded period into the contract units", async () => {
    const snapshot = await fetchSnapshot(40.14, -75.44, {
      fetcher: fetcherFor(gridpointsCelsius, { type: "FeatureCollection", features: [] }),
      sleep: async () => undefined,
      random: () => 0,
    });

    expect(snapshot.forecast[0]).toMatchObject({
      temperatureF: 68,
      windMph: 9.94,
      precipChance: 25,
    });
  });

  it("keeps alert timing explicitly unknown when the recorded fields are null", async () => {
    const snapshot = await fetchSnapshot(40.14, -75.44, {
      fetcher: fetcherFor(gridpoints, alertsUnknownWindow),
      sleep: async () => undefined,
      random: () => 0,
    });

    expect(snapshot.alerts[0]).toMatchObject({
      event: "Flood Advisory",
      onset: null,
      ends: null,
    });
  });

  it("retries transient failures twice with bounded injected backoff", async () => {
    let attempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      attempts += 1;
      if (attempts <= 2) throw new TypeError("temporary network failure");
      return fetcherFor()(input, init);
    });

    const snapshot = await fetchSnapshot(40.14, -75.44, {
      fetcher,
      sleep: async () => undefined,
      random: () => 0,
    });

    expect(snapshot.forecast[0]?.shortForecast).toBe("Sunny");
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("rejects malformed upstream data as a typed error instead of returning a partial snapshot", async () => {
    await expect(fetchSnapshot(40.14, -75.44, {
      fetcher: fetcherFor(malformedGridpoints),
      sleep: async () => undefined,
      random: () => 0,
    })).rejects.toMatchObject({ code: "malformed", retryable: false });
    await expect(fetchSnapshot(40.14, -75.44, {
      fetcher: fetcherFor(malformedGridpoints),
      sleep: async () => undefined,
      random: () => 0,
    })).rejects.toBeInstanceOf(WeatherProviderError);
  });

  it("rejects coordinates outside geographic bounds before network work", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(fetchSnapshot(91, -75.44, { fetcher })).rejects.toMatchObject({
      code: "invalid-coordinate",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("enforces the timeout even when an injected transport ignores AbortSignal", async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    const pending = fetchSnapshot(40.14, -75.44, {
      fetcher,
      timeoutMs: 10,
      maxRetries: 0,
    });
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout", retryable: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assertion;
  });

  it.skipIf(process.env.OGV_LIVE !== "1")("shape-checks the real NWS API only when explicitly enabled", async () => {
    const snapshot = await fetchSnapshot(39.7456, -97.0892);
    expect(snapshot.source).toBe("nws");
    expect(snapshot.alerts).toEqual(expect.any(Array));
    expect(snapshot.forecast).toEqual(expect.any(Array));
  });
});
