import { describe, expect, it } from "vitest";
import {
  RIDE_FOCUS_DIM,
  RIDE_FOCUS_ROAD_OPACITY,
  type RoadOpacityEntry,
  SATELLITE_RIDE_ROAD_OPACITY,
  SATELLITE_ROAD_OPACITY,
  basemapRoadChanges,
  basemapRoadOpacityFactor,
  isBasemapRoadLayer,
  rideFocusChanges,
} from "@/infrastructure/map/maplibre/ride-focus-dim";
import type { HostedStyleLayer } from "@/infrastructure/map/maplibre/visual-detail";

const twisty = (opacity: unknown): HostedStyleLayer => ({ id: "ogv-info-line", type: "line", paint: { "line-opacity": opacity } });

describe("map first: discovery layers step back while a ride is shown", () => {
  it("dims the twisty/gravel lines when a ride appears and restores them when it is cleared", () => {
    const originals = new Map<string, unknown>();
    const on = rideFocusChanges([twisty(0.9)], true, originals);
    expect(on).toEqual([{ id: "ogv-info-line", property: "line-opacity", value: 0.9 * RIDE_FOCUS_DIM }]);
    // Already dimmed: nothing more to do.
    expect(rideFocusChanges([twisty(0.9 * RIDE_FOCUS_DIM)], true, originals)).toEqual([]);
    const off = rideFocusChanges([twisty(0.9 * RIDE_FOCUS_DIM)], false, originals);
    expect(off).toEqual([{ id: "ogv-info-line", property: "line-opacity", value: 0.9 }]);
  });

  it("dims a data-driven opacity without losing its per-layer values", () => {
    const original = ["match", ["get", "layerId"], "great-roads", 0.9, 0.85];
    const [change] = rideFocusChanges([twisty(original)], true, new Map());
    expect(JSON.stringify(change?.value)).not.toBe(JSON.stringify(original));
  });

  it("re-dims a layer the style reloaded at full strength, and never dims twice", () => {
    const originals = new Map<string, unknown>();
    rideFocusChanges([twisty(0.9)], true, originals);
    const again = rideFocusChanges([twisty(0.9)], true, originals);
    expect(again).toEqual([{ id: "ogv-info-line", property: "line-opacity", value: 0.9 * RIDE_FOCUS_DIM }]);
  });

  it("leaves layers alone when there is no ride and nothing was dimmed", () => {
    expect(rideFocusChanges([twisty(0.9)], false, new Map())).toEqual([]);
  });

  it("only fades basemap streets on satellite, never the ride's own lines", () => {
    expect(isBasemapRoadLayer({ id: "road-primary", type: "line", "source-layer": "transportation" })).toBe(true);
    expect(isBasemapRoadLayer({ id: "ogv-route-selected", type: "line", source: "ogv-routes" })).toBe(false);
  });
});

describe("PF-5: the basemap's streets step back while a ride is shown", () => {
  const road = (id: string, opacity?: unknown): HostedStyleLayer => ({
    id,
    type: "line",
    "source-layer": "road",
    paint: opacity === undefined ? {} : { "line-opacity": opacity },
  });
  /** Applies a plan's changes to a layer list the way the renderer would. */
  const apply = (layers: HostedStyleLayer[], changes: readonly { id: string; value: unknown }[]): HostedStyleLayer[] =>
    layers.map((layer) => {
      const change = changes.find((entry) => entry.id === layer.id);
      if (change === undefined) return layer;
      const paint = { ...layer.paint } as Record<string, unknown>;
      if (change.value === null) delete paint["line-opacity"];
      else paint["line-opacity"] = change.value;
      return { ...layer, paint };
    });

  it("is 0.6 on Day and Night with a ride, 0.25 over satellite, 0.4 on satellite alone", () => {
    expect(basemapRoadOpacityFactor({ satellite: false, rideShown: false })).toBe(1);
    expect(basemapRoadOpacityFactor({ satellite: false, rideShown: true })).toBe(RIDE_FOCUS_ROAD_OPACITY);
    expect(RIDE_FOCUS_ROAD_OPACITY).toBe(0.6);
    expect(basemapRoadOpacityFactor({ satellite: true, rideShown: true })).toBe(SATELLITE_RIDE_ROAD_OPACITY);
    expect(SATELLITE_RIDE_ROAD_OPACITY).toBe(0.25);
    expect(basemapRoadOpacityFactor({ satellite: true, rideShown: false })).toBe(SATELLITE_ROAD_OPACITY);
    expect(SATELLITE_ROAD_OPACITY).toBe(0.4);
  });

  it("dims every road layer, keeps zoom curves valid, and restores them on Close route", () => {
    const curve = ["interpolate", ["linear"], ["zoom"], 3, 0, 3.5, 1];
    let layers = [road("road-primary"), road("road-motorway-trunk", curve), twisty(0.9)];
    const entries = new Map<string, RoadOpacityEntry>();
    const on = basemapRoadChanges(layers, 0.6, entries);
    expect(on).toEqual([
      { id: "road-primary", property: "line-opacity", value: 0.6 },
      { id: "road-motorway-trunk", property: "line-opacity", value: ["interpolate", ["linear"], ["zoom"], 3, 0, 3.5, 0.6] },
    ]);
    layers = apply(layers, on);
    // Same factor again: nothing to do, and never dimmed twice.
    expect(basemapRoadChanges(layers, 0.6, entries)).toEqual([]);
    // Satellite on top of a ride: from the original, not from the dimmed value.
    const satellite = basemapRoadChanges(layers, 0.25, entries);
    expect(satellite[0]).toEqual({ id: "road-primary", property: "line-opacity", value: 0.25 });
    layers = apply(layers, satellite);
    const off = basemapRoadChanges(layers, 1, entries);
    expect(off).toEqual([
      { id: "road-primary", property: "line-opacity", value: null },
      { id: "road-motorway-trunk", property: "line-opacity", value: curve },
    ]);
    layers = apply(layers, off);
    expect(layers[0]?.paint).toEqual({});
    expect(entries.size).toBe(0);
    expect(basemapRoadChanges(layers, 1, entries)).toEqual([]);
  });

  it("dims again after a style reload brings the streets back at full strength", () => {
    const entries = new Map<string, RoadOpacityEntry>();
    basemapRoadChanges([road("road-street", 0.9)], 0.6, entries);
    // The reloaded style holds its own 0.9 again, not our 0.54.
    const again = basemapRoadChanges([road("road-street", 0.9)], 0.6, entries);
    expect(again).toEqual([{ id: "road-street", property: "line-opacity", value: 0.9 * 0.6 }]);
  });

  it("never touches the ride's own lines or the discovery layers", () => {
    const changes = basemapRoadChanges(
      [{ id: "ogv-route-selected", type: "line", source: "ogv-routes" }, twisty(0.9)],
      0.25,
      new Map(),
    );
    expect(changes).toEqual([]);
  });
});
