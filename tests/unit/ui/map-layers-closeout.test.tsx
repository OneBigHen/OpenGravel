import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAP_LAYERS, type MapLayerId } from "@/application/map-layers";
import { MapLayersPanel } from "@/ui/layers/MapLayersPanel";
import type { MapLayerStatus } from "@/ui/layers/useMapLayers";

afterEach(cleanup);

function panel(statusOverrides: Partial<Record<MapLayerId, MapLayerStatus>> = {}) {
  const status = Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, statusOverrides[layer.id] ?? "off"])) as Record<MapLayerId, MapLayerStatus>;
  return render(<MapLayersPanel enabled={["weather-radar", "active-fire", "public-land", "gravel"]} status={status} counts={Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, 0])) as Record<MapLayerId, number>} cameraRouteOnly={false} cameraRouteAvailable={false} onToggleCameraRouteOnly={vi.fn()} onToggle={vi.fn()} onClearAll={vi.fn()} freshness={[{ layerId: "weather-radar", source: "NOAA / IEM", observedAt: "2026-10-03T12:00:00Z", fetchedAt: "2026-10-03T12:30:00Z", stale: true, note: "Coverage gaps unknown" }, { layerId: "public-land", source: "OpenStreetMap fallback", observedAt: null, fetchedAt: "2026-10-03T12:30:00Z", stale: false, note: "PAD-US unavailable" }]} />);
}
describe("closeout layers sheet", () => {
  it("turns a whole lens on with one tap", () => {
    const onToggleLens = vi.fn();
    const status = Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, "off"])) as Record<MapLayerId, MapLayerStatus>;
    render(<MapLayersPanel enabled={["great-roads", "gravel", "viewpoints", "hillshade", "weather-radar"]} status={status} counts={Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, 0])) as Record<MapLayerId, number>} cameraRouteOnly={false} cameraRouteAvailable={false} onToggleCameraRouteOnly={vi.fn()} onToggle={vi.fn()} onToggleLens={onToggleLens} onClearAll={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByTestId("map-lens-fun")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("map-lens-weather")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("map-lens-weather")).toHaveAccessibleName(/Partial/);
    expect(screen.getByText("5 active")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("map-lens-weather"));
    expect(onToggleLens).toHaveBeenCalledWith(["weather-radar", "weather"]);
  });
  it("gives a quick set tile one icon, its words and its state", () => {
    const status = Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, "off"])) as Record<MapLayerId, MapLayerStatus>;
    render(<MapLayersPanel enabled={["great-roads", "gravel", "viewpoints", "hillshade"]} status={status} counts={Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, 0])) as Record<MapLayerId, number>} cameraRouteOnly={false} cameraRouteAvailable={false} onToggleCameraRouteOnly={vi.fn()} onToggle={vi.fn()} onToggleLens={vi.fn()} onClearAll={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    for (const lens of screen.getAllByTestId(/^map-lens-/)) {
      expect(lens.querySelectorAll(".og-layers__swatch")).toHaveLength(1);
      expect(lens.querySelectorAll(".og-layers__swatch svg")).toHaveLength(1);
      expect(lens.querySelectorAll(".og-layers__name")).toHaveLength(1);
      expect(lens.querySelectorAll(".og-layers__lens-state")).toHaveLength(1);
      // Nothing else may sit in the tile: a leftover badge or absolutely
      // positioned circle was what once covered the icon.
      expect(lens.children).toHaveLength(3);
    }
    expect(screen.getByTestId("map-lens-fun")).toHaveAttribute("data-on", "true");
    expect(screen.getByTestId("map-lens-weather")).toHaveAttribute("data-on", "false");
  });
  it("shows stale frame time, unavailable primary and empty gravel", () => {
    panel({ "weather-radar": "stale", "public-land": "unavailable", gravel: "ready" });
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByText("Out of date")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText(/May be out of date · Updated/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About Rain radar" }));
    expect(screen.getByText(/NOAA \/ IEM · Observed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About Public land" }));
    expect(screen.getByText(/OpenStreetMap fallback · Retrieved/)).toBeInTheDocument();
    expect(screen.getByText("None here")).toBeInTheDocument();
  });
  it.each([
    ["loading", "Loading terrain"],
    ["unavailable", "Terrain unavailable"],
    ["flat-offline", "Flat offline"],
  ] as const)("describes terrain state %s", (state, label) => {
    panel({ "terrain-3d": state });
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByText(label)).toBeInTheDocument();
  });
  it("puts the basemap style in the sheet when the map does not own it", () => {
    const onChoose = vi.fn();
    render(<MapLayersPanel enabled={[]} status={Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, "off"])) as Record<MapLayerId, MapLayerStatus>} counts={Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, 0])) as Record<MapLayerId, number>} cameraRouteOnly={false} cameraRouteAvailable={false} onToggleCameraRouteOnly={vi.fn()} onToggle={vi.fn()} onClearAll={vi.fn()} mapStyle={{ look: "map", options: ["map", "night", "satellite"], onChoose }} />);
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByTestId("sheet-map-style-map")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("sheet-map-style-night")).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByTestId("sheet-map-style-night"));
    expect(onChoose).toHaveBeenCalledWith("night");
  });
  it("discloses fire limits and returns keyboard focus after Escape", () => {
    panel();
    const control = screen.getByRole("button", { name: "Layers" });
    fireEvent.click(control);
    fireEvent.click(screen.getByRole("button", { name: "About Wildfires" }));
    expect(screen.getByText(/Hotspots are not road closures/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(control).toHaveFocus();
    expect(screen.queryByRole("region", { name: "Map layers" })).not.toBeInTheDocument();
  });
});
