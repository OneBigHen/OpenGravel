import { describe, expect, it } from "vitest";
import { RIDE_FOCUS_DIM, isBasemapRoadLayer, rideFocusChanges } from "@/infrastructure/map/maplibre/ride-focus-dim";
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
