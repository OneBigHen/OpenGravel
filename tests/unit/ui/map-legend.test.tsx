/**
 * The cold-open legend chip (first-minute wow, W1): a small legend that opens
 * the Layers sheet, and a panel that a host can also open from elsewhere.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
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

describe("map legend chip, first three opens only (PF-6)", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    vi.resetModules();
  });

  async function open() {
    vi.resetModules();
    const chip = await import("@/ui/layers/MapLegendChip");
    return render(<chip.MapLegendChip onOpen={vi.fn()} />);
  }

  it("fades 8 seconds after the map is ready and then leaves the page", async () => {
    vi.useFakeTimers();
    await open();
    expect(screen.getByTestId("map-legend")).not.toHaveAttribute("data-fading");
    act(() => { vi.advanceTimersByTime(8100); });
    expect(screen.getByTestId("map-legend")).toHaveAttribute("data-fading", "true");
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.queryByTestId("map-legend")).toBeNull();
  });

  it("is not there on the fourth open", async () => {
    window.localStorage.setItem("og-legend-seen", "3");
    await open();
    expect(screen.queryByTestId("map-legend")).toBeNull();
    expect(window.localStorage.getItem("og-legend-seen")).toBe("4");
  });
});
