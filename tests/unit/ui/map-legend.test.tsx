/**
 * The cold-open legend chip (first-minute wow, W1): a small legend that opens
 * the Layers sheet, and a panel that a host can also open from elsewhere.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAP_LAYERS, type MapLayerId } from "@/application/map-layers";
import { MapLayersPanel } from "@/ui/layers/MapLayersPanel";
import { MapLegendChip } from "@/ui/layers/MapLegendChip";
import type { MapLayerStatus } from "@/ui/layers/useMapLayers";

afterEach(cleanup);

const status = Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, "off"])) as Record<MapLayerId, MapLayerStatus>;
const counts = Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, 0])) as Record<MapLayerId, number>;

describe("map legend chip", () => {
  it("names both swatches and opens Layers when tapped", () => {
    const onOpen = vi.fn();
    render(<MapLegendChip onOpen={onOpen} />);
    const chip = screen.getByTestId("map-legend");
    expect(chip).toHaveAccessibleName(/gravel/i);
    expect(chip).toHaveAccessibleName(/twisty/i);
    expect(chip.querySelectorAll("svg")).toHaveLength(2);
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("lets a host open the Layers sheet without the Layers button", () => {
    render(
      <MapLayersPanel
        enabled={["gravel", "great-roads"]}
        status={{ ...status, gravel: "ready", "great-roads": "ready" }}
        counts={counts}
        cameraRouteOnly={false}
        cameraRouteAvailable={false}
        onToggleCameraRouteOnly={vi.fn()}
        onToggle={vi.fn()}
        onClearAll={vi.fn()}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Layers" })).toBeInTheDocument();
    expect(screen.getByTestId("map-layer-rider-picked")).toBeInTheDocument();
  });
});
