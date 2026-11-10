/**
 * Milestone 3, "one clean front door": the side features that left the map's
 * first screen (Ask, traffic cameras) start off, come back from Settings, and
 * are remembered per device.
 */

import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAP_LAYERS, type MapLayerId } from "@/application/map-layers";
import {
  getFrontDoorOption,
  setFrontDoorOption,
  subscribeFrontDoorOptions,
} from "@/application/map/front-door-options";
import { FRONT_DOOR_ASK_STORAGE_KEY, FRONT_DOOR_CAMERAS_STORAGE_KEY } from "@/application/persistence/local-data-keys";
import { MapLayersPanel } from "@/ui/layers/MapLayersPanel";
import type { MapLayerStatus } from "@/ui/layers/useMapLayers";
import { useFrontDoorOption } from "@/ui/stores/front-door-options";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setFrontDoorOption("ask", false);
  setFrontDoorOption("cameras", false);
});

describe("front-door options", () => {
  it("start off, so a cold load shows the clean first screen", () => {
    expect(getFrontDoorOption("ask")).toBe(false);
    expect(getFrontDoorOption("cameras")).toBe(false);
    const { result } = renderHook(() => useFrontDoorOption("ask"));
    expect(result.current).toBe(false);
  });

  it("remember only the on choice, on this device", () => {
    setFrontDoorOption("ask", true);
    expect(localStorage.getItem(FRONT_DOOR_ASK_STORAGE_KEY)).toBe("on");
    expect(getFrontDoorOption("ask")).toBe(true);
    expect(getFrontDoorOption("cameras")).toBe(false);
    setFrontDoorOption("ask", false);
    expect(localStorage.getItem(FRONT_DOOR_ASK_STORAGE_KEY)).toBeNull();
    setFrontDoorOption("cameras", true);
    expect(localStorage.getItem(FRONT_DOOR_CAMERAS_STORAGE_KEY)).toBe("on");
  });

  it("tell a mounted hook when Settings flips a switch", () => {
    const { result } = renderHook(() => useFrontDoorOption("cameras"));
    expect(result.current).toBe(false);
    act(() => setFrontDoorOption("cameras", true));
    expect(result.current).toBe(true);
    const listener = vi.fn();
    const unsubscribe = subscribeFrontDoorOptions(listener);
    setFrontDoorOption("cameras", false);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    setFrontDoorOption("cameras", true);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("keep the choice for the visit when device storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    setFrontDoorOption("ask", true);
    expect(getFrontDoorOption("ask")).toBe(true);
    expect(getFrontDoorOption("cameras")).toBe(false);
  });
});

function panel() {
  const status = Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, "off"])) as Record<MapLayerId, MapLayerStatus>;
  const counts = Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, 0])) as Record<MapLayerId, number>;
  return render(
    <MapLayersPanel
      enabled={[]}
      status={status}
      counts={counts}
      cameraRouteOnly={false}
      cameraRouteAvailable={false}
      onToggleCameraRouteOnly={vi.fn()}
      onToggle={vi.fn()}
      onClearAll={vi.fn()}
    />,
  );
}

describe("traffic cameras in the Layers panel", () => {
  it("are not offered until Settings turns them on", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.queryByTestId("map-layer-traffic-cameras")).toBeNull();
    expect(screen.queryByText("Traffic cameras")).toBeNull();
    // The rest of the panel is untouched.
    expect(screen.getByTestId("map-layer-live-traffic")).toBeInTheDocument();
  });

  it("come back as a normal row once Settings turns them on", () => {
    setFrontDoorOption("cameras", true);
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByTestId("map-layer-traffic-cameras")).toBeInTheDocument();
    expect(screen.getByText("Traffic cameras")).toBeInTheDocument();
  });
});
