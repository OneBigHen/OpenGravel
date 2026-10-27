/**
 * The planner map host seam (02-ARCHITECTURE-CONTRACT §17, 05 §2–§9, §11).
 *
 * The component is a React wrapper around a `MapHost`, and what it owes the
 * product is narrow and testable without WebGL:
 *
 * - **One host per surface.** It is created once, receives the current scene, and
 *   is disposed on unmount — a scene change, a tool change or a revision change
 *   must never create a second map (05 §2). StrictMode's create → dispose →
 *   create is the case that proves it.
 * - **The scene is pushed, not pulled.** Whatever scene is current is what the
 *   host ends up drawing, including when the host resolves after the scene moved.
 * - **Intents go up, transitions go down.** A host intent reaches `onIntent`; a
 *   tool or revision change is dispatched into the host's interaction machine.
 * - **Fits are the workspace's decision.** A `fitKey` requests a fit; a `null`
 *   key (the rider owns the camera) requests nothing (05 §8).
 */

import { applyResolvedTheme } from "@/ui/appearance/appearance";
import { cssRuleRaw } from "../../helpers/app-css";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MAP_EXTENT, sceneExtent } from "@/application/map/build-map-scene";
import type { MapScene } from "@/application/map/types";
import { asRouteCandidateId } from "@/domain/route/ids";
import { PlannerMap } from "@/ui/map/PlannerMap";
import {
  createStubMapHostFactory,
  type StubMapHostFactory,
} from "../support/stub-map-host";

const SELECTED = asRouteCandidateId("route_selected");

function scene(withRoutes = true): MapScene {
  return {
    mode: "plan",
    routes: withRoutes
      ? [
          {
            id: SELECTED,
            role: "best-ride",
            geometry: [
              { lon: -75.2, lat: 39.9 },
              { lon: -75.1, lat: 39.95 },
            ],
            state: "selected",
          },
        ]
      : [],
    selectedRouteId: withRoutes ? SELECTED : null,
    points: [],
    preview: null,
    avoidAreas: [],
    roadSpans: [],
    sketch: null,
    avoidHandles: [],
    previewArea: null,
    selectedObject: null,
  };
}

/** React's effects run in a microtask after the async host factory resolves. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

interface Rendered {
  readonly factory: StubMapHostFactory;
  readonly onIntent: (intent: unknown) => void;
}

async function renderMap(
  props: Partial<Parameters<typeof PlannerMap>[0]> = {},
): Promise<Rendered> {
  const factory = createStubMapHostFactory();
  const onIntent = vi.fn();
  render(
    <PlannerMap
      scene={scene()}
      onIntent={onIntent as never}
      hostFactory={factory.factory}
      activeTool="pan"
      {...props}
    />,
  );
  await settle();
  return { factory, onIntent };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the map surface", () => {
  it("renders the map container and the basemap it was given", async () => {
    await renderMap({ basemap: "openfreemap" });

    const map = screen.getByTestId("planner-map");
    expect(map).toBeInTheDocument();
    // The QA/browser-gate seam: which basemap is actually in use is an attribute,
    // so a gate can assert "the preview shows real cartography" without pixels.
    expect(map).toHaveAttribute("data-basemap", "openfreemap");
  });

  it("defaults to the deterministic empty basemap", async () => {
    await renderMap();
    expect(screen.getByTestId("planner-map")).toHaveAttribute("data-basemap", "empty");
  });

  it("marks the host while a drawing is stale", async () => {
    // 04 §9: a plan in flight keeps the previous route and marks it as stale.
    await renderMap({ dimmed: true });
    expect(screen.getByTestId("map-host")).toHaveAttribute("data-dimmed", "true");
  });
});

describe("the host seam", () => {
  it("creates exactly one host for the surface", async () => {
    const { factory } = await renderMap();
    expect(factory.hosts).toHaveLength(1);
  });

  it("creates the host inside the rendered container", async () => {
    const { factory } = await renderMap();

    expect(factory.containers[0]).toBe(screen.getByTestId("planner-map"));
  });

  it("hands the host the scene it is currently rendering", async () => {
    const { factory } = await renderMap();
    expect(factory.hosts[0]?.lastScene()?.routes).toHaveLength(1);
    expect(factory.hosts[0]?.lastScene()?.selectedRouteId).toBe(SELECTED);
  });

  it("pushes every scene change into the same host", async () => {
    const { factory } = await renderMap();
    const host = factory.hosts[0];
    if (host === undefined) throw new Error("expected a host");

    const empty = scene(false);
    cleanup();
    const factory2 = createStubMapHostFactory();
    const view = render(
      <PlannerMap
        scene={scene()}
        onIntent={vi.fn() as never}
        hostFactory={factory2.factory}
        activeTool="pan"
      />,
    );
    await settle();
    view.rerender(
      <PlannerMap
        scene={empty}
        onIntent={vi.fn() as never}
        hostFactory={factory2.factory}
        activeTool="pan"
      />,
    );

    // A scene change is a sync, never a second map (05 §2).
    expect(factory2.hosts).toHaveLength(1);
    expect(factory2.hosts[0]?.scenes).toHaveLength(2);
    expect(factory2.hosts[0]?.lastScene()?.routes).toHaveLength(0);
  });

  it("forwards a host intent to the workspace", async () => {
    const { factory, onIntent } = await renderMap();
    factory.hosts[0]?.emit({
      type: "map-click",
      coordinate: { lon: -75.2, lat: 39.95 },
    });

    expect(onIntent).toHaveBeenCalledWith({
      type: "map-click",
      coordinate: { lon: -75.2, lat: 39.95 },
    });
  });

  it("subscribes to the host viewport and unsubscribes on dispose", async () => {
    const onViewport = vi.fn();
    const { factory } = await renderMap({ onViewport });
    const host = factory.hosts[0];
    if (host === undefined) throw new Error("expected a host");

    expect(onViewport).toHaveBeenCalledWith(DEFAULT_MAP_EXTENT);
    cleanup();
    host.reportViewport({ minLon: -76, minLat: 39, maxLon: -74, maxLat: 41 });
    expect(onViewport).toHaveBeenCalledTimes(1);
  });

  it("dispatches the pointer tool and the ride revision into the host", async () => {
    const factory = createStubMapHostFactory();
    const view = render(
      <PlannerMap
        scene={scene()}
        onIntent={vi.fn() as never}
        hostFactory={factory.factory}
        activeTool="sketch"
        rideRevision={4}
      />,
    );
    await settle();

    expect(factory.hosts[0]?.events).toContainEqual({ type: "tool-change", tool: "sketch" });
    expect(factory.hosts[0]?.events).toContainEqual({
      type: "ride-revision-change",
      revision: 4,
    });

    view.rerender(
      <PlannerMap
        scene={scene()}
        onIntent={vi.fn() as never}
        hostFactory={factory.factory}
        activeTool="pan"
        rideRevision={5}
      />,
    );

    expect(factory.hosts[0]?.events).toContainEqual({ type: "tool-change", tool: "pan" });
    expect(factory.hosts[0]?.events).toContainEqual({
      type: "ride-revision-change",
      revision: 5,
    });
    expect(factory.hosts).toHaveLength(1);
  });

  it("disposes the host on unmount", async () => {
    const { factory } = await renderMap();
    const host = factory.hosts[0];

    cleanup();

    expect(host?.disposals).toBe(1);
  });

  it("disposes a host that resolves after the surface went away", async () => {
    const factory = createStubMapHostFactory();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = ((container: HTMLElement, options: Parameters<typeof factory.factory>[1]) => {
      const host = factory.factory(container, options);
      return gate.then(() => host);
    }) as typeof factory.factory;

    const view = render(
      <PlannerMap
        scene={scene()}
        onIntent={vi.fn() as never}
        hostFactory={slow}
        activeTool="pan"
      />,
    );
    view.unmount();
    release();
    await settle();

    // StrictMode and a fast unmount both produce this ordering; the host must not
    // outlive the effect that asked for it.
    expect(factory.hosts[0]?.disposals).toBe(1);
  });

  it("opens on the scene's own extent", async () => {
    const { factory } = await renderMap();

    expect(factory.options[0]?.initialExtent).toEqual(sceneExtent(scene()));
    expect(factory.hosts[0]?.fits[0]?.extent).toEqual(sceneExtent(scene()));
  });

  it("opens on the baseline region while the scene is empty", async () => {
    const { factory } = await renderMap({ scene: scene(false) });
    expect(factory.options[0]?.initialExtent).toEqual(DEFAULT_MAP_EXTENT);
  });

  it("passes the basemap through to the renderer", async () => {
    const { factory } = await renderMap({ basemap: "osm" });
    expect(factory.options[0]?.basemap).toBe("osm");
  });
});

describe("camera fits", () => {
  it("does not refit for the mount key alone", async () => {
    const { factory } = await renderMap({ fitKey: "route:1", insets: { top: 1, right: 2, bottom: 3, left: 4 } });

    // The creation path already framed the opening extent; the first observed key
    // only records itself, so the map does not jump on its first render.
    expect(factory.hosts[0]?.fits).toHaveLength(1);
  });

  it("fits when the workspace's fit key changes", async () => {
    const factory = createStubMapHostFactory();
    const onIntent = vi.fn() as never;
    const view = render(
      <PlannerMap
        scene={scene()}
        onIntent={onIntent}
        hostFactory={factory.factory}
        activeTool="pan"
        fitKey="key-a"
        insets={{ top: 0, right: 0, bottom: 240, left: 0 }}
      />,
    );
    await settle();
    view.rerender(
      <PlannerMap
        scene={scene()}
        onIntent={onIntent}
        hostFactory={factory.factory}
        activeTool="pan"
        fitKey="key-b"
        insets={{ top: 0, right: 0, bottom: 240, left: 0 }}
      />,
    );

    const host = factory.hosts[0];
    expect(host?.fits).toHaveLength(2);
    // 05 §9: the fit is padded with the measured insets, not a fixed reservation.
    expect(host?.fits[1]?.insets.bottom).toBe(240);
  });

  it("does not refit while the rider owns the camera", async () => {
    const factory = createStubMapHostFactory();
    const onIntent = vi.fn() as never;
    const view = render(
      <PlannerMap
        scene={scene()}
        onIntent={onIntent}
        hostFactory={factory.factory}
        activeTool="pan"
        fitKey="key-a"
      />,
    );
    await settle();
    view.rerender(
      <PlannerMap
        scene={scene()}
        onIntent={onIntent}
        hostFactory={factory.factory}
        activeTool="pan"
        fitKey={null}
      />,
    );

    // 05 §8: a `null` key means "the rider has the camera"; nothing moves.
    expect(factory.hosts[0]?.fits).toHaveLength(1);
  });

  it("fits again when the rider hands the camera back", async () => {
    const factory = createStubMapHostFactory();
    const onIntent = vi.fn() as never;
    const view = render(
      <PlannerMap
        scene={scene()}
        onIntent={onIntent}
        hostFactory={factory.factory}
        activeTool="pan"
        fitKey="route-1"
      />,
    );
    await settle();
    view.rerender(
      <PlannerMap
        scene={scene()}
        onIntent={onIntent}
        hostFactory={factory.factory}
        activeTool="pan"
        fitKey={null}
      />,
    );
    view.rerender(
      <PlannerMap
        scene={scene()}
        onIntent={onIntent}
        hostFactory={factory.factory}
        activeTool="pan"
        fitKey="route-1"
      />,
    );

    // "Show whole ride" clears the suspension (05 §8), and the same key must then
    // fit again rather than be treated as already applied.
    expect(factory.hosts[0]?.fits).toHaveLength(2);
  });
});

/**
 * The seam's two remaining obligations (05 §4, §22): a renderer failure goes up
 * to the workspace, and Escape goes to the UI state machine *and* into the
 * interaction machine. Neither is a renderer decision, which is why they are the
 * component's job and not the host's.
 */
describe("renderer failures and Escape", () => {
  it("reports a host renderer failure to the workspace", async () => {
    const onRenderError = vi.fn();
    const { factory } = await renderMap({ onRenderError });

    factory.hosts[0]?.failWith({ kind: "style", detail: "Failed to load style" });

    expect(onRenderError).toHaveBeenCalledWith({
      kind: "style",
      detail: "Failed to load style",
    });
  });

  it("stops reporting after unmount", async () => {
    const onRenderError = vi.fn();
    const { factory } = await renderMap({ onRenderError });
    const host = factory.hosts[0];

    cleanup();
    host?.failWith({ kind: "worker", detail: null });

    // A disposed host has no listeners left, so the notice cannot outlive the map.
    expect(onRenderError).not.toHaveBeenCalled();
  });

  it("relays Escape to the interaction machine and to the workspace", async () => {
    const onEscape = vi.fn();
    const { factory } = await renderMap({ onEscape });

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    // The workspace owns the armed placement; the host must still hear about it so
    // an in-flight gesture cannot commit after the rider pressed Escape.
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(factory.hosts[0]?.events).toContainEqual({ type: "escape" });
  });

  it("ignores every other key", async () => {
    const onEscape = vi.fn();
    const { factory } = await renderMap({ onEscape });

    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "s" });

    expect(onEscape).not.toHaveBeenCalled();
    expect(factory.hosts[0]?.events).not.toContainEqual({ type: "escape" });
  });
});

describe("the deployment prefix", () => {
  it("passes the asset base path into the host options", async () => {
    const { factory } = await renderMap({ assetBasePath: "/ogv" });

    expect(factory.options[0]?.assetBasePath).toBe("/ogv");
  });

  it("leaves the option unset when the composition has no prefix", async () => {
    const { factory } = await renderMap();

    expect(factory.options[0]?.assetBasePath).toBeUndefined();
  });
});

describe("the overlay hint", () => {
  it("renders as an instruction note, never as a control", async () => {
    await renderMap({ hint: "Tap the map to set your start." });

    const hint = screen.getByTestId("map-hint");
    expect(hint).toHaveTextContent("Tap the map to set your start.");
    // 12 §16/§20: an instruction is not a control — no button role, no action.
    // (The map's own camera controls are buttons; the instruction is not one of
    // them, and nothing offers to "perform" the instruction.)
    expect(hint).toHaveRole("note");
    expect(hint.tagName).not.toBe("BUTTON");
    expect(screen.queryByRole("button", { name: /set your start/i })).toBeNull();
  });

  it("renders no hint when the workspace supplies none", async () => {
    await renderMap();
    expect(screen.queryByTestId("map-hint")).not.toBeInTheDocument();
  });
});

describe("load health and recovery (4.0s)", () => {
  it("reports the host's load status, including the state that already holds", async () => {
    const onLoadStatus = vi.fn();
    const { factory } = await renderMap({ onLoadStatus: onLoadStatus as never });
    const host = factory.hosts[0];
    if (host === undefined) throw new Error("the surface never created a host");

    // The host replays `loading` at subscription time: a subscriber must never
    // have to guess, and the workspace's default is not evidence either.
    expect(onLoadStatus).toHaveBeenCalledWith({ state: "loading", reason: null });

    act(() => {
      host.reportStatus({ state: "ready", reason: null });
    });
    expect(onLoadStatus).toHaveBeenLastCalledWith({ state: "ready", reason: null });
  });

  it("asks the one live host for a retry when the workspace bumps the retry token", async () => {
    const factory = createStubMapHostFactory();
    const shared = {
      scene: scene(),
      onIntent: vi.fn() as never,
      hostFactory: factory.factory,
      activeTool: "pan" as const,
    };
    const view = render(<PlannerMap {...shared} retryToken={0} />);
    await settle();
    const host = factory.hosts[0];
    if (host === undefined) throw new Error("the surface never created a host");
    expect(host.retries).toBe(0);

    // The workspace owns the action and the token is how it reaches the host
    // (05 §8's fit pattern): one bump, one `retry()` call on the live host.
    await act(async () => {
      view.rerender(<PlannerMap {...shared} retryToken={1} />);
    });
    expect(host.retries).toBe(1);
    // Asking again is another request, and still the same host: a retry is a
    // renderer rebuild, never a second map surface.
    await act(async () => {
      view.rerender(<PlannerMap {...shared} retryToken={2} />);
    });
    expect(host.retries).toBe(2);
    expect(factory.hosts).toHaveLength(1);
  });

  it("does not retry for the initial token value", async () => {
    const { factory } = await renderMap({ retryToken: 0 });
    expect(factory.hosts[0]?.retries).toBe(0);
  });

  it("asks the same host for the recovery: never a second map", async () => {
    const factory = createStubMapHostFactory();
    const shared = {
      scene: scene(),
      onIntent: vi.fn() as never,
      hostFactory: factory.factory,
      activeTool: "pan" as const,
    };
    const view = render(<PlannerMap {...shared} retryToken={0} />);
    await settle();
    const host = factory.hosts[0];
    if (host === undefined) throw new Error("the surface never created a host");

    act(() => {
      host.reportStatus({ state: "failed", reason: "tile" });
    });
    view.rerender(<PlannerMap {...shared} retryToken={1} />);
    await settle();

    // A recovery is a renderer rebuild inside the host, never a second surface:
    // one host, one map container, one retry.
    expect(factory.hosts).toHaveLength(1);
    expect(screen.getAllByTestId("planner-map")).toHaveLength(1);
    expect(host.retries).toBe(1);
  });
});

describe("satellite imagery (M3, OGV-D-265)", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("offers Map / Satellite only on a host that can draw it, and remembers the choice", async () => {
    const plain = await renderMap();
    expect(plain.factory.hosts).toHaveLength(1);
    expect(screen.queryByTestId("map-satellite-toggle")).toBeNull();
    cleanup();

    const base = createStubMapHostFactory();
    const setSatellite = vi.fn();
    render(
      <PlannerMap
        scene={scene()}
        onIntent={vi.fn() as never}
        hostFactory={(container, options) =>
          Object.assign(base.factory(container, options), { supportsSatellite: true, setSatellite })
        }
        activeTool="pan"
      />,
    );
    await act(async () => {
      await settle();
    });
    const toggle = screen.getByTestId("map-satellite-toggle");
    expect(toggle).toHaveTextContent("Map");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    // No Night contrast on this host: the menu offers Map and Satellite only.
    expect(screen.queryByTestId("map-look-night")).toBeNull();
    expect(screen.getByTestId("map-look-map")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByTestId("map-look-satellite"));
    expect(setSatellite).toHaveBeenLastCalledWith(true);
    expect(toggle).toHaveTextContent("Satellite");
    expect(screen.queryByTestId("map-look-menu")).toBeNull();
    expect(window.localStorage.getItem("opengravel-vnext-satellite")).toBe("1");
    expect(window.localStorage.getItem("opengravel-basemap-look")).toBe("satellite");
  });

  it("draws the dark basemap whenever the theme is Night, and keeps Night out of the map menu", async () => {
    // DESIGN.md §3 (v3): Night is a theme, not a map choice. Under Night every
    // look sits on the dark basemap; satellite still draws over it.
    const base = createStubMapHostFactory();
    const setSatellite = vi.fn();
    const setBasemapLook = vi.fn();
    const seen: unknown[] = [];
    const factory = (container: HTMLElement, options: Parameters<typeof base.factory>[1]) => {
      seen.push(options.basemapLook);
      return Object.assign(base.factory(container, options), {
        supportsSatellite: true,
        supportsNightLook: true,
        setSatellite,
        setBasemapLook,
      });
    };
    applyResolvedTheme("night");
    try {
      render(<PlannerMap scene={scene()} onIntent={vi.fn() as never} hostFactory={factory as never} activeTool="pan" />);
      await act(async () => {
        await settle();
      });
      // The map opens dark from its first frame.
      expect(seen.at(-1)).toBe("night");
      fireEvent.click(screen.getByTestId("map-satellite-toggle"));
      expect(screen.queryByTestId("map-look-night")).toBeNull();
      fireEvent.click(screen.getByTestId("map-look-satellite"));
      expect(setSatellite).toHaveBeenLastCalledWith(true);
      expect(setBasemapLook).toHaveBeenLastCalledWith("night");
      // Back to Map: still the dark basemap while the theme is Night.
      fireEvent.click(screen.getByTestId("map-satellite-toggle"));
      fireEvent.click(screen.getByTestId("map-look-map"));
      expect(setSatellite).toHaveBeenLastCalledWith(false);
      expect(setBasemapLook).toHaveBeenLastCalledWith("night");

      // The sun comes up: the same map turns light, the rider's look is kept.
      act(() => {
        applyResolvedTheme("day");
      });
      await act(settle);
      expect(setBasemapLook).toHaveBeenLastCalledWith("map");
    } finally {
      applyResolvedTheme("day");
    }
  });
});

describe("a look the layers sheet owns", () => {
  it("reports the looks the host can draw and applies the chosen one", async () => {
    const base = createStubMapHostFactory();
    const setSatellite = vi.fn();
    const setBasemapLook = vi.fn();
    const onLookOptions = vi.fn();
    const onLookChange = vi.fn();
    const factory = (container: HTMLElement, options: Parameters<typeof base.factory>[1]) =>
      Object.assign(base.factory(container, options), {
        supportsSatellite: true,
        supportsNightLook: true,
        setSatellite,
        setBasemapLook,
      });
    const props = {
      scene: scene(),
      onIntent: (() => undefined) as never,
      activeTool: "pan" as const,
      hostFactory: factory as never,
      onLookOptions,
      onLookChange,
    };
    const view = render(<PlannerMap {...props} look="map" />);
    await act(settle);
    // Night is the theme's job, so the sheet is offered Map and Satellite.
    expect(onLookOptions).toHaveBeenLastCalledWith(["map", "satellite"]);
    expect(onLookChange).not.toHaveBeenCalled();

    view.rerender(<PlannerMap {...props} look="satellite" />);
    await act(settle);
    expect(setSatellite).toHaveBeenLastCalledWith(true);
    // A sheet-owned choice is not written back as the rider's preference here.
    expect(window.localStorage.getItem("opengravel-basemap-look")).toBeNull();
    view.unmount();
  });
});

describe("a surface that insists on a look (the ride follows Day/Night)", () => {
  const props = {
    scene: scene(),
    onIntent: (() => undefined) as never,
    activeTool: "pan" as const,
  };

  it("opens dark without reading or writing the rider's planner look", async () => {
    const base = createStubMapHostFactory();
    const opened: unknown[] = [];
    const factory = (container: HTMLElement, options: Parameters<typeof base.factory>[1]) => {
      opened.push(options.basemapLook);
      return Object.assign(base.factory(container, options), { supportsNightLook: true });
    };
    // The planner's own last choice is satellite; the ride must not inherit it.
    window.localStorage.setItem("opengravel-basemap-look", "satellite");

    const view = render(<PlannerMap {...props} hostFactory={factory as never} forcedLook="night" />);
    await act(settle);

    expect(opened.at(-1)).toBe("night");
    expect(window.localStorage.getItem("opengravel-basemap-look")).toBe("satellite");

    // The sun comes up: the same mounted map turns with the chrome.
    const setBasemapLook = vi.fn();
    const host = base.hosts.at(-1);
    if (host === undefined) throw new Error("no host");
    Object.assign(host, { setBasemapLook });
    view.rerender(<PlannerMap {...props} hostFactory={factory as never} forcedLook="map" />);
    await act(settle);
    expect(setBasemapLook).toHaveBeenLastCalledWith("map");
    expect(window.localStorage.getItem("opengravel-basemap-look")).toBe("satellite");
    view.unmount();
    window.localStorage.clear();
  });
});

describe("the map point menu", () => {
  const press = { type: "map-long-press", coordinate: { lon: -75.2, lat: 39.95 }, pixel: { x: 100, y: 100 }, authorityFeatureId: null } as const;

  it("offers all five rows at 48 px minimum and an inline disabled reason", async () => {
    const style = document.createElement("style");
    style.textContent = `.og-map-point-menu__row {${cssRuleRaw(".og-map-point-menu__row")}}`;
    document.head.append(style);
    try {
      const { factory } = await renderMap({ onPointAction: vi.fn(), addStopDisabledReason: "plan a start and finish first" });
      act(() => factory.hosts[0]?.emit(press));
      const buttons = screen.getByRole("dialog", { name: "Plan here" }).querySelectorAll("button");
      expect(buttons).toHaveLength(5);
      for (const button of buttons) {
        expect(getComputedStyle(button).minHeight).toBe("48px");
        expect(button.querySelector("svg")).toHaveAttribute("width", "20");
      }
      expect(screen.getByRole("button", { name: /Add stop here — plan a start and finish first/ })).toBeDisabled();
    } finally { style.remove(); }
  });

  it("hands What's here to the place sheet without a ride edit", async () => {
    const onPointAction = vi.fn();
    const { factory, onIntent } = await renderMap({ onPointAction });
    act(() => factory.hosts[0]?.emit(press));
    fireEvent.click(screen.getByRole("button", { name: "What's here?" }));
    expect(onPointAction).toHaveBeenCalledWith("info", press.coordinate);
    expect(screen.queryByTestId("map-point-menu")).toBeNull();
    expect(onIntent).not.toHaveBeenCalled();
  });

  it.each([ ["Start here", "start"], ["Add stop here", "stop"], ["Finish here", "finish"], ["Loop from here", "loop"] ])("dispatches %s at the original press coordinate", async (label, action) => {
    const onPointAction = vi.fn();
    const { factory } = await renderMap({ onPointAction });
    act(() => factory.hosts[0]?.emit(press));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onPointAction).toHaveBeenCalledExactlyOnceWith(action, press.coordinate);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses on outside press and Escape", async () => {
    const { factory } = await renderMap({ onPointAction: vi.fn() });
    act(() => factory.hosts[0]?.emit(press));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => factory.hosts[0]?.emit(press));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables the reducer entry point when placement is armed", async () => {
    const { factory } = await renderMap({ onPointAction: vi.fn(), longPressEnabled: false });
    expect(factory.hosts[0]?.events).toContainEqual({ type: "long-press-enabled", enabled: false });
    act(() => factory.hosts[0]?.emit(press));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});


describe("map point evidence and positioning", () => {
  const press = { type: "map-long-press", coordinate: { lon: -75.2, lat: 39.95 }, pixel: { x: 950, y: 700 }, authorityFeatureId: null } as const;

  it("shows the road name and source only for a hit on a loaded authority feature", async () => {
    const base = scene(false);
    const onPointAction = vi.fn();
    const { factory } = await renderMap({ onPointAction, scene: { ...base, infoLayers: {
      trafficFlowTiles: null, selectedId: null, visible: ["mvum"], features: [{
        id: "authority:usfs:123", layerId: "mvum", name: "Forest Road 123", detail: "USFS MVUM · retrieved 2026-10-23 · dates unknown",
        weight: null, geometry: { type: "Point", coordinates: [-75.2, 39.95] },
      }],
    } } });
    act(() => factory.hosts[0]?.emit({ ...press, authorityFeatureId: "authority:usfs:123" }));
    fireEvent.click(screen.getByRole("button", { name: "What's here?" }));
    expect(onPointAction).toHaveBeenCalledWith("info", press.coordinate);
    expect(screen.queryByTestId("map-point-menu")).toBeNull();
  });

  it("flips a wide card left and up near the viewport edge", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const box = this.className === "og-map-point-menu"
        ? { left: 0, top: 0, width: 320, height: 260 }
        : { left: 20, top: 10, width: 1000, height: 750 };
      return { ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => ({}) } as DOMRect;
    });
    const previous = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    try {
      const { factory } = await renderMap({ onPointAction: vi.fn() });
      act(() => factory.hosts[0]?.emit(press));
      const menu = screen.getByRole("dialog");
      expect(menu.style.left).toBe("642px");
      expect(menu.style.top).toBe("442px");
    } finally { window.matchMedia = previous; }
  });

  it("keeps a wide card clear of the instrument column on the right edge", async () => {
    // The control column is live chrome (12 px inset + a 44 px button), so a card
    // pressed at the map's right edge must end before x = 1024 - 56 = 968 rather
    // than sitting under the compass and zoom buttons.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const box = this.className === "og-map-point-menu"
        ? { left: 0, top: 0, width: 320, height: 260 }
        : { left: 0, top: 0, width: 1024, height: 700 };
      return { ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => ({}) } as DOMRect;
    });
    const previous = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    try {
      const { factory } = await renderMap({ onPointAction: vi.fn() });
      act(() => factory.hosts[0]?.emit({ ...press, pixel: { x: 1000, y: 600 } }));
      const menu = screen.getByRole("dialog");
      expect(parseFloat(menu.style.left) + 320).toBeLessThanOrEqual(1024 - 56);
      expect(menu.style.left).toBe("648px");
    } finally { window.matchMedia = previous; }
  });

  it("places a compact sheet above the measured dock", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const box = this.className === "og-map-point-menu" ? { left: 0, top: 0, width: 366, height: 260 }
        : this.className === "og-planner__dock" ? { left: 0, top: 600, width: 390, height: 200 }
        : { left: 0, top: 0, width: 390, height: 800 };
      return { ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => ({}) } as DOMRect;
    });
    const previous = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    try {
      const factory = createStubMapHostFactory();
      render(<main className="og-planner"><PlannerMap scene={scene()} activeTool="pan" hostFactory={factory.factory} onIntent={vi.fn()} onPointAction={vi.fn()} /><div className="og-planner__dock" /></main>);
      await settle();
      act(() => factory.hosts[0]?.emit(press));
      const menu = screen.getByRole("dialog");
      expect(menu.style.top).toBe("332px");
      expect(menu.style.left).toBe("12px");
      expect(menu.style.width).toBe("366px");
    } finally { window.matchMedia = previous; }
  });
});


it("closes the menu on tool and revision changes without restoring an old menu", async () => {
  const factory = createStubMapHostFactory();
  const props = { scene: scene(), hostFactory: factory.factory, onIntent: vi.fn(), onPointAction: vi.fn() };
  const view = render(<PlannerMap {...props} activeTool="pan" rideRevision={0} />);
  await settle();
  const press = { type: "map-long-press", coordinate: { lon: -75.2, lat: 39.95 }, pixel: { x: 100, y: 100 }, authorityFeatureId: null } as const;
  act(() => factory.hosts[0]?.emit(press));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  view.rerender(<PlannerMap {...props} activeTool="sketch" rideRevision={0} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  view.rerender(<PlannerMap {...props} activeTool="pan" rideRevision={0} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  act(() => factory.hosts[0]?.emit(press));
  view.rerender(<PlannerMap {...props} activeTool="pan" rideRevision={1} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
describe("the map's instruments (05 §9)", () => {
  /** The one live host of the rendered surface. */
  function hostOf(factory: StubMapHostFactory) {
    const host = factory.hosts[0];
    if (host === undefined) throw new Error("expected a host");
    return host;
  }

  it("states the rotation in the compass's accessible name and faces north on a tap", async () => {
    const { factory } = await renderMap();
    const host = hostOf(factory);

    // The host is the authority on the bearing; the compass reads it, it does not
    // guess. 42 degrees clockwise from north is the top of the screen pointing east.
    act(() => {
      host.reportCamera({ bearing: 42, zoom: 14, minZoom: 0, maxZoom: 22, metersPerPixel: 4.8 });
    });
    const compass = screen.getByRole("button", {
      name: "Face north. Map is rotated 42 degrees east.",
    });
    expect(compass).toHaveAttribute("data-visible", "true");

    fireEvent.click(compass);
    expect(host.northResets).toBe(1);
    // The double eases north like the real map, so the hidden state follows.
    expect(screen.getByTestId("map-compass")).toHaveAttribute("data-visible", "false");
  });

  it("hides the compass while the map is north-up and keeps it out of the tab order", async () => {
    const { factory } = await renderMap();
    act(() => {
      hostOf(factory).reportCamera({ bearing: 0, zoom: 12, minZoom: 0, maxZoom: 22, metersPerPixel: 38 });
    });

    const compass = screen.getByTestId("map-compass");
    expect(compass).toHaveAttribute("data-visible", "false");
    expect(compass).toHaveAttribute("aria-hidden", "true");
    expect(compass).toHaveAttribute("tabindex", "-1");
    // Hidden from assistive tech, so it is not a control a rider can find.
    expect(screen.queryByRole("button", { name: /Face north/ })).toBeNull();
  });

  it("zooms one level per press, and says when the renderer's limit is reached", async () => {
    const { factory } = await renderMap();
    const host = hostOf(factory);

    // Before the camera arrives nothing claims a limit: unknown is not "at the end".
    expect(screen.getByRole("button", { name: "Zoom in" })).not.toHaveAttribute("aria-disabled");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(host.zooms).toEqual([1, -1]);

    act(() => {
      host.reportCamera({
        bearing: 0,
        zoom: 22,
        minZoom: 0,
        maxZoom: 22,
        metersPerPixel: 0.02,
      });
    });
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    expect(zoomIn).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(zoomIn);
    // Disabled means no further zoom, not a silent extra level.
    expect(host.zooms).toEqual([1, -1]);
  });

  it("draws the scale rule from the camera's metres per pixel", async () => {
    const { factory } = await renderMap();
    act(() => {
      hostOf(factory).reportCamera({ bearing: 0, zoom: 15, minZoom: 0, maxZoom: 22, metersPerPixel: 4.8 });
    });

    // 88 px at 4.8 m/px is 422 m (~1,386 ft); the largest 1-2-5 step that fits
    // is 1,000 ft, which draws 63.5 px wide.
    const scale = screen.getByTestId("map-scale");
    expect(scale).toHaveAccessibleName("Map scale: 1,000 ft");
    expect(scale.style.getPropertyValue("--og-scale-width")).toBe("63.5px");
  });

  it("draws no scale rule while the camera's scale is unknown", async () => {
    const { factory } = await renderMap();
    act(() => {
      hostOf(factory).reportCamera({
        bearing: 0,
        zoom: 12,
        minZoom: 0,
        maxZoom: 22,
        metersPerPixel: Number.NaN,
      });
    });

    expect(screen.queryByTestId("map-scale")).toBeNull();
  });
});
