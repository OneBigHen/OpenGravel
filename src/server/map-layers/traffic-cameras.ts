/**
 * Multi-state traffic-camera map-layer provider.
 *
 * Only adapters whose state bounding box intersects the current map view are
 * contacted. Partial state failures do not blank neighboring states; the layer
 * is unavailable only when every relevant configured adapter fails.
 */

import type {
  InfoFeature,
  LngLat,
  MapLayerBounds,
} from "@/application/map-layers";
import {
  TRAFFIC_CAMERA_ADAPTERS,
  type TrafficCameraAdapter,
  type TrafficCameraRecord,
  type TrafficCameraState,
} from "@/server/traffic-cameras/registry";

import type { LayerProvider, ProviderContext } from "./providers";

const DEFAULT_STATES: readonly TrafficCameraState[] = ["PA", "NJ", "NY", "DE", "MD", "VA", "WV", "OH"];

function intersects(a: MapLayerBounds, b: MapLayerBounds): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function inside(bounds: MapLayerBounds, point: LngLat): boolean {
  return point[0] >= bounds.west && point[0] <= bounds.east && point[1] >= bounds.south && point[1] <= bounds.north;
}

function enabledStates(env: ProviderContext["env"]): ReadonlySet<TrafficCameraState> {
  const general = env["TRAFFIC_CAMERAS_ENABLED"] === "1";
  const configured = env["TRAFFIC_CAMERAS_STATES"]?.split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is TrafficCameraState => DEFAULT_STATES.includes(value as TrafficCameraState)) ?? [];
  const states = new Set<TrafficCameraState>(general ? (configured.length > 0 ? configured : DEFAULT_STATES) : []);
  // Backward compatibility for the first PA-only implementation.
  if (env["PA511_CAMERAS_ENABLED"] === "1") states.add("PA");
  return states;
}

export function relevantTrafficCameraAdapters(
  bounds: MapLayerBounds,
  env: ProviderContext["env"],
): readonly TrafficCameraAdapter[] {
  const enabled = enabledStates(env);
  return TRAFFIC_CAMERA_ADAPTERS.filter((adapter) =>
    enabled.has(adapter.state) &&
    intersects(bounds, adapter.bounds) &&
    (adapter.requiresKey === undefined || (env[adapter.requiresKey]?.trim() ?? "") !== ""));
}

function feature(camera: TrafficCameraRecord): InfoFeature {
  return {
    id: `traffic-camera:${camera.state}:${camera.id}`,
    layerId: "traffic-cameras",
    name: camera.name,
    detail: camera.detail === null ? camera.provider : `${camera.detail} · ${camera.state}`,
    weight: camera.videoAvailable ? 1 : 0,
    geometry: { type: "Point", coordinates: camera.coordinates },
    media: {
      previewUrl: camera.previewUrl,
      playbackUrl: camera.playbackUrl,
      sourceHref: camera.sourceHref,
      refreshSeconds: camera.previewUrl === null ? null : 10,
      videoAvailable: camera.videoAvailable,
    },
  };
}

export const trafficCamerasProvider: LayerProvider = {
  id: "traffic-cameras",
  layers: ["traffic-cameras"],
  ttlMs: 60_000,
  async load(bounds, _layers, context) {
    const adapters = relevantTrafficCameraAdapters(bounds, context.env);
    if (adapters.length === 0) throw new Error("No traffic-camera provider configured for this view");

    const answers = await Promise.allSettled(adapters.map((adapter) => adapter.load(context)));
    const successes = answers.flatMap((answer) => answer.status === "fulfilled" ? [[...answer.value]] : []);
    if (successes.length === 0) throw new Error("All traffic-camera providers failed");

    const deduped = new Map<string, TrafficCameraRecord>();
    for (const camera of successes.flat()) {
      if (inside(bounds, camera.coordinates)) deduped.set(`${camera.state}:${camera.id}`, camera);
    }
    return [...deduped.values()].map(feature);
  },
};
