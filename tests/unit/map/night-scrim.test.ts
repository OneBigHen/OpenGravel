/**
 * The night look on a deployment with no dark basemap of its own.
 *
 * Night contrast is a Mapbox style, so a deployment without the public token
 * has no dark cartography to switch to. Rather than leaving the ride map bright
 * while the chrome goes dark, the renderer adds one flat fill under its own
 * layers (see `syncNightScrim`). This is the layer itself: a dimmer, not a
 * second cartography, and never a hit target.
 */

import { describe, expect, it } from "vitest";

import { HIT_LAYER_IDS, MAP_LAYER_IDS, nightScrimLayer, overlayLayers, DEFAULT_MAP_PALETTE } from "@/infrastructure/map/maplibre/style";

describe("the night scrim", () => {
  const layer = nightScrimLayer();

  it("paints the whole viewport with a translucent dark fill", () => {
    expect(layer.id).toBe(MAP_LAYER_IDS.nightScrim);
    expect(layer.type).toBe("background");
    expect(layer.paint?.["background-color"]).toBe("#07100c");
    expect(layer.paint?.["background-opacity"]).toBe(0.38);
  });

  it("is not part of the default overlay stack and not selectable", () => {
    // It only exists while the rider has asked for the night look, and it lives
    // under the route rather than in the scene's own draw order.
    expect(overlayLayers(DEFAULT_MAP_PALETTE).some((entry) => entry.id === MAP_LAYER_IDS.nightScrim)).toBe(false);
    expect(HIT_LAYER_IDS).not.toContain(MAP_LAYER_IDS.nightScrim);
  });
});
