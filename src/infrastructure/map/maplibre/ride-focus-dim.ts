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
  ["ogv-info-line-minor", "line-opacity"],
  ["ogv-info-line-casing-minor", "line-opacity"],
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

/** How strong the basemap streets stay while a ride is shown (Day and Night). */
export const RIDE_FOCUS_ROAD_OPACITY = 0.6;
/** How strong the streets stay over satellite imagery while a ride is shown. */
export const SATELLITE_RIDE_ROAD_OPACITY = 0.25;

/**
 * Phone first PF-5 (owner, 2026-11-12: "dark roads, one bright line"): the
 * share of their own opacity the basemap's street lines keep. A ride on the
 * map pushes them back on every look; satellite already pushes them back.
 */
export function basemapRoadOpacityFactor(state: { readonly satellite: boolean; readonly rideShown: boolean }): number {
  if (state.satellite) return state.rideShown ? SATELLITE_RIDE_ROAD_OPACITY : SATELLITE_ROAD_OPACITY;
  return state.rideShown ? RIDE_FOCUS_ROAD_OPACITY : 1;
}

/** One street layer's own opacity, and the value this plan last set on it. */
export interface RoadOpacityEntry {
  readonly original: unknown;
  readonly applied: unknown;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The `line-opacity` changes that bring every basemap street layer to
 * `factor` of its own strength. `entries` (layer id → original and applied
 * value) is updated in place. A value that is not the one this plan set is the
 * layer's own: first time here, or the style reloaded at full strength. At a
 * factor of 1 every layer gets its own value back and the entry is dropped.
 */
export function basemapRoadChanges(
  layers: readonly HostedStyleLayer[],
  factor: number,
  entries: Map<string, RoadOpacityEntry>,
): readonly PaintChange[] {
  const changes: PaintChange[] = [];
  const seen = new Set<string>();
  for (const layer of layers) {
    if (!isBasemapRoadLayer(layer)) continue;
    seen.add(layer.id);
    const now = layer.paint?.["line-opacity"];
    const entry = entries.get(layer.id);
    const original = entry !== undefined && same(now, entry.applied) ? entry.original : now;
    if (factor === 1) {
      entries.delete(layer.id);
      if (!same(now, original)) changes.push({ id: layer.id, property: "line-opacity", value: original ?? null });
      continue;
    }
    const target = scaleOpacity(original, factor);
    entries.set(layer.id, { original, applied: target });
    if (!same(now, target)) changes.push({ id: layer.id, property: "line-opacity", value: target });
  }
  for (const id of [...entries.keys()]) if (!seen.has(id)) entries.delete(id);
  return changes;
}
