import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAP_LAYERS, type MapLayerId } from "@/application/map-layers";
import { MapLayersPanel } from "@/ui/layers/MapLayersPanel";
import type { MapLayerStatus } from "@/ui/layers/useMapLayers";

afterEach(cleanup);

function panel(statusOverrides: Partial<Record<MapLayerId, MapLayerStatus>> = {}) {
  const status = Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, statusOverrides[layer.id] ?? "off"])) as Record<MapLayerId, MapLayerStatus>;
  return render(<MapLayersPanel enabled={["weather-radar", "active-fire", "public-land", "road-surface"]} status={status} counts={Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, 0])) as Record<MapLayerId, number>} cameraRouteOnly={false} cameraRouteAvailable={false} onToggleCameraRouteOnly={vi.fn()} onToggle={vi.fn()} onClearAll={vi.fn()} freshness={[{ layerId: "weather-radar", source: "NOAA / IEM", observedAt: "2026-10-03T12:00:00Z", fetchedAt: "2026-10-03T12:30:00Z", stale: true, note: "Coverage gaps unknown" }, { layerId: "public-land", source: "OpenStreetMap fallback", observedAt: null, fetchedAt: "2026-10-03T12:30:00Z", stale: false, note: "PAD-US unavailable" }]} />);
}
describe("closeout layers sheet", () => {
  it("shows stale frame time, unavailable primary and unknown surface gaps", () => {
    panel({ "weather-radar": "stale", "public-land": "unavailable", "road-surface": "ready" });
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText(/NOAA \/ IEM · Observed/)).toBeInTheDocument();
    expect(screen.getByText(/OpenStreetMap fallback · Retrieved/)).toBeInTheDocument();
    expect(screen.getByText("No records · gaps unknown")).toBeInTheDocument();
    expect(screen.getByTestId("map-layer-road-surface").querySelector("rect")?.getAttribute("fill")).toBe("var(--og-trail-brown)");
  });
  it("discloses fire limits and returns keyboard focus after Escape", () => {
    panel();
    const control = screen.getByRole("button", { name: "Layers" });
    fireEvent.click(control);
    fireEvent.click(screen.getByRole("button", { name: "About Active fire hotspots" }));
    expect(screen.getByText(/Hotspots are not road closures/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(control).toHaveFocus();
    expect(screen.queryByRole("region", { name: "Map layers" })).not.toBeInTheDocument();
  });
});
