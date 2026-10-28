import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MapLayersSource, RadarFrameList } from "@/application/map-layers";
import { enableMapLayer, useMapLayers } from "@/ui/layers/useMapLayers";

/**
 * The rain radar's state in `useMapLayers` (map-experience wave 3): the frame
 * list arrives from our route, the timeline starts at "now", the current frame
 * reaches the scene as a tile template, and a list that cannot be read reads as
 * unavailable — never as an empty (dry) radar.
 */

const NOW = Date.now();
const FRAME_LIST: RadarFrameList = {
  host: "https://tilecache.rainviewer.com",
  generatedAt: new Date(NOW).toISOString(),
  frames: [
    { time: Math.floor((NOW - 20 * 60_000) / 1_000), path: "/v2/radar/older", kind: "past" },
    { time: Math.floor((NOW - 10 * 60_000) / 1_000), path: "/v2/radar/latest", kind: "past" },
    { time: Math.floor((NOW + 10 * 60_000) / 1_000), path: "/v2/radar/nowcast_ab12", kind: "nowcast" },
  ],
};

function makeSource(overrides: Partial<MapLayersSource> = {}): MapLayersSource {
  return {
    trafficTileUrl: null,
    load: vi.fn(async () => ({ features: [], unavailable: [] })),
    radarFrames: vi.fn(async () => FRAME_LIST),
    ...overrides,
  };
}

beforeEach(() => {
  enableMapLayer("weather-radar");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("rain radar in the map layers view", () => {
  it("starts on the newest past frame and hands that frame to the scene", async () => {
    const { result } = renderHook(() => useMapLayers(makeSource()));

    await waitFor(() => expect(result.current.radar?.frames).toHaveLength(3));
    expect(result.current.radar?.index).toBe(1);
    expect(result.current.radar?.playing).toBe(true);
    expect(result.current.status["weather-radar"]).toBe("ready");
    expect(result.current.scene?.radarTiles).toBe(
      "https://tilecache.rainviewer.com/v2/radar/latest/256/{z}/{x}/{y}/2/1_1.png",
    );

    act(() => result.current.radar?.togglePlay());
    expect(result.current.radar?.playing).toBe(false);

    act(() => result.current.radar?.scrub(2));
    expect(result.current.radar?.index).toBe(2);
    expect(result.current.scene?.radarTiles).toContain("/v2/radar/nowcast_ab12/");
    expect(result.current.radar?.label).toMatch(/^\+\d+ min$/);
  });

  it("does not autoplay when the rider asked for reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion: reduce"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

    const { result } = renderHook(() => useMapLayers(makeSource()));
    await waitFor(() => expect(result.current.radar?.frames).toHaveLength(3));
    expect(result.current.radar?.playing).toBe(false);
  });

  it("reads an unreadable frame list as unavailable, not as a dry map", async () => {
    const { result } = renderHook(() => useMapLayers(makeSource({ radarFrames: async () => null })));

    await waitFor(() => expect(result.current.status["weather-radar"]).toBe("unavailable"));
    expect(result.current.radar?.unavailable).toBe(true);
    expect(result.current.radar?.frames).toEqual([]);
    expect(result.current.scene?.radarTiles).toBeNull();
    expect(result.current.freshness.some((entry) => entry.layerId === "weather-radar")).toBe(false);
  });

  it("turns the timeline and the raster off with the layer", async () => {
    const { result } = renderHook(() => useMapLayers(makeSource()));
    await waitFor(() => expect(result.current.scene?.radarTiles).toContain("rainviewer.com"));

    act(() => result.current.toggle("weather-radar"));
    expect(result.current.radar).toBeNull();
    expect(result.current.scene).toBeUndefined();
    expect(result.current.status["weather-radar"]).toBe("off");
  });
});
