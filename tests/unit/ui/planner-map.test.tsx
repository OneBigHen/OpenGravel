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
    expect(hint).toHaveRole("note");
    expect(hint.tagName).not.toBe("BUTTON");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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
    expect(toggle).toHaveTextContent("Satellite");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(setSatellite).toHaveBeenLastCalledWith(true);
    expect(toggle).toHaveTextContent("Map");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("opengravel-vnext-satellite")).toBe("1");
  });
});
