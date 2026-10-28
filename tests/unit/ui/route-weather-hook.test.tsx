import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RouteWeatherReport } from "@/application/weather/route-weather";
import { useRouteWeather, type RouteWeatherSubject } from "@/ui/weather/useRouteWeather";
import type { Coordinate } from "@/domain/ride/types";

const LINE: readonly Coordinate[] = [
  { lon: -75.5, lat: 40.2 },
  { lon: -75.46, lat: 40.2 },
  { lon: -75.42, lat: 40.2 },
  { lon: -75.3, lat: 40.2 },
];

const REPORT: RouteWeatherReport = {
  source: "nws",
  samples: [
    {
      coordinate: { lon: -75.5, lat: 40.2 },
      alongMeters: 0,
      mile: 0,
      elapsedSeconds: 0,
      eta: "2026-10-27T13:30:00.000Z",
      tempF: 61,
      rainChancePct: 10,
      windMph: 8,
      shortForecast: "Mostly Sunny",
    },
    {
      coordinate: { lon: -75.3, lat: 40.2 },
      alongMeters: 16_900,
      mile: 10.5,
      elapsedSeconds: 3600,
      eta: "2026-10-27T14:30:00.000Z",
      tempF: 64,
      rainChancePct: 80,
      windMph: 12,
      shortForecast: "Rain",
    },
  ],
  headline: "Rain from mile 6 around 2 PM",
  forecastAvailable: true,
};

function subject(overrides: Partial<RouteWeatherSubject> = {}): RouteWeatherSubject {
  return {
    line: LINE,
    departureTime: "2026-10-27T13:30:00.000Z",
    durationSeconds: 3600,
    ...overrides,
  };
}

function stubFetch(handler: (url: string, init: RequestInit | undefined) => Promise<Response> | Response) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRouteWeather", () => {
  it("posts the route line, the departure and the route's duration", async () => {
    const fetchMock = stubFetch(() => Response.json({ report: REPORT }));
    const { result } = renderHook(() => useRouteWeather(subject()));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toEqual({ status: "ready", report: REPORT });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/weather/route");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["line"]).toEqual(LINE.map((point) => ({ lon: point.lon, lat: point.lat })));
    expect(body["departureTime"]).toBe("2026-10-27T13:30:00.000Z");
    expect(body["durationSeconds"]).toBe(3600);
    expect(typeof body["timeZone"]).toBe("string");
  });

  it("stays idle until the rider has a departure and a duration", async () => {
    const fetchMock = stubFetch(() => Response.json({ report: REPORT }));
    const noDeparture = renderHook(() => useRouteWeather(subject({ departureTime: null })));
    const noDuration = renderHook(() => useRouteWeather(subject({ durationSeconds: null })));
    const noRoute = renderHook(() => useRouteWeather(null));

    expect(noDeparture.result.current).toEqual({ status: "idle" });
    expect(noDuration.result.current).toEqual({ status: "idle" });
    expect(noRoute.result.current).toEqual({ status: "idle" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers unavailable rather than an invented sky when the API is down", async () => {
    stubFetch(() => new Response("busy", { status: 503 }));
    const { result } = renderHook(() => useRouteWeather(subject({ departureTime: "2026-10-27T15:00:00.000Z" })));

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current).toMatchObject({ status: "unavailable" });
  });

  it("rejects a body that is not a report", async () => {
    stubFetch(() => Response.json({ report: { source: "nws", samples: "none", headline: "Dry the whole way" } }));
    const { result } = renderHook(() => useRouteWeather(subject({ departureTime: "2026-10-27T16:00:00.000Z" })));

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
  });

  it("shares one request between two surfaces showing the same route", async () => {
    const fetchMock = stubFetch(() => Response.json({ report: REPORT }));
    const departureTime = "2026-10-27T17:00:00.000Z";
    const first = renderHook(() => useRouteWeather(subject({ departureTime })));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    const second = renderHook(() => useRouteWeather(subject({ departureTime })));

    expect(second.result.current.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
