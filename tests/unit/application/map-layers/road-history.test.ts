import { describe, expect, it, vi } from "vitest";

import { createRoadHistoryMapLayersSource } from "@/application/map-layers/road-history";
import type { LibraryExploreRide } from "@/application/library/library-service";
import type { MapLayersSource } from "@/application/map-layers";

const ride = {
  summary: { rideId: "ride_recorded" },
  document: { provenance: { type: "recorded" } },
  geometry: [{ lon: -75.5, lat: 40 }, { lon: -75.49, lat: 40 }],
  riddenAt: "2026-09-17T12:00:00.000Z",
} as unknown as LibraryExploreRide;

function source(): { readonly source: MapLayersSource; readonly load: ReturnType<typeof vi.fn> } {
  const load = vi.fn(async (_bounds, layers) => ({
    features: [
      {
        id: "curvy:1",
        layerId: "great-roads" as const,
        name: "Good road",
        detail: null,
        weight: 800,
        geometry: { type: "LineString" as const, coordinates: [[-75.5, 40], [-75.49, 40]] as const },
      },
    ],
    unavailable: [],
    requestedLayers: layers,
  }));
  return {
    load,
    source: { load, trafficTileUrl: "tiles" },
  };
}

describe("road-history map-layer source", () => {
  it("requests bounded road catalogues without sending local history and returns clipped local features", async () => {
    const base = source();
    const historyReader = vi.fn().mockResolvedValue([ride]);
    const wrapped = createRoadHistoryMapLayersSource(base.source, { historyReader });

    const result = await wrapped.load(
      { west: -75.6, south: 39.9, east: -75.4, north: 40.1 },
      ["road-history"],
    );

    expect(base.load).toHaveBeenCalledWith(
      { west: -75.6, south: 39.9, east: -75.4, north: 40.1 },
      ["great-roads", "gravel"],
      undefined,
    );
    expect(historyReader).toHaveBeenCalledOnce();
    expect(result.features[0]?.layerId).toBe("road-history");
    expect(JSON.stringify(base.load.mock.calls[0])).not.toContain("-75.5");
    await wrapped.load(
      { west: -75.7, south: 39.8, east: -75.3, north: 40.2 },
      ["road-history"],
    );
    expect(historyReader).toHaveBeenCalledOnce();
  });

  it("retains the prepared local matcher across viewport pans", async () => {
    const base = source();
    const historyEntry = { ...ride };
    const historyReader = vi.fn().mockImplementation(async () => [historyEntry]);
    const wrapped = createRoadHistoryMapLayersSource(base.source, { historyReader });

    const first = await wrapped.load(
      { west: -75.6, south: 39.9, east: -75.4, north: 40.1 },
      ["road-history"],
    );
    Object.assign(historyEntry, {
      geometry: [{ lon: -75.3, lat: 40 }, { lon: -75.29, lat: 40 }],
    });
    const second = await wrapped.load(
      { west: -75.7, south: 39.8, east: -75.3, north: 40.2 },
      ["road-history"],
    );

    expect(first.features.map((feature) => feature.layerId)).toEqual(["road-history"]);
    expect(second.features.map((feature) => feature.layerId)).toEqual(["road-history"]);
    expect(historyReader).toHaveBeenCalledOnce();
  });

  it("does not ask for or expose internal catalogue features when history is not enabled", async () => {
    const base = source();
    const wrapped = createRoadHistoryMapLayersSource(base.source, { historyReader: vi.fn().mockResolvedValue([ride]) });
    const result = await wrapped.load(
      { west: -75.6, south: 39.9, east: -75.4, north: 40.1 },
      ["food"],
    );

    expect(base.load).toHaveBeenCalledWith(
      { west: -75.6, south: 39.9, east: -75.4, north: 40.1 },
      ["food"],
      undefined,
    );
    expect(result.features).toEqual([]);
  });

  it("marks local history unavailable while retaining healthy provider features", async () => {
    const base = source();
    const wrapped = createRoadHistoryMapLayersSource(base.source, { historyReader: vi.fn().mockRejectedValue(new Error("storage")) });
    const result = await wrapped.load(
      { west: -75.6, south: 39.9, east: -75.4, north: 40.1 },
      ["road-history", "great-roads"],
    );

    expect(result.features.map((feature) => feature.layerId)).toEqual(["great-roads"]);
    expect(result.unavailable).toContain("road-history");
    expect(result.unavailable).not.toContain("roads");
  });

  it("propagates cancellation without hiding the healthy catalogue peer", async () => {
    const base = source();
    const wrapped = createRoadHistoryMapLayersSource(base.source, { historyReader: vi.fn().mockResolvedValue([ride]) });
    const controller = new AbortController();
    controller.abort();

    await expect(wrapped.load(
      { west: -75.6, south: 39.9, east: -75.4, north: 40.1 },
      ["road-history", "great-roads"],
      controller.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(base.load).toHaveBeenCalledWith(
      { west: -75.6, south: 39.9, east: -75.4, north: 40.1 },
      ["great-roads", "gravel"],
      controller.signal,
    );
  });
});
