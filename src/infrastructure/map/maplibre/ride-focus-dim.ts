/**
 * Map first (owner, 2026-11-12): two quiet-down rules the host applies to the
 * style it is given, written as pure plans so they can be tested without a map.
 *
 * - While a ride is on the map, the discovery layers (twisty roads, gravel,
 *   curated rides, road history) step back to a third of their strength, so the
 *   ride and its choices are what the eye finds. They return in full when the
 *   ride is cleared.
 * - Over satellite imagery, the basemap's street lines step back: the imagery
 *   already shows the roads, and white streets made every ride look the same.
 */

import { scaleOpacity } from "./scale-opacity";
import type { HostedStyleLayer } from "./visual-detail";

/** How strong the discovery layers stay while a ride is on the map. */
export const RIDE_FOCUS_DIM = 0.35;
/** How strong the basemap streets stay over satellite imagery. */
export const SATELLITE_ROAD_OPACITY = 0.4;

export const RIDE_FOCUS_DIM_LAYERS: readonly (readonly [string, string])[] = [
  ["ogv-info-line", "line-opacity"],
  ["ogv-info-line-casing", "line-opacity"],
  ["ogv-info-surface", "line-opacity"],
  ["ogv-info-point", "circle-opacity"],
  ["ogv-info-point", "circle-stroke-opacity"],
];

export interface PaintChange {
  readonly id: string;
  readonly property: string;
  readonly value: unknown;
}

/**
 * The paint changes that bring the discovery layers to `focused`, given what the
 * style holds now. `originals` (layer|property → original value) is updated in
 * place. A value other than our own dim is the layer's original strength: first
 * time here, or the style reloaded and re-added it.
 */
export function rideFocusChanges(
  layers: readonly HostedStyleLayer[],
  focused: boolean,
  originals: Map<string, unknown>,
): readonly PaintChange[] {
  const changes: PaintChange[] = [];
  for (const [id, property] of RIDE_FOCUS_DIM_LAYERS) {
    const layer = layers.find((candidate) => candidate.id === id);
    if (layer === undefined) continue;
    const key = `${id}|${property}`;
    const now = layer.paint?.[property];
    if (focused) {
      const dimmed = originals.has(key) ? JSON.stringify(scaleOpacity(originals.get(key), RIDE_FOCUS_DIM)) : null;
      if (JSON.stringify(now) === dimmed) continue;
      originals.set(key, now);
      changes.push({ id, property, value: scaleOpacity(now, RIDE_FOCUS_DIM) });
    } else if (originals.has(key)) {
      changes.push({ id, property, value: originals.get(key) ?? null });
      originals.delete(key);
    }
  }
  return changes;
}

/** Basemap street layers: line layers drawn from a road source layer. */
export function isBasemapRoadLayer(layer: HostedStyleLayer): boolean {
  return layer.type === "line" && ["transportation", "road", "roads"].includes(layer["source-layer"] ?? "");
}
