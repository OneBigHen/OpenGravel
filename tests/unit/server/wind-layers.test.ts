import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WindSeries } from "@/application/map-layers/wind";
import {
  WeatherProviderError,
  parseGridValidTime,
  parseIsoDurationMs,
  parseNwsWindGrid,
} from "@/infrastructure/weather/nws";
import { createWindProvider } from "@/server/map-layers/wind";
import { clearWeatherCache } from "@/server/weather/cache";
import type { LayerSnapshot, ProviderContext } from "@/server/map-layers/providers";

const AT = Date.parse("2026-10-27T14:30:00Z");
const HOUR = 60 * 60_000;

/** A view 0.3° by 0.2°: three columns and two rows of arrows. */
const BOUNDS = { west: -75.5, south: 40.1, east: -75.2, north: 40.3 };

function series(overrides: Partial<WindSeries> = {}): WindSeries {
  return {
    speedMph: [{ startMs: AT - HOUR, endMs: AT + 2 * HOUR, value: 17.7 }],
    gustMph: [{ startMs: AT - HOUR, endMs: AT + 2 * HOUR, value: 31.6 }],
    fromDegrees: [{ startMs: AT - HOUR, endMs: AT + 2 * HOUR, value: 250 }],
    ...overrides,
  };
}

function context(overrides: Partial<ProviderContext> = {}): ProviderContext {
  return { fetch: vi.fn(), now: () => AT, env: {}, ...overrides };
}

function snapshotOf(answer: LayerSnapshot) {
  return answer as LayerSnapshot & { readonly freshness?: readonly { readonly note: string }[] };
}

beforeEach(() => {
  clearWeatherCache();
});

afterEach(() => {
  clearWeatherCache();
});

describe("NWS gridpoint wind", () => {
  it("reads ISO 8601 durations and start/duration windows", () => {
    expect(parseIsoDurationMs("PT3H")).toBe(3 * HOUR);
    expect(parseIsoDurationMs("P1DT6H")).toBe(30 * HOUR);
    expect(parseIsoDurationMs("PT30M")).toBe(30 * 60_000);
    expect(parseIsoDurationMs("P")).toBeNull();
    expect(parseIsoDurationMs("3H")).toBeNull();

    const window = parseGridValidTime("2026-10-27T14:00:00+00:00/PT3H");
    expect(window).toEqual({ startMs: Date.parse("2026-10-27T14:00:00Z"), endMs: Date.parse("2026-10-27T17:00:00Z") });
    expect(parseGridValidTime("2026-10-27T14:00:00Z/2026-10-27T15:00:00Z")).not.toBeNull();
    expect(parseGridValidTime("2026-10-27T14:00:00Z/PT0H")).toBeNull();
    expect(parseGridValidTime("nonsense/PT3H")).toBeNull();
  });

  it("converts the published km/h speeds to mph and keeps the direction it comes from", () => {
    const parsed = parseNwsWindGrid({
      properties: {
        windSpeed: {
          uom: "wmoUnit:km_h-1",
          values: [
            { validTime: "2026-10-27T13:00:00+00:00/PT3H", value: 28.5 },
            { validTime: "2026-10-27T16:00:00+00:00/PT3H", value: null },
          ],
        },
        windDirection: {
          uom: "wmoUnit:degree_(angle)",
          values: [{ validTime: "2026-10-27T13:00:00+00:00/PT3H", value: 250 }],
        },
        windGust: {
          uom: "wmoUnit:km_h-1",
          values: [{ validTime: "2026-10-27T13:00:00+00:00/PT3H", value: 51 }],
        },
      },
    });

    expect(parsed.speedMph).toHaveLength(1);
    expect(parsed.speedMph[0]?.value).toBeCloseTo(17.71, 2);
    expect(parsed.gustMph[0]?.value).toBeCloseTo(31.69, 2);
    expect(parsed.fromDegrees[0]?.value).toBe(250);
  });

  it("treats a missing gust series as unpublished and rejects a payload it cannot read", () => {
    const noGust = parseNwsWindGrid({
      properties: {
        windSpeed: { uom: "wmoUnit:mph", values: [{ validTime: "2026-10-27T13:00:00+00:00/PT3H", value: 12 }] },
        windDirection: { uom: "wmoUnit:degree_(angle)", values: [{ validTime: "2026-10-27T13:00:00+00:00/PT3H", value: 90 }] },
      },
    });
    expect(noGust.gustMph).toEqual([]);
    expect(noGust.speedMph[0]?.value).toBe(12);

    expect(() => parseNwsWindGrid({ properties: { windSpeed: { uom: "wmoUnit:parsecs", values: [] } } }))
      .toThrow(WeatherProviderError);
    expect(() => parseNwsWindGrid({ properties: {} })).toThrow(WeatherProviderError);
    expect(() => parseNwsWindGrid({})).toThrow(WeatherProviderError);
  });
});

describe("the wind layer provider", () => {
  it("projects one tappable arrow per grid point, with gusts when NWS has them", async () => {
    const fetchSeries = vi.fn(async () => series());
    const provider = createWindProvider({ fetchSeries });
    const answer = await provider.snapshot?.(BOUNDS, ["wind"], context());

    expect(answer?.features).toHaveLength(6);
    expect(answer?.features[0]).toMatchObject({
      layerId: "wind",
      name: "W 18 mph",
      detail: "Gusts 32 mph",
      wind: { fromDegrees: 250 },
      geometry: { type: "Point" },
    });
    // The arrows are only as many as the coarse grid: never more than 25.
    expect(fetchSeries.mock.calls.length).toBeLessThanOrEqual(25);
    expect(snapshotOf(answer!).freshness?.[0]?.note).toContain("grid points have a forecast");
  });

  it("reads each NWS cell once and answers a repeated view from the shared weather cache", async () => {
    const fetchSeries = vi.fn(async () => series());
    const provider = createWindProvider({ fetchSeries });

    await provider.snapshot?.(BOUNDS, ["wind"], context());
    const firstReads = fetchSeries.mock.calls.length;
    expect(firstReads).toBeGreaterThan(0);

    await provider.snapshot?.(BOUNDS, ["wind"], context());
    expect(fetchSeries.mock.calls.length).toBe(firstReads);
  });

  it("leaves a cell NWS could not answer for unknown instead of drawing a calm one", async () => {
    const fetchSeries = vi.fn(async (lat: number) => {
      if (lat > 40.24) throw new Error("NWS timed out");
      return series();
    });
    const provider = createWindProvider({ fetchSeries });
    const answer = await provider.snapshot?.(BOUNDS, ["wind"], context());

    expect(answer?.features).toHaveLength(3);
    expect(answer?.features.every((feature) => (feature.geometry.type === "Point" ? feature.geometry.coordinates[1] < 40.24 : false)))
      .toBe(true);
    expect(snapshotOf(answer!).freshness?.[0]?.note).toContain("3 of 6");
  });

  it("reports unavailable when no cell in the view could be read", async () => {
    const provider = createWindProvider({ fetchSeries: async () => { throw new Error("NWS down"); } });
    await expect(provider.snapshot?.(BOUNDS, ["wind"], context())).rejects.toThrow();
  });

  it("reports unavailable when NWS has no window covering now", async () => {
    const stale: WindSeries = {
      speedMph: [{ startMs: AT - 30 * HOUR, endMs: AT - 28 * HOUR, value: 9 }],
      gustMph: [],
      fromDegrees: [{ startMs: AT - 30 * HOUR, endMs: AT - 28 * HOUR, value: 180 }],
    };
    const provider = createWindProvider({ fetchSeries: async () => stale });
    await expect(provider.snapshot?.(BOUNDS, ["wind"], context())).rejects.toThrow();
  });

  it("reads the live gridpoint resource through the shared NWS client", async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/points/")) {
        return Response.json({ properties: { gridId: "PHI", gridX: 10, gridY: 20 } });
      }
      return Response.json({
        properties: {
          windSpeed: { uom: "wmoUnit:km_h-1", values: [{ validTime: "2026-10-27T13:00:00+00:00/PT3H", value: 28.5 }] },
          windDirection: { uom: "wmoUnit:degree_(angle)", values: [{ validTime: "2026-10-27T13:00:00+00:00/PT3H", value: 250 }] },
        },
      });
    });
    const provider = createWindProvider();
    const answer = await provider.snapshot?.(BOUNDS, ["wind"], context({ fetch }));

    expect(answer?.features.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith("https://api.weather.gov/"))).toBe(true);
    expect(urls.some((url) => url.endsWith("/gridpoints/PHI/10,20"))).toBe(true);
    expect(answer?.features[0]?.name).toBe("W 18 mph");
    expect(answer?.features[0]?.detail).toBe("Gusts not published");
  });
});
