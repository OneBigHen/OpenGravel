/**
 * The real MapLibre host, against a fake `maplibre-gl` module (4.0 review finding
 * 11; 05 §2–§9, §22).
 *
 * The review's sharpest finding was not a bug but a *testing* gap: every other map
 * test in this repository exercises a pure function or an injected stub, so the
 * concrete `MapLibreHost` — the code that actually adds sources, syncs scenes,
 * publishes attributes and translates renderer failures — would stay green if it
 * were replaced by a no-op. jsdom cannot provide WebGL, but it does not need to:
 * the host talks to MapLibre through a small structural surface (`on`, `addSource`,
 * `addLayer`, `setData`, `queryRenderedFeatures`, `project`, `unproject`,
 * `fitBounds`, `remove`), so a fake module injected at the factory seam runs the
 * *real* host code without a network, a canvas or a tile.
 *
 * What is asserted here is therefore the behaviour the browser gate and the rider
 * depend on: the sources and layers that get added, the per-part scene diff, the
 * machine-readable failure attributes, the pointer-stream contract (streams only
 * while a drawing tool owns the pointer), the escape/cancel path, and the degraded
 * host for a device without WebGL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MapHost } from "@/application/map/map-host";
import type { MapIntent, MapScene } from "@/application/map/types";
import { asRouteCandidateId } from "@/domain/route/ids";
import type { PointId } from "@/domain/ride/ids";
import {
  BOOT_WATCHDOG_MS,
  MAP_ATTEMPT_CLASS,
  MAP_BASEMAP_ATTRIBUTE,
  MAP_ERROR_ATTRIBUTE,
  MAP_LAYER_ERROR_ATTRIBUTE,
  MAP_LOAD_ATTRIBUTE,
  MAP_LOAD_REASON_ATTRIBUTE,
  MAP_SCENE_ATTRIBUTE,
  MAX_AUTOMATIC_RETRIES,
  TILE_STARVATION_MS,
  classifyMapError,
  createMapLibreHost,
} from "@/infrastructure/map/maplibre/host";
import {
  DEFAULT_MAP_PALETTE,
  MAP_LAYER_IDS,
  MAP_SOURCE_IDS,
  overlayLayers,
} from "@/infrastructure/map/maplibre/style";
import { asPlaceId } from "@/application/places/types";

/** Every knob the fake renderer needs, plus what it observed. */
interface FakeRenderer {
  readonly state: {
    instances: FakeMapInstance[];
    /** Every option object the renderer was constructed with, in order. */
    constructorOptions: Record<string, unknown>[];
    workerUrls: string[];
    constructorError: Error | null;
    throwOnSource: string | null;
    throwOnLayer: string | null;
    dataWrites: { source: string; data: unknown }[];
    removals: number;
    /** Pointer ids the host asked to capture, in order. */
    captures: number[];
    /** What the next hit test returns, so a tap can resolve to an object. */
    queryFeatures: readonly unknown[];
    /** Glyph endpoint reported by the current basemap style, if any. */
    glyphs: string | null;
    /** Image ids passed to MapLibre across style loads and retries. */
    imageAdds: string[];
    /** Terrain writes made by the host. */
    terrainCalls: unknown[];
    /** Camera animations requested by the host. */
    easeCalls: Record<string, unknown>[];
  };
  readonly Map: new (options: Record<string, unknown>) => FakeMapInstance;
  setWorkerUrl(url: string): void;
}

interface FakeMapInstance {
  readonly sources: Map<string, Record<string, unknown>>;
  readonly layers: Set<string>;
  readonly images: Set<string>;
  readonly fits: Record<string, unknown>[];
  fire(event: string, payload?: unknown): void;
  resetStyle(): void;
  getBounds(): { toArray(): readonly (readonly [number, number])[] };
  getCanvas(): HTMLCanvasElement;
  getCanvasContainer(): HTMLElement;
}

/**
 * The fake module is hoisted above the imports because `vi.mock` must be, and the
 * host imports `maplibre-gl` dynamically — which is exactly why this seam works
 * without touching the host's own code.
 */
const fake = vi.hoisted((): FakeRenderer => {
  interface Listener {
    (payload: unknown): void;
  }

  const state: FakeRenderer["state"] = {
    instances: [],
    constructorOptions: [],
    workerUrls: [],
    constructorError: null,
    throwOnSource: null,
    throwOnLayer: null,
    dataWrites: [],
    removals: 0,
    captures: [],
    queryFeatures: [],
    glyphs: null,
    imageAdds: [],
    terrainCalls: [],
    easeCalls: [],
  };

  class FakeMap implements FakeMapInstance {
    readonly sources = new Map<string, Record<string, unknown>>();
    readonly layers = new Set<string>();
    readonly images = new Set<string>();
    readonly fits: Record<string, unknown>[] = [];
    private readonly listeners = new Map<string, Set<Listener>>();
    private readonly container: HTMLElement;
    private readonly canvas = document.createElement("canvas");
    private readonly canvasContainer = document.createElement("div");

    constructor(options: Record<string, unknown>) {
      // Recorded before the injected failure: a start that throws is exactly the
      // case the resilience tests have to count.
      state.constructorOptions.push(options);
      if (state.constructorError !== null) throw state.constructorError;
      this.container = options["container"] as HTMLElement;
      this.container.appendChild(this.canvasContainer);
      // jsdom has no pointer capture, and the host is written to tolerate that.
      // Recording it here is what lets a test prove the host asks for it.
      this.canvasContainer.setPointerCapture = (pointerId: number): void => {
        state.captures.push(pointerId);
      };
      state.instances.push(this);
    }

    on(event: string, listener: Listener): void {
      const set = this.listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      this.listeners.set(event, set);
    }

    off(event: string, listener: Listener): void {
      this.listeners.get(event)?.delete(listener);
    }

    fire(event: string, payload?: unknown): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload);
    }

    resetStyle(): void {
      this.sources.clear();
      this.layers.clear();
      this.images.clear();
    }

    getCanvas(): HTMLCanvasElement {
      return this.canvas;
    }

    getCanvasContainer(): HTMLElement {
      return this.canvasContainer;
    }

    getContainer(): HTMLElement {
      return this.container;
    }

    getBounds(): { toArray(): readonly (readonly [number, number])[] } {
      return {
        toArray: (): readonly (readonly [number, number])[] => [
          [-75.3, 39.9],
          [-74.9, 40.2],
        ],
      };
    }

    getStyle(): { readonly glyphs?: string } {
      return state.glyphs === null ? {} : { glyphs: state.glyphs };
    }

    project(): { x: number; y: number } {
      return { x: 10, y: 20 };
    }

    unproject(): { lng: number; lat: number } {
      return { lng: -75.25, lat: 39.97 };
    }

    addSource(id: string, source: Record<string, unknown>): void {
      if (state.throwOnSource === id) throw new Error(`source ${id} could not be added`);
      this.sources.set(id, source);
    }

    getSource(id: string): { setData(data: unknown): void } | undefined {
      if (!this.sources.has(id)) return undefined;
      return {
        setData: (data: unknown): void => {
          state.dataWrites.push({ source: id, data });
        },
      };
    }

    addLayer(layer: unknown): void {
      const id = (layer as { id: string }).id;
      if (state.throwOnLayer === id) throw new Error(`layer ${id} could not be added`);
      this.layers.add(id);
    }

    addImage(name: string): void {
      state.imageAdds.push(name);
      this.images.add(name);
    }

    hasImage(name: string): boolean {
      return this.images.has(name);
    }

    getLayer(id: string): unknown {
      return this.layers.has(id) ? { id } : undefined;
    }

    setTerrain(terrain: unknown): void {
      state.terrainCalls.push(terrain);
    }

    easeTo(options: Record<string, unknown>): void {
      state.easeCalls.push(options);
    }

    moveLayer(): void {}
    removeLayer(): void {}
    removeSource(): void {}

    queryRenderedFeatures(
      _point: readonly [number, number] | { x: number; y: number },
      options?: { layers?: readonly string[] },
    ): readonly unknown[] {
      if (options?.layers === undefined) return state.queryFeatures;
      return state.queryFeatures.filter((hit) =>
        options.layers?.includes((hit as { layer: { id: string } }).layer.id),
      );
    }

    fitBounds(
      bounds: readonly [readonly [number, number], readonly [number, number]],
      options?: Record<string, unknown>,
    ): void {
      this.fits.push({ bounds, options });
    }

    remove(): void {
      state.removals += 1;
    }
  }

  return {
    state,
    Map: FakeMap,
    setWorkerUrl: (url: string): void => {
      state.workerUrls.push(url);
    },
  };
});

vi.mock("maplibre-gl", () => ({
  Map: fake.Map,
  setWorkerUrl: fake.setWorkerUrl,
}));

const OPTIONS = {
  basemap: "empty" as const,
  initialExtent: { minLon: -76, minLat: 39, maxLon: -74, maxLat: 41 },
};

const COORDINATE = { lon: -75.25, lat: 39.97 };
const ROUTE_ID = asRouteCandidateId("route_a");

function scene(overrides: Partial<MapScene> = {}): MapScene {
  return {
    mode: "plan",
    routes: [
      {
        id: ROUTE_ID,
        role: "best-ride",
        geometry: [COORDINATE, { lon: -75.1, lat: 40.0 }],
        state: "selected",
      },
    ],
    selectedRouteId: ROUTE_ID,
    points: [
      {
        id: "pt_start" as PointId,
        kind: "start",
        coordinate: COORDINATE,
        label: null,
      },
    ],
    preview: null,
    avoidAreas: [],
    roadSpans: [],
    sketch: null,
    avoidHandles: [],
    previewArea: null,
    selectedObject: null,
    ...overrides,
  };
}

function container(): HTMLElement {
  const element = document.createElement("div");
  // jsdom has no layout, so the camera-fit insets would clamp to zero on a
  // zero-sized element; the host's own clamp is what reads these.
  Object.defineProperty(element, "clientWidth", { value: 1000, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: 800, configurable: true });
  document.body.appendChild(element);
  return element;
}

/** The map the most recent host created. */
function currentMap(): FakeMapInstance {
  const map = fake.state.instances[fake.state.instances.length - 1];
  if (map === undefined) throw new Error("the host never created a map");
  return map;
}

/** A pointer event jsdom can dispatch; `pointerId` is set explicitly because the
 * `PointerEvent` constructor does not always carry it. */
function pointerEvent(
  type: string,
  init: { readonly x: number; readonly y: number; readonly pointerId?: number },
): PointerEvent {
  const event = new PointerEvent(type, {
    clientX: init.x,
    clientY: init.y,
    button: 0,
    bubbles: true,
  });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  return event;
}

/** Records every intent the host emits, in order. */
function recordIntents(host: MapHost): MapIntent[] {
  const intents: MapIntent[] = [];
  host.onIntent((intent: MapIntent): void => {
    intents.push(intent);
  });
  return intents;
}

afterEach(() => {
  fake.state.instances.length = 0;
  fake.state.constructorOptions.length = 0;
  fake.state.workerUrls.length = 0;
  fake.state.constructorError = null;
  fake.state.throwOnSource = null;
  fake.state.throwOnLayer = null;
  fake.state.dataWrites.length = 0;
  fake.state.removals = 0;
  fake.state.captures = [];
  fake.state.queryFeatures = [];
  fake.state.glyphs = null;
  fake.state.imageAdds = [];
  fake.state.terrainCalls = [];
  fake.state.easeCalls = [];
  document.body.innerHTML = "";
});

describe("MapLibreHost — the real host against a fake renderer", () => {
  it("adds every source and overlay layer once the style loads", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    const map = currentMap();

    // Nothing is added before the style exists: MapLibre rejects a layer whose
    // source is missing, and a rejected layer never comes back.
    expect(map.sources.size).toBe(0);
    expect(element.getAttribute(MAP_BASEMAP_ATTRIBUTE)).toBe("empty");

    map.fire("load");

    expect([...map.sources.keys()].sort()).toEqual(
      [...Object.values(MAP_SOURCE_IDS)].sort(),
    );
    for (const layer of overlayLayers(DEFAULT_MAP_PALETTE)) {
      // Text layers wait for the basemap's glyphs, which this fake has none of.
      if (layer.type === "symbol" && (layer.source === MAP_SOURCE_IDS.places || layer.source === MAP_SOURCE_IDS.infoLayers || layer.source === MAP_SOURCE_IDS.routes)) continue;
      expect(map.layers.has(layer.id), layer.id).toBe(true);
    }
    expect(map.layers.has(MAP_LAYER_IDS.placeDot)).toBe(true);
    expect(map.layers.has(MAP_LAYER_IDS.placePill)).toBe(false);
    expect(map.layers.has(MAP_LAYER_IDS.placeSelected)).toBe(false);
    // The camera is published too, which is what the browser gate clicks against.
    expect(element.getAttribute("data-map-extent")).toBeTruthy();

    host.dispose();
  });

  it("adds stretchable pill images only when the basemap exposes glyphs and restores them on style reload", async () => {
    fake.state.glyphs = "https://tiles.example/fonts/{fontstack}/{range}.pbf";
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    const map = currentMap();
    map.fire("load");

    // Eight pill images and the rider's heading arrow.
    expect(map.images.size).toBe(9);
    expect(map.layers.has(MAP_LAYER_IDS.placePill)).toBe(true);
    expect(map.layers.has(MAP_LAYER_IDS.placeSelected)).toBe(true);
    expect(map.layers.has(MAP_LAYER_IDS.riderHeading)).toBe(true);
    const firstImageAdds = fake.state.imageAdds.length;

    map.resetStyle();
    map.fire("style.load");

    expect(fake.state.imageAdds).toHaveLength(firstImageAdds * 2);
    expect(map.images.size).toBe(9);
    expect(map.layers.has(MAP_LAYER_IDS.placePill)).toBe(true);
    host.dispose();
  });

  it("changes terrain detail without taking ownership of the camera", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    const map = currentMap();
    map.fire("load");

    host.setTerrain3d?.(true);

    expect(map.sources.get("og-terrain-dem")).toMatchObject({
      type: "raster-dem",
      encoding: "terrarium",
    });
    expect(fake.state.terrainCalls.at(-1)).toEqual({
      source: "og-terrain-dem",
      exaggeration: 1.1,
    });
    expect(fake.state.easeCalls).toEqual([]);

    host.setTerrain3d?.(false);

    expect(fake.state.terrainCalls.at(-1)).toBeNull();
    expect(fake.state.easeCalls).toEqual([]);

    host.dispose();
  });

  it("registers the vendored worker at the normalized asset path", async () => {
    const element = container();
    const host = await createMapLibreHost(element, { ...OPTIONS, assetBasePath: "ogv/" });

    // A prefix without its leading slash is the shape that silently 404s in a
    // deployment; the host must join a root-relative URL (4.0 review finding 2).
    expect(fake.state.workerUrls.at(-1)).toBe(
      "/ogv/vendor/maplibre/maplibre-gl-worker.mjs",
    );

    host.dispose();
  });

  it("serves the worker from the origin root when no prefix is set", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);

    expect(fake.state.workerUrls.at(-1)).toBe("/vendor/maplibre/maplibre-gl-worker.mjs");

    host.dispose();
  });

  it("holds a scene until the style is ready, then applies it once", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    const map = currentMap();

    host.applyScene(scene());
    expect(fake.state.dataWrites).toHaveLength(0);

    map.fire("load");

    const written = fake.state.dataWrites.map((entry) => entry.source);
    expect(written).toContain(MAP_SOURCE_IDS.routes);
    expect(written).toContain(MAP_SOURCE_IDS.points);
    expect(element.getAttribute(MAP_SCENE_ATTRIBUTE)).toContain("routes:1");
    expect(element.getAttribute(MAP_SCENE_ATTRIBUTE)).toContain("points:1");
    expect(element.getAttribute(MAP_SCENE_ATTRIBUTE)).toContain(`selected:${ROUTE_ID}`);

    host.dispose();
  });

  it("updates the places source without re-uploading routes", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    const map = currentMap();
    map.fire("load");
    host.applyScene(scene());
    fake.state.dataWrites.length = 0;

    host.applyScene(scene({
      places: [{
        id: asPlaceId("hh:venue-1"),
        kind: "happy_hour",
        coordinate: COORDINATE,
        pill: "$3 · til 10p",
        tone: "live",
        priority: 325,
        selected: false,
      }],
    }));

    expect(fake.state.dataWrites.map((entry) => entry.source)).toEqual([MAP_SOURCE_IDS.places]);

    host.dispose();
  });

  it("re-sets only the source a selection change can affect", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    const map = currentMap();
    map.fire("load");
    host.applyScene(scene());
    fake.state.dataWrites.length = 0;

    // Selecting the stop re-writes the points source only: the highlight is a
    // feature property, so re-uploading the route geometry would be waste.
    host.applyScene(
      scene({ selectedObject: { kind: "stop", stopId: "stop_1" as never } }),
    );

    expect(fake.state.dataWrites.map((entry) => entry.source)).toEqual([
      MAP_SOURCE_IDS.points,
    ]);

    host.dispose();
  });

  it("draws the changed-span emphasis from its own source and retracts it at its deadline (05 §12)", async () => {
    vi.useFakeTimers();
    try {
      const element = container();
      const host = await createMapLibreHost(element, OPTIONS);
      const map = currentMap();
      map.fire("load");
      fake.state.dataWrites.length = 0;
      const untilIso = new Date(Date.now() + 5_000).toISOString();

      host.applyScene(
        scene({
          changedSpan: {
            coordinates: [COORDINATE, { lon: -75.1, lat: 40.0 }],
            untilIso,
          },
        }),
      );

      const write = fake.state.dataWrites.find(
        (entry) => entry.source === MAP_SOURCE_IDS.changedSpan,
      );
      expect(write).toBeDefined();
      expect(JSON.stringify(write?.data)).toContain("LineString");
      expect(element.getAttribute(MAP_SCENE_ATTRIBUTE)).toContain("changedSpan:1");
      // The emphasis is drawn above the selected route it annotates.
      expect(map.layers.has(MAP_LAYER_IDS.changedSpan)).toBe(true);
      const drawn = [...map.layers];
      expect(drawn.indexOf(MAP_LAYER_IDS.changedSpan)).toBeGreaterThan(
        drawn.indexOf(MAP_LAYER_IDS.routeSelected),
      );

      // The interval is the renderer's too: with no new scene at all, the emphasis
      // is retracted when its deadline passes, and the attribute stops claiming it.
      vi.advanceTimersByTime(5_500);
      expect(element.getAttribute(MAP_SCENE_ATTRIBUTE)).toContain("changedSpan:0");
      const emptied = fake.state.dataWrites
        .filter((entry) => entry.source === MAP_SOURCE_IDS.changedSpan)
        .pop();
      expect(JSON.stringify(emptied?.data)).toContain('"features":[]');

      host.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("publishes how much of the drawn scene is the previous answer (04 §9, §21)", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    const map = currentMap();
    map.fire("load");

    host.applyScene(
      scene({
        routes: [
          { id: ROUTE_ID, role: "best-ride", geometry: [COORDINATE, { lon: -75.1, lat: 40.0 }], state: "previous" },
          { id: asRouteCandidateId("route_b"), role: null, geometry: [COORDINATE, { lon: -75.05, lat: 40.02 }], state: "previous" },
        ],
      }),
    );

    const attribute = element.getAttribute(MAP_SCENE_ATTRIBUTE) ?? "";
    expect(attribute).toContain("previous:2");
    // Nothing is drawn as the rider's answer, so nothing is reported as selected.
    expect(attribute).toContain("selected:none");

    host.dispose();
  });

  it("draws nothing new when the scene did not change", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    const map = currentMap();
    map.fire("load");
    host.applyScene(scene());
    fake.state.dataWrites.length = 0;

    host.applyScene(scene());

    expect(fake.state.dataWrites).toHaveLength(0);

    host.dispose();
  });

  it("fits the camera with the measured insets, not a fixed reservation", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    const map = currentMap();
    map.fire("load");

    host.fitBounds(
      { minLon: -75.3, minLat: 39.9, maxLon: -74.9, maxLat: 40.2 },
      { top: 40, right: 0, bottom: 240, left: 12 },
    );

    const fit = map.fits.at(-1);
    expect(fit).toBeDefined();
    expect(fit?.options).toMatchObject({
      padding: { top: 40, right: 0, bottom: 240, left: 12 },
      maxZoom: 15,
    });

    host.dispose();
  });

  it("takes over a container that already has a map instead of stacking a second", async () => {
    const element = container();
    const first = await createMapLibreHost(element, OPTIONS);
    const second = await createMapLibreHost(element, OPTIONS);

    expect(fake.state.removals).toBe(1);
    first.dispose();
    expect(fake.state.removals).toBe(1);

    second.dispose();
    expect(fake.state.removals).toBe(2);
  });

  it("disposes idempotently and clears its published attributes", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    const map = currentMap();
    map.fire("load");

    host.dispose();
    host.dispose();

    expect(fake.state.removals).toBe(1);
    expect(element.getAttribute("data-map-extent")).toBeNull();
    expect(element.getAttribute("data-map-camera")).toBeNull();
  });
});

describe("MapLibreHost — renderer failures are never silent (4.0 review finding 1)", () => {
  async function loaded(): Promise<{
    readonly element: HTMLElement;
    readonly host: Awaited<ReturnType<typeof createMapLibreHost>>;
    readonly map: FakeMapInstance;
  }> {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    const map = currentMap();
    map.fire("load");
    return { element, host, map };
  }

  it("translates a renderer error event into a machine-readable attribute", async () => {
    const { element, host, map } = await loaded();
    const errors: unknown[] = [];
    host.onError?.((error) => errors.push(error));

    map.fire("error", { error: new Error("Failed to load style: fetch failed") });

    expect(element.getAttribute(MAP_ERROR_ATTRIBUTE)).toBe("style");
    expect(errors).toEqual([{ kind: "style", detail: "Failed to load style: fetch failed" }]);
    // 05 §22: the map is not blanked and nothing claims the ride is gone.
    expect(element.getAttribute(MAP_BASEMAP_ATTRIBUTE)).toBe("empty");

    host.dispose();
  });

  it("names the source of a source or tile failure and accumulates kinds", async () => {
    const { element, host, map } = await loaded();

    map.fire("error", { error: new Error("anything"), sourceId: MAP_SOURCE_IDS.routes });
    expect(element.getAttribute(MAP_ERROR_ATTRIBUTE)).toBe("source");

    map.fire("error", {
      error: new Error("anything"),
      sourceId: MAP_SOURCE_IDS.routes,
      tile: { x: 1, y: 2, z: 3 },
    });
    // Sorted and de-duplicated, so the attribute is a stable set, not a log.
    expect(element.getAttribute(MAP_ERROR_ATTRIBUTE)).toBe("source,tile");

    host.dispose();
  });

  it("reports each failure kind once, however many times it repeats", async () => {
    const { host, map } = await loaded();
    const errors: unknown[] = [];
    host.onError?.((error) => errors.push(error));

    map.fire("error", { error: new Error("worker failed") });
    map.fire("error", { error: new Error("worker failed again") });

    // The attribute accumulates kinds; the listener hears each kind once, so a
    // retrying renderer cannot re-render the notice on every frame.
    expect(errors).toEqual([{ kind: "worker", detail: "worker failed" }]);

    host.dispose();
  });

  it("reports a source that cannot be added instead of dropping it silently", async () => {
    fake.state.throwOnSource = MAP_SOURCE_IDS.routes;
    const { element, host, map } = await loaded();

    // The other sources still exist: one bad source must not take the rest down.
    expect(map.sources.has(MAP_SOURCE_IDS.points)).toBe(true);
    expect(map.sources.has(MAP_SOURCE_IDS.routes)).toBe(false);
    expect(element.getAttribute(MAP_ERROR_ATTRIBUTE)).toBe("source");

    host.dispose();
  });

  it("marks only the layer that failed", async () => {
    fake.state.throwOnLayer = MAP_LAYER_IDS.routeSelected;
    const { element, host, map } = await loaded();

    expect(map.layers.has(MAP_LAYER_IDS.routeAlternative)).toBe(true);
    expect(map.layers.has(MAP_LAYER_IDS.routeSelected)).toBe(false);
    expect(element.getAttribute(MAP_LAYER_ERROR_ATTRIBUTE)).toBe(
      MAP_LAYER_IDS.routeSelected,
    );

    host.dispose();
  });

  it("clears the layer error when no layer fails", async () => {
    const { element, host } = await loaded();

    expect(element.getAttribute(MAP_LAYER_ERROR_ATTRIBUTE)).toBeNull();

    host.dispose();
  });

  it("returns a degraded host when the renderer cannot start at all", async () => {
    fake.state.constructorError = new Error("Failed to initialize WebGL2 context");
    const element = container();

    const host = await createMapLibreHost(element, OPTIONS);

    expect(element.getAttribute(MAP_ERROR_ATTRIBUTE)).toBe("webgl-unavailable");
    // The notice must not wait for a future event that will never come.
    const errors: unknown[] = [];
    host.onError?.((error) => errors.push(error));
    expect(errors).toEqual([{ kind: "webgl-unavailable", detail: null }]);
    // Every method stays a no-op, so the planner keeps working without a canvas.
    expect(() => host.applyScene(scene())).not.toThrow();
    host.dispose();
    expect(element.getAttribute(MAP_ERROR_ATTRIBUTE)).toBeNull();
  });

  it("classifies the payloads MapLibre actually sends", () => {
    // The pure classifier, pinned: this is the table the attribute contract rests
    // on, and it is deliberately ordered (named source before message).
    expect(classifyMapError({ error: new Error("Failed to load style") })).toEqual({
      kind: "style",
      detail: "Failed to load style",
    });
    expect(classifyMapError({ error: new Error("worker blew up") })).toEqual({
      kind: "worker",
      detail: "worker blew up",
    });
    expect(classifyMapError({ error: "boom", sourceId: "ogv-points" })).toEqual({
      kind: "source",
      detail: "ogv-points",
    });
    expect(
      classifyMapError({ error: new Error("x"), sourceId: "ogv-points", tile: {} }),
    ).toEqual({ kind: "tile", detail: "ogv-points" });
    expect(classifyMapError({ error: new Error("tile 404") })).toEqual({
      kind: "tile",
      detail: "tile 404",
    });
    expect(classifyMapError({ error: new Error("geojson source failed") })).toEqual({
      kind: "source",
      detail: "geojson source failed",
    });
    expect(classifyMapError({ error: new Error("something else") })).toEqual({
      kind: "renderer",
      detail: "something else",
    });
    // Nothing to report: no error object at all.
    expect(classifyMapError({})).toBeNull();
    expect(classifyMapError(null)).toBeNull();
    expect(classifyMapError("not an event")).toBeNull();
  });
});

describe("MapLibreHost — the pointer stream belongs to a drawing tool (05 §4)", () => {
  async function loaded(): Promise<{
    readonly element: HTMLElement;
    readonly host: Awaited<ReturnType<typeof createMapLibreHost>>;
    readonly map: FakeMapInstance;
    readonly intents: MapIntent[];
  }> {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    const map = currentMap();
    map.fire("load");
    return { element, host, map, intents: recordIntents(host) };
  }

  it("does not emit a pointer stream for a pan", async () => {
    const { host, map, intents } = await loaded();

    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointermove", { x: 200, y: 200 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerup", { x: 200, y: 200 }));

    // 05 §4: pointer intents are drawing-tool-only. A pan is a camera gesture, so
    // nothing about it is forwarded — and a drag is not a click.
    expect(intents).toEqual([]);

    host.dispose();
  });

  it("emits exactly one tap for an unmoved pan press, as a resolved intent", async () => {
    const { host, map, intents } = await loaded();

    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerup", { x: 10, y: 10 }));

    expect(intents).toEqual([{ type: "map-click", coordinate: COORDINATE }]);

    host.dispose();
  });

  it("lets a place pill consume a tap before any ride object under it", async () => {
    fake.state.glyphs = "https://tiles.example/fonts/{fontstack}/{range}.pbf";
    const { host, map, intents } = await loaded();
    fake.state.queryFeatures = [
      { layer: { id: MAP_LAYER_IDS.routeSelected }, properties: { id: "route_a" } },
      { layer: { id: MAP_LAYER_IDS.placePill }, properties: { id: "hh:venue-1" } },
    ];

    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerup", { x: 10, y: 10 }));

    expect(intents).toEqual([
      { type: "place-click", placeId: "hh:venue-1", coordinate: COORDINATE },
    ]);

    host.dispose();
  });

  it("shows a pointer cursor over place pills", async () => {
    fake.state.glyphs = "https://tiles.example/fonts/{fontstack}/{range}.pbf";
    const { host, map } = await loaded();
    fake.state.queryFeatures = [
      { layer: { id: MAP_LAYER_IDS.placePill }, properties: { id: "hh:venue-1" } },
    ];

    map.fire("mousemove", { point: { x: 10, y: 10 } });

    expect(map.getCanvas().style.cursor).toBe("pointer");
    host.dispose();
  });

  it("does not let place layers steal a drawing gesture", async () => {
    fake.state.glyphs = "https://tiles.example/fonts/{fontstack}/{range}.pbf";
    const { host, map, intents } = await loaded();
    fake.state.queryFeatures = [
      { layer: { id: MAP_LAYER_IDS.placePill }, properties: { id: "hh:venue-1" } },
    ];
    host.dispatch({ type: "tool-change", tool: "sketch" });
    intents.length = 0;

    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointermove", { x: 80, y: 90 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerup", { x: 80, y: 90 }));

    expect(intents.map((intent) => intent.type)).toEqual([
      "pointer-down",
      "pointer-move",
      "pointer-up",
      "gesture-commit",
    ]);

    host.dispose();
  });

  it("keeps route overlap resolution separate from place hits", async () => {
    const { host, map, intents } = await loaded();
    fake.state.queryFeatures = [
      { layer: { id: MAP_LAYER_IDS.routeSelected }, properties: { id: "route_a" } },
      { layer: { id: MAP_LAYER_IDS.routeAlternative }, properties: { id: "route_b" } },
    ];

    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerup", { x: 10, y: 10 }));

    expect(intents).toEqual([
      {
        type: "overlap-click",
        candidates: [
          { kind: "route", routeId: "route_a" },
          { kind: "route", routeId: "route_b" },
        ],
        coordinate: COORDINATE,
      },
    ]);

    host.dispose();
  });

  it("keeps a tremor below the threshold a tap, and a real drag not a tap", async () => {
    const { host, map, intents } = await loaded();

    // 3px of tremor: the rider tapped (05 §4 + 12 §10's 44px targets).
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointermove", { x: 12, y: 11 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerup", { x: 12, y: 11 }));
    expect(intents.map((intent) => intent.type)).toEqual(["map-click"]);

    // A centimetre of travel: a camera gesture, and no click at all.
    intents.length = 0;
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointermove", { x: 60, y: 60 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerup", { x: 60, y: 60 }));
    expect(intents).toEqual([]);

    host.dispose();
  });

  it("forwards the full stream, then one commit, for a drawing tool", async () => {
    const { host, map, intents } = await loaded();
    host.dispatch({ type: "tool-change", tool: "point-drag" });
    intents.length = 0;

    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointermove", { x: 80, y: 90 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerup", { x: 80, y: 90 }));

    // The stream is the transport; the machine decides what the release means, and
    // one release has exactly one outcome (05 §4).
    expect(intents.map((intent) => intent.type)).toEqual([
      "pointer-down",
      "pointer-move",
      "pointer-up",
      "gesture-commit",
    ]);
    expect(intents.at(-1)).toMatchObject({ tool: "point-drag" });

    host.dispose();
  });

  it("reports a cancellation without inventing a release", async () => {
    const { host, map, intents } = await loaded();
    host.dispatch({ type: "tool-change", tool: "point-drag" });
    intents.length = 0;

    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointermove", { x: 80, y: 90 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointercancel", { x: 80, y: 90 }));

    // A cancelled pointer is not a release: the gesture is dropped, and the only
    // thing the rider hears is that it was dropped.
    expect(intents.map((intent) => intent.type)).toEqual(["pointer-down", "pointer-move", "gesture-cancel"]);

    host.dispose();
  });

  it("drops an in-flight gesture on Escape, without committing it", async () => {
    const { host, map, intents } = await loaded();
    host.dispatch({ type: "tool-change", tool: "point-drag" });
    intents.length = 0;

    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointermove", { x: 80, y: 90 }));
    host.dispatch({ type: "escape" });
    // A release after the cancellation must not commit: the pointer no longer owns
    // the stream, and the machine never invents a gesture.
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerup", { x: 80, y: 90 }));

    expect(intents.map((intent) => intent.type)).toEqual([
      "pointer-down",
      "pointer-move",
      "gesture-cancel",
    ]);

    host.dispose();
  });

  it("resolves what the press grabbed, for a gesture-scoped point drag", async () => {
    const { host, map, intents } = await loaded();
    fake.state.queryFeatures = [
      {
        layer: { id: MAP_LAYER_IDS.pointFinish },
        properties: { id: "pt_finish" },
      },
    ];

    // A press on the destination with the neutral tool is a one-gesture point
    // drag (05 §4), and the finish resolves as a point — the ref its own feature is
    // selected by (4.0 review finding 7).
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointermove", { x: 90, y: 90 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerup", { x: 90, y: 90 }));

    expect(intents).toHaveLength(4);
    expect(intents[0]).toMatchObject({
      type: "pointer-down",
      ref: { kind: "point", pointId: "pt_finish" },
    });
    expect(intents.at(-1)).toMatchObject({ type: "gesture-commit", tool: "point-drag" });

    host.dispose();
  });

  it("captures the pointer for every owned gesture, so a release is always received", async () => {
    const { host, map } = await loaded();

    // A pan emits no stream, but the gesture still has to end: without capture a
    // drag that leaves the canvas would never deliver its release, and the machine
    // would keep ownership and ignore the next press.
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    expect(fake.state.captures).toEqual([1]);

    host.dispose();
  });

  it("clears ownership on release, so the next gesture is accepted", async () => {
    const { host, map, intents } = await loaded();

    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerup", { x: 10, y: 10 }));
    expect(intents.map((intent) => intent.type)).toEqual(["map-click"]);

    // A second gesture, with a tool that owns the stream: if the first release had
    // not cleared ownership, this press would be ignored entirely.
    host.dispatch({ type: "tool-change", tool: "point-drag" });
    intents.length = 0;
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerdown", { x: 10, y: 10 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointermove", { x: 80, y: 90 }));
    map.getCanvasContainer().dispatchEvent(pointerEvent("pointerup", { x: 80, y: 90 }));

    expect(intents.map((intent) => intent.type)).toEqual([
      "pointer-down",
      "pointer-move",
      "pointer-up",
      "gesture-commit",
    ]);

    host.dispose();
  });

  it("reports a camera gesture so automatic fit can suspend", async () => {
    const { host, map, intents } = await loaded();
    const before = Number(fake.state.instances.length);

    // A rider pan/zoom carries their own original event, which is what distinguishes
    // it from our own programmatic fit (05 §8).
    map.fire("movestart", { originalEvent: { type: "pointerdown" } });
    map.fire("moveend");

    expect(intents).toEqual([{ type: "camera-changed" }]);
    expect(before).toBe(1);

    host.dispose();
  });

  it("reports the visible extent on moveend and immediately to settled subscribers", async () => {
    const { host, map } = await loaded();
    const onViewport = vi.fn();
    const unsubscribe = host.onViewport?.(onViewport);

    expect(onViewport).toHaveBeenCalledWith({
      minLon: -75.3,
      minLat: 39.9,
      maxLon: -74.9,
      maxLat: 40.2,
    });
    map.fire("moveend");
    expect(onViewport).toHaveBeenCalledTimes(2);

    unsubscribe?.();
    map.fire("moveend");
    expect(onViewport).toHaveBeenCalledTimes(2);
    host.dispose();
  });
});

/**
 * Load health and bounded self-heal (4.0s).
 *
 * The failure this suite exists for was silent: under heavy concurrent load a
 * cold page load could abort the style fetch, lose the WebGL context and leave
 * the app with a map element, no tiles and no error — "an empty map" as far as
 * anything could tell.
 *
 * Three behaviours make that state impossible, and each is asserted here against
 * the real host and the fake renderer:
 *
 * - a load that never produces data is a **failure**, bounded in time and
 *   reported as `data-map-load`, never an indefinite `loading`;
 * - exactly **one automatic recovery** per load, into a fresh renderer and a
 *   fresh container child (a lost WebGL context is never reused), and a second
 *   failure is terminal;
 * - a rider-initiated `retry()` is exactly **one more renderer**, and a recovered
 *   map is handed the scene and the camera it had.
 */
describe("MapLibreHost — load health and bounded self-heal (4.0s)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A host whose style loaded but which never produces a single tile. */
  async function starved(): Promise<{
    readonly element: HTMLElement;
    readonly host: MapHost;
  }> {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    currentMap().fire("style.load");
    return { element, host };
  }

  it("publishes `loading` and then `ready` once the style and its data are in", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("loading");

    const statuses: unknown[] = [];
    host.onStatus?.((status) => statuses.push(status));
    const map = currentMap();
    map.fire("style.load");
    map.fire("load");
    map.fire("sourcedata", { sourceId: MAP_SOURCE_IDS.routes });

    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("ready");
    expect(element.getAttribute(MAP_LOAD_REASON_ATTRIBUTE)).toBeNull();
    expect(element.getAttribute(MAP_ERROR_ATTRIBUTE)).toBeNull();
    // A late subscriber is told the state that already holds, not left waiting.
    expect(statuses).toEqual([
      { state: "loading", reason: null },
      { state: "ready", reason: null },
    ]);

    host.dispose();
  });

  it("fails a starved load after the bound, then recovers exactly once", async () => {
    const { element, host } = await starved();

    // No data event of any kind for the whole bound: not "an empty map", a
    // failed load.
    vi.advanceTimersByTime(TILE_STARVATION_MS);
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("retrying");
    expect(element.getAttribute(MAP_LOAD_REASON_ATTRIBUTE)).toBe("tile");
    // The failure channel describes the renderer that is on screen; the reason
    // the load is still retrying is the load-reason attribute's job.
    expect(element.getAttribute(MAP_ERROR_ATTRIBUTE)).toBeNull();
    expect(fake.state.instances).toHaveLength(1 + MAX_AUTOMATIC_RETRIES);
    // The dead renderer is gone (one removal) and exactly one mount remains: a
    // recovery never stacks two canvases or two WebGL contexts.
    expect(fake.state.removals).toBe(1);
    expect(element.querySelectorAll(`.${MAP_ATTEMPT_CLASS}`)).toHaveLength(1);

    // The second attempt starves too. The bound holds: that is `failed`, not
    // another attempt.
    currentMap().fire("style.load");
    vi.advanceTimersByTime(TILE_STARVATION_MS);
    expect(fake.state.instances).toHaveLength(1 + MAX_AUTOMATIC_RETRIES);
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("failed");
    expect(element.getAttribute(MAP_LOAD_REASON_ATTRIBUTE)).toBe("tile");
    // The terminal state carries the failure on the S1 channel too: this is what
    // a browser gate fails on.
    expect(element.getAttribute(MAP_ERROR_ATTRIBUTE)).toBe("tile");

    host.dispose();
  });

  it("fails a boot that never reports anything at all, after the boot bound", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    // No `style.load` and no error event: the renderer is silent, which is exactly
    // what an aborted style fetch looks like from out here. The boot backstop is
    // the only thing that can tell "still coming" from "never".
    vi.advanceTimersByTime(BOOT_WATCHDOG_MS);
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("retrying");
    expect(element.getAttribute(MAP_LOAD_REASON_ATTRIBUTE)).toBe("style");
    expect(fake.state.instances).toHaveLength(1 + MAX_AUTOMATIC_RETRIES);

    host.dispose();
  });

  it("does not count a hidden page's silence as a failure", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden" as DocumentVisibilityState);
    const { element, host } = await starved();

    vi.advanceTimersByTime(TILE_STARVATION_MS * 3);
    // Nothing paints while the tab is hidden, so nothing was proven: the bound
    // waits instead of declaring a working load dead.
    expect(fake.state.instances).toHaveLength(1);
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("loading");

    visibility.mockReturnValue("visible" as DocumentVisibilityState);
    vi.advanceTimersByTime(TILE_STARVATION_MS);
    expect(fake.state.instances).toHaveLength(2);

    host.dispose();
    visibility.mockRestore();
  });

  it("rebuilds after a lost WebGL context, restoring the scene and the camera", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    host.applyScene(scene());
    const first = currentMap();
    first.fire("style.load");
    first.fire("load");
    first.fire("sourcedata", { sourceId: MAP_SOURCE_IDS.routes });
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("ready");
    const writesBefore = fake.state.dataWrites.filter(
      (write) => write.source === MAP_SOURCE_IDS.routes,
    ).length;
    expect(writesBefore).toBeGreaterThan(0);

    first.fire("webglcontextlost");
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("retrying");
    expect(element.getAttribute(MAP_LOAD_REASON_ATTRIBUTE)).toBe("context-lost");
    expect(fake.state.instances).toHaveLength(2);
    // The lost context is never reused: a brand-new renderer is constructed,
    // and it opens on the camera the rider was already looking at.
    expect(fake.state.constructorOptions[1]?.["bounds"]).toEqual(first.getBounds().toArray());

    const second = currentMap();
    second.fire("style.load");
    second.fire("load");
    const writesAfter = fake.state.dataWrites.filter(
      (write) => write.source === MAP_SOURCE_IDS.routes,
    ).length;
    // The rider's route is drawn on the recovered map, not just the basemap.
    expect(writesAfter).toBeGreaterThan(writesBefore);
    second.fire("sourcedata", { sourceId: MAP_SOURCE_IDS.routes });
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("ready");
    // The map is drawing again, so the failure channel says so: a recovered map
    // must not keep claiming to be broken.
    expect(element.getAttribute(MAP_ERROR_ATTRIBUTE)).toBeNull();

    host.dispose();
  });

  it("spends one renderer per explicit rider retry, and never loops", async () => {
    const { element, host } = await starved();
    vi.advanceTimersByTime(TILE_STARVATION_MS);
    currentMap().fire("style.load");
    vi.advanceTimersByTime(TILE_STARVATION_MS);
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("failed");
    expect(fake.state.instances).toHaveLength(2);

    // The rider asks once: exactly one renderer, exactly one attempt.
    host.retry?.();
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("retrying");
    expect(fake.state.instances).toHaveLength(3);
    // Two bounds of silence later the rider's attempt has failed too, and the
    // host has not started a loop behind their back.
    vi.advanceTimersByTime(TILE_STARVATION_MS * 2);
    expect(fake.state.instances).toHaveLength(3);
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("failed");

    // A second click is a second attempt, still exactly one per action.
    host.retry?.();
    expect(fake.state.instances).toHaveLength(4);
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("retrying");

    host.dispose();
  });

  it("keeps a loaded map drawing when the renderer reports a later error", async () => {
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);
    const map = currentMap();
    map.fire("style.load");
    map.fire("load");
    map.fire("sourcedata", { sourceId: MAP_SOURCE_IDS.routes });
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("ready");

    // 05 §22: after the map has drawn, a reported failure is the bounded notice's
    // business — it must not tear a working map down.
    map.fire("error", { error: new Error("tile failed"), tile: { x: 1, y: 2, z: 3 } });

    expect(element.getAttribute(MAP_ERROR_ATTRIBUTE)).toBe("tile");
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("ready");
    expect(fake.state.instances).toHaveLength(1);

    host.dispose();
  });

  it("recovers a renderer that fails to start, but never retries one the device cannot give", async () => {
    fake.state.constructorError = new Error("Failed to initialize WebGL context");
    const element = container();
    const host = await createMapLibreHost(element, OPTIONS);

    // A constructor failure is transient evidence (driver pressure, a lost GPU
    // process), so it gets the one automatic retry like any other load failure.
    expect(fake.state.instances).toHaveLength(0);
    expect(fake.state.constructorOptions).toHaveLength(2);
    expect(element.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("failed");

    // The device cannot provide the context at all: one attempt, no retry loop,
    // and the honest surface plus the ride.
    const capability = container();
    fake.state.constructorError = new Error("Failed to initialize WebGL2 context");
    const degraded = await createMapLibreHost(capability, OPTIONS);
    expect(fake.state.constructorOptions).toHaveLength(3);
    expect(capability.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("failed");
    expect(capability.getAttribute(MAP_LOAD_REASON_ATTRIBUTE)).toBe("webgl-unavailable");
    expect(() => degraded.applyScene(scene())).not.toThrow();
    expect(() => degraded.retry?.()).not.toThrow();
    expect(fake.state.constructorOptions).toHaveLength(4);
    expect(capability.getAttribute(MAP_LOAD_ATTRIBUTE)).toBe("failed");

    degraded.dispose();
    host.dispose();
  });
});
