import { describe, expect, it } from "vitest";

import {
  WIND_GRID_MAX_POINTS,
  WIND_READING_TOLERANCE_MS,
  meanWindArrowDirectionDeg,
  sampleWindGrid,
  windArrowImageId,
  windArrowProperties,
  windArrowRotationDeg,
  windArrowStyle,
  windArrowText,
  windDirectionLabel,
  windGridFeatures,
  windReadingAt,
  type WindReading,
  type WindSeries,
} from "@/application/map-layers/wind";
import type { MapLayerId } from "@/application/map-layers";
import { INFO_HIT_LAYERS, infoFeatureCollection, infoLayerSpecs } from "@/infrastructure/map/maplibre/info-layers";
import { DEFAULT_MAP_PALETTE } from "@/infrastructure/map/maplibre/style";
import type { MapScene } from "@/application/map/types";

const HOUR = 60 * 60_000;
const AT = Date.parse("2026-10-27T14:30:00Z");

/** A series whose windows hold for one hour from 13:00 UTC. */
function series(overrides: Partial<WindSeries> = {}): WindSeries {
  return {
    speedMph: [{ startMs: AT - HOUR, endMs: AT + HOUR, value: 17.7 }],
    gustMph: [{ startMs: AT - HOUR, endMs: AT + HOUR, value: 31.6 }],
    fromDegrees: [{ startMs: AT - HOUR, endMs: AT + HOUR, value: 250 }],
    ...overrides,
  };
}

function reading(overrides: Partial<WindReading> = {}): WindReading {
  return { speedMph: 17.7, gustMph: 31.6, fromDegrees: 250, ...overrides };
}

describe("the wind grid sampler", () => {
  it("caps a wide view at the arrow limit and keeps every point inside the view", () => {
    const bounds = { west: -76, south: 39.5, east: -74.4, north: 40.5 };
    const points = sampleWindGrid(bounds);

    expect(points).toHaveLength(WIND_GRID_MAX_POINTS);
    for (const [lon, lat] of points) {
      expect(lon).toBeGreaterThan(bounds.west);
      expect(lon).toBeLessThan(bounds.east);
      expect(lat).toBeGreaterThan(bounds.south);
      expect(lat).toBeLessThan(bounds.north);
    }
    // Points are cell centres, so the same view always reads the same cells.
    expect(sampleWindGrid(bounds)).toEqual(points);
    expect(new Set(points.map(([lon, lat]) => `${lon},${lat}`)).size).toBe(points.length);
  });

  it("draws fewer arrows where the NWS grid cannot honestly say more", () => {
    // A zoom-12 phone view is ~0.07° across: one arrow at the view centre.
    expect(sampleWindGrid({ west: -75.44, south: 40.14, east: -75.37, north: 40.19 }))
      .toEqual([[expect.closeTo(-75.405, 5), expect.closeTo(40.165, 5)]]);
  });

  it("honours a tighter point budget and refuses an empty or inverted view", () => {
    const bounds = { west: -76, south: 39.5, east: -74.4, north: 40.5 };
    expect(sampleWindGrid(bounds, 4).length).toBeLessThanOrEqual(4);
    expect(sampleWindGrid(bounds, 1)).toHaveLength(1);
    expect(sampleWindGrid({ west: -75, south: 40, east: -75, north: 40 })).toEqual([]);
    expect(sampleWindGrid({ west: -74, south: 40, east: -75, north: 39 })).toEqual([]);
  });
});

describe("the wind reading at an instant", () => {
  it("uses the window that covers now and keeps the gust with it", () => {
    const at = windReadingAt(series(), AT);
    expect(at).not.toBeNull();
    expect(at?.reading).toEqual({ speedMph: 17.7, gustMph: 31.6, fromDegrees: 250 });
    expect(at?.startMs).toBe(AT - HOUR);
  });

  it("keeps a gust unknown when NWS publishes none for the window", () => {
    expect(windReadingAt(series({ gustMph: [] }), AT)?.reading.gustMph).toBeNull();
    const late = windReadingAt(series({ gustMph: [{ startMs: AT + HOUR, endMs: AT + 2 * HOUR, value: 40 }] }), AT);
    expect(late?.reading.gustMph).toBeNull();
  });

  it("falls back to the window that just ended, but not past the tolerance", () => {
    const justEnded: WindSeries = {
      speedMph: [{ startMs: AT - 3 * HOUR, endMs: AT - 2 * HOUR, value: 9 }],
      gustMph: [],
      fromDegrees: [{ startMs: AT - 3 * HOUR, endMs: AT - 2 * HOUR, value: 90 }],
    };
    expect(windReadingAt(justEnded, AT)?.reading.speedMph).toBe(9);
    expect(windReadingAt(justEnded, AT + WIND_READING_TOLERANCE_MS)).toBeNull();
  });

  it("never invents a reading without both a speed and a direction", () => {
    expect(windReadingAt(series({ fromDegrees: [] }), AT)).toBeNull();
    expect(windReadingAt(series({ speedMph: [] }), AT)).toBeNull();
    expect(windReadingAt(series({ gustMph: [], fromDegrees: [] }), AT)).toBeNull();
  });
});

describe("the wind arrow style", () => {
  it("grades speed into bands a rider can tell apart by size and colour", () => {
    const style = (mph: number) => windArrowStyle(mph);
    expect(style(0)).toMatchObject({ band: "calm", tone: "sage", size: 0.62 });
    expect(style(7.9)).toMatchObject({ band: "calm" });
    expect(style(8)).toMatchObject({ band: "breeze", tone: "signal", size: 0.78 });
    expect(style(15.9)).toMatchObject({ band: "breeze" });
    expect(style(16)).toMatchObject({ band: "strong", tone: "gold", size: 0.94 });
    expect(style(25)).toMatchObject({ band: "gale", tone: "ember", size: 1.12 });
    // Size and colour only ever move together.
    expect(style(30)!.size).toBeGreaterThan(style(3)!.size);
  });

  it("draws nothing for an unknown speed", () => {
    expect(windArrowStyle(null)).toBeNull();
    expect(windArrowStyle(undefined)).toBeNull();
    expect(windArrowStyle(Number.NaN)).toBeNull();
    expect(windArrowStyle(-4)).toBeNull();
    expect(windArrowProperties(null)).toEqual({});
  });

  it("points the arrow downwind and labels the direction it comes from", () => {
    expect(windDirectionLabel(250)).toBe("W");
    expect(windDirectionLabel(0)).toBe("N");
    expect(windDirectionLabel(90)).toBe("E");
    expect(windDirectionLabel(180)).toBe("S");
    expect(windDirectionLabel(45)).toBe("NE");
    expect(windDirectionLabel(350)).toBe("N");
    expect(windDirectionLabel(-90)).toBe("W");
    expect(windArrowRotationDeg(250)).toBe(70);
    expect(windArrowRotationDeg(0)).toBe(180);
    expect(windArrowRotationDeg(360)).toBe(180);
  });

  it("turns a reading into the properties the arrow layer draws from", () => {
    expect(windArrowProperties(reading())).toEqual({
      direction: 70,
      icon: windArrowImageId("strong"),
      size: 0.94,
    });
  });
});

describe("the wind feature card text", () => {
  it("prints the forecast in the forecast's own words", () => {
    expect(windArrowText(reading())).toEqual({ name: "W 18 mph", detail: "Gusts 32 mph" });
    expect(windArrowText(reading({ gustMph: null }))).toEqual({ name: "W 18 mph", detail: "Gusts not published" });
  });

  it("builds tappable features that carry the reading", () => {
    const features = windGridFeatures([
      { coordinate: [-75.4, 40.1], reading: reading(), validFrom: "2026-10-27T13:00:00.000Z" },
      { coordinate: [-75.3, 40.2], reading: reading({ speedMph: 6, gustMph: null, fromDegrees: 90 }), validFrom: "2026-10-27T13:00:00.000Z" },
    ]);
    expect(features).toHaveLength(2);
    expect(features[0]).toMatchObject({
      id: "wind:-75.400,40.100",
      layerId: "wind",
      name: "W 18 mph",
      detail: "Gusts 32 mph",
      weight: 17.7,
      wind: { speedMph: 17.7, gustMph: 31.6, fromDegrees: 250 },
      geometry: { type: "Point", coordinates: [-75.4, 40.1] },
    });
    expect(features[1]).toMatchObject({ name: "E 6 mph", detail: "Gusts not published" });
  });
});

describe("the view's mean wind direction", () => {
  it("averages across north instead of jumping south", () => {
    // Flow directions 170° and 190°: a westerly wind either side of the seam.
    expect(meanWindArrowDirectionDeg([reading({ fromDegrees: 350 }), reading({ fromDegrees: 10 })]))
      .toBeCloseTo(180, 5);
    expect(meanWindArrowDirectionDeg([reading({ fromDegrees: 270 })])).toBe(90);
    expect(meanWindArrowDirectionDeg([])).toBeNull();
  });
});

describe("the wind layer on the renderer", () => {
  it("is a catalogue layer whose arrows are drawn, hit-testable and not dots", () => {
    const specs = infoLayerSpecs(DEFAULT_MAP_PALETTE);
    const arrows = specs.find((layer) => layer.id === "ogv-info-wind-arrow");
    expect(arrows).toMatchObject({ type: "symbol", minzoom: 8, maxzoom: 13 });
    expect(arrows?.filter).toEqual(["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "layerId"], "wind"]]);
    expect(INFO_HIT_LAYERS).toContain("ogv-info-wind-arrow");
    const dot = specs.find((layer) => layer.id === "ogv-info-point");
    expect(JSON.stringify(dot?.filter)).toContain("wind");
  });

  it("hands the arrow layer a downwind rotation and a band image", () => {
    const feature = {
      id: "wind:-75.4,40.1",
      layerId: "wind" as MapLayerId,
      name: "W 18 mph",
      detail: "Gusts 32 mph",
      weight: 17.7,
      wind: reading(),
      geometry: { type: "Point" as const, coordinates: [-75.4, 40.1] as const },
    };
    const scene = {
      mode: "plan",
      routes: [],
      selectedRouteId: null,
      points: [],
      preview: null,
      avoidAreas: [],
      roadSpans: [],
      sketch: null,
      avoidHandles: [],
      previewArea: null,
      selectedObject: null,
      infoLayers: { features: [feature], trafficFlowTiles: null, selectedId: null, visible: ["wind" as MapLayerId] },
    } as unknown as MapScene;
    const collection = infoFeatureCollection(scene);
    expect(collection.features[0]).toMatchObject({
      properties: { id: "wind:-75.4,40.1", layerId: "wind", direction: 70, icon: "ogv-wind-arrow-strong", size: 0.94 },
    });
  });
});
