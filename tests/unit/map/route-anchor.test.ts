import { describe, expect, it } from "vitest";
import { routeLineAnchorId, routeLineBelowRoads } from "@/infrastructure/map/maplibre/route-anchor";
import type { HostedStyleLayer } from "@/infrastructure/map/maplibre/visual-detail";

const line = (id: string, sourceLayer = "road"): HostedStyleLayer => ({ id, type: "line", "source-layer": sourceLayer });
const symbol = (id: string): HostedStyleLayer => ({ id, type: "symbol" });
const fill = (id: string): HostedStyleLayer => ({ id, type: "fill", "source-layer": "landuse" });

// Mapbox Outdoors: road labels are interleaved with road lines, and the bridges come last.
const outdoors: HostedStyleLayer[] = [
  { id: "land", type: "background" },
  fill("landuse"),
  line("tunnel-street"),
  symbol("tunnel-oneway-arrow"),
  line("road-street"),
  symbol("road-label-simple"),
  line("road-primary"),
  symbol("road-oneway-arrow-blue"),
  line("bridge-street"),
  line("bridge-primary"),
  symbol("bridge-oneway-arrow-white"),
  symbol("level-crossing"),
  symbol("road-label"),
  symbol("road-number-shield"),
  symbol("settlement-major-label"),
];

// OpenMapTiles (OpenFreeMap liberty / dark): "transportation" source layer, highway-* ids.
const openMapTiles: HostedStyleLayer[] = [
  { id: "background", type: "background" },
  fill("park"),
  line("tunnel_motorway", "transportation"),
  line("highway_minor", "transportation"),
  symbol("water_name"),
  line("highway_major", "transportation"),
  line("bridge_motorway", "transportation"),
  symbol("highway-name-minor"),
  symbol("label_city"),
];

describe("the ride line is the top line (PF-1)", () => {
  it("lands above the last bridge line and before the first road label on Mapbox Outdoors", () => {
    const anchor = routeLineAnchorId(outdoors);
    expect(anchor).toBe("road-label");
    const at = outdoors.findIndex((layer) => layer.id === anchor);
    expect(at).toBeGreaterThan(outdoors.findIndex((layer) => layer.id === "bridge-primary"));
    expect(outdoors.slice(at).some((layer) => layer.type === "line" || layer.type === "fill")).toBe(false);
  });

  it("lands above the last road line on an OpenMapTiles style", () => {
    expect(routeLineAnchorId(openMapTiles)).toBe("highway-name-minor");
  });

  it("keeps the old rule (first label) on a style with no road lines", () => {
    expect(routeLineAnchorId([fill("water"), symbol("place-label"), symbol("poi")])).toBe("place-label");
  });

  it("appends when nothing is drawn after the last road", () => {
    expect(routeLineAnchorId([fill("water"), line("road-street")])).toBeUndefined();
  });

  it("ignores our own layers when it looks for roads and labels", () => {
    const layers = [line("road-street"), { id: "ogv-route-selected", type: "line" }, symbol("ogv-route-label"), symbol("road-label")];
    expect(routeLineAnchorId(layers)).toBe("road-label");
  });

  it("knows when a route line already in the style sits under a basemap road", () => {
    const layers = [line("road-street"), { id: "ogv-route-selected", type: "line" }, line("bridge-street"), symbol("road-label")];
    expect(routeLineBelowRoads(layers, "ogv-route-selected")).toBe(true);
    const fixed = [line("road-street"), line("bridge-street"), { id: "ogv-route-selected", type: "line" }, symbol("road-label")];
    expect(routeLineBelowRoads(fixed, "ogv-route-selected")).toBe(false);
  });
});
