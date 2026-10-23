/**
 * A recording `MapHost` for component tests (05 §2–§9).
 *
 * The MapLibre host needs WebGL, so jsdom cannot exercise it; the browser gate
 * does. What jsdom *can* exercise is the seam: that the component creates exactly
 * one host, pushes every scene into it, forwards every intent out of it, requests
 * fits only when the workspace says so, and disposes it. This double records all
 * of that, so a component test asserts the contract instead of a renderer.
 */

import type { RideCamera } from "@/application/map/ride-camera";
import { DEFAULT_MAP_EXTENT, type MapExtent } from "@/application/map/build-map-scene";
import type { InteractionEvent } from "@/application/map/interaction";
import type { MapInsets } from "@/application/map/insets";
import type {
  MapCameraState,
  MapHost,
  MapHostFactory,
  MapHostOptions,
  MapLoadStatus,
  MapRenderError,
} from "@/application/map/map-host";
import type { MapIntent, MapScene } from "@/application/map/types";

export interface StubFit {
  readonly extent: MapExtent;
  readonly insets: MapInsets;
}

export interface StubMapHost extends MapHost {
  /** Every scene pushed into this host, in order. */
  readonly scenes: MapScene[];
  readonly fits: StubFit[];
  /** Every heading-up ride camera the surface asked for (DV-10). */
  readonly follows: RideCamera[];
  /** Every zoom step the rider's zoom buttons asked for, in order (05 §9). */
  readonly zooms: number[];
  /** How many times the compass asked the map to face north. */
  readonly northResets: number;
  readonly events: InteractionEvent[];
  /** How many times `dispose()` was called. */
  readonly disposals: number;
  /** How many rider-initiated recovery attempts the workspace asked for. */
  readonly retries: number;
  /** Where and with what the factory was called; filled by the factory. */
  readonly container: HTMLElement | null;
  readonly options: MapHostOptions | null;
  /** Records the factory's call context (the stub is created before it is known). */
  bind(container: HTMLElement, options: MapHostOptions): void;
  /** Push an intent as if the rider had produced it on the map. */
  emit(intent: MapIntent): void;
  /**
   * Report a renderer failure exactly as the MapLibre host would (05 §22): the
   * machine-readable attribute goes on the container, and every error listener
   * hears it. A test uses this to drive the UI's bounded notice without WebGL.
   */
  failWith(error: MapRenderError): void;
  /**
   * Drive a load-status transition exactly as the MapLibre host would (4.0s):
   * `data-map-load` on the container and every status listener, including the
   * replay a late subscriber gets.
   */
  reportStatus(status: MapLoadStatus): void;
  /** Drive the visible extent after the surface subscribes (OGV-D-274). */
  reportViewport(extent: MapExtent): void;
  /**
   * Drive a camera reading exactly as the MapLibre host would (05 §9): every
   * camera listener hears it, including the replay a late subscriber gets.
   */
  reportCamera(camera: MapCameraState): void;
  lastScene(): MapScene | null;
  /** Drop every recorded call, keeping the subscription. */
  reset(): void;
}

export function createStubMapHost(): StubMapHost {
  const listeners = new Set<(intent: MapIntent) => void>();
  const errorListeners = new Set<(error: MapRenderError) => void>();
  const statusListeners = new Set<(status: MapLoadStatus) => void>();
  const viewportListeners = new Set<(extent: MapExtent) => void>();
  const cameraListeners = new Set<(camera: MapCameraState) => void>();
  const scenes: MapScene[] = [];
  const fits: StubFit[] = [];
  const follows: RideCamera[] = [];
  const events: InteractionEvent[] = [];
  const zooms: number[] = [];
  let northResets = 0;
  let disposals = 0;
  let retries = 0;
  // A fresh renderer is `loading` until it says otherwise (4.0s), which is also
  // the state a late subscriber must be told about.
  let status: MapLoadStatus = { state: "loading", reason: null };
  // An unturned, mid-zoom camera, so the default compass is hidden and neither
  // zoom button claims a limit it does not know about.
  let camera: MapCameraState = {
    bearing: 0,
    zoom: 12,
    minZoom: 0,
    maxZoom: 22,
    metersPerPixel: 38.2,
  };
  let container: HTMLElement | null = null;
  let hostOptions: MapHostOptions | null = null;
  const host: StubMapHost = {
    scenes,
    fits,
    follows,
    zooms,
    events,
    get northResets(): number {
      return northResets;
    },
    get disposals(): number {
      return disposals;
    },
    get retries(): number {
      return retries;
    },
    get container(): HTMLElement | null {
      return container;
    },
    get options(): MapHostOptions | null {
      return hostOptions;
    },
    bind(nextContainer: HTMLElement, nextOptions: MapHostOptions): void {
      container = nextContainer;
      hostOptions = nextOptions;
    },
    applyScene(scene: MapScene): void {
      scenes.push(scene);
    },
    fitBounds(extent: MapExtent, insets: MapInsets): void {
      fits.push({ extent, insets });
    },
    followCamera(camera: RideCamera): void {
      follows.push(camera);
    },
    dispatch(event: InteractionEvent): void {
      events.push(event);
    },
    onIntent(listener: (intent: MapIntent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onError(listener: (error: MapRenderError) => void): () => void {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    onStatus(listener: (next: MapLoadStatus) => void): () => void {
      statusListeners.add(listener);
      // The real host replays: a subscriber that attaches after the map already
      // settled must not wait for a transition that has happened.
      listener(status);
      return () => statusListeners.delete(listener);
    },
    onViewport(listener: (extent: MapExtent) => void): () => void {
      viewportListeners.add(listener);
      listener(DEFAULT_MAP_EXTENT);
      return () => viewportListeners.delete(listener);
    },
    onCamera(listener: (next: MapCameraState) => void): () => void {
      cameraListeners.add(listener);
      // The real host replays the camera that holds, so a compass mounted into an
      // already-turned map points the right way at once.
      listener(camera);
      return () => cameraListeners.delete(listener);
    },
    zoomBy(delta: number): void {
      zooms.push(delta);
    },
    faceNorth(): void {
      northResets += 1;
      // The real host eases to north; the double says the same thing, so the
      // compass's visible state follows without WebGL.
      host.reportCamera({ ...camera, bearing: 0 });
    },
    retry(): void {
      retries += 1;
      // The real host publishes `retrying` before it rebuilds; the double says
      // the same thing, so the UI's chip is exercised without WebGL.
      host.reportStatus({ state: "retrying", reason: null });
    },
    dispose(): void {
      listeners.clear();
      errorListeners.clear();
      statusListeners.clear();
      viewportListeners.clear();
      cameraListeners.clear();
      disposals += 1;
    },
    reportStatus(next: MapLoadStatus): void {
      status = next;
      const element = container;
      if (element !== null) {
        element.setAttribute("data-map-load", next.state);
        if (next.reason === null) element.removeAttribute("data-map-load-reason");
        else element.setAttribute("data-map-load-reason", next.reason);
      }
      for (const listener of [...statusListeners]) listener(next);
    },
    reportViewport(extent: MapExtent): void {
      for (const listener of [...viewportListeners]) listener(extent);
    },
    reportCamera(next: MapCameraState): void {
      camera = next;
      for (const listener of [...cameraListeners]) listener(next);
    },
    emit(intent: MapIntent): void {
      for (const listener of [...listeners]) listener(intent);
    },
    failWith(error: MapRenderError): void {
      container?.setAttribute("data-map-error", error.kind);
      for (const listener of [...errorListeners]) listener(error);
    },
    lastScene(): MapScene | null {
      return scenes.length === 0 ? null : (scenes[scenes.length - 1] ?? null);
    },
    reset(): void {
      scenes.length = 0;
      fits.length = 0;
      follows.length = 0;
      zooms.length = 0;
      events.length = 0;
    },
  };
  return host;
}

export interface StubMapHostFactory {
  readonly factory: MapHostFactory;
  readonly hosts: StubMapHost[];
  readonly containers: HTMLElement[];
  readonly options: MapHostOptions[];
}

/** A factory that mints one stub per call and records every call. */
export function createStubMapHostFactory(): StubMapHostFactory {
  const hosts: StubMapHost[] = [];
  const containers: HTMLElement[] = [];
  const options: MapHostOptions[] = [];
  return {
    hosts,
    containers,
    options,
    factory: (container: HTMLElement, hostOptions: MapHostOptions): MapHost => {
      const host = createStubMapHost();
      host.bind(container, hostOptions);
      hosts.push(host);
      containers.push(container);
      options.push(hostOptions);
      return host;
    },  };
}
