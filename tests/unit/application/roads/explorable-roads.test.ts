import { describe, expect, it, vi } from "vitest";

import {
  createRoadProgressReader,
  observedRoadOverlayFeatures,
  prepareRoadHistory,
  projectRoadProgress,
} from "@/application/roads/explorable-roads";
import type { LibraryExploreRide } from "@/application/library/library-service";
import type { InfoFeature } from "@/application/map-layers";
import type { MapLayersSource } from "@/application/map-layers";
import type { Coordinate } from "@/domain/ride/types";

const A: Coordinate = { lon: -75.5, lat: 40 };
const B: Coordinate = { lon: -75.49, lat: 40 };
const C: Coordinate = { lon: -75.48, lat: 40 };
const D: Coordinate = { lon: -75.47, lat: 40 };

function ride(
  rideId: string,
  geometry: readonly Coordinate[],
  riddenAt = "2026-09-17T12:00:00.000Z",
  provenance: "recorded" | "import" | "new" = "recorded",
): LibraryExploreRide {
  return {
    summary: { rideId, title: rideId } as LibraryExploreRide["summary"],
    document: { provenance: { type: provenance } } as LibraryExploreRide["document"],
    geometry,
    ...(provenance === "recorded" ? { riddenAt } : {}),
  };
}

function feature(
  id: string,
  layerId: "great-roads" | "gravel",
  line: readonly Coordinate[],
  weight: number | null = layerId === "great-roads" ? 800 : null,
): InfoFeature {
  return {
    id,
    layerId,
    name: id,
    detail: null,
    weight,
    geometry: { type: "LineString", coordinates: line.map((point) => [point.lon, point.lat] as const) },
  };
}

describe("road progress projection", () => {
  it("measures each observed edge once across overlapping qualified catalogues", () => {
    const current = ride("ride_current", [A, B, C]);
    const result = projectRoadProgress({
      ride: current,
      history: [current],
      features: [feature("curvy:1", "great-roads", [A, B, C]), feature("gravel:1", "gravel", [A, B, C])],
    });

    expect(result.coverage).toBe("partial");
    expect(result.qualifiedMeters).toBeGreaterThan(1_000);
    expect(result.qualifiedMeters).toBeLessThan(2_500);
    expect(result.newToYouMeters).toBeNull();
  });

  it("keeps prior observed roads familiar and only counts later qualified edges as new", () => {
    const prior = ride("ride_prior", [A, B], "2026-09-16T12:00:00.000Z");
    const current = ride("ride_current", [A, B, C]);
    const result = projectRoadProgress({
      ride: current,
      history: [prior, current],
      features: [feature("curvy:1", "great-roads", [A, B, C])],
    });

    expect(result.newToYouMeters).not.toBeNull();
    expect(result.newToYouMeters!).toBeGreaterThan(500);
    expect(result.newToYouMeters!).toBeLessThan(result.qualifiedMeters);
  });

  it("does not use a later observed recording to explain post-ride newness", () => {
    const current = ride("ride_current", [A, B], "2026-09-17T12:00:00.000Z");
    const earlier = ride("ride_earlier", [C, D], "2026-09-16T12:00:00.000Z");
    const later = ride("ride_later", [A, B], "2026-09-18T12:00:00.000Z");
    const result = projectRoadProgress({
      ride: current,
      history: [earlier, current, later],
      features: [feature("curvy:1", "great-roads", [A, B])],
    });

    expect(result.newToYouMeters).toBeGreaterThan(0);
    expect(result.newToYouMeters).toBe(result.qualifiedMeters);
  });

  it("keeps newness unknown when the selected recording has no valid observed time", () => {
    const current = { ...ride("ride_current", [A, B]), riddenAt: "not-a-date" };
    const earlier = ride("ride_earlier", [C, D], "2026-09-16T12:00:00.000Z");
    const later = ride("ride_later", [A, B], "2026-09-18T12:00:00.000Z");
    const result = projectRoadProgress({
      ride: current,
      history: [earlier, current, later],
      features: [feature("curvy:1", "great-roads", [A, B])],
    });

    expect(result.newToYouMeters).toBeNull();
  });

  it("clips matched features to the selected recording, not unrelated history", () => {
    const prior = ride("ride_prior", [C, D], "2026-09-16T12:00:00.000Z");
    const current = ride("ride_current", [A, B]);
    const later = ride("ride_later", [C, D], "2026-09-18T12:00:00.000Z");
    const result = projectRoadProgress({
      ride: current,
      history: [prior, current, later],
      features: [
        feature("curvy:current", "great-roads", [A, B]),
        feature("curvy:other", "great-roads", [C, D]),
      ],
    });

    expect(result.matchedFeatures.map((matched) => matched.id)).toEqual(["road-history:curvy:current:0"]);
  });

  it("does not treat imports, low-rated roads, or missing catalogues as qualified history", () => {
    const current = ride("ride_current", [A, B]);
    const imported = ride("imported", [A, B], "2026-09-16T12:00:00.000Z", "import");
    const result = projectRoadProgress({
      ride: current,
      history: [imported, current],
      features: [feature("curvy:low", "great-roads", [A, B], 599)],
    });
    const unknown = projectRoadProgress({ ride: current, history: [current], features: [] });

    expect(result.coverage).toBe("unknown");
    expect(result.newToYouMeters).toBeNull();
    expect(unknown.coverage).toBe("unknown");
  });

  it("keeps a directly requested imported ride outside observed progress", () => {
    const imported = ride("ride_imported", [A, B], "2026-09-16T12:00:00.000Z", "import");
    const planned = ride("ride_planned", [A, B], "2026-09-16T12:00:00.000Z", "new");
    for (const selected of [imported, planned]) {
      const result = projectRoadProgress({
        ride: selected,
        history: [selected],
        features: [feature("curvy:1", "great-roads", [A, B])],
      });

      expect(result.coverage).toBe("unknown");
      expect(result.qualifiedMeters).toBe(0);
      expect(result.newToYouMeters).toBeNull();
      expect(result.matchedFeatures).toEqual([]);
    }
  });

  it("clips the overlay to the observed catalogue portion", () => {
    const current = ride("ride_current", [A, B]);
    const overlays = observedRoadOverlayFeatures(
      [feature("curvy:1", "great-roads", [A, B, C, D])],
      [current],
    );

    expect(overlays).toHaveLength(1);
    expect(overlays[0]?.layerId).toBe("road-history");
    expect(overlays[0]?.overlay).toBe("road-history");
    expect(overlays[0]?.geometry).toEqual({ type: "LineString", coordinates: [[A.lon, A.lat], [B.lon, B.lat]] });
    expect(overlays[0]?.geometry).not.toEqual({ type: "LineString", coordinates: [[A.lon, A.lat], [B.lon, B.lat], [C.lon, C.lat], [D.lon, D.lat]] });
  });

  it("prepares the local matcher once and excludes a selected ride", () => {
    const current = ride("ride_current", [A, B]);
    const prepared = prepareRoadHistory([current], { excludeRideId: current.summary.rideId });
    expect(prepared.available).toBe(false);
    expect(prepared.edgeSeen(A, B)).toBe(false);
  });

  it("reads the bounded catalogue only through the explicit progress reader", async () => {
    const current = ride("ride_current", [A, B]);
    const load = vi.fn().mockResolvedValue({
      features: [feature("curvy:1", "great-roads", [A, B])],
      unavailable: [],
    });
    const reader = createRoadProgressReader({
      listExploreRides: async () => [current],
      mapLayersSource: { load, trafficTileUrl: null } satisfies MapLayersSource,
    });

    const result = await reader.read(current.summary.rideId);

    const call = load.mock.calls[0];
    expect(call?.[0]).toMatchObject({ west: A.lon, south: A.lat, north: B.lat });
    expect(call?.[0]?.east).toBeCloseTo(B.lon, 10);
    expect(call?.[1]).toEqual(["great-roads", "gravel"]);
    expect(call?.[2]).toBeUndefined();
    expect(result.qualifiedMeters).toBeGreaterThan(0);
  });
});
